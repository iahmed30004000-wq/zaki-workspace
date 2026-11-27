import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { ingest, logFile, openStored, PENDING_PATH } from "@/server/services/files";
import { checksumHex, sniffMimeType } from "@/server/files/sniff";
import type { ReceivedUpload } from "@/server/files/upload-stream";
import { notHiddenFor } from "@/server/chat/hidden-messages";
import { sendMessage } from "@/server/chat/messages";
import type { MessageDto } from "@/server/chat/dto";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import { GIF_MAX_BYTES, GIF_MAX_SAVED, GIF_MIME, GIF_RECENT, type GifDto, type GifListDto } from "@/lib/chat/gifs";

/**
 * «صور متحركة» — A PERSON'S OWN LIBRARY OF GIFS. No outside provider, no key, no request to anybody.
 *
 * THE ONE RULE: a kept GIF is a POINTER (`SavedGif`), never a copy and never a right. Every list, read and send asks again whether THIS person may have the file now:
 *  - it is their OWN upload to the library (a `StoredFile` of purpose `GIF` they uploaded): theirs, wherever it was sent since; or
 *  - some message that carries the very same file is alive (not deleted) in a conversation they can read NOW by the ordinary reading rule.
 * So: leave a topic, be removed from a space, have the message deleted or the conversation purged, and a GIF kept from there is no longer listed (not even its name), read or
 * sent. The row stays, and it comes back if the access does. Sending it links the same file to a new message (what «حوّل» does): the people of THAT conversation read it
 * through the ordinary attachment rule, and nobody else gains anything. A message cannot be made from a file id the page names: the page names a library row or an
 * attachment, and the server finds the file.
 *
 * The ordinary reading rule here is `canRead` WITHOUT silent oversight: a person who only reads a conversation in silence keeps nothing from it (keeping is their own trace,
 * like a pin or a reminder). What an owner may read as a space's admin or through their own rows, they may keep.
 */

export const GIF_PURPOSE = "GIF";

/** The library is a part of the new chat screen: `chatLayoutV2` AND `chatGifs`. */
export async function gifsOn(orgId: string): Promise<boolean> {
  return (await isFeatureOn(orgId, "chatLayoutV2")) && (await isFeatureOn(orgId, "chatGifs"));
}

export async function assertGifsOn(orgId: string): Promise<void> {
  await assertFeatureOn(orgId, "chatLayoutV2");
  await assertFeatureOn(orgId, "chatGifs");
}

const uploadLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 });

const gone = () => new NotFoundError("gifs.e.not_found");

/** The file of a row, when it is still a GIF this company holds. */
const liveGifFile = (orgId: string) => ({ orgId, deletedAt: null, path: { not: PENDING_PATH }, mimeType: GIF_MIME });

/** May the person read this conversation by the ordinary rule? One answer per conversation per request. */
async function ordinaryReader(ctx: Pick<OrgAccessContext, "userId" | "orgId">): Promise<(conversationId: string) => Promise<boolean>> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const known = new Map<string, boolean>();
  return async (conversationId) => {
    const had = known.get(conversationId);
    if (had !== undefined) return had;
    const facts = await loadConversationFacts(ctx.userId, conversationId);
    const ok =
      !!facts &&
      !!org &&
      facts.orgId === ctx.orgId &&
      canRead(facts, { ...org, oversight: false }) &&
      // a guest reads topics only (the same rule as opening the conversation)
      !(org.role === "GUEST" && facts.kind !== "TOPIC");
    known.set(conversationId, ok);
    return ok;
  };
}

interface Link {
  attachmentId: string;
  fileId: string;
  width: number | null;
  height: number | null;
}

/** For each of these files, ONE live message that carries it where the person may read (the newest); a file with none is absent. */
async function readableLinks(ctx: Pick<OrgAccessContext, "userId" | "orgId">, fileIds: string[]): Promise<Map<string, Link>> {
  const found = new Map<string, Link>();
  if (fileIds.length === 0) return found;
  const rows = await db.messageAttachment.findMany({
    where: { fileId: { in: fileIds }, message: { orgId: ctx.orgId, deletedAt: null } },
    select: { id: true, fileId: true, width: true, height: true, message: { select: { conversationId: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const mayRead = await ordinaryReader(ctx);
  for (const row of rows) {
    if (found.has(row.fileId) || !row.message) continue;
    if (await mayRead(row.message.conversationId)) found.set(row.fileId, { attachmentId: row.id, fileId: row.fileId, width: row.width, height: row.height });
  }
  return found;
}

const isOwnUpload = (file: { purpose: string; uploaderId: string }, userId: string): boolean => file.purpose === GIF_PURPOSE && file.uploaderId === userId;

function sizeOfMeta(meta: unknown): { width?: number; height?: number } {
  const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  return {
    ...(typeof m["width"] === "number" ? { width: m["width"] } : {}),
    ...(typeof m["height"] === "number" ? { height: m["height"] } : {}),
  };
}

const dims = (d: { width: number | null; height: number | null } | undefined): { width?: number; height?: number } => ({
  ...(d && typeof d.width === "number" ? { width: d.width } : {}),
  ...(d && typeof d.height === "number" ? { height: d.height } : {}),
});

interface Kept {
  rowId: string;
  fileId: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
}

/** The rows of MY library that I may have right now, the newest used first. */
async function availableRows(ctx: Pick<OrgAccessContext, "userId" | "orgId">): Promise<Kept[]> {
  const rows = await db.savedGif.findMany({
    where: { userId: ctx.userId, orgId: ctx.orgId, file: liveGifFile(ctx.orgId) },
    select: { id: true, fileId: true, file: { select: { name: true, size: true, purpose: true, uploaderId: true, meta: true } } },
    orderBy: [{ usedAt: "desc" }, { id: "desc" }],
  });
  const links = await readableLinks(ctx, rows.map((r) => r.fileId));
  return rows.flatMap((row) => {
    const link = links.get(row.fileId);
    const own = isOwnUpload(row.file, ctx.userId);
    if (!own && !link) return [];
    const size = link ? dims(link) : sizeOfMeta(row.file.meta);
    return [{ rowId: row.id, fileId: row.fileId, name: row.file.name, size: row.file.size, ...size }];
  });
}

/** What I sent lately: the GIFs of my own live messages (a forward included) that I can still read. */
async function recentlySent(ctx: Pick<OrgAccessContext, "userId" | "orgId">, keptFileIds: ReadonlySet<string>): Promise<GifDto[]> {
  const rows = await db.messageAttachment.findMany({
    where: { message: { orgId: ctx.orgId, authorId: ctx.userId, deletedAt: null, ...notHiddenFor(ctx.userId) }, file: liveGifFile(ctx.orgId) },
    select: { id: true, fileId: true, width: true, height: true, file: { select: { name: true } }, message: { select: { conversationId: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: GIF_RECENT * 5,
  });
  const mayRead = await ordinaryReader(ctx);
  const seen = new Set<string>();
  const out: GifDto[] = [];
  for (const row of rows) {
    if (out.length >= GIF_RECENT) break;
    if (seen.has(row.fileId) || !row.message) continue;
    if (!(await mayRead(row.message.conversationId))) continue;
    seen.add(row.fileId);
    out.push({ attachmentId: row.id, name: row.file.name, url: `/api/chat/attachments/${row.id}`, ...dims(row), ...(keptFileIds.has(row.fileId) ? { kept: true } : {}) });
  }
  return out;
}

export async function listMyGifs(ctx: OrgAccessContext): Promise<GifListDto> {
  await assertGifsOn(ctx.orgId);
  const kept = await availableRows(ctx);
  const saved: GifDto[] = kept.slice(0, GIF_MAX_SAVED).map((k) => ({
    savedId: k.rowId,
    name: k.name,
    url: `/api/chat/gifs/${k.rowId}/file`,
    ...(k.width !== undefined ? { width: k.width } : {}),
    ...(k.height !== undefined ? { height: k.height } : {}),
  }));
  return { saved, recent: await recentlySent(ctx, new Set(kept.map((k) => k.fileId))) };
}

async function assertRoom(ctx: OrgAccessContext): Promise<void> {
  // only what the person can see counts: a row that is out of reach is not something they could take out to make room
  if ((await availableRows(ctx)).length >= GIF_MAX_SAVED) throw new ForbiddenError("gifs.e.too_many");
}

async function keepFile(ctx: OrgAccessContext, fileId: string): Promise<{ id: string }> {
  const where = { userId_orgId_fileId: { userId: ctx.userId, orgId: ctx.orgId, fileId } };
  return db.savedGif.upsert({ where, create: { userId: ctx.userId, orgId: ctx.orgId, fileId }, update: { usedAt: new Date() }, select: { id: true } });
}

interface Source {
  fileId: string;
  width: number | null;
  height: number | null;
}

/** The GIF a message carries, when that message is alive in a conversation the person can read now; anything else is «not found», whatever the reason. */
async function sourceOfAttachment(ctx: OrgAccessContext, attachmentId: string): Promise<Source> {
  const att = await db.messageAttachment.findFirst({
    where: { id: attachmentId, message: { orgId: ctx.orgId, deletedAt: null }, file: liveGifFile(ctx.orgId) },
    select: { fileId: true, width: true, height: true, message: { select: { conversationId: true } } },
  });
  if (!att?.message || !(await (await ordinaryReader(ctx))(att.message.conversationId))) throw gone();
  return { fileId: att.fileId, width: att.width, height: att.height };
}

/** One of MY rows, when I may have its file now. */
async function sourceOfSaved(ctx: OrgAccessContext, savedId: string): Promise<Source> {
  const row = await db.savedGif.findFirst({
    where: { id: savedId, userId: ctx.userId, orgId: ctx.orgId, file: liveGifFile(ctx.orgId) },
    select: { fileId: true, file: { select: { purpose: true, uploaderId: true, meta: true } } },
  });
  if (!row) throw gone();
  const link = (await readableLinks(ctx, [row.fileId])).get(row.fileId);
  if (link) return { fileId: row.fileId, width: link.width, height: link.height };
  if (!isOwnUpload(row.file, ctx.userId)) throw gone();
  const size = sizeOfMeta(row.file.meta);
  return { fileId: row.fileId, width: size.width ?? null, height: size.height ?? null };
}

export const gifSaveSchema = z.object({ attachmentId: z.string().min(1).max(64) }).strict();

/** «احفظ بالصور المتحركة»: keep the GIF of a message I can read. Saving it again moves it to the front. */
export async function saveGifFromAttachment(ctx: OrgAccessContext, attachmentId: string): Promise<{ id: string }> {
  await assertGifsOn(ctx.orgId);
  const source = await sourceOfAttachment(ctx, attachmentId);
  const had = await db.savedGif.findUnique({ where: { userId_orgId_fileId: { userId: ctx.userId, orgId: ctx.orgId, fileId: source.fileId } }, select: { id: true } });
  if (!had) await assertRoom(ctx);
  return keepFile(ctx, source.fileId);
}

async function checksumFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").slice(0, 32);
}

async function gifSize(upload?: ReceivedUpload, bytes?: Uint8Array): Promise<{ width: number; height: number } | undefined> {
  try {
    const sharp = (await import("sharp")).default;
    const m = await (upload ? sharp(upload.path).metadata() : sharp(Buffer.from(bytes!)).metadata());
    return m.width && m.height ? { width: m.width, height: m.height } : undefined;
  } catch {
    return undefined; // sharp missing or unable: the GIF is kept without its size
  }
}

/**
 * «ارفع صورة متحركة»: a new GIF straight into MY library. The bytes decide that it is a GIF. It goes through `ingest` like every upload of the company (Drive first, the server's
 * disk as the fallback) with its own purpose, `GIF`: it is no library file, and the sweep of unsent chat uploads leaves it alone.
 */
export async function uploadMyGif(ctx: OrgAccessContext, input: { name: string; upload?: ReceivedUpload; bytes?: Uint8Array }): Promise<{ id: string }> {
  await assertGifsOn(ctx.orgId);
  if (!uploadLimiter.check(`chat.gif.${ctx.userId}`).ok) throw new RateLimitedError(60, "chat.e.rate_limited");
  uploadLimiter.hit(`chat.gif.${ctx.userId}`);
  const size = input.upload?.size ?? input.bytes?.length ?? 0;
  const prefix = input.upload?.prefix ?? input.bytes;
  if (!prefix || size === 0) throw new ForbiddenError("chat.f.empty");
  if (sniffMimeType(prefix) !== GIF_MIME) throw new ForbiddenError("gifs.e.only_gif");
  if (size > GIF_MAX_BYTES) throw new ForbiddenError("gifs.e.too_large");
  await assertRoom(ctx);
  const measured = await gifSize(input.upload, input.bytes);
  const checksum = input.upload ? await checksumFile(input.upload.path) : checksumHex(input.bytes!);
  const made = await ingest(
    ctx,
    input.upload ? { name: input.name, path: input.upload.path, size, prefix: input.upload.prefix } : { name: input.name, bytes: input.bytes! },
    undefined,
    GIF_PURPOSE,
    measured,
    { sniffedMime: GIF_MIME, maxBytes: GIF_MAX_BYTES, checksum },
  );
  await logFile(ctx.orgId, "file.gif_upload", { fileId: made.id, mime: made.mimeType, size, checksum });
  return keepFile(ctx, made.id);
}

/**
 * Takes one out of MY library. The messages that carry the file are not touched. An upload of mine that was never sent has nothing else holding it: it is put out of reach, like
 * a deleted library file (its row stays for the storage sweep).
 */
export async function removeSavedGif(ctx: OrgAccessContext, savedId: string): Promise<void> {
  await assertGifsOn(ctx.orgId);
  await db.$transaction(async (tx) => {
    const row = await tx.savedGif.findFirst({ where: { id: savedId, userId: ctx.userId, orgId: ctx.orgId }, select: { fileId: true, file: { select: { purpose: true, uploaderId: true } } } });
    if (!row) throw gone();
    await tx.savedGif.delete({ where: { id: savedId } });
    if (isOwnUpload(row.file, ctx.userId)) {
      await tx.storedFile.updateMany({ where: { id: row.fileId, deletedAt: null, chatLinks: { none: {} }, savedGifs: { none: {} } }, data: { deletedAt: new Date() } });
    }
  });
}

/** The bytes of one of MY kept GIFs, judged now. */
export async function openSavedGif(ctx: OrgAccessContext, savedId: string) {
  await assertGifsOn(ctx.orgId);
  const source = await sourceOfSaved(ctx, savedId);
  return openStored(ctx.orgId, source.fileId);
}

export const gifSendSchema = z
  .object({
    conversationId: z.string().min(1).max(64),
    savedId: z.string().min(1).max(64).optional(),
    attachmentId: z.string().min(1).max(64).optional(),
    replyToId: z.string().min(1).max(64).optional(),
    replyQuote: z.string().max(1000).optional(),
    clientId: z.string().min(1).max(64).optional(),
    silent: z.boolean().optional(),
  })
  .strict();

export type GifSendBody = z.infer<typeof gifSendSchema>;

/**
 * One tap sends it. First: may I HAVE this GIF now (`sourceOfSaved` / `sourceOfAttachment`)? Then the ordinary send: may I write THERE, with its quota, its reply rule, its
 * silent rule, its idempotency by `clientId` and its notifications (`sendMessage`), which links the file to the new message inside its own transaction.
 */
export async function sendGifMessage(ctx: OrgAccessContext, input: GifSendBody): Promise<MessageDto> {
  await assertGifsOn(ctx.orgId);
  if ((input.savedId === undefined) === (input.attachmentId === undefined)) throw new ValidationError([{ path: "savedId", message: "gifs.e.bad_request" }]);
  const source = input.savedId !== undefined ? await sourceOfSaved(ctx, input.savedId) : await sourceOfAttachment(ctx, input.attachmentId!);
  const sent = await sendMessage(
    ctx,
    input.conversationId,
    {
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      ...(input.replyQuote ? { replyQuote: input.replyQuote } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.silent ? { silent: true } : {}),
    },
    { gif: source },
  );
  // a kept one moves to the front of the library
  await db.savedGif.updateMany({ where: { userId: ctx.userId, orgId: ctx.orgId, fileId: source.fileId }, data: { usedAt: new Date() } });
  return sent;
}
