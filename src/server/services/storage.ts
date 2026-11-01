import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError, type OrgAccessContext } from "@/server/auth";
import {
  DRIVE_PREFIX,
  DriveStoreError,
  chatDriveSpace,
  digestDriveFile,
  driveIdOf,
  driveNameFor,
  moveToOldVersions,
  trashOnDrive,
  uploadToDrive,
  type DriveSpace,
} from "@/server/files/drive-store";
import { insideLibrary, serverCopyOf } from "@/server/files/server-copy";
import { driveIsDown, pauseDrive, resumeDrive, storageTarget, type ServerReason } from "@/server/files/storage-policy";
import { fileLibrary, PENDING_PATH } from "@/server/services/files";
import { logEvent } from "@/server/services/integrations";

/**
 * THE STORAGE OF THE COMPANY'S FILES — what the owner sees and does about the server's disk filling up (his decision,
 * 2026-11-01). New files go to Google Drive first (storage-policy.ts); this is for what is already on the server:
 *
 *  1. `storageMeter`: how much the server holds, how much Drive holds, whether Drive is connected, and the copies on
 *     the server that were already moved and verified but are still on disk.
 *  2. `moveToDrive` («انقل الملفات القديمة للدرايف»): small batches, a dry run first, safe to stop and to run again.
 *     A file is read from the server, uploaded (Drive's own size and MD5 are checked by the upload), and only then
 *     does its row point at Drive. The server's copy is LEFT where it is, with its size and SHA-256 written on the
 *     row (`meta.serverCopy`): nothing is ever deleted by this step.
 *  3. `deleteServerCopies` («احذف نسخ السيرفر المتحقَّق منها»): a separate, explicit step. Each file is read back from
 *     Drive; the server's copy is removed only when Drive returns exactly the size and SHA-256 recorded at the move.
 *
 * ⚠️ Until step 3 runs, a moved file exists twice (the server's copy is only a safety net, nothing reads it).
 * 🔧 The meter counts these copies, and the owner removes them with one click once he is satisfied.
 * Only the OWNER (his rank) does any of this: the piece of the company that pays for the disk and the Drive.
 */

const BATCH_DEFAULT = 10;
const BATCH_MAX = 25;
/** A batch also stops after this many bytes (one request must not run for minutes). */
const BATCH_BYTES = 150 * 1024 * 1024;

export interface Tally {
  files: number;
  bytes: number;
}

export interface StorageMeter {
  /** Drive is connected and holds the library: a new file goes there. */
  target: "drive" | "server";
  /** Why new files go to the server (null while they go to Drive). */
  reason: ServerReason | null;
  /** Everything whose bytes are on the server's disk (profile pictures and verified copies awaiting deletion are not counted). */
  server: Tally;
  /** Files held by Drive. */
  drive: Tally;
  /** What «انقل الملفات القديمة للدرايف» would move now (the server's files, but profile pictures: they stay). */
  movable: Tally;
  /** Files already on Drive whose server copy is still on disk, verified at the move, waiting for the owner's delete step. */
  copies: Tally;
}

function assertOwner(ctx: OrgAccessContext): void {
  if (ctx.orgRole !== "OWNER") throw new ForbiddenError("storage.owner_only");
}

const tally = (r: { _count: { _all: number }; _sum: { size: number | null } }): Tally => ({ files: r._count._all, bytes: r._sum.size ?? 0 });

const onServer = (orgId: string): Prisma.StoredFileWhereInput => ({ orgId, path: { not: PENDING_PATH }, NOT: { path: { startsWith: DRIVE_PREFIX } } });
const movableWhere = (orgId: string): Prisma.StoredFileWhereInput => ({ ...onServer(orgId), purpose: { not: "AVATAR" } });

async function copiesTally(orgId: string): Promise<Tally> {
  const rows = await db.$queryRaw<Array<{ files: bigint; bytes: bigint | null }>>`
    SELECT COUNT(*) AS files, COALESCE(SUM("size"), 0) AS bytes FROM "StoredFile"
    WHERE "orgId" = ${orgId} AND "path" LIKE 'gdrive:%' AND jsonb_exists("meta", 'serverCopy')`;
  return { files: Number(rows[0]?.files ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
}

export async function storageMeter(ctx: OrgAccessContext): Promise<StorageMeter> {
  assertOwner(ctx);
  const orgId = ctx.orgId;
  const agg = { _count: { _all: true }, _sum: { size: true } } as const;
  const [state, server, drive, movable, copies] = await Promise.all([
    storageTarget(orgId),
    db.storedFile.aggregate({ where: onServer(orgId), ...agg }),
    db.storedFile.aggregate({ where: { orgId, path: { startsWith: DRIVE_PREFIX } }, ...agg }),
    db.storedFile.aggregate({ where: movableWhere(orgId), ...agg }),
    copiesTally(orgId),
  ]);
  return { target: state.target, reason: state.reason, server: tally(server), drive: tally(drive), movable: tally(movable), copies };
}

/* ---------------- one run at a time ---------------- */

const running = new Set<string>();

async function exclusive<T>(orgId: string, work: () => Promise<T>): Promise<T> {
  if (running.has(orgId)) throw new ValidationError([{ path: "storage", message: "storage.busy" }]);
  running.add(orgId);
  try {
    return await work();
  } finally {
    running.delete(orgId);
  }
}

export interface BatchOptions {
  /** `true`: only count what the step would touch. */
  dryRun?: boolean;
  limit?: number;
  /** The `next` of the previous batch (a file id): the run goes on after it. Left out: from the start. */
  after?: string | null;
}

export interface BatchResult {
  dryRun: boolean;
  /** Files this batch finished (moved to Drive / server copy removed). */
  done: number;
  bytes: number;
  /** Files this batch could not finish and left exactly as they were. */
  failed: number;
  /** Files whose bytes are not on the server's disk any more (nothing to move): reported, never invented. */
  missing: number;
  /** Where the next batch goes on from; null when this one reached the end. */
  next: string | null;
  /** Why the run stopped early (Drive down, or Drive not ready), else null. */
  stopped: "drive_unavailable" | null;
  /** The dry run's count: how many files and bytes the whole step would touch. */
  plan?: Tally;
}

const clampLimit = (n: number | undefined) => Math.max(1, Math.min(BATCH_MAX, Math.floor(n ?? BATCH_DEFAULT)));

async function sha256OfFile(full: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(full)) hash.update(chunk);
  return hash.digest("hex");
}

interface MovableRow {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  version: number;
  isLatest: boolean;
  purpose: string;
  workspaceId: string | null;
}

type Outcome = "moved" | "missing" | "failed" | "skipped";

async function moveOne(orgId: string, row: MovableRow): Promise<Outcome> {
  const full = insideLibrary(fileLibrary, row.path);
  if (!full) return "failed";
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile()) return "missing";
  // a file whose size is not what the row says is not trusted: it stays where it is
  if (stat.size !== row.size || stat.size === 0) return "failed";
  const sha256 = await sha256OfFile(full);
  const space: DriveSpace | null =
    row.purpose === "LIBRARY"
      ? row.workspaceId
        ? await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { id: true, name: true } })
        : null
      : chatDriveSpace(orgId);
  // Drive checks its own size and MD5 against the bytes it was sent (the upload fails on a mismatch)
  const drivePath = await uploadToDrive(orgId, { name: driveNameFor(row.name, row.version), mimeType: row.mimeType, path: full, size: stat.size, space, fileId: row.id });
  const note = JSON.stringify({ serverCopy: { path: row.path, sha256, size: stat.size } });
  // the row points at Drive only if it still points at the file we read (a second run, a replaced row: nobody is overwritten)
  const changed = await db.$executeRaw`
    UPDATE "StoredFile" SET "path" = ${drivePath}, "meta" = COALESCE("meta", '{}'::jsonb) || ${note}::jsonb
    WHERE "id" = ${row.id} AND "path" = ${row.path}`;
  if (changed === 0) {
    await trashOnDrive(orgId, driveIdOf(drivePath)).catch(() => undefined);
    return "skipped";
  }
  // an older version belongs in «نسخ قديمة» of its space folder, as a version that stepped down does (tidiness only)
  if (row.purpose === "LIBRARY" && !row.isLatest) await moveToOldVersions(orgId, driveIdOf(drivePath), space).catch(() => undefined);
  return "moved";
}

/**
 * «انقل الملفات القديمة للدرايف»: one small batch. `dryRun` only counts (the first thing the owner sees). Idempotent and
 * resumable: a file that is on Drive is not on the list any more; a failure leaves the file untouched and the run goes on
 * after it (`next`). The server's copies stay (see `deleteServerCopies`).
 */
export async function moveToDrive(ctx: OrgAccessContext, opts: BatchOptions = {}): Promise<BatchResult> {
  assertOwner(ctx);
  const orgId = ctx.orgId;
  if (opts.dryRun) {
    const plan = tally(await db.storedFile.aggregate({ where: movableWhere(orgId), _count: { _all: true }, _sum: { size: true } }));
    return { dryRun: true, done: 0, bytes: 0, failed: 0, missing: 0, next: null, stopped: null, plan };
  }
  return exclusive(orgId, async () => {
    const state = await storageTarget(orgId);
    // Drive must be ready (connected, the library on, not just failing): moving to a Drive that is not there loses nothing
    // but wastes the owner's time, so it is refused up front
    if (state.target !== "drive") throw new ForbiddenError("storage.drive_not_ready");
    const limit = clampLimit(opts.limit);
    const rows = (await db.storedFile.findMany({
      where: { ...movableWhere(orgId), ...(opts.after ? { id: { gt: opts.after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: { id: true, path: true, name: true, mimeType: true, size: true, version: true, isLatest: true, purpose: true, workspaceId: true },
    })) as MovableRow[];
    const batch = rows.slice(0, limit);
    const result: BatchResult = { dryRun: false, done: 0, bytes: 0, failed: 0, missing: 0, next: null, stopped: null };
    let last: string | null = null;
    for (const row of batch) {
      if (result.bytes >= BATCH_BYTES) break;
      last = row.id;
      try {
        const outcome = await moveOne(orgId, row);
        if (outcome === "moved") {
          result.done++;
          result.bytes += row.size;
          resumeDrive(orgId);
        } else if (outcome === "missing") result.missing++;
        else if (outcome === "failed") result.failed++;
      } catch (err) {
        result.failed++;
        if (driveIsDown(err)) {
          pauseDrive(orgId);
          result.stopped = "drive_unavailable";
          break;
        }
        // one file Drive refused (a mismatch, a bad answer): it stays on the server, the run goes on
        await logEvent(orgId, { direction: "OUT", type: "storage.move_failed", status: "FAILED", detail: err instanceof DriveStoreError ? err.message : "drive.error" });
      }
    }
    // the run goes on after the last file looked at, unless this batch looked at all of the rest of the list
    const lookedAtAll = !result.stopped && (batch.length === 0 || last === batch[batch.length - 1]?.id);
    result.next = lookedAtAll && rows.length <= limit ? null : last;
    await logEvent(orgId, { direction: "OUT", type: "storage.moved", payload: { moved: result.done, bytes: result.bytes, failed: result.failed, missing: result.missing } });
    return result;
  });
}

/**
 * «احذف نسخ السيرفر المتحقَّق منها»: the owner's separate, explicit step. One small batch of moved files: each one is read
 * back from Drive and compared with what the server's copy was at the move; only an exact match (size and SHA-256) removes
 * the server's copy and clears the note on the row. Anything else keeps the copy and is counted as failed.
 */
export async function deleteServerCopies(ctx: OrgAccessContext, opts: BatchOptions = {}): Promise<BatchResult> {
  assertOwner(ctx);
  const orgId = ctx.orgId;
  if (opts.dryRun) {
    const plan = await copiesTally(orgId);
    return { dryRun: true, done: 0, bytes: 0, failed: 0, missing: 0, next: null, stopped: null, plan };
  }
  return exclusive(orgId, async () => {
    const limit = clampLimit(opts.limit);
    const after = opts.after ?? "";
    const rows = await db.$queryRaw<Array<{ id: string; path: string; size: number; meta: unknown }>>`
      SELECT "id", "path", "size", "meta" FROM "StoredFile"
      WHERE "orgId" = ${orgId} AND "path" LIKE 'gdrive:%' AND jsonb_exists("meta", 'serverCopy') AND "id" > ${after}
      ORDER BY "id" ASC LIMIT ${limit + 1}`;
    const batch = rows.slice(0, limit);
    const result: BatchResult = { dryRun: false, done: 0, bytes: 0, failed: 0, missing: 0, next: null, stopped: null };
    for (const row of batch) {
      const copy = serverCopyOf(row.meta);
      if (!copy) {
        result.failed++;
        continue;
      }
      try {
        const drive = await digestDriveFile(orgId, driveIdOf(row.path));
        // exactly what the server's copy was: otherwise the copy is the only good one and stays
        if (drive.size !== copy.size || drive.size !== row.size || drive.sha256 !== copy.sha256) {
          result.failed++;
          continue;
        }
        const full = insideLibrary(fileLibrary, copy.path);
        if (!full) {
          result.failed++;
          continue;
        }
        await fs.rm(full, { force: true });
        await db.$executeRaw`UPDATE "StoredFile" SET "meta" = NULLIF("meta" - 'serverCopy', '{}'::jsonb) WHERE "id" = ${row.id}`;
        result.done++;
        result.bytes += copy.size;
      } catch (err) {
        result.failed++;
        if (driveIsDown(err)) {
          result.stopped = "drive_unavailable";
          break;
        }
      }
    }
    result.next = rows.length > limit && !result.stopped ? (batch[batch.length - 1]?.id ?? null) : null;
    await logEvent(orgId, { direction: "OUT", type: "storage.copies_deleted", payload: { deleted: result.done, bytes: result.bytes, failed: result.failed } });
    return result;
  });
}
