import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { logChat } from "@/server/chat/moderation";
import type { OversightConversationDto } from "@/server/chat/dto";
import { holdsArchiveView } from "./archive-access";
import { isSelfDmKey, SAVED_TITLE_KEY } from "@/server/chat/dm";
import { AR } from "@/lib/i18n/dict";

/**
 * The OWNER's silent eye: every conversation of the company — spaces, topics and private DMs (the
 * owner's decision D-2, 2026-10-24: he reads everything). His reading stays silent everywhere (no read
 * mark, no tick, no reader avatar). Every look is written to the audit trail (`chat.oversight_read`),
 * because reading without being in the room is exactly the act that must leave a trace.
 */

export async function listOversight(
  ctx: OrgAccessContext,
  opts: { spaceId?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: OversightConversationDto[]; nextCursor: string | null }> {
  if (!(await holdsArchiveView(ctx))) throw new ForbiddenError("chat.e.oversight_denied");

  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await db.conversation.findMany({
    where: {
      orgId: ctx.orgId,
      ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
    },
    select: {
      id: true,
      kind: true,
      title: true,
      dmKey: true,
      emoji: true,
      spaceId: true,
      space: { select: { name: true } },
      updatedAt: true,
      _count: { select: { members: true } },
      // a DM is listed by its two people
      members: { where: { conversation: { kind: "DM" } }, select: { user: { select: { name: true } } }, take: 2 },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
  });

  await logChat({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "chat.oversight_read",
    spaceId: opts.spaceId ?? null,
    meta: { scope: opts.spaceId ? "space" : "org", returnCount: Math.min(rows.length, limit) },
  });

  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((c) => ({
      id: c.id,
      kind: c.kind as OversightConversationDto["kind"],
      // a DM shows its two names, never a title; a person's saved chat (a self key, C3a.3) is titled from the dictionary, with the one name of whose it is
      title: c.kind === "DM" ? (isSelfDmKey(c.dmKey) ? (AR[SAVED_TITLE_KEY] ?? "") : "") : (c.title ?? ""),
      emoji: c.emoji,
      spaceId: c.spaceId,
      spaceName: c.space?.name ?? null,
      membersCount: c._count.members,
      names: c.kind === "DM" ? c.members.map((m) => m.user.name) : undefined,
      lastMessageAt: c.messages[0]?.createdAt.toISOString() ?? null,
    })),
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
  };
}

/**
 * Reading one conversation AS the owner: topics, groups and private DMs alike (he is in no row, he
 * reads everything, silently).
 */
export async function assertOversightRead(ctx: OrgAccessContext, conversationId: string): Promise<{ kind: string; spaceId: string | null }> {
  if (!(await holdsArchiveView(ctx))) throw new ForbiddenError("chat.e.oversight_denied");
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, orgId: ctx.orgId },
    select: { id: true, kind: true, spaceId: true },
  });
  if (!conv) throw new ForbiddenError("chat.e.not_found");
  await logChat({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "chat.oversight_read",
    spaceId: conv.spaceId,
    conversationId: conv.id,
    meta: { kind: conv.kind },
  });
  return { kind: conv.kind, spaceId: conv.spaceId };
}
