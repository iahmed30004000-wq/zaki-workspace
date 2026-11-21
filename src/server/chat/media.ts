import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { memberCan } from "@/server/policy/actor";
import { attachmentView } from "@/server/chat/attachments";
import { linkPreviewsOn } from "@/server/chat/link-preview";
import { linkKeyOf, linksOfBody } from "@/lib/chat/v2/info/link-list";
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
 *    the videos together (what the viewer steps through). `LINK` (S5.4) is EVERY web address found in the words of a message that is not deleted and not a system
 *    line, newest first, one row per page (`linksOfBody`); a card's title and picture are added only from an OK preview of THAT address while the link-preview
 *    switches are on (the same two switches that decide whether the card is drawn at all). The address itself is the message's own text, so it is listed either way.
 *  - counts: one number per kind, by the same rule (the tabs are always drawn; the number is what they show).
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
  /** `<message id>:<place of the address in it>` — the row's own key (the `before` cursor is the message's id) */
  id: string;
  messageId: string;
  at: string;
  authorName: string;
  url: string;
  /** the address's host as the reader sees it (`www.` dropped) */
  host: string;
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

/** How many messages one read of the links tab looks at, and how many reads one request makes while it still has fewer addresses than the page asks for. */
const LINK_BATCH = 100;
const LINK_ROUNDS = 6;
/** The messages looked at to count the addresses (newest first): the tab's number is a count of the recent ones, never a full scan of a huge conversation. */
const LINK_COUNT_SCAN = 1000;

/**
 * The messages that may carry an address: an ordinary text message that is not deleted (a deleted message's words are secret even from this list, the owner too)
 * and whose words contain `http` or `www.`. The words are then read by the chat's one tokenizer, so a message that only says «http» as a word gives nothing.
 */
const linkMessages = (orgId: string, conversationId: string): Prisma.ChatMessageWhereInput => ({
  ...listable(orgId, conversationId),
  kind: "TEXT",
  OR: [{ body: { contains: "http", mode: "insensitive" } }, { body: { contains: "www.", mode: "insensitive" } }],
});

const beforeMessage = (anchor: { id: string; createdAt: Date }): Prisma.ChatMessageWhereInput => ({ OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] });

async function listLinks(ctx: OrgAccessContext, conversationId: string, before: string | undefined, limit: number): Promise<MediaPageDto> {
  // the card's words only while the switches are on; the address is the message's own text and is listed either way
  const cardsOn = await linkPreviewsOn(ctx.orgId);
  let cursor: Prisma.ChatMessageWhereInput | null = null;
  if (before) {
    const anchor = await db.chatMessage.findFirst({ where: { id: before, orgId: ctx.orgId, conversationId }, select: { id: true, createdAt: true } });
    if (!anchor) throw new NotFoundError("chat.e.not_found");
    cursor = beforeMessage(anchor);
  }
  const links: LinkItemDto[] = [];
  const seen = new Set<string>();
  let next: string | null = null;
  // a page is `limit` ADDRESSES (newest first), so the messages are read in batches until there are enough; the cursor is the last message looked at
  scan: for (let round = 0; round < LINK_ROUNDS; round++) {
    const rows = await db.chatMessage.findMany({
      where: { ...linkMessages(ctx.orgId, conversationId), ...(cursor ? { AND: [cursor] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LINK_BATCH + 1,
      select: {
        id: true,
        createdAt: true,
        body: true,
        author: { select: { name: true } },
        preview: { select: { url: true, title: true, description: true, siteName: true, imageFileId: true, status: true } },
      },
    });
    const batch = rows.slice(0, LINK_BATCH);
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]!;
      linksOfBody(row.body).forEach((found, place) => {
        if (seen.has(found.key)) return;
        seen.add(found.key);
        // the card is the preview of the message's FIRST address: it speaks only for that address, and only when it was made (status OK)
        const card = cardsOn && row.preview?.status === "OK" && linkKeyOf(row.preview.url) === found.key ? row.preview : null;
        links.push({
          id: `${row.id}:${place}`,
          messageId: row.id,
          at: row.createdAt.toISOString(),
          authorName: row.author.name,
          url: found.url,
          host: found.host,
          title: card?.title ?? null,
          description: card?.description ?? null,
          siteName: card?.siteName ?? null,
          image: card?.imageFileId ? `/api/chat/messages/${row.id}/preview/image` : null,
        });
      });
      if (links.length >= limit) {
        next = i < batch.length - 1 || rows.length > LINK_BATCH ? row.id : null;
        break scan;
      }
    }
    if (rows.length <= LINK_BATCH) {
      next = null;
      break;
    }
    const last = batch[batch.length - 1]!;
    cursor = beforeMessage(last);
    next = last.id;
  }
  return { items: [], links, next };
}

async function linkCount(orgId: string, conversationId: string): Promise<number> {
  const rows = await db.chatMessage.findMany({ where: linkMessages(orgId, conversationId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LINK_COUNT_SCAN, select: { body: true } });
  const seen = new Set<string>();
  for (const row of rows) for (const found of linksOfBody(row.body)) seen.add(found.key);
  return seen.size;
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
