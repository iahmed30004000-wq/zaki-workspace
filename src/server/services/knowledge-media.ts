import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { Prisma } from "@prisma/client";
import { ingest, openStored } from "@/server/services/files";
import { createChatUpload } from "@/server/chat/attachments";
import { sendMessage } from "@/server/chat/messages";
import type { MessageDto } from "@/server/chat/dto";
import { knowledgeAccess, readSheet } from "@/server/services/knowledge";
import { sniffMimeType } from "@/server/files/sniff";

/**
 * Product photos and feedback pictures (Q1.2). They are NOT library files: they are stored through the sheet's own door as `StoredFile.purpose =
 * "KNOWLEDGE"` (the library lists only `LIBRARY`), linked to the sheet by a `CardAttachment` whose `role` is GALLERY (the photos of the product, on top of
 * the sheet) or FEEDBACK («آراء الزباين»).
 *
 *  - WHO READS a photo: whoever may read its sheet. A FEEDBACK item is read by the others only once it has the customer's consent AND an approver's approval;
 *    the editors always (`mayReadKnowledgeFile` is called by `assertMayReadFile`).
 *  - WHO WRITES: the sheet's editors; the approvers approve. The caps: 30 photos, 60 feedback items.
 *  - A FEEDBACK picture is somebody's private chat: the browser covers the name, the number and the profile picture BEFORE anything is sent, and says so
 *    (`covered`); the server refuses an item that does not say it, and never offers one without consent and approval.
 *  - Only pictures (JPEG, PNG, WebP), at most 8 MB; the bytes are sniffed, the client's type is ignored.
 */
export const MEDIA_ROLES = ["GALLERY", "FEEDBACK"] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];
export const GALLERY_CAP = 30;
export const FEEDBACK_CAP = 60;
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface FeedbackMeta {
  kind: "image";
  /** the customer agreed that it may be published */
  consent: boolean;
  /** the browser painted its rectangles over the private parts before this was sent */
  covered: boolean;
  approvedById?: string;
  approvedAt?: string;
  source?: string;
}

const asMeta = (v: unknown): Partial<FeedbackMeta> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Partial<FeedbackMeta>) : {});
const isApproved = (m: Partial<FeedbackMeta>): boolean => m.consent === true && typeof m.approvedAt === "string" && m.approvedAt.length > 0;

export interface MediaItemDTO {
  id: string;
  fileId: string;
  role: MediaRole;
  caption: string | null;
  position: number;
  /** FEEDBACK only, for editors: where the item stands */
  state?: { consent: boolean; approved: boolean };
  /** the address of its bytes (`/api/files/<id>/raw`) */
  url: string;
}

export interface MediaListDTO {
  gallery: MediaItemDTO[];
  feedback: MediaItemDTO[];
  canEdit: boolean;
  canApprove: boolean;
}

function toDto(row: { id: string; fileId: string; role: string; caption: string | null; position: number; meta: unknown }, editor: boolean): MediaItemDTO {
  const role = row.role === "FEEDBACK" ? "FEEDBACK" : "GALLERY";
  const m = asMeta(row.meta);
  return {
    id: row.id,
    fileId: row.fileId,
    role,
    caption: row.caption,
    position: row.position,
    url: `/api/files/${row.fileId}/raw`,
    ...(role === "FEEDBACK" && editor ? { state: { consent: m.consent === true, approved: isApproved(m) } } : {}),
  };
}

/** The sheet's photos and feedback, as this person may see them. The sheet itself must be readable by them (`readSheet`). */
export async function listMedia(actor: Actor, cardId: string): Promise<MediaListDTO> {
  const sheet = await readSheet(actor, cardId);
  const access = await knowledgeAccess(actor);
  const rows = await db.cardAttachment.findMany({
    where: { cardId, file: { purpose: "KNOWLEDGE", deletedAt: null } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, fileId: true, role: true, caption: true, position: true, meta: true },
  });
  const gallery = rows.filter((r) => r.role !== "FEEDBACK").map((r) => toDto(r, access.editor));
  const feedback = rows.filter((r) => r.role === "FEEDBACK" && (access.editor || isApproved(asMeta(r.meta)))).map((r) => toDto(r, access.editor));
  return { gallery, feedback, canEdit: sheet.canEdit, canApprove: sheet.canApprove };
}

async function sheetCard(actor: Actor, cardId: string, spaceId: string): Promise<{ id: string }> {
  const card = await db.card.findFirst({ where: { id: cardId, orgId: actor.orgId, workspaceId: spaceId, kind: "PRODUCT", archivedAt: null }, select: { id: true } });
  if (!card) throw new NotFoundError("cards.not_found");
  return card;
}

export async function addMedia(
  actor: Actor,
  ctx: OrgAccessContext,
  cardId: string,
  input: { role: MediaRole; file: { name: string; path: string; size: number; prefix: Uint8Array }; caption?: string | null; covered?: boolean; consent?: boolean },
): Promise<MediaItemDTO> {
  const access = await knowledgeAccess(actor);
  if (!access.editor) throw new ForbiddenError("knowledge.readonly");
  await sheetCard(actor, cardId, access.spaceId);
  if (!(MEDIA_ROLES as readonly string[]).includes(input.role)) throw new ValidationError([{ path: "role", message: "knowledge.media.e.role" }]);
  // only pictures: judged on the bytes before anything is stored
  const mime = sniffMimeType(input.file.prefix);
  if (!mime || !IMAGE_TYPES.has(mime)) throw new ValidationError([{ path: "file", message: "knowledge.media.e.image_only" }]);
  if (input.role === "FEEDBACK" && input.covered !== true) throw new ValidationError([{ path: "covered", message: "knowledge.media.e.cover_first" }]);
  const cap = input.role === "FEEDBACK" ? FEEDBACK_CAP : GALLERY_CAP;
  const have = await db.cardAttachment.count({ where: { cardId, role: input.role, file: { purpose: "KNOWLEDGE", deletedAt: null } } });
  if (have >= cap) throw new ValidationError([{ path: "role", message: "knowledge.media.e.cap" }]);

  const made = await ingest(ctx, { name: input.file.name, path: input.file.path, size: input.file.size, prefix: input.file.prefix }, undefined, "KNOWLEDGE", undefined, { maxBytes: MEDIA_MAX_BYTES });
  const position = (await db.cardAttachment.aggregate({ where: { cardId, role: input.role }, _max: { position: true } }))._max.position ?? -1;
  const meta: FeedbackMeta | null = input.role === "FEEDBACK" ? { kind: "image", consent: input.consent === true, covered: true, source: "upload" } : null;
  const row = await db.cardAttachment.create({
    data: { cardId, fileId: made.id, position: position + 1, caption: input.caption?.trim() ? input.caption.trim().slice(0, 200) : null, addedById: actor.userId, role: input.role, ...(meta ? { meta: meta as unknown as Prisma.InputJsonValue } : {}) },
    select: { id: true, fileId: true, role: true, caption: true, position: true, meta: true },
  });
  return toDto(row, true);
}

/** Consent (an editor, with the customer's word) and approval (an approver, only with consent): the two things that make a feedback item offerable. */
export async function setFeedbackState(actor: Actor, cardId: string, attachmentId: string, input: { consent?: boolean; approve?: boolean }): Promise<MediaItemDTO> {
  const access = await knowledgeAccess(actor);
  if (!access.editor) throw new ForbiddenError("knowledge.readonly");
  await sheetCard(actor, cardId, access.spaceId);
  const row = await db.cardAttachment.findFirst({ where: { id: attachmentId, cardId, role: "FEEDBACK", file: { purpose: "KNOWLEDGE", deletedAt: null } }, select: { id: true, fileId: true, role: true, caption: true, position: true, meta: true } });
  if (!row) throw new NotFoundError("knowledge.media.not_found");
  const meta: Partial<FeedbackMeta> = { kind: "image", consent: false, covered: true, ...asMeta(row.meta) };
  if (input.consent !== undefined) {
    meta.consent = input.consent;
    // withdrawing the consent withdraws the approval with it
    if (!input.consent) {
      delete meta.approvedById;
      delete meta.approvedAt;
    }
  }
  if (input.approve !== undefined) {
    if (!access.approver) throw new ForbiddenError("knowledge.approver_only");
    if (input.approve) {
      if (meta.consent !== true) throw new ValidationError([{ path: "approve", message: "knowledge.media.e.consent_first" }]);
      meta.approvedById = actor.userId;
      meta.approvedAt = new Date().toISOString();
    } else {
      delete meta.approvedById;
      delete meta.approvedAt;
    }
  }
  const saved = await db.cardAttachment.update({ where: { id: row.id }, data: { meta: meta as unknown as Prisma.InputJsonValue }, select: { id: true, fileId: true, role: true, caption: true, position: true, meta: true } });
  return toDto(saved, true);
}

export async function removeMedia(actor: Actor, cardId: string, attachmentId: string): Promise<void> {
  const access = await knowledgeAccess(actor);
  if (!access.editor) throw new ForbiddenError("knowledge.readonly");
  await sheetCard(actor, cardId, access.spaceId);
  const row = await db.cardAttachment.findFirst({ where: { id: attachmentId, cardId, file: { purpose: "KNOWLEDGE" } }, select: { id: true, fileId: true } });
  if (!row) throw new NotFoundError("knowledge.media.not_found");
  await db.$transaction(async (tx) => {
    await tx.cardAttachment.delete({ where: { id: row.id } });
    await tx.storedFile.update({ where: { id: row.fileId }, data: { deletedAt: new Date() } });
  });
}

/**
 * «ابعتيها بالمحادثة»: a picture of the sheet goes into a conversation as a COPY — a chat attachment of its own (a chat's files belong to their
 * conversation: a purge removes them, and the sheet's picture is untouched). Only a picture this person may read (an unapproved feedback item is not),
 * through the ordinary send path (may post there, the send limiter).
 */
export async function sendMediaToChat(actor: Actor, ctx: OrgAccessContext, cardId: string, attachmentId: string, conversationId: string): Promise<MessageDto> {
  const row = await db.cardAttachment.findFirst({ where: { id: attachmentId, cardId, file: { orgId: actor.orgId, purpose: "KNOWLEDGE", deletedAt: null } }, select: { fileId: true, file: { select: { name: true } } } });
  if (!row || !(await mayReadKnowledgeFile(actor, row.fileId))) throw new NotFoundError("knowledge.media.not_found");
  const opened = await openStored(actor.orgId, row.fileId);
  const chunks: Uint8Array[] = [];
  const reader = (await opened.stream(null)).getReader();
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.length;
    if (total > MEDIA_MAX_BYTES) throw new ValidationError([{ path: "file", message: "files.too_large" }]);
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const copy = await createChatUpload({ actor, name: row.file.name, bytes, declaredKind: "IMAGE" });
  return sendMessage(ctx, conversationId, { body: "", attachmentIds: [copy.id] });
}

/**
 * The rule of `assertMayReadFile` for a KNOWLEDGE file: it is read by whoever may read the sheet it belongs to; a FEEDBACK item only once it is approved with
 * consent (the editors always). Anything else is «not found» — a file id says nothing.
 */
export async function mayReadKnowledgeFile(actor: Actor, fileId: string): Promise<boolean> {
  const link = await db.cardAttachment.findFirst({ where: { fileId, file: { orgId: actor.orgId, purpose: "KNOWLEDGE", deletedAt: null } }, select: { cardId: true, role: true, meta: true } });
  if (!link) return false;
  try {
    await readSheet(actor, link.cardId);
    const access = await knowledgeAccess(actor);
    return link.role !== "FEEDBACK" || access.editor || isApproved(asMeta(link.meta));
  } catch {
    return false;
  }
}
