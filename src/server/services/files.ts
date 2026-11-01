import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { assertMemberCan } from "@/server/policy/actor";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { arabicSearch } from "@/lib/search/arabic";
import { rankedSearch } from "@/server/search/ranked";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { logEvent } from "@/server/services/integrations";
import { canReadConversation } from "@/server/policy/conversation";
import { MAX_FILE_BYTES, canManageFile, checksumHex, safeStoredName, sniffMimeType } from "@/server/files/sniff";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { driveIsDown, pauseDrive, resumeDrive, storageTarget } from "@/server/files/storage-policy";
import { insideLibrary, serverCopyOf } from "@/server/files/server-copy";
import { mayReadApprovalFile } from "@/server/services/approval-access";
import { MAX_PAGE_SCAN_BYTES, countPdfPages } from "@/server/files/pdf-pages";
import {
  DriveStoreError,
  chatDriveSpace,
  type DriveSpace,
  driveIdOf,
  driveNameFor,
  isDrivePath,
  moveToOldVersions,
  readAllFromDrive,
  readFromDrive,
  trashOnDrive,
  uploadToDrive,
} from "@/server/files/drive-store";

export const fileLibrary = process.env.UPLOAD_DIR || join(process.cwd(), ".data", "uploads");

/**
 * `path` of a row whose bytes are not on disk (yet): `ingest` creates the row first - it needs the
 * id for the file name - and writes the bytes second. Such a row is never a file: it is not listed,
 * not counted as a version and not served. Anything that reads `StoredFile` directly must skip it
 * too (`where: { path: { not: PENDING_PATH } }`).
 */
export const PENDING_PATH = "pending";
const STORED = { path: { not: PENDING_PATH } } as const;

export const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/ogg", "application/pdf"]);
export const INLINE_TEXT = new Set(["text/plain", "application/zip"]);

export async function logFile(orgId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
  await logEvent(orgId, { direction: "IN", type, payload: payload as Prisma.InputJsonValue });
}

/* ---------------- where a library file is read ---------------- */

/**
 * EACH SPACE HAS ITS OWN LIBRARY (the owner's decision, 2026-10-25): inside a space, the files uploaded there; inside
 * «الشركة» also the files from before spaces had libraries.
 */
export interface FilePlace {
  spaceId: string | null;
  isHq: boolean;
}

export function filePlaceWhere(place: FilePlace): Prisma.StoredFileWhereInput {
  if (!place.spaceId) return { id: { in: [] } };
  return place.isHq ? { OR: [{ workspaceId: place.spaceId }, { workspaceId: null }] } : { workspaceId: place.spaceId };
}

/** A library file of a space the person cannot open is «not found» (one with no space is everybody's). */
async function assertOfMySpaces(userId: string, workspaceId: string | null): Promise<void> {
  if (workspaceId && !(await accessibleWorkspaceIds(userId)).includes(workspaceId)) throw new NotFoundError("files.not_found");
}

/* ---------------- reads ---------------- */

/**
 * The library files of the place whose name carries the words, spelled as people spell them (the search box):
 * names that START with the words first, then the ones that contain them, newest first inside each.
 */
export async function searchLibrary(orgId: string, place: FilePlace, q: string): Promise<Array<{ id: string; name: string }>> {
  const search = arabicSearch(q);
  if (!search) return [];
  return rankedSearch({
    query: {
      table: "StoredFile",
      search,
      rank: true,
      where: [
        Prisma.sql`"orgId" = ${orgId}`,
        Prisma.sql`"isLatest" = TRUE`,
        Prisma.sql`"deletedAt" IS NULL`,
        Prisma.sql`"purpose" = 'LIBRARY'`,
        Prisma.sql`"path" <> ${PENDING_PATH}`,
        // a library has one place: a space's own, and inside «الشركة» the files from before spaces had libraries
        place.spaceId
          ? place.isHq
            ? Prisma.sql`("workspaceId" = ${place.spaceId} OR "workspaceId" IS NULL)`
            : Prisma.sql`"workspaceId" = ${place.spaceId}`
          : Prisma.sql`FALSE`,
      ],
      order: Prisma.sql`"createdAt" DESC`,
    },
    take: 6,
    // the real rule, as ever: the same where as `listFiles`, narrowed to the pool
    load: (ids) =>
      db.storedFile.findMany({
        where: { orgId, isLatest: true, deletedAt: null, purpose: "LIBRARY", ...STORED, AND: [filePlaceWhere(place)], id: { in: ids } },
        select: { id: true, name: true },
      }),
  });
}

export async function listFiles(orgId: string, place?: FilePlace): Promise<
  Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    version: number;
    versions: number;
    previewable: boolean;
    uploader: string;
    uploaderId: string;
    createdAt: Date;
    familyId: string;
  }>
> {
  const here = place ? { AND: [filePlaceWhere(place)] } : {};
  const heads = await db.storedFile.findMany({
    where: { orgId, isLatest: true, deletedAt: null, purpose: "LIBRARY", ...STORED, ...here },
    orderBy: { createdAt: "desc" },
    include: { uploader: { select: { name: true } } },
  });
  const counts = await db.storedFile.groupBy({
    by: ["familyId"],
    where: { orgId, ...STORED, purpose: "LIBRARY", ...here },
    _count: { familyId: true },
  });
  const versionCount = new Map(counts.map((c) => [c.familyId, c._count.familyId]));
  return heads.map((f) => ({
    id: f.id,
    familyId: f.familyId,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    version: f.version,
    versions: versionCount.get(f.familyId) ?? 1,
    previewable: PREVIEWABLE.has(f.mimeType),
    uploader: f.uploader.name,
    uploaderId: f.uploaderId,
    createdAt: f.createdAt,
  }));
}

/**
 * The gate of the library routes (meta and bytes) for one stored file. A LIBRARY file is open to
 * the caller (the route has already refused guests). A CHAT/VOICE file is not a library file: it
 * opens only for someone who may read the conversation of a message it is attached to (the
 * OWNER silently; the file of a deleted message for the OWNER only), or for its uploader while no
 * message has claimed it yet - the same rule as /api/chat/attachments/[id]. Anything else is
 * 404, never 403, so a file id from another conversation says nothing.
 */
export async function assertMayReadFile(ctx: OrgAccessContext, id: string): Promise<void> {
  const f = await db.storedFile.findFirst({
    where: { id, orgId: ctx.orgId, deletedAt: null, ...STORED },
    select: {
      purpose: true,
      uploaderId: true,
      workspaceId: true,
      chatLinks: { select: { message: { select: { conversationId: true, deletedAt: true } } } },
    },
  });
  if (!f) throw new NotFoundError("files.not_found");
  // a library file: the library row of the person's grid, and of one of their spaces (or from before spaces had
  // libraries). A chat attachment is its conversation's, whatever the library box says.
  if (f.purpose === "LIBRARY") {
    await assertMemberCan(ctx, "files.view", "section.view_denied");
    return assertOfMySpaces(ctx.userId, f.workspaceId);
  }
  const messages = f.chatLinks.flatMap((l) => (l.message ? [l.message] : []));
  if (messages.length === 0 && f.uploaderId === ctx.userId) return;
  for (const m of messages) {
    if (m.deletedAt && ctx.orgRole !== "OWNER") continue;
    if (await canReadConversation(ctx.userId, m.conversationId)) return;
  }
  // a file attached to an approval request opens for the people who may read that request
  if (await mayReadApprovalFile({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }, id)) return;
  throw new NotFoundError("files.not_found");
}

/** Meta of the family of a file the caller may read (`assertMayReadFile` first). */
export async function getFileMeta(orgId: string, id: string) {
  const anchor = await db.storedFile.findFirst({
    where: { id, orgId, deletedAt: null, ...STORED },
    select: { familyId: true, isLatest: true },
  });
  if (!anchor) throw new NotFoundError("files.not_found");
  // meta always describes the family HEAD, whoever asked
  const head = anchor.isLatest
    ? await db.storedFile.findFirst({
        where: { id, orgId, deletedAt: null, ...STORED },
        include: { uploader: { select: { name: true } } },
      })
    : await db.storedFile.findFirst({
        where: { familyId: anchor.familyId, isLatest: true, deletedAt: null, ...STORED },
        include: { uploader: { select: { name: true } } },
      });
  if (!head) throw new NotFoundError("files.not_found");
  const versions = await db.storedFile.findMany({
    where: { familyId: head.familyId, ...STORED },
    orderBy: { version: "desc" },
    select: { id: true, version: true, size: true, createdAt: true, uploader: { select: { name: true } } },
  });
  return {
    id: head.id,
    name: head.name,
    mimeType: head.mimeType,
    size: head.size,
    version: head.version,
    versions: versions.map((v) => ({ id: v.id, version: v.version, size: v.size, createdAt: v.createdAt, uploader: v.uploader.name })),
    previewable: PREVIEWABLE.has(head.mimeType),
    textLike: INLINE_TEXT.has(head.mimeType),
    uploader: head.uploader.name,
    uploaderId: head.uploaderId,
    createdAt: head.createdAt,
  };
}

/**
 * Raw bytes for the proxy/download endpoints. Permission gate is in the caller: `assertMayReadFile`
 * for the library route, the conversation rule for the chat attachment route.
 */
export async function readStored(orgId: string, id: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const f = await db.storedFile.findFirst({ where: { id, orgId, deletedAt: null, ...STORED } });
  if (!f) throw new NotFoundError("files.not_found");
  let buffer: Buffer;
  try {
    buffer = isDrivePath(f.path) ? await readAllFromDrive(orgId, driveIdOf(f.path)) : await fs.readFile(join(fileLibrary, f.path));
  } catch (err) {
    throw driveReadError(err);
  }
  return { buffer, mimeType: f.mimeType, name: f.name };
}

/**
 * The page count of a PDF (`assertMayReadFile` first), or null when the file is not a PDF, is too big to be worth scanning or
 * keeps its pages where this cheap reading cannot see them (src/server/files/pdf-pages.ts).
 */
export async function pdfPageCount(orgId: string, id: string): Promise<number | null> {
  const f = await db.storedFile.findFirst({ where: { id, orgId, deletedAt: null, ...STORED }, select: { mimeType: true, size: true } });
  if (!f) throw new NotFoundError("files.not_found");
  if (f.mimeType !== "application/pdf" || f.size > MAX_PAGE_SCAN_BYTES) return null;
  return countPdfPages((await readStored(orgId, id)).buffer);
}

/** Drive gone for a moment is not «the file is gone». */
function driveReadError(err: unknown): NotFoundError {
  if (err instanceof DriveStoreError && err.status !== 404) return new NotFoundError("files.drive_unavailable");
  return new NotFoundError("files.missing_storage");
}

/**
 * A stored file opened for streaming (the download route): its size, and its bytes - all of them or
 * one inclusive range - read on demand from the server's disk or from Drive. Nothing is held in memory.
 * Permission gate is in the caller, as for `readStored`.
 */
export async function openStored(
  orgId: string,
  id: string,
): Promise<{ mimeType: string; name: string; size: number; stream: (range: { start: number; end: number } | null) => Promise<ReadableStream<Uint8Array>> }> {
  const f = await db.storedFile.findFirst({ where: { id, orgId, deletedAt: null, ...STORED }, select: { path: true, mimeType: true, name: true, size: true } });
  if (!f) throw new NotFoundError("files.not_found");
  if (isDrivePath(f.path)) {
    const driveId = driveIdOf(f.path);
    return {
      mimeType: f.mimeType,
      name: f.name,
      // the upload checked that Drive holds exactly `size` bytes
      size: f.size,
      stream: (range) => readFromDrive(orgId, driveId, range).catch((err: unknown) => Promise.reject(driveReadError(err))),
    };
  }
  const full = join(fileLibrary, f.path);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile()) throw new NotFoundError("files.missing_storage");
  return {
    mimeType: f.mimeType,
    name: f.name,
    size: stat.size,
    stream: (range) => fileStream(full, range ?? { start: 0, end: stat.size - 1 }),
  };
}

/**
 * The bytes start..end (inclusive) of a file on the server's disk, read 64 KB at a time as the response is
 * consumed. (A web stream by hand: `node:stream` is not resolvable in every bundle that imports this file.)
 */
async function fileStream(full: string, range: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
  const handle = await fs.open(full, "r");
  let at = range.start;
  const done = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    await handle.close().catch(() => undefined);
    controller.close();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const want = Math.min(64 * 1024, range.end - at + 1);
        if (want <= 0) return done(controller);
        const chunk = new Uint8Array(want);
        const { bytesRead } = await handle.read(chunk, 0, want, at);
        if (bytesRead === 0) return done(controller);
        at += bytesRead;
        controller.enqueue(chunk.subarray(0, bytesRead));
      } catch (err) {
        await handle.close().catch(() => undefined);
        controller.error(err);
      }
    },
    async cancel() {
      await handle.close().catch(() => undefined);
    },
  });
}

/* ---------------- writes ---------------- */

export interface IngestBytes {
  name: string;
  bytes: Uint8Array;
}

export interface IngestPath {
  name: string;
  path: string;
  size: number;
  prefix: Uint8Array;
}

export type IngestFile = IngestBytes | IngestPath;

function isIngestPath(input: IngestFile): input is IngestPath {
  return "path" in input;
}

/** Validate bytes, write to disk + DB as a new head in a version family. */
export async function ingest(
  ctx: OrgAccessContext,
  input: IngestFile,
  familyOf?: { familyId: string; latestVersion: number },
  purpose: "LIBRARY" | "CHAT" | "VOICE" | "AVATAR" = "LIBRARY",
  meta?: Record<string, unknown>,
  /**
   * `sniffedMime`: the chat's own sniffing (`sniffChatMedia`) already read the bytes WITH the declared
   * kind, which is the only way to tell audio/webm from video/webm; the plain sniffer here would
   * store a voice note as a video. Trusted callers only, never a client's claim.
   */
  opts: { sniffedMime?: string; workspaceId?: string | null; maxBytes?: number; checksum?: string } = {},
): Promise<{ id: string; version: number; mimeType: string }> {
  // a guest posts in the topics of their spaces (files and voice notes included), never in the library
  if (ctx.orgRole === "GUEST" && purpose === "LIBRARY") throw new ForbiddenError("chat.guest_forbidden");
  // adding to the library (a file or a new version) is its «يضيف ويعدّل» box; chat files are the topic's
  if (purpose === "LIBRARY") await assertMemberCan(ctx, "files.edit", "section.edit_denied");
  const size = isIngestPath(input) ? input.size : input.bytes.length;
  const prefix = isIngestPath(input) ? input.prefix : input.bytes;
  if (size === 0) throw new ForbiddenError("files.empty");
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES;
  if (size > maxBytes) throw new ForbiddenError(purpose === "LIBRARY" ? "files.too_large" : "chat.f.too_large");

  const mime = opts.sniffedMime ?? sniffMimeType(prefix);
  if (!mime) throw new ForbiddenError("files.unsupported");

  const display = safeStoredName(input.name.split(/[\\/]/).pop() ?? "file");
  const familyId = familyOf ? familyOf.familyId : "";
  const version = familyOf ? familyOf.latestVersion + 1 : 1;
  // a library file lives in a space: a new version in its family's, a new file in the one it was uploaded in
  const workspaceId =
    purpose !== "LIBRARY"
      ? null
      : familyOf
        ? ((await db.storedFile.findFirst({ where: { familyId, orgId: ctx.orgId }, select: { workspaceId: true } }))?.workspaceId ?? null)
        : (opts.workspaceId ?? null);
  const checksum = opts.checksum ?? (isIngestPath(input) ? await checksumFile(input.path) : checksumHex(input.bytes));

  // The row comes first (its id is part of the file name) and is PENDING until the bytes are on disk.
  const created = await db.storedFile.create({
    data: {
      orgId: ctx.orgId,
      uploaderId: ctx.userId,
      familyId,
      name: display,
      path: PENDING_PATH,
      mimeType: mime,
      size,
      version,
      purpose,
      workspaceId,
    },
    select: { id: true },
  });
  if (meta && Object.keys(meta).length > 0) {
    // Parameterised raw SQL until the generated client knows the column
    // (migration 20261024093000_stored_file_meta; the coordinator regenerates between waves).
    try {
      await db.$executeRaw`UPDATE "StoredFile" SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${created.id}`;
    } catch (err) {
      await db.storedFile.deleteMany({ where: { id: created.id } }).catch(() => undefined);
      throw err;
    }
  }

  const finalFamilyId = familyId || created.id;
  // A file goes to the owner's Drive FIRST when it is connected and healthy (library, chat attachments, voice notes; see
  // storage-policy.ts); on any Drive failure it is kept on the server instead, so an upload never fails because of Drive.
  // Written to one place, never both.
  let space: { of: DriveSpace | null } | null = null;
  let steppingDown: string | null = null;
  let path = "";
  let target: string | null = null;
  let updated: { id: string; version: number; mimeType: string };
  try {
    space = purpose !== "AVATAR" && (await storageTarget(ctx.orgId)).target === "drive" ? { of: purpose === "LIBRARY" ? await driveSpaceOf(workspaceId) : chatDriveSpace(ctx.orgId) } : null;
    steppingDown = space && familyOf ? await previousHeadPath(ctx.orgId, finalFamilyId) : null;
    if (space) {
      path = await uploadToDrive(ctx.orgId, {
        name: driveNameFor(display, version),
        mimeType: mime,
        ...(isIngestPath(input) ? { path: input.path, size } : { bytes: input.bytes }),
        space: space.of,
        fileId: created.id,
      }).then(
        (drivePath) => {
          resumeDrive(ctx.orgId);
          return drivePath;
        },
        async (err: unknown) => {
          // Drive itself is down (not just this file refused): the next minute's uploads skip it instead of each waiting
          if (driveIsDown(err)) pauseDrive(ctx.orgId);
          await logEvent(ctx.orgId, { direction: "OUT", type: "file.drive_failed", status: "FAILED", detail: err instanceof DriveStoreError ? err.message : "drive.error" });
          return "";
        },
      );
    }
    if (!path) {
      path = join(ctx.orgId, `${created.id}_v${version}_${display}`);
      target = join(fileLibrary, path);
      await fs.mkdir(join(fileLibrary, ctx.orgId), { recursive: true });
      if (isIngestPath(input)) await copyFile(input.path, target);
      else await fs.writeFile(target, input.bytes);
    }
    // The row becomes a file, and the previous head steps down, in ONE transaction.
    updated = await db.$transaction(async (tx) => {
      const row = await tx.storedFile.update({
        where: { id: created.id },
        data: { path, familyId: finalFamilyId },
        select: { id: true, version: true, mimeType: true },
      });
      if (familyOf) {
        await tx.storedFile.updateMany({
          where: { familyId: finalFamilyId, isLatest: true, id: { not: created.id } },
          data: { isLatest: false },
        });
      }
      return row;
    });
  } catch (err) {
    // Leave nothing behind. A row without its bytes is listed, then answers 404 on download
    // (a root-owned volume makes EVERY upload end up here).
    if (target) await fs.rm(target, { force: true }).catch(() => undefined);
    if (isDrivePath(path)) await trashOnDrive(ctx.orgId, driveIdOf(path)).catch(() => undefined);
    await db.storedFile.deleteMany({ where: { id: created.id } }).catch(() => undefined);
    throw err;
  }
  // the version that stepped down leaves the space folder for «نسخ قديمة» (tidiness only: never fails the upload)
  if (space && steppingDown && isDrivePath(steppingDown)) {
    await moveToOldVersions(ctx.orgId, driveIdOf(steppingDown), space.of).catch(() => undefined);
  }

  await logFile(ctx.orgId, "file.uploaded", {
    fileId: created.id,
    familyId: finalFamilyId,
    version,
    mime,
    size,
    checksum,
  });
  return { id: updated.id, version: updated.version, mimeType: updated.mimeType };
}

async function copyFile(source: string, target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(source);
    const output = createWriteStream(target);
    const fail = (err: unknown) => {
      input.destroy();
      output.destroy();
      reject(err);
    };
    input.on("error", fail);
    output.on("error", fail);
    output.on("finish", resolve);
    input.pipe(output);
  });
}

async function checksumFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").slice(0, 32);
}

/** The Drive folder of a library file's space (none: a file from before spaces had libraries). */
async function driveSpaceOf(workspaceId: string | null): Promise<DriveSpace | null> {
  if (!workspaceId) return null;
  return db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
}

async function previousHeadPath(orgId: string, familyId: string): Promise<string | null> {
  const head = await db.storedFile.findFirst({ where: { orgId, familyId, isLatest: true, deletedAt: null, ...STORED }, select: { path: true } });
  return head?.path ?? null;
}

/**
 * The bytes of a row that is being removed for good (an upload nobody claimed): the file on the server's disk, or the
 * Drive file (into Drive's bin: the owner's, for 30 days), and a verified server copy still waiting for the owner's
 * delete step. Never throws: a file already gone is the goal.
 */
export async function discardStoredBytes(orgId: string, f: { path: string; meta?: unknown }): Promise<void> {
  const drop = async (stored: string) => {
    const full = insideLibrary(fileLibrary, stored);
    if (full) await fs.rm(full, { force: true }).catch(() => undefined);
  };
  if (isDrivePath(f.path)) await trashOnDrive(orgId, driveIdOf(f.path)).catch(() => undefined);
  else await drop(f.path);
  const copy = serverCopyOf(f.meta);
  if (copy) await drop(copy.path);
}

/** Library files only: a chat file goes with its message, never through the library. */
export async function softDelete(ctx: OrgAccessContext, id: string): Promise<void> {
  const f = await db.storedFile.findFirst({
    where: { id, orgId: ctx.orgId, deletedAt: null, purpose: "LIBRARY", ...STORED },
    select: { id: true, uploaderId: true, isLatest: true, familyId: true, workspaceId: true },
  });
  if (!f) throw new NotFoundError("files.not_found");
  await assertMemberCan(ctx, "files.delete", "section.delete_denied");
  await assertOfMySpaces(ctx.userId, f.workspaceId);
  if (!canManageFile({ uploaderId: f.uploaderId, viewerId: ctx.userId, orgRole: ctx.orgRole })) {
    throw new ForbiddenError("files.no_perm");
  }
  await db.$transaction(async (tx) => {
    await tx.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    if (f.isLatest) {
      // a head was removed → promote the newest surviving version as the new head
      const heir = await tx.storedFile.findFirst({
        where: { familyId: f.familyId, deletedAt: null, ...STORED },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      if (heir) {
        await tx.storedFile.update({ where: { id: heir.id }, data: { isLatest: true } });
      }
    }
  });
  await logFile(ctx.orgId, "file.deleted", { fileId: id });
}
