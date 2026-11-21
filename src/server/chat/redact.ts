import type { Prisma } from "@prisma/client";
import type { AttachmentDto, MessageDto, ReactionDto, ReactorDto, SystemMeta } from "./dto";
import { attachmentView } from "./attachments";
import { presentPoll, type PollRow } from "./poll-shared";
import { stripFormatting } from "@/lib/chat/format/parse";
import { zakiToWords } from "@/lib/chat/zaki-emoji";
import { featureOn } from "@/lib/features";

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
  /** the company's switch `linkPreviews` (C3b.2); a card is presented ONLY when it is `true` (the data stays when it is off). Absent reads as off: a caller that forgets to ask the switch hides the cards instead of showing them while the company turned them off. */
  linkPreviews?: boolean;
  /** the company's switch `chatFormatting` (C3b.1): present and `true` means the quote of a reply shows the words without the markers (a spoiler is masked). Absent reads as off: the old detail and the Android app get the quote as it always was. */
  formatting?: boolean;
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
  /** a CARD message: what it points at (Q1.3) */
  card?: unknown;
  pinned: boolean;
  /** «ابعت بدون صوت» (C3c.2): the sender chose silence */
  silent?: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedById?: string | null;
  deletedBy?: { name: string } | null;
  authorId: string;
  /** the company the message was written in (every database row carries it): which of the author's memberships counts for the badge */
  orgId?: string;
  /**
   * `memberships`: the author's memberships that carry a badge, ONLY those (`messageInclude` asks `verifiedAt: { not: null }`) — so a row here means «verified». `organization.settings` is
   * there to read the company's switch `verifiedBadge` (absent: read as on). The time itself never leaves the server.
   */
  author?: { id: string; name: string; avatarUrl?: string | null; memberships?: { organizationId: string; organization?: { settings: unknown } }[] };
  reactions?: { emoji: string; userId: string; /** the reactor's name and picture («مين تفاعل»); absent: nobody is named */ user?: { name: string; avatarUrl?: string | null } }[];
  attachments?: (Parameters<typeof attachmentView>[0] & { id: string })[];
  revisions?: { body: string; createdAt: Date }[];
  notes?: { id: string; authorId: string; author: { name: string }; body: string; createdAt: Date }[];
  tasks?: { id: string; visibility?: string; creatorId?: string; assigneeId?: string | null }[];
  tickets?: { id: string; number?: number; status?: string; assignee?: { name: string } | null }[];
  poll?: PollRow | null;
  /** «معاينة الرابط» (C3b.2): the card of the first link, as stored */
  preview?: { url: string; title: string | null; description: string | null; siteName: string | null; imageFileId: string | null; status: string } | null;
};

/** How many reactors one chip names («مين تفاعل»): the count stays the truth, the list is a window of it (a message with hundreds of reactions must not carry hundreds of names). */
export const REACTORS_CAP = 50;
/** The ✅ of «لازم ينقرأ» (`ACK_EMOJI` in src/server/services/must-read.ts): somebody's receipt, not a reaction to be listed. */
const RECEIPT_EMOJI = "✅";

/**
 * Reactions grouped by emoji, oldest entry first, `mine` from the viewer's own rows, and «مين تفاعل» (`by`): who reacted, for the people who may be told.
 *  - everybody who can read the message may see the names (it is the conversation's own audience: a restricted topic is readable by its members only, so no name leaves it);
 *  - a GUEST sees only himself (the staff behind a chip are not his to learn; his own row is);
 *  - the ✅ receipt names its people to the message's author, the moderators and the owner only (the same people «لازم ينقرأ» names the missing to); the others get the count and themself.
 * The names come with the message rows (one join, no query per message).
 */
function groupReactions(rows: MessageRow["reactions"], viewer: Viewer, opts: { authorId: string }): ReactionDto[] {
  if (!rows?.length) return [];
  const viewerId = viewer.userId;
  const guest = viewer.role === "GUEST";
  const mayNameReceipts = opts.authorId === viewerId || viewer.canModerateHere || (viewer.oversight ?? viewer.role === "OWNER"); // oversight-ok: the fallback of a hand-made viewer
  const order: string[] = [];
  const byEmoji = new Map<string, { count: number; mine: boolean; by: ReactorDto[] }>();
  for (const r of rows) {
    if (!byEmoji.has(r.emoji)) {
      byEmoji.set(r.emoji, { count: 0, mine: false, by: [] });
      order.push(r.emoji);
    }
    const g = byEmoji.get(r.emoji)!;
    g.count += 1;
    const isMe = r.userId === viewerId;
    if (isMe) g.mine = true;
    if (!r.user) continue;
    const named = isMe || (!guest && (r.emoji !== RECEIPT_EMOJI || mayNameReceipts));
    if (!named || g.by.length >= REACTORS_CAP) continue;
    g.by.push({ id: r.userId, name: r.user.name, ...(guest ? {} : { avatar: r.user.avatarUrl ?? null }), ...(isMe ? { me: true as const } : {}) });
  }
  return order.map((emoji) => {
    const { count, mine, by } = byEmoji.get(emoji)!;
    return { emoji, count, mine, ...(by.length ? { by } : {}) };
  });
}

/**
 * «إشارة التوثيق» (S5.5): does this message's author carry the badge, FOR THIS VIEWER? Never for a guest (a partner must not learn who is who from a mark), never on a system
 * line, and never while the company's switch is off (the grant stays stored). One join with the message rows (`messageInclude`), no query of its own.
 */
function authorVerified(row: MessageRow, viewer: Viewer): boolean {
  if (viewer.role === "GUEST" || row.kind === "SYSTEM") return false;
  const m = row.author?.memberships?.find((x) => x.organizationId === row.orgId);
  if (!m) return false;
  return m.organization === undefined || featureOn(m.organization.settings, "verifiedBadge");
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
    ...(authorVerified(row, viewer) ? { authorVerified: true } : {}),
    createdAt: row.createdAt.toISOString(),
    clientId: row.clientId ?? null,
    mentions: (Array.isArray(row.mentions) ? (row.mentions as string[]) : []),
    // a deleted message takes its files and reactions with it, for everybody but the OWNER
    // (he reads the original, files included); the attachment route refuses the bytes the same way
    attachments: deleted && !isOwner ? [] : attachmentDtos(row.attachments),
    reactions: deleted && !isOwner ? [] : groupReactions(row.reactions, viewer, { authorId: row.authorId }),
    system: systemMeta(row),
  };
  if (row.videoAtSec !== null && row.videoAtSec !== undefined) dto.videoAtSec = row.videoAtSec;
  // «ابعت بدون صوت» (C3c.2): `true` only when it was; the other screen reads it to make no arrival sound
  if (row.silent) dto.silent = true;

  // a poll: a deleted message hides it like any message (the owner reads the question in `original`)
  if (row.kind === "POLL" && row.poll && !deleted) {
    dto.poll = presentPoll(row.poll, { userId: viewer.userId, role: viewer.role, oversight: viewer.oversight, isMember: viewer.isMember === true, canModerateHere: viewer.canModerateHere }, row.authorId, deleted);
  }

  // a card message points at a product sheet: only its address travels, whatever the reader may see of the sheet is decided when it is opened
  if (row.kind === "CARD" && !deleted) {
    const ref = row.card as { type?: unknown; cardId?: unknown; number?: unknown } | null;
    if (ref && ref.type === "product" && typeof ref.cardId === "string") dto.card = { type: "product", cardId: ref.cardId };
    else if (ref && ref.type === "order" && typeof ref.number === "string") dto.card = { type: "order", number: ref.number };
  }

  // the card of the first link: a deleted message has none (for everybody, the owner too: his original is the words), a card that failed has none, and the company's
  // switch off hides every card (the rows stay). It is the same card for every viewer who may see the words — a guest included — because it is made of the PAGE, not of
  // anything the company holds.
  if (row.preview && row.preview.status === "OK" && !deleted && row.kind === "TEXT" && viewer.linkPreviews === true) {
    dto.preview = {
      url: row.preview.url,
      title: row.preview.title,
      description: row.preview.description,
      siteName: row.preview.siteName,
      image: row.preview.imageFileId ? `/api/chat/messages/${row.id}/preview/image` : null,
    };
  }

  // reply preview: a deleted parent shows the placeholder, never its text
  if (row.replyTo) {
    dto.replyTo = {
      id: row.replyTo.id,
      // C3b.1: the words, not the markers (`**bold**`, a spoiler's bars, a link's address), where the company's formatting switch is on
      preview: row.replyTo.deletedAt ? null : zakiToWords(viewer.formatting === true ? stripFormatting(row.replyTo.body, { math: true }) : row.replyTo.body), // S5.6: a Zaki emoji is its Arabic name here, never the raw code
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
    // a private task («المعنيين بس») is not even named to a person it does not concern: its existence is private too.
    // (Managers up the reporting line and of the space open the task itself; the chip needs no database, so it is stricter.)
    const seesTask = (t: { visibility?: string; creatorId?: string; assigneeId?: string | null }): boolean =>
      t.visibility !== "PARTICIPANTS" || (viewer.oversight ?? viewer.role === "OWNER") /* oversight-ok: hand-made viewers */ || t.creatorId === viewer.userId || t.assigneeId === viewer.userId || viewer.canModerateHere;
    const work = [...(row.tasks ?? []).filter(seesTask).map((t) => ({ kind: "task" as const, id: t.id })), ...(row.tickets ?? []).map((t) => ({ kind: "ticket" as const, id: t.id, ...(t.number !== undefined ? { number: t.number, status: t.status, assigneeName: t.assignee?.name ?? null } : {}) }))];
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

/**
 * A safe preview for lists (home, the pinned bar): null when the message is deleted. `format: true` (C3b.1) gives the words without the markers, the WHOLE body stripped
 * and then cut (a bold run is never cut inside its markers); the default keeps the raw cut that the old screen and `chatHome` always had.
 */
export function previewOf(body: string | null, deletedAt: Date | null, opts: { format?: boolean } = {}): string | null {
  if (deletedAt) return null;
  if (body === null) return null;
  return zakiToWords(opts.format === true ? stripFormatting(body, { math: true }) : body).slice(0, 140); // 140: the same length as the bell and the push (`PREVIEW_CHARS` in notify.ts)
}

export type PrismaTx = Prisma.TransactionClient;
