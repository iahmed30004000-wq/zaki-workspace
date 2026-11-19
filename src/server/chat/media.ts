import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { memberCan } from "@/server/policy/actor";
import { attachmentView } from "@/server/chat/attachments";
import { linkPreviewsOn } from "@/server/chat/link-preview";
import type { AttachmentDto } from "@/server/chat/dto";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { canReadTicket } from "@/server/services/tickets";

/**
 * C3d — WHAT A CONVERSATION HOLDS, for the info panel's tabs «الوسائط · الملفات · الروابط · الصوتيات · الشغل» and the media viewer's list.
 *
 * READING FIRST: the same rule as opening the conversation (`canRead`; always «not found» for what is not mine; a guest has topics only). Every door here is a
 * READ and writes nothing — no read row, no event — so the silent eye (oversight) lists without a trace.
 *
 *  - media: the attachments of NON-DELETED messages, newest first. NEVER the file of a deleted message (for the owner either: the attachment route serves him the
 *    original, this list is not a way to it), never a system line, never an upload no message claimed, never a file the library deleted. `MEDIA` is the pictures and
 *    the videos together (what the viewer steps through). `LINK` is the messages with a link card (`previewId`, status OK) and exists only while the link-preview
 *    switches are on (the same two switches that decide whether the card is drawn at all).
 *  - counts: one number per kind, by the same rule, so a tab with nothing in it is not drawn.
 *  - work: the tasks and tickets made from a message of THIS conversation (a message that was deleted since leaves no row here, as it leaves no chip on the
 *    screen). A task by P0.2's rule (`taskVisibleWhere`: a private task is not even counted for a person it does not concern), a ticket by the ticket door's own
 *    reader rule (`canReadTicket`); a guest learns of neither (as on the message chips).
 */

export const MEDIA_PAGE_DEFAULT = 60;
export const MEDIA_PAGE_MAX = 100;
export const WORK_MAX = 50;
/** How many ticket rows are read before the reader rule is applied (the rule is a verdict per row, so the read is wider than what is shown). */
const TICKETS_READ = 400;

export const MEDIA_KINDS = ["IMAGE", "VIDEO", "FILE", "AUDIO", "LINK", "MEDIA"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** `kind` + `before` + `limit` for a page; `counts=1` alone for the numbers. One of the two is required. */
export const mediaQuerySchema = z
  .object({
    kind: z.enum(MEDIA_KINDS).optional(),
    before: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(MEDIA_PAGE_MAX).optional(),
    counts: z.literal("1").optional(),
  })
  .refine((q) => q.kind !== undefined || q.counts !== undefined, { message: "kind or counts" });
export type MediaQuery = z.infer<typeof mediaQuerySchema>;

export interface MediaItemDto {
  /** the attachment's id (also the `before` cursor) */
  id: string;
  messageId: string;
  at: string;
  /** the picture's place inside its message (an album): what keeps the pictures of one message in order */
  position: number;
  authorName: string;
  /** the message's own words (formatting markers included: the screen strips them), or null */
  caption: string | null;
  attachment: AttachmentDto;
}

export interface LinkItemDto {
  /** the message's id (also the `before` cursor) */
  id: string;
  messageId: string;
  at: string;
  authorName: string;
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** the card's picture, served by the preview door of that message */
  image: string | null;
}

export interface MediaPageDto {
  items: MediaItemDto[];
  links: LinkItemDto[];
  /** the last id of this page when there are more (pass it as `before`), else null */
  next: string | null;
}

export type MediaCountsDto = { counts: { IMAGE: number; VIDEO: number; FILE: number; AUDIO: number; LINK: number } };

const CAPTION_MAX = 1000;

/** Reading first. Returns the facts so a caller can use them. */
async function readable(ctx: OrgAccessContext, conversationId: string): Promise<{ facts: ConversationFacts; org: OrgFacts }> {
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (!facts || !org || facts.orgId !== ctx.orgId || !canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST" && facts.kind !== "TOPIC") throw new ForbiddenError("chat.guest_forbidden");
  return { facts, org };
}

/** The messages whose attachments may be listed: of this conversation, not deleted, not a system line. */
const listable = (orgId: string, conversationId: string): Prisma.ChatMessageWhereInput => ({ orgId, conversationId, deletedAt: null, kind: { not: "SYSTEM" } });

const KINDS_OF: Record<Exclude<MediaKind, "LINK">, string[]> = { IMAGE: ["IMAGE"], VIDEO: ["VIDEO"], FILE: ["FILE"], AUDIO: ["AUDIO"], MEDIA: ["IMAGE", "VIDEO"] };

export async function listConversationMedia(ctx: OrgAccessContext, conversationId: string, query: MediaQuery): Promise<MediaPageDto | MediaCountsDto> {
  await readable(ctx, conversationId);
  const messages = listable(ctx.orgId, conversationId);

  if (query.counts === "1" && query.kind === undefined) {
    const [groups, links] = await Promise.all([
      db.messageAttachment.groupBy({ by: ["kind"], where: { message: messages, file: { orgId: ctx.orgId, deletedAt: null } }, _count: { _all: true } }),
      linkCount(ctx.orgId, conversationId),
    ]);
    const counts = { IMAGE: 0, VIDEO: 0, FILE: 0, AUDIO: 0, LINK: links };
    for (const g of groups) if (g.kind === "IMAGE" || g.kind === "VIDEO" || g.kind === "FILE" || g.kind === "AUDIO") counts[g.kind] = g._count._all;
    return { counts };
  }

  const kind = query.kind as MediaKind;
  const limit = Math.min(Math.max(query.limit ?? MEDIA_PAGE_DEFAULT, 1), MEDIA_PAGE_MAX);
  return kind === "LINK" ? listLinks(ctx, conversationId, query.before, limit) : listAttachments(ctx, conversationId, KINDS_OF[kind], query.before, limit);
}

async function listAttachments(ctx: OrgAccessContext, conversationId: string, kinds: string[], before: string | undefined, limit: number): Promise<MediaPageDto> {
  const messages = listable(ctx.orgId, conversationId);
  // the cursor is the attachment's `(message time, id)`: two pictures of the same instant (an album) are ordered by id, so a page can end between them
  let cursor: Prisma.MessageAttachmentWhereInput | null = null;
  if (before) {
    const anchor = await db.messageAttachment.findFirst({ where: { id: before, message: { orgId: ctx.orgId, conversationId } }, select: { id: true, message: { select: { createdAt: true } } } });
    if (!anchor?.message) throw new NotFoundError("chat.e.not_found");
    cursor = { OR: [{ message: { createdAt: { lt: anchor.message.createdAt } } }, { message: { createdAt: anchor.message.createdAt }, id: { lt: anchor.id } }] };
  }
  const rows = await db.messageAttachment.findMany({
    where: { kind: { in: kinds }, message: messages, file: { orgId: ctx.orgId, deletedAt: null }, ...(cursor ? { AND: [cursor] } : {}) },
    orderBy: [{ message: { createdAt: "desc" } }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      kind: true,
      width: true,
      height: true,
      durationMs: true,
      peaks: true,
      position: true,
      file: { select: { id: true, name: true, mimeType: true, size: true } },
      message: { select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } },
    },
  });
  const page = rows.slice(0, limit);
  const items: MediaItemDto[] = [];
  for (const row of page) {
    if (!row.message) continue;
    const body = row.message.body.trim();
    items.push({
      id: row.id,
      messageId: row.message.id,
      at: row.message.createdAt.toISOString(),
      position: row.position,
      authorName: row.message.author.name,
      caption: body ? body.slice(0, CAPTION_MAX) : null,
      attachment: attachmentView(row),
    });
  }
  return { items, links: [], next: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

async function listLinks(ctx: OrgAccessContext, conversationId: string, before: string | undefined, limit: number): Promise<MediaPageDto> {
  // the card exists only while the switches are on: with them off the list is empty and the cursor means nothing
  if (!(await linkPreviewsOn(ctx.orgId))) return { items: [], links: [], next: null };
  let cursor: Prisma.ChatMessageWhereInput | null = null;
  if (before) {
    const anchor = await db.chatMessage.findFirst({ where: { id: before, orgId: ctx.orgId, conversationId }, select: { id: true, createdAt: true } });
    if (!anchor) throw new NotFoundError("chat.e.not_found");
    cursor = { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] };
  }
  const rows = await db.chatMessage.findMany({
    where: { ...linkMessages(ctx.orgId, conversationId), ...(cursor ? { AND: [cursor] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, createdAt: true, author: { select: { name: true } }, preview: { select: { url: true, title: true, description: true, siteName: true, imageFileId: true } } },
  });
  const page = rows.slice(0, limit);
  const links: LinkItemDto[] = [];
  for (const row of page) {
    if (!row.preview) continue;
    links.push({
      id: row.id,
      messageId: row.id,
      at: row.createdAt.toISOString(),
      authorName: row.author.name,
      url: row.preview.url,
      title: row.preview.title,
      description: row.preview.description,
      siteName: row.preview.siteName,
      image: row.preview.imageFileId ? `/api/chat/messages/${row.id}/preview/image` : null,
    });
  }
  return { items: [], links, next: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

/** The messages that carry a link card: an ordinary text message whose preview was made (the card of a deleted message is gone for everybody). */
const linkMessages = (orgId: string, conversationId: string): Prisma.ChatMessageWhereInput => ({ ...listable(orgId, conversationId), kind: "TEXT", previewId: { not: null }, preview: { status: "OK" } });

async function linkCount(orgId: string, conversationId: string): Promise<number> {
  if (!(await linkPreviewsOn(orgId))) return 0;
  return db.chatMessage.count({ where: linkMessages(orgId, conversationId) });
}

// ───────────────────────────── «الشغل» ─────────────────────────────

export interface WorkTaskDto {
  id: string;
  /** `KEY-12` */
  key: string;
  title: string;
  done: boolean;
  assigneeName: string | null;
  messageId: string;
}

export interface WorkTicketDto {
  id: string;
  /** `KEY-T12` */
  key: string;
  title: string;
  status: string;
  assigneeName: string | null;
  messageId: string;
}

export interface ConversationWorkDto {
  tasks: WorkTaskDto[];
  tickets: WorkTicketDto[];
}

export async function conversationWork(ctx: OrgAccessContext, conversationId: string): Promise<ConversationWorkDto> {
  const { org } = await readable(ctx, conversationId);
  // a guest never learns of the company's tasks and tickets (the message chips say the same)
  if (org.role === "GUEST") return { tasks: [], tickets: [] };
  // a deleted message leaves nothing: the row would point at a message that is no longer in the conversation
  const source = { sourceMessage: { orgId: ctx.orgId, conversationId, deletedAt: null } };

  const [tasks, tickets] = await Promise.all([taskRows(ctx, source), ticketRows(ctx, source)]);
  return { tasks, tickets };
}

async function taskRows(ctx: OrgAccessContext, source: { sourceMessage: Prisma.ChatMessageWhereInput }): Promise<WorkTaskDto[]> {
  if ((await memberCan(ctx, "tasks.view", { spaceGuestsPass: true })) !== true) return [];
  // the person's whole scope (the task may live in another space than the conversation), and the participants rule of P0.2: a private task is not even counted
  const scope = await loadWorkScope(ctx.userId);
  const rows = await db.task.findMany({
    where: { orgId: ctx.orgId, ...source, archived: false, AND: [taskVisibleWhere(scope)] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: WORK_MAX,
    select: {
      id: true,
      number: true,
      title: true,
      completedAt: true,
      sourceMessageId: true,
      assignee: { select: { name: true } },
      organization: { select: { keyPrefix: true } },
    },
  });
  return rows.flatMap((t) =>
    t.sourceMessageId
      ? [{ id: t.id, key: `${t.organization.keyPrefix}-${t.number}`, title: t.title, done: t.completedAt !== null, assigneeName: t.assignee?.name ?? null, messageId: t.sourceMessageId }]
      : [],
  );
}

async function ticketRows(ctx: OrgAccessContext, source: { sourceMessage: Prisma.ChatMessageWhereInput }): Promise<WorkTicketDto[]> {
  if ((await memberCan(ctx, "tickets.view")) !== true) return [];
  const rows = await db.ticket.findMany({
    where: { orgId: ctx.orgId, ...source },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TICKETS_READ,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      creatorId: true,
      assigneeId: true,
      departmentId: true,
      sourceMessageId: true,
      assignee: { select: { name: true } },
      organization: { select: { keyPrefix: true } },
    },
  });
  const out: WorkTicketDto[] = [];
  // the ticket door's own reader rule (`canReadTicket`: whoever raised or holds it, the department's people, the OWNER and the ADMINs) is the verdict; it depends only on
  // «did I raise it», «do I hold it» and the department, so it is asked ONCE per such combination, not once per row
  const verdicts = new Map<string, Promise<boolean>>();
  const may = (t: (typeof rows)[number]): Promise<boolean> => {
    const key = `${t.creatorId === ctx.userId}|${t.assigneeId === ctx.userId}|${t.departmentId ?? ""}`;
    let verdict = verdicts.get(key);
    if (!verdict) {
      verdict = canReadTicket(ctx, t).catch(() => false);
      verdicts.set(key, verdict);
    }
    return verdict;
  };
  for (const t of rows) {
    if (out.length >= WORK_MAX) break;
    if (!t.sourceMessageId || !(await may(t))) continue;
    out.push({ id: t.id, key: `${t.organization.keyPrefix}-T${t.number}`, title: t.title, status: t.status, assigneeName: t.assignee?.name ?? null, messageId: t.sourceMessageId });
  }
  return out;
}
