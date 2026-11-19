import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { MENTION_ALL_ID } from "@/lib/chat/conversation/mentions";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";

/**
 * C3b.6 — the unread messages that mention me: what the «@» button of the conversation walks, oldest to newest.
 *
 * THE SAME «UNREAD» AS THE CHAT LIST (C1.2, `queryConversations`): after MY read mark, never my own message, never a deleted one, never a system line, never an
 * archived conversation, and only with a read mark of my own — a person with no row in the conversation has nothing counted there (the list's `mentionsUnread` is
 * 0 for them), so this list is empty for them too. That is also what keeps the silent eye silent: the owner reading through oversight has no row, gets an empty
 * list, and THIS DOOR NEVER WRITES (no row, no event, no read mark).
 *
 * Reading first: the same rule as opening the conversation (`canRead`; always «not found» for what is not mine; a guest has topics only). The answer is ids and a
 * cursor, never a text, an author or anything of a deleted message.
 */

export const MENTIONS_PAGE_DEFAULT = 50;
export const MENTIONS_PAGE_MAX = 100;

/** `after`: the last id of the previous page; `limit`: the page size. Both optional. */
export const mentionsQuerySchema = z.object({
  after: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MENTIONS_PAGE_MAX).optional(),
});
export type MentionsQuery = z.infer<typeof mentionsQuerySchema>;

export interface UnreadMentionsDto {
  /** oldest first */
  ids: string[];
  /** the last id of this page when there are more (pass it as `after`), else null */
  next: string | null;
}

export async function unreadMentionIds(ctx: OrgAccessContext, conversationId: string, opts: MentionsQuery = {}): Promise<UnreadMentionsDto> {
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (!facts || !org || facts.orgId !== ctx.orgId || !canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST" && facts.kind !== "TOPIC") throw new ForbiddenError("chat.guest_forbidden");
  // no row of my own = nothing counted (the silent eye has none): nothing to ask the messages, and nothing is written
  if (!facts.viewerIsMember) return { ids: [], next: null };

  const limit = Math.min(Math.max(opts.limit ?? MENTIONS_PAGE_DEFAULT, 1), MENTIONS_PAGE_MAX);
  const [mark, anchor] = await Promise.all([
    db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: ctx.userId } },
      select: { lastReadAt: true, conversation: { select: { archivedAt: true } } },
    }),
    opts.after ? db.chatMessage.findFirst({ where: { id: opts.after, conversationId }, select: { id: true, createdAt: true } }) : Promise.resolve(null),
  ]);
  if (opts.after && !anchor) throw new NotFoundError("chat.e.not_found");
  if (!mark || mark.conversation.archivedAt) return { ids: [], next: null };

  const where: Prisma.ChatMessageWhereInput = {
    conversationId,
    authorId: { not: ctx.userId },
    deletedAt: null,
    kind: { not: "SYSTEM" },
    createdAt: { gt: mark.lastReadAt },
    mentions: { hasSome: [ctx.userId, MENTION_ALL_ID] },
    // the cursor is the message's `(createdAt, id)`: two messages of the same instant are ordered by id, so a page can end between them
    ...(anchor ? { AND: [{ OR: [{ createdAt: { gt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { gt: anchor.id } }] }] } : {}),
  };
  const rows = await db.chatMessage.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1, select: { id: true } });
  const ids = rows.slice(0, limit).map((r) => r.id);
  return { ids, next: rows.length > limit ? (ids.at(-1) ?? null) : null };
}
