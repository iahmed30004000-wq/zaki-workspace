import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { loadOrgFacts } from "@/server/policy/conversation";
import { PINS_MAX } from "@/server/chat/read-state";
import { AR } from "@/lib/i18n/dict";
import { emitRealtime } from "@/server/realtime/emit";
import { writeSystemMessage } from "@/server/chat/system";
import { systemSentenceOfBody } from "@/lib/chat/system-sentence";
import { isHqSpace, isOfSpace } from "@/server/chat/space-people";

/**
 * DMs. A DM is its two people; nobody else WRITES in it. The OWNER reads it too, silently (decision
 * D-2, 2026-10-24: he reads everything; his reading leaves no mark). A person can only open a DM in
 * their own company; guests have no DMs at all.
 *
 * `dmKey` is `min|max` of the two user ids in plain code-unit order — the same key the data move
 * wrote, so the second person opening the same DM finds the row instead of creating a twin.
 *
 * A DM BELONGS TO A SPACE (the owner's decision, 2026-10-25: each space is like a separate account): it is opened
 * in the space the person is in, with somebody of that space, and lives there (`spaceId`; its key ends in
 * `@<spaceId>`, so the same two people have one DM per space). The DMs from before spaces had them (no space) are
 * «الشركة»'s, and a DM opened in «الشركة» keeps the old key, so it finds them.
 */

export const dmKeyOf = (a: string, b: string, spaceId: string | null = null): string =>
  (a < b ? `${a}|${b}` : `${b}|${a}`) + (spaceId ? `@${spaceId}` : "");

/** The two people of a DM key (`a|b`, or `a|b@space`). */
export const dmPairOf = (dmKey: string): string[] => (dmKey.split("@")[0] ?? "").split("|");

/**
 * «الرسائل المحفوظة» (C3a.3): a DM with oneself. The key is `<me>|<me>` with NO space suffix: it is the person's own, one per company, shown in every
 * space they are in (a space's DMs belong to the space; this one does not). The existing unique (orgId, dmKey) is what makes it one.
 */
export const savedKeyOf = (userId: string): string => dmKeyOf(userId, userId, null);

/** Is this key a DM of one person with themselves (whoever's, with or without a space suffix)? */
export const isSelfDmKey = (dmKey: string | null | undefined): boolean => {
  if (!dmKey) return false;
  const pair = dmPairOf(dmKey);
  return pair.length === 2 && !!pair[0] && pair[0] === pair[1];
};

/** The title a saved chat is stored with and shown under (the screens draw the dictionary's own line, so an old stored title never shows). */
export const SAVED_TITLE_KEY = "chatsaved.title";

/**
 * Where a person's DMs are listed: the DMs of the space they are in, and in «الشركة» also the ones from before
 * spaces (no space). `undefined`: everywhere (the owner's oversight, older callers).
 */
export async function dmPlaceWhere(spaceId: string | null | undefined) {
  if (spaceId === undefined) return {};
  if (!spaceId) return { spaceId: null };
  return (await isHqSpace(spaceId)) ? { OR: [{ spaceId }, { spaceId: null }] } : { spaceId };
}

/** Opens (or finds) the DM between the viewer and `otherId` in the space they are in. Returns its id. */
export async function openDm(ctx: OrgAccessContext, otherId: string, spaceId: string | null = null): Promise<{ id: string; created: boolean }> {
  if (otherId === ctx.userId) throw new ForbiddenError("chat.e.not_found");
  const [me, other] = await Promise.all([
    loadOrgFacts(ctx.userId, ctx.orgId),
    loadOrgFacts(otherId, ctx.orgId),
  ]);
  if (!me || !other || me.status !== "ACTIVE" || other.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (me.role === "GUEST" || other.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  // only with somebody of the space you are in (the owner is in every space)
  if (spaceId && !(await isOfSpace(ctx.orgId, spaceId, otherId))) throw new ForbiddenError("chat.dm_not_in_space");

  // «الشركة» keeps the old key (its DMs from before spaces are found); every other space has its own
  const hq = await isHqSpace(spaceId);
  const dmKey = dmKeyOf(ctx.userId, otherId, hq ? null : spaceId);
  const existing = await db.conversation.findFirst({
    where: { orgId: ctx.orgId, dmKey },
    select: { id: true },
  });
  if (existing) {
    // a DM is never left (see leaveConversation), but a row lost before that rule (older data) is put
    // back for both people, so neither is locked out of their own history and the pair can talk again
    await db.conversationMember.createMany({
      data: [{ conversationId: existing.id, userId: ctx.userId }, { conversationId: existing.id, userId: otherId }],
      skipDuplicates: true,
    });
    return { id: existing.id, created: false };
  }

  // the OLDEST DM of the pair keeps the key when legacy duplicates exist: only claim it if free
  const created = await db.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        kind: "DM",
        dmKey,
        spaceId,
        title: null,
        members: { create: [{ userId: ctx.userId }, { userId: otherId }] },
      },
      select: { id: true },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: c.id, userId: otherId });
    return c;
  });
  return { id: created.id, created: true };
}

/**
 * Opens (or finds) the person's own saved chat: a DM with ONE row (theirs), `dmKey = <me>|<me>`. Idempotent: the second call, and two tabs at once, end at the
 * same conversation (the unique (orgId, dmKey) decides; the loser of the race reads the winner's row). A guest has none; a suspended person is nobody. A new
 * saved chat is pinned for the person through C3a.1's own column (`ConversationMember.pinnedAt`, while they have fewer than `PINS_MAX` pins); they may
 * unpin it, and opening it again never pins it again. The caller checks the company's switch `savedMessages` (the door does).
 */
export async function openSavedMessages(ctx: OrgAccessContext): Promise<{ id: string; created: boolean }> {
  const me = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!me || me.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (me.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  const dmKey = savedKeyOf(ctx.userId);

  const found = async (): Promise<{ id: string; created: boolean } | null> => {
    const existing = await db.conversation.findFirst({ where: { orgId: ctx.orgId, dmKey }, select: { id: true } });
    if (!existing) return null;
    // a row lost before the rule that a DM is never left is put back: the person is never locked out of their own saved messages
    await db.conversationMember.createMany({ data: [{ conversationId: existing.id, userId: ctx.userId }], skipDuplicates: true });
    return { id: existing.id, created: false };
  };
  const already = await found();
  if (already) return already;

  try {
    const created = await db.$transaction(async (tx) => {
      const pins = await tx.conversationMember.count({ where: { userId: ctx.userId, pinnedAt: { not: null }, conversation: { orgId: ctx.orgId } } });
      const c = await tx.conversation.create({
        data: {
          orgId: ctx.orgId,
          kind: "DM",
          dmKey,
          spaceId: null,
          title: AR[SAVED_TITLE_KEY] ?? null,
          members: { create: [{ userId: ctx.userId, ...(pins < PINS_MAX ? { pinnedAt: new Date() } : {}) }] },
        },
        select: { id: true },
      });
      // the person's other tabs and devices get the row through the sync feed (ids only, for them alone: the same event as C3a.1)
      await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: c.id, targetUserId: ctx.userId });
      return c;
    });
    return { id: created.id, created: true };
  } catch (err) {
    // two tabs at once: the other one made it first (the unique key refused ours); read theirs
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await found();
      if (winner) return winner;
    }
    throw err;
  }
}

/** The DM list of a person (in the space they are in, when given): peers, last message, unread count. */
export async function listDms(ctx: OrgAccessContext, spaceId?: string | null) {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (org?.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  const rows = await db.conversation.findMany({
    where: {
      orgId: ctx.orgId,
      kind: { in: ["DM", "GROUP"] },
      members: { some: { userId: ctx.userId } },
      ...(await dmPlaceWhere(spaceId)),
    },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, body: true, kind: true, deletedAt: true, authorId: true, createdAt: true, author: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // the saved chat has no peer: the old lists would draw a nameless row (it is the new screen's)
  return Promise.all(
    rows.filter((c) => !isSelfDmKey(c.dmKey)).map(async (c) => {
      const mine = c.members.find((m) => m.userId === ctx.userId);
      const other = c.members.find((m) => m.userId !== ctx.userId);
      const last = c.messages[0] ?? null;
      const unread = last && mine
        ? await db.chatMessage.count({
            where: { conversationId: c.id, createdAt: { gt: mine.lastReadAt }, authorId: { not: ctx.userId }, deletedAt: null, kind: { not: "SYSTEM" } },
          })
        : 0;
      return {
        id: c.id,
        peer: { id: other?.userId ?? "", name: other?.user.name ?? "", avatarUrl: other?.user.avatarUrl ?? null },
        unread,
        lastMessage: last
          ? {
              at: last.createdAt.toISOString(),
              preview: last.kind === "SYSTEM" ? systemSentenceOfBody(last.body, last.author.name) : last.deletedAt ? null : last.body.slice(0, 140),
              mine: last.authorId === ctx.userId,
            }
          : null,
      };
    }),
  );
}

/** A GROUP (a private group chat, not a topic): creator plus invited ACTIVE people. */
export async function createGroup(ctx: OrgAccessContext, opts: { title: string; memberIds: string[]; emoji?: string | null }): Promise<{ id: string }> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!org || org.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");

  const ids = [...new Set([ctx.userId, ...opts.memberIds])];
  const people = await db.organizationMember.findMany({
    where: { organizationId: ctx.orgId, userId: { in: ids }, status: "ACTIVE", role: { not: "GUEST" } },
    select: { userId: true },
  });
  if (people.length !== ids.length) throw new NotFoundError("chat.e.not_found");

  const c = await db.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        kind: "GROUP",
        title: opts.title,
        emoji: opts.emoji ?? null,
        members: { create: ids.map((userId) => ({ userId, role: userId === ctx.userId ? "admin" : "member" })) },
      },
      select: { id: true },
    });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId: conv.id, authorId: ctx.userId, k: "topic_created", p: { title: opts.title } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: conv.id });
    return conv;
  });
  return { id: c.id };
}

/** Group settings: title, emoji, members (a group admin only). */
export async function manageGroup(
  ctx: OrgAccessContext,
  conversationId: string,
  input: { title?: string; emoji?: string | null; addMemberIds?: string[]; removeMemberIds?: string[] },
): Promise<void> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId, kind: "GROUP" }, select: { id: true } });
  if (!conv) throw new NotFoundError("chat.e.not_found");
  const me = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: ctx.userId } },
    select: { role: true },
  });
  if (!me || me.role !== "admin") throw new ForbiddenError("chat.e.moderator_only");

  await db.$transaction(async (tx) => {
    if (input.title !== undefined || input.emoji !== undefined) {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.emoji !== undefined ? { emoji: input.emoji } : {}) },
      });
    }
    if (input.addMemberIds?.length) {
      const people = await tx.organizationMember.findMany({
        where: { organizationId: ctx.orgId, userId: { in: input.addMemberIds }, status: "ACTIVE", role: { not: "GUEST" } },
        select: { userId: true },
      });
      await tx.conversationMember.createMany({
        data: people.map((p) => ({ conversationId, userId: p.userId })),
        skipDuplicates: true,
      });
      for (const p of people) {
        await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "member_added", p: { userId: p.userId } });
      }
    }
    if (input.removeMemberIds?.length) {
      // a person may always remove themselves; removing others is the group admin's act
      await tx.conversationMember.deleteMany({ where: { conversationId, userId: { in: input.removeMemberIds } } });
      for (const id of input.removeMemberIds) {
        await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "member_removed", p: { userId: id } });
      }
    }
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId });
  });
}

/**
 * Leaving a group: remove my row; the last person leaving deletes nothing (the group stays for the archive).
 * A DM is never left: removing one side's row locked the OTHER person out of their own history (the
 * policy needs both rows) and, the DM being found again by its pair key, blocked any new DM (review A7).
 */
export async function leaveConversation(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId }, select: { id: true, kind: true } });
  if (!conv) throw new NotFoundError("chat.e.not_found");
  if (conv.kind === "DM") throw new ForbiddenError("chat.e.dm_leave_denied");
  const me = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: ctx.userId } },
    select: { id: true },
  });
  if (!me) throw new NotFoundError("chat.e.not_found");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.delete({ where: { id: me.id } });
    if (conv.kind === "GROUP") {
      await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "leave" });
    }
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId: ctx.userId });
  });
}
