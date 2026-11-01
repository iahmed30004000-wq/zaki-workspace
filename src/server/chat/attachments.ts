import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { ReceivedUpload } from "@/server/files/upload-stream";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import {
  CHAT_LIMITS,
  checksumHex,
  kindOfMime,
  sniffChatMedia,
  type ChatAttachmentKind,
} from "@/server/files/sniff";

export type { ChatAttachmentKind };
import { discardStoredBytes, ingest, logFile, openStored, PENDING_PATH } from "@/server/services/files";

/**
 * FILES-VOICE owns the implementation; SERVICES calls these from the message service.
 * The signatures are the contract from 11-PHASE3-SHARED.md — do not change them.
 */

export type ClaimUploadsInput = {
  orgId: string;
  uploaderId: string;
  conversationId: string;
  messageId: string;
  attachmentIds: string[];
};

export type ClaimedFile = {
  id: string;
  mimeType: string;
  size: number;
  name: string;
  purpose: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  peaks: unknown;
  createdAt: Date;
};

const MAX_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** The voice cap the server clamps to (the client records at most 5 minutes). */
export const MAX_VOICE_MS = 300_000;

/**
 * An uploaded chat file before it is claimed by a message: the row carries everything the
 * attachment needs in `meta` (an upload is created BEFORE its message, so there is nothing
 * to update when the message is written — claim only links).
 */
type UploadMeta = {
  kind: ChatAttachmentKind;
  width?: number;
  height?: number;
  durationMs?: number;
  peaks?: number[];
};

function readMeta(raw: unknown): UploadMeta {
  if (!raw || typeof raw !== "object") return { kind: "FILE" };
  const m = raw as Record<string, unknown>;
  const meta: UploadMeta = {
    kind: (typeof m.kind === "string" && (m.kind as ChatAttachmentKind)) || "FILE",
  };
  if (typeof m.width === "number" && Number.isFinite(m.width)) meta.width = Math.round(m.width);
  if (typeof m.height === "number" && Number.isFinite(m.height)) meta.height = Math.round(m.height);
  if (typeof m.durationMs === "number" && Number.isFinite(m.durationMs)) meta.durationMs = Math.max(0, Math.round(m.durationMs));
  if (Array.isArray(m.peaks)) meta.peaks = m.peaks.filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  return meta;
}

/* ---------------- upload (route layer) ---------------- */

export interface ChatUploadInput {
  actor: Actor;
  name: string;
  bytes?: Uint8Array;
  upload?: ReceivedUpload;
  declaredKind: ChatAttachmentKind | "VOICE";
  durationMs?: unknown;
  peaks?: unknown;
}

export type ChatUploadResult = {
  id: string;
  kind: ChatAttachmentKind;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  peaks?: number[];
};

function clampPeaks(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const nums: number[] = [];
  for (const v of raw.slice(0, 100)) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isFinite(n)) continue;
    nums.push(Math.max(0, Math.min(100, Math.round(n))));
  }
  return nums.length > 0 ? nums : undefined;
}

/**
 * The uploader must be able to post SOMEWHERE (ACTIVE org member; guests post in topics),
 * but the conversation is not known at upload time, so the file binds to the uploader only.
 * Everything the attachment row will need travels in `meta` on the StoredFile row.
 */
export async function createChatUpload(input: ChatUploadInput): Promise<ChatUploadResult> {
  const upload = input.upload;
  const bytes = input.bytes;
  if (!upload && !bytes) throw new ForbiddenError("files.empty");
  const size = upload?.size ?? bytes!.length;
  const prefix = upload?.prefix ?? bytes!;
  // anyone ACTIVE may upload for the chat (a guest posts in the topics of his spaces)
  if (size === 0) throw new ForbiddenError("files.empty");

  const sn = sniffChatMedia(prefix, input.declaredKind, input.name);
  if (!sn.ok) throw new ForbiddenError(sn.key);
  const limit = input.declaredKind === "VOICE" ? CHAT_LIMITS.VOICE : CHAT_LIMITS[sn.kind];
  if (size > limit) throw new ForbiddenError("chat.f.too_large");

  const meta: UploadMeta = { kind: sn.kind };
  let width: number | undefined;
  let height: number | undefined;
  if (sn.kind === "IMAGE") {
    const dims = await imageDimensions(upload?.path, bytes);
    if (dims) {
      width = dims.width;
      height = dims.height;
      meta.width = dims.width;
      meta.height = dims.height;
    }
  }
  let durationMs: number | undefined;
  let peaks: number[] | undefined;
  if (input.declaredKind === "VOICE") {
    durationMs = clampDuration(input.durationMs);
    peaks = clampPeaks(input.peaks);
    meta.durationMs = durationMs;
    meta.peaks = peaks;
    meta.kind = "AUDIO";
  }

  const checksum = upload ? await checksumFile(upload.path) : checksumHex(bytes!);
  const made = await ingest(
    { orgId: input.actor.orgId, orgRole: input.actor.role, userId: input.actor.userId },
    upload ? { name: input.name, path: upload.path, size: upload.size, prefix: upload.prefix } : { name: input.name, bytes: bytes! },
    undefined,
    input.declaredKind === "VOICE" ? "VOICE" : "CHAT",
    meta,
    { sniffedMime: sn.mime, maxBytes: limit, checksum }, // audio/webm stays audio/webm (the plain sniffer says video/webm)
  );

  await logFile(input.actor.orgId, "file.chat_upload", {
    fileId: made.id,
    kind: meta.kind,
    mime: made.mimeType,
    size,
    checksum,
  });

  const out: ChatUploadResult = { id: made.id, kind: meta.kind, mime: made.mimeType, size };
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  if (durationMs !== undefined) out.durationMs = durationMs;
  if (peaks !== undefined) out.peaks = peaks;
  return out;
}

function clampDuration(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(MAX_VOICE_MS, Math.round(n));
}

/** Image width/height from the real bytes with sharp (the client's numbers are never trusted). */
async function imageDimensions(path?: string, bytes?: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const m = await (path ? sharp(path).metadata() : sharp(Buffer.from(bytes!)).metadata());
    return m.width && m.height ? { width: m.width, height: m.height } : null;
  } catch {
    return null; // sharp missing/unusable: attachments still work, just without dimensions
  }
}

async function checksumFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").slice(0, 32);
}

/* ---------------- claim (called inside the message service transaction) ---------------- */

/**
 * The contract function: links previously uploaded chat files to a message. Every id must
 * belong to the uploader, be an unclaimed CHAT/VOICE upload younger than 24 h, and exist in
 * this organization. Runs inside the message service's transaction — a failure rolls the
 * message back too.
 */
export async function claimUploads(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  input: ClaimUploadsInput,
): Promise<void> {
  const ids = [...new Set(input.attachmentIds)];
  if (ids.length === 0) return;
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new ForbiddenError("chat.f.too_many");
  const oldest = new Date(Date.now() - MAX_UPLOAD_AGE_MS);
  const files = await tx.storedFile.findMany({
    where: { id: { in: ids }, orgId: input.orgId, uploaderId: input.uploaderId, deletedAt: null, path: { not: PENDING_PATH }, purpose: { in: ["CHAT", "VOICE"] } },
    select: { id: true, purpose: true, mimeType: true, createdAt: true },
  });
  if (files.length !== ids.length) throw new NotFoundError("chat.f.not_found");
  for (const f of files) {
    if (f.createdAt < oldest) throw new ForbiddenError("chat.f.expired");
  }
  const already = await tx.messageAttachment.findMany({ where: { fileId: { in: ids } }, select: { fileId: true } });
  if (already.length > 0) throw new ForbiddenError("chat.f.already_claimed");
  // a file an approval request already holds is that request's (src/server/services/approvals.ts), not a message's
  const heldByApproval = await tx.approvalAttachment.count({ where: { fileId: { in: ids } } });
  if (heldByApproval > 0) throw new ForbiddenError("chat.f.already_claimed");
  // Read the upload metadata the same way it was written (raw SQL until the client is regenerated).
  const metaById = new Map<string, UploadMeta>();
  for (const id of ids) {
    const rows = (await tx.$queryRaw`SELECT meta FROM "StoredFile" WHERE id = ${id}`) as Array<{ meta: unknown }>;
    metaById.set(id, readMeta(rows[0]?.meta));
  }
  await tx.messageAttachment.createMany({
    data: files.map((f, i) => {
      const meta = metaById.get(f.id) ?? { kind: "FILE" as const };
      return {
        messageId: input.messageId,
        fileId: f.id,
        kind: f.purpose === "VOICE" ? "AUDIO" : kindOfMime(f.mimeType),
        position: i,
        width: meta.width ?? null,
        height: meta.height ?? null,
        durationMs: meta.durationMs ?? null,
        peaks: (meta.peaks ?? null) as never,
      };
    }),
  });
}

/* ---------------- read view ---------------- */

export type AttachmentDto = {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  peaks?: number[];
  url: string;
};

/** The ONE exit for an attachment row -> the Message DTO shape. */
export function attachmentView(att: {
  id: string;
  file?: { id: string; name: string; mimeType: string; size: number } | null;
  kind?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  peaks?: unknown;
}): AttachmentDto {
  const file = att.file ?? null;
  if (!file) throw new NotFoundError("chat.f.not_found");
  const peaks = Array.isArray(att.peaks) ? (att.peaks as number[]).filter((p) => typeof p === "number" && Number.isFinite(p)).slice(0, 100) : undefined;
  const out: AttachmentDto = {
    id: att.id,
    kind: (att.kind as ChatAttachmentKind) ?? "FILE",
    name: file.name,
    mime: file.mimeType,
    size: file.size,
    url: `/api/chat/attachments/${att.id}`,
  };
  if (typeof att.width === "number") out.width = att.width;
  if (typeof att.height === "number") out.height = att.height;
  if (typeof att.durationMs === "number") out.durationMs = att.durationMs;
  if (peaks) out.peaks = peaks;
  return out;
}

/* ---------------- reads / purge ---------------- */

/**
 * The raw row + the file opened for streaming (from the server's disk or proxied from Drive, only the asked range)
 * for the attachment route; the caller decides whether the viewer may read it.
 */
export async function readAttachment(orgId: string, attachmentId: string) {
  const att = await db.messageAttachment.findFirst({
    where: { id: attachmentId, file: { orgId, deletedAt: null, path: { not: PENDING_PATH } } },
    include: { file: { select: { id: true, name: true, mimeType: true, size: true, uploaderId: true, path: true, purpose: true } }, message: { select: { id: true, conversationId: true, deletedAt: true } } },
  });
  if (!att || !att.file) throw new NotFoundError("chat.f.not_found");
  const opened = await openStored(orgId, att.file.id);
  return { attachment: att, file: att.file, ...opened };
}

/** An unclaimed upload row (the uploader may still see his own file before the message exists). */
export async function findUnclaimedUpload(orgId: string, fileId: string, uploaderId: string) {
  return db.storedFile.findFirst({
    where: { id: fileId, orgId, uploaderId, deletedAt: null, path: { not: PENDING_PATH }, purpose: { in: ["CHAT", "VOICE"] } },
    select: { id: true, name: true, mimeType: true, size: true, uploaderId: true, purpose: true, createdAt: true },
  });
}

/**
 * Chat uploads nobody ever claimed (a message was never sent with them) die after 24 h.
 * Exported for the REALTIME purge job (which owns the hourly schedule); see the report for
 * the wiring: one line in the purge job's body — `await purgeOrphanUploads()`.
 */
export async function purgeOrphanUploads(orgId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - MAX_UPLOAD_AGE_MS);
  // a file attached to an approval request is not an orphan: nothing ever deletes what a request holds
  const held = (await db.approvalAttachment.findMany({ select: { fileId: true }, distinct: ["fileId"] })).map((a) => a.fileId);
  const orphans = await db.storedFile.findMany({
    where: {
      purpose: { in: ["CHAT", "VOICE"] },
      createdAt: { lt: cutoff },
      chatLinks: { none: {} },
      ...(held.length > 0 ? { id: { notIn: held } } : {}),
      deletedAt: null,
      path: { not: PENDING_PATH },
      ...(orgId ? { orgId } : {}),
    },
    select: { id: true, orgId: true, path: true, meta: true },
  });
  for (const f of orphans) {
    await discardStoredBytes(f.orgId, f);
  }
  const res = await db.storedFile.deleteMany({ where: { id: { in: orphans.map((f) => f.id) } } });
  return res.count;
}

