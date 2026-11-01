import { z } from "zod";
import { memberCan } from "@/server/policy/actor";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canModerate, canPost, canRead, loadConversationFacts, loadOrgFacts, type ConversationFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { isSpaceAdmin } from "@/server/policy/conversation";
import { writeSystemMessage } from "@/server/chat/system";
import type { ConversationDto, MemberDto, MessageDto, ReaderDto } from "@/server/chat/dto";
import { presentMessage, previewOf, type Viewer } from "@/server/chat/redact";
import { messageInclude, dmStatusFor } from "@/server/chat/messages";
import { isFeatureOn } from "@/server/services/features";
import { chatAssistantOffered } from "@/server/services/chat-assistant";
import { ASSISTANT_MENTION_ID, ASSISTANT_MENTION_NAME } from "@/lib/chat/conversation/mentions";
import { lastSeenReader } from "@/server/services/last-seen";
import type { Prisma } from "@prisma/client";

/** ---------- create topic ---------- */

/**
 * The kinds of topic the owner asked for (2026-10-25): نقاش، تنبيهات، مهام، أفكار، متابعة. A kind gives the topic
 * its mark and, for «التنبيهات», who writes there (the space's admins); both can still be set by hand.
 */
export const TOPIC_TYPES = ["DISCUSSION", "ANNOUNCEMENTS", "TASKS", "IDEAS", "FOLLOWUP"] as const;
export const TOPIC_TYPE_EMOJI: Record<(typeof TOPIC_TYPES)[number], string> = {
  DISCUSSION: "💬",
  ANNOUNCEMENTS: "📢",
  TASKS: "✅",
  IDEAS: "💡",
  FOLLOWUP: "🔁",
};

export const createTopicSchema = z.object({
  spaceId: z.string().min(1),
  title: z.string().trim().min(1, "chat.e.empty").max(120, "chat.e.too_long"),
  emoji: z.string().max(16).optional(),
  topicType: z.enum(TOPIC_TYPES).optional(),
  restricted: z.boolean().optional(),
  postingPolicy: z.enum(["ALL", "ADMINS"]).optional(),
  /** Who it is for: the whole space (none), one «مقطع» of it, or (`restricted`) the people named here. */
  teamId: z.string().min(1).nullable().optional(),
  memberIds: z.array(z.string().min(1)).max(200).optional(),
});

/** Named people must be people of the space (nobody is pulled in from outside it). */
export async function assertPeopleOfSpace(orgId: string, spaceId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const inSpace = await db.workspaceMember.count({
    where: { workspaceId: spaceId, userId: { in: ids }, user: { memberships: { some: { organizationId: orgId, status: "ACTIVE" } } } },
  });
  if (inSpace !== ids.length) throw new ForbiddenError("teams.member_not_in_space");
}

/** The «مقطع» must be one of the space's own (a miss reads as «not found», like everything of another space). */
async function assertTeamOfSpace(spaceId: string, teamId: string | null | undefined): Promise<void> {
  if (!teamId) return;
  const team = await db.team.findFirst({ where: { id: teamId, workspaceId: spaceId }, select: { id: true } });
  if (!team) throw new NotFoundError("teams.not_found");
}

export async function createTopic(ctx: OrgAccessContext, input: z.infer<typeof createTopicSchema>): Promise<{ id: string }> {
  // only a space admin of THIS space (or the org OWNER) opens a topic
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const sm = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.spaceId, userId: ctx.userId } },
    select: { role: true },
  });
  const ws = await db.workspace.findFirst({ where: { id: input.spaceId, organizationId: ctx.orgId }, select: { id: true } });
  if (!ws) throw new NotFoundError("chat.e.not_found");
  if (!(org?.role === "OWNER" || isSpaceAdmin(sm?.role ?? null))) throw new ForbiddenError("chat.e.moderator_only");
  await assertTeamOfSpace(input.spaceId, input.teamId);

  // a topic for named people: they must be people of the space (nobody is pulled in from outside it)
  const restricted = input.restricted ?? false;
  const named = restricted ? [...new Set(input.memberIds ?? [])].filter((id) => id !== ctx.userId) : [];
  await assertPeopleOfSpace(ctx.orgId, input.spaceId, named);

  const topicType = input.topicType ?? "DISCUSSION";
  const topic = await db.$transaction(async (tx) => {
    const t = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        spaceId: input.spaceId,
        kind: "TOPIC",
        title: input.title,
        emoji: input.emoji ?? TOPIC_TYPE_EMOJI[topicType],
        topicType,
        restricted,
        teamId: input.teamId ?? null,
        // «التنبيهات»: the space's admins write, everybody reads (unless set otherwise)
        postingPolicy: input.postingPolicy ?? (topicType === "ANNOUNCEMENTS" ? "ADMINS" : "ALL"),
        // the creator is in their own topic, and so are the people it was opened for
        members: { create: [{ userId: ctx.userId }, ...named.map((userId) => ({ userId }))] },
      },
      select: { id: true },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: input.spaceId });
    return t;
  });
  return { id: topic.id };
}

/** ---------- settings (space admins / owner only) ---------- */

export const updateTopicSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  emoji: z.string().max(16).nullable().optional(),
  topicType: z.enum(TOPIC_TYPES).optional(),
  restricted: z.boolean().optional(),
  postingPolicy: z.enum(["ALL", "ADMINS"]).optional(),
  /** Move the topic to a «مقطع» of its space, or back to the whole space (null). */
  teamId: z.string().min(1).nullable().optional(),
  /** With `restricted: true`: exactly who the topic is for (the one changing it stays in). */
  memberIds: z.array(z.string().min(1)).max(200).optional(),
});

export async function updateTopic(ctx: OrgAccessContext, conversationId: string, input: z.infer<typeof updateTopicSchema>): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  if (input.teamId !== undefined && facts.spaceId) await assertTeamOfSpace(facts.spaceId, input.teamId);
  // «ناس محددين»: the people it is for are exactly the ones named (and the one changing it)
  const { memberIds, ...fields } = input;
  const named = fields.restricted && memberIds ? [...new Set([...memberIds, ctx.userId])] : null;
  if (named && facts.spaceId) await assertPeopleOfSpace(ctx.orgId, facts.spaceId, named.filter((id) => id !== ctx.userId));
  await db.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { ...fields } });
    if (named) {
      await tx.conversationMember.deleteMany({ where: { conversationId, userId: { notIn: named } } });
      await tx.conversationMember.createMany({ data: named.map((userId) => ({ conversationId, userId })), skipDuplicates: true });
    }
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- join / leave ---------- */

export async function joinTopic(ctx: OrgAccessContext, conversationId: string): Promise<{ joined: boolean }> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (facts.viewerIsMember) return { joined: true };
  if (org.role === "GUEST" && facts.topicType === "ANNOUNCEMENTS") throw new ForbiddenError("chat.e.guest_read_only");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.create({ data: { conversationId, userId: ctx.userId } });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "join", spaceId: facts.spaceId });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId: ctx.userId, spaceId: facts.spaceId ?? undefined });
  });
  return { joined: true };
}

export async function leaveTopic(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const { facts } = await guardTopic(ctx, conversationId);
  if (!facts.viewerIsMember) throw new NotFoundError("chat.e.not_found");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.delete({ where: { conversationId_userId: { conversationId, userId: ctx.userId } } });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId: ctx.userId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- add / remove member (space admins + owner; restricted topics only) ---------- */

export async function addMember(ctx: OrgAccessContext, conversationId: string, userId: string): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  const target = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
    select: { status: true },
  });
  if (!target || target.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId },
      update: {},
    });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId, spaceId: facts.spaceId ?? undefined });
  });
}

export async function removeMember(ctx: OrgAccessContext, conversationId: string, userId: string): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.deleteMany({ where: { conversationId, userId } });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- close / reopen (space admins + owner) ---------- */

export async function setTopicClosed(ctx: OrgAccessContext, conversationId: string, closed: boolean): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  // an archived topic stays read-only until it is brought back from «المؤرشفة»
  if (!closed && (await db.conversation.findUnique({ where: { id: conversationId }, select: { archivedAt: true } }))?.archivedAt) {
    throw new TopicConflictError("chat.topic_archived");
  }
  await db.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { closedAt: closed ? new Date() : null } });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: closed ? "close" : "reopen", spaceId: facts.spaceId });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
}

/**
 * ---------- archive / pin / delete (space admins + owner) ----------
 * The owner's ask (2026-10-25): a topic can be closed, pinned on top, and deleted. A topic people wrote in is never
 * deleted (their words would go with it): it is ARCHIVED instead — out of the list, read-only, found by the space's
 * managers under «المؤرشفة» and brought back from there. Only a topic nobody wrote in is deleted, and never one the
 * system made (a space's «عام» and «التنبيهات», «الشركة»'s topics).
 */

/** A topic that cannot go as asked (somebody wrote in it): 409, the route says so. */
export class TopicConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TopicConflictError";
  }
}

export async function setTopicArchived(ctx: OrgAccessContext, conversationId: string, archived: boolean): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.$transaction(async (tx) => {
    // archived is read-only (closed); brought back, it opens again
    await tx.conversation.update({
      where: { id: conversationId },
      data: archived ? { archivedAt: new Date(), closedAt: new Date(), pinnedAt: null } : { archivedAt: null, closedAt: null },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
}

export async function setTopicPinned(ctx: OrgAccessContext, conversationId: string, pinned: boolean): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { pinnedAt: pinned ? new Date() : null } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
}

export async function deleteTopic(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { systemKey: true } });
  if (conv.systemKey) throw new ForbiddenError("chat.topic_system");
  // somebody wrote here: archive it instead (system lines «انضم»، «ثبّت» are not somebody's words)
  if ((await db.chatMessage.count({ where: { conversationId, kind: { not: "SYSTEM" } } })) > 0) {
    throw new TopicConflictError("chat.topic_has_messages");
  }
  await db.$transaction(async (tx) => {
    await tx.conversation.delete({ where: { id: conversationId } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- pagination + detail ---------- */

const PAGE = 50;

/**
 * The detail page of one conversation for one viewer: the newest `limit` messages, the ones before `before`, or the
 * ones around `around` (a search hit: half older, half newer, the message itself among them).
 */
export async function conversationDetail(
  ctx: OrgAccessContext,
  conversationId: string,
  opts: { before?: string; around?: string; limit?: number } = {},
): Promise<ConversationDto> {
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  // another company's conversation does not exist for this viewer, whatever their rank at home
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");

  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), PAGE);
  const where: Prisma.ChatMessageWhereInput = { conversationId };
  if (opts.before) {
    const anchor = await db.chatMessage.findUnique({ where: { id: opts.before }, select: { createdAt: true } });
    if (!anchor) throw new NotFoundError("chat.e.not_found");
    where.createdAt = { lt: anchor.createdAt };
  }

  // around one message: its newer half (oldest first, turned round below), then it and its older half
  let newer: Awaited<ReturnType<typeof newerThan>> = [];
  let olderLimit = limit;
  async function newerThan(at: Date, take: number) {
    return db.chatMessage.findMany({ where: { conversationId, createdAt: { gt: at } }, orderBy: { createdAt: "asc" }, take, include: messageInclude() });
  }
  if (opts.around) {
    const anchor = await db.chatMessage.findFirst({ where: { id: opts.around, conversationId }, select: { createdAt: true } });
    if (!anchor) throw new NotFoundError("chat.e.not_found");
    olderLimit = limit - Math.floor(limit / 2);
    newer = await newerThan(anchor.createdAt, Math.floor(limit / 2));
    where.createdAt = { lte: anchor.createdAt };
  }

  const [older, conv] = await Promise.all([
    db.chatMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: olderLimit + 1, // one extra: is there an older page?
      include: messageInclude(),
    }),
    db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        space: { select: { id: true, name: true, organizationId: true } },
        members: {
          // a suspended or offboarded person is nobody: their leftover row is not shown among the members
          // (nor as a reader) — the same rule the policy applies to reading
          where: { user: { memberships: { some: { organizationId: ctx.orgId, status: "ACTIVE" } } } },
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    }),
  ]);
  if (!conv) throw new NotFoundError("chat.e.not_found");

  const hasOlder = older.length > olderLimit;
  const page = [...newer.reverse(), ...older.slice(0, olderLimit)];

  // who is online, for the member pills
  const { onlineUserIds } = await import("@/server/realtime/presence");
  const online = new Set(await onlineUserIds(ctx.orgId));

  const canModerateHere = canModerate(facts, org!);
  const viewer: Viewer = { userId: ctx.userId, role: org!.role, canModerateHere, isMember: facts.viewerIsMember };
  const hideOwnerOnline = await isFeatureOn(ctx.orgId, "ownerHiddenOnline");

  // the OWNER's reading is silent: his read mark never shows, in ticks or reader avatars
  const ownerIds = new Set(
    (
      await db.organizationMember.findMany({ // all-statuses: the owner's silence holds whatever his status
        where: { organizationId: ctx.orgId, role: "OWNER", userId: { in: conv.members.map((m) => m.userId) } },
        select: { userId: true },
      })
    ).map((o) => o.userId),
  );
  // «إخفاء المالك من متصل»: the owner does not light up for anybody but himself
  if (hideOwnerOnline) for (const id of ownerIds) if (id !== ctx.userId) online.delete(id);

  // DM ticks: the OTHER person's marks decide my own messages' status
  let otherMember: { lastDeliveredAt: Date | null; lastReadAt: Date | null } | null = null;
  if (facts.kind === "DM") {
    const other = conv.members.find((m) => m.userId !== ctx.userId) ?? null;
    otherMember = other && ownerIds.has(other.userId) ? { lastDeliveredAt: other.lastDeliveredAt, lastReadAt: null } : other;
  }

  const messages: MessageDto[] = page.map((row) =>
    presentMessage(
      row as never,
      viewer,
      facts.kind === "DM" && row.authorId === ctx.userId ? dmStatusFor(otherMember, row.createdAt) : undefined,
    ),
  );

  const members: MemberDto[] = conv.members.map((m) => ({
    id: m.userId,
    name: m.user.name,
    online: online.has(m.userId),
    role: m.role,
    avatarUrl: m.user.avatarUrl,
  }));

  // «آخر ظهور» of the OTHER person of a private chat, for the line under the name (a DM only, and only for one of its two
  // people: the owner reading a DM in oversight is not the peer of anybody there). Left out (key absent) when the company's
  // switch is off or the viewer is not told anything (a guest); null when it is unknown or hidden (services/last-seen.ts).
  let peerSeen: { peerLastSeenAt?: string | null; timeZone?: string } = {};
  if (facts.kind === "DM" && facts.viewerIsMember) {
    const peer = conv.members.find((m) => m.userId !== ctx.userId);
    const reader = await lastSeenReader(ctx.orgId, ctx.userId);
    if (peer && reader.enabled) {
      const row = await db.organizationMember.findUnique({
        // all-statuses: the reader answers null for anybody who is not ACTIVE
        where: { organizationId_userId: { organizationId: ctx.orgId, userId: peer.userId } },
        select: { userId: true, role: true, status: true, lastSeenAt: true, hideLastSeen: true },
      });
      if (row) peerSeen = { peerLastSeenAt: reader.read(row) ?? null, timeZone: reader.timeZone };
    }
  }

  const title =
    facts.kind === "DM"
      ? (conv.members.find((m) => m.userId !== ctx.userId)?.user.name ?? conv.title ?? "")
      : (conv.title ?? "");

  return {
    id: conv.id,
    kind: facts.kind,
    title,
    emoji: conv.emoji,
    topicType: conv.topicType as ConversationDto["topicType"],
    postingPolicy: conv.postingPolicy as ConversationDto["postingPolicy"],
    restricted: conv.restricted,
    teamId: conv.teamId,
    closed: !!conv.closedAt,
    pinned: !!conv.pinnedAt,
    archived: !!conv.archivedAt,
    space: conv.space ? { id: conv.space.id, name: conv.space.name, hasExternal: false } : null,
    ...peerSeen,
    me: {
      canPost: canPost(facts, org!, { ownerJoined: facts.viewerIsMember }),
      canModerate: canModerateHere,
      muted: !!(facts.mutedUntil && facts.mutedUntil > new Date()),
      oversight: org!.role === "OWNER" && !facts.viewerIsMember,
      // a topic only (a DM is never his to enter), and not a closed one (it takes no messages)
      canJoin: org!.role === "OWNER" && !facts.viewerIsMember && facts.kind === "TOPIC" && !conv.closedAt,
      canMakeWork: org!.role !== "GUEST" && !(org!.role === "OWNER" && !facts.viewerIsMember),
      canCall: (await memberCan(ctx, "calls.edit", { spaceGuestsPass: true })) === true,
      canMakeTask: (await memberCan(ctx, "tasks.edit")) === true,
      canMakeTicket: (await memberCan(ctx, "tickets.edit")) === true,
      // «ذكّرني» on a message: the company's switch, and never in silent oversight (a reminder is his own trace; he joins first)
      canRemind: !(org!.role === "OWNER" && !facts.viewerIsMember) && (await isFeatureOn(ctx.orgId, "reminders")),
      canMentionAll: facts.kind === "TOPIC" && org!.role !== "GUEST" && canPost(facts, org!, { ownerJoined: facts.viewerIsMember }),
      canPoll: facts.kind === "TOPIC" && org!.role !== "GUEST" && canPost(facts, org!, { ownerJoined: facts.viewerIsMember }),
      id: ctx.userId,
    },
    pinnedMessages: (
      await db.chatMessage.findMany({
        where: { conversationId, pinned: true, deletedAt: null, kind: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, body: true, deletedAt: true, author: { select: { name: true } } },
      })
    ).map((m) => ({ id: m.id, authorName: m.author.name, preview: previewOf(m.body, m.deletedAt) })),
    members,
    mentionables:
      org!.role === "GUEST"
        ? members
        : [
            ...(await mentionablesOf(ctx.orgId, facts, conv.spaceId ?? null, members, online)),
            // «@المساعد»: only where the company's switch is on and the owner's key is saved (src/server/services/chat-assistant.ts); never for a guest
            ...((await chatAssistantOffered(ctx.orgId)) ? [{ id: ASSISTANT_MENTION_ID, name: ASSISTANT_MENTION_NAME, online: false, role: "AI" }] : []),
          ],
    messages: messages.reverse(), // oldest first in the payload
    // topics and groups: each person's avatar sits under the last message they read (DMs have ticks)
    readers:
      facts.kind === "DM"
        ? []
        : readersOf(
            page,
            conv.members.filter((m) => m.userId !== ctx.userId && !ownerIds.has(m.userId)).map((m) => ({ userId: m.userId, name: m.user.name, avatarUrl: m.user.avatarUrl, lastReadAt: m.lastReadAt })),
          ),
    oldestId: hasOlder ? (messages[0]?.id ?? null) : null,
    // the company's switch, so the log draws the shape it is set to (the words of a message never change)
    chatBubbles: await isFeatureOn(ctx.orgId, "chatBubbles"),
    chatOutbox: await isFeatureOn(ctx.orgId, "chatOutbox"),
  };
}

/**
 * Who read up to where: for each person, the newest message on the page that they have read (a
 * system line or a deleted message is no place for an avatar). A person whose mark is older than
 * the whole page, or who never read, has no avatar here. The caller leaves out the viewer and the OWNER.
 */
export function readersOf(
  page: { id: string; createdAt: Date; kind: string; deletedAt: Date | null }[],
  people: { userId: string; name: string; avatarUrl?: string | null; lastReadAt: Date }[],
): ReaderDto[] {
  const visible = page.filter((m) => m.kind !== "SYSTEM" && !m.deletedAt);
  const out: ReaderDto[] = [];
  for (const p of people) {
    // `page` is newest first: the first one at or before the mark is the newest they read
    const at = visible.find((m) => m.createdAt <= p.lastReadAt);
    if (at) out.push({ userId: p.userId, name: p.name, messageId: at.id, readAt: p.lastReadAt.toISOString(), ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}) });
  }
  return out;
}

/**
 * Shared guard of every topic action: the conversation exists, is of this org, IS A TOPIC, and
 * facts/org are non-null. A DM or a group is not a topic: joining it, adding or removing its people,
 * renaming or closing it through these doors is "not found" (spec: never someone else's DM).
 */
export async function guardTopic(ctx: OrgAccessContext, conversationId: string) {
  const [facts, org] = await Promise.all([
    loadConversationFacts(ctx.userId, conversationId),
    loadOrgFacts(ctx.userId, ctx.orgId),
  ]);
  if (!facts || !org || facts.orgId !== ctx.orgId || facts.kind !== "TOPIC") throw new NotFoundError("chat.e.not_found");
  return { facts, org };
}


/**
 * The people the composer offers for «@»: whoever the topic reaches. An open topic reaches its whole space, and
 * a space member who never opened the topic has no row in it, so the rows alone would leave them out of the list.
 * A restricted topic, a DM and a group reach their own rows. The OWNER is offered only when he is one of them.
 * A GUEST is never given the space's people (no staff directory, no pictures): the caller passes them the rows only.
 */
async function mentionablesOf(
  orgId: string,
  facts: ConversationFacts,
  spaceId: string | null,
  rows: MemberDto[],
  online: Set<string>,
): Promise<MemberDto[]> {
  if (facts.kind !== "TOPIC" || facts.restricted || !spaceId) return rows;
  const spaceRows = await db.workspaceMember.findMany({
    where: { workspaceId: spaceId, user: { memberships: { some: { organizationId: orgId, status: "ACTIVE" } } } },
    select: { role: true, user: { select: { id: true, name: true, avatarUrl: true } } },
  });
  const seen = new Set(rows.map((m) => m.id));
  const extra: MemberDto[] = spaceRows
    .filter((m) => !seen.has(m.user.id))
    .map((m) => ({ id: m.user.id, name: m.user.name, online: online.has(m.user.id), role: m.role, avatarUrl: m.user.avatarUrl }));
  return [...rows, ...extra];
}
