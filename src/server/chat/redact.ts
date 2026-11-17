import type { Prisma } from "@prisma/client";
import type { AttachmentDto, MessageDto, ReactionDto, SystemMeta } from "./dto";
import { attachmentView } from "./attachments";
import { presentPoll, type PollRow } from "./poll-shared";

export { attachmentView };

/**
 * The ONE exit for a message row -> the Message DTO. Nothing anywhere else may turn a
 * `ChatMessage` into a response: deleted text, edit history and admin notes are secret
 * for everyone but the people the design allows, and this file is where that is decided.
 */

export type Viewer = {
  userId: string;
  /** the organization rank, for the owner's privileges and the guest's blindness */
  role: string;
  /**
   * the viewer holds silent oversight (the capability `archive.view`): the edit history, the originals of deleted
   * messages. Absent: read as "an OWNER-rank viewer holds it" (hand-made viewers); the server always sets it.
   */
  oversight?: boolean;
  /** true: the viewer moderates the conversation's space (or is the org ADMIN/OWNER) */
  canModerateHere: boolean;
  /** the viewer is a row of the conversation (the owner only where he joined); absent: not */
  isMember?: boolean;
};

type MessageRow = {
  id: string;
  kind: string;
  body: string;
  createdAt: Date;
  clientId?: string | null;
  videoAtSec?: number | null;
  replyToId?: string | null;
  replyTo?: { id: string; body: string; deletedAt: Date | null; author: { name: string } } | null;
  forwardedFromId?: string | null;
  forwardedFrom?: { author: { name: string } } | null;
  mentions?: unknown;
  pinned: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedById?: string | null;
  deletedBy?: { name: string } | null;
  authorId: string;
  author?: { id: string; name: string; avatarUrl?: string | null };
  reactions?: { emoji: string; userId: string }[];
  attachments?: (Parameters<typeof attachmentView>[0] & { id: string })[];
  revisions?: { body: string; createdAt: Date }[];
  notes?: { id: string; authorId: string; author: { name: string }; body: string; createdAt: Date }[];
  tasks?: { id: string }[];
  tickets?: { id: string }[];
  poll?: PollRow | null;
};

/** Reactions grouped by emoji, oldest entry first, `mine` from the viewer's own rows. */
function groupReactions(rows: { emoji: string; userId: string }[] | undefined, viewerId: string): ReactionDto[] {
  if (!rows?.length) return [];
  const order: string[] = [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    if (!byEmoji.has(r.emoji)) {
      byEmoji.set(r.emoji, { count: 0, mine: false });
      order.push(r.emoji);
    }
    const g = byEmoji.get(r.emoji)!;
    g.count += 1;
    if (r.userId === viewerId) g.mine = true;
  }
  return order.map((emoji) => ({ emoji, ...byEmoji.get(emoji)! }));
}

function attachmentDtos(rows: MessageRow["attachments"]): AttachmentDto[] {
  return (rows ?? []).map((a) => attachmentView(a));
}

/**
 * The system message's `{k,p}` — stored as JSON in `body` (ChatMessage has no meta column);
 * anything unparsable renders as a plain system text.
 */
function systemMeta(row: MessageRow): SystemMeta | null {
  if (row.kind !== "SYSTEM") return null;
  try {
    const meta = JSON.parse(row.body) as { k?: string; p?: Record<string, string | number> };
    if (!meta || typeof meta.k !== "string") return null;
    return { k: meta.k, p: meta.p ?? {} };
  } catch {
    return null;
  }
}

/**
 * Presents one message row for one viewer.
 * `dmStatus` (DMs only, on MY messages): the ticks, computed from the OTHER person's marks.
 */
export function presentMessage(
  row: MessageRow,
  viewer: Viewer,
  dmStatus?: "sent" | "delivered" | "read",
): MessageDto {
  const isOwner = viewer.oversight ?? viewer.role === "OWNER"; // oversight-ok: the fallback of a hand-made viewer
  const deleted = !!row.deletedAt;
  const isMine = row.authorId === viewer.userId;
  const isSystem = row.kind === "SYSTEM";

  const dto: MessageDto = {
    id: row.id,
    kind: row.kind as MessageDto["kind"],
    // a deleted message's body leaves for EVERYBODY (the owner reads it in `original`);
    // a system message has no body of its own (the client composes it from `system`)
    body: deleted || isSystem ? null : row.body,
    deleted,
    edited: !!row.editedAt && !deleted,
    pinned: row.pinned,
    mine: isMine,
    authorId: row.authorId,
    authorName: row.author?.name ?? "",
    // a GUEST never receives a picture address: the bytes route refuses him, so an address in his
    // payload would only be a broken image on his screen (his chat draws initials)
    authorAvatar: viewer.role === "GUEST" ? null : (row.author?.avatarUrl ?? null),
    createdAt: row.createdAt.toISOString(),
    clientId: row.clientId ?? null,
    mentions: (Array.isArray(row.mentions) ? (row.mentions as string[]) : []),
    // a deleted message takes its files and reactions with it, for everybody but the OWNER
    // (he reads the original, files included); the attachment route refuses the bytes the same way
    attachments: deleted && !isOwner ? [] : attachmentDtos(row.attachments),
    reactions: deleted && !isOwner ? [] : groupReactions(row.reactions, viewer.userId),
    system: systemMeta(row),
  };
  if (row.videoAtSec !== null && row.videoAtSec !== undefined) dto.videoAtSec = row.videoAtSec;

  // a poll: a deleted message hides it like any message (the owner reads the question in `original`)
  if (row.kind === "POLL" && row.poll && !deleted) {
    dto.poll = presentPoll(row.poll, { userId: viewer.userId, role: viewer.role, oversight: viewer.oversight, isMember: viewer.isMember === true, canModerateHere: viewer.canModerateHere }, row.authorId, deleted);
  }

  // reply preview: a deleted parent shows the placeholder, never its text
  if (row.replyTo) {
    dto.replyTo = {
      id: row.replyTo.id,
      preview: row.replyTo.deletedAt ? null : row.replyTo.body,
      authorName: row.replyTo.author.name,
      deleted: !!row.replyTo.deletedAt,
    };
  }

  // forwarded from: a GUEST never learns which conversation a message came from
  if (row.forwardedFromId) {
    const name = row.forwardedFrom?.author.name ?? null;
    if (!(viewer.role === "GUEST")) dto.forwardedFrom = { name: name ?? "" };
  }

  // DM ticks on my own messages
  if (dmStatus) dto.status = dmStatus;

  // what the message became (a guest never learns of the company's tasks and tickets)
  if (viewer.role !== "GUEST" && !deleted) {
    const work = [...(row.tasks ?? []).map((t) => ({ kind: "task" as const, id: t.id })), ...(row.tickets ?? []).map((t) => ({ kind: "ticket" as const, id: t.id }))];
    if (work.length) dto.work = work;
  }

  // edit history: the OWNER only
  if (isOwner && row.revisions?.length) {
    dto.history = row.revisions.map((r) => ({ body: r.body, editedAt: r.createdAt.toISOString() }));
  }

  // the original of a deleted message: the OWNER only
  if (isOwner && deleted) {
    dto.original = {
      body: row.body,
      deletedBy: row.deletedBy?.name ?? "",
      deletedAt: row.deletedAt!.toISOString(),
    };
  }

  // admin notes: space admins and the OWNER only
  if ((isOwner || viewer.canModerateHere) && row.notes?.length) {
    dto.notes = row.notes.map((n) => ({
      id: n.id,
      authorId: n.authorId,
      authorName: n.author.name,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  return dto;
}

/** A safe preview for lists (home, reply quotes): null when the message is deleted. */
export function previewOf(body: string | null, deletedAt: Date | null): string | null {
  if (deletedAt) return null;
  return body === null ? null : body.slice(0, 140);
}

export type PrismaTx = Prisma.TransactionClient;
