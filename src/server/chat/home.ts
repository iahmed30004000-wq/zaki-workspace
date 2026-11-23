import { db } from "@/server/db";
import { MENTION_ALL_ID } from "@/lib/chat/conversation/mentions";
import { isAssistantChatKey } from "@/lib/chat/assistant-chat";
import { isFeatureOn } from "@/server/services/features";
import type { OrgAccessContext } from "@/server/auth";
import { hasOversight, loadOrgFacts, isSpaceAdmin, type OrgFacts } from "@/server/policy/conversation";
import { listDms } from "@/server/chat/dm";
import type { DmSummaryDto, GroupSummaryDto, HomeDto, SpaceSummaryDto, TopicSummaryDto } from "@/server/chat/dto";
import { previewOf } from "@/server/chat/redact";
import { systemSentenceOfBody } from "@/lib/chat/system-sentence";
import { loadOrders } from "@/server/chat/order";
import { applySavedOrder, dmScope, spaceScope } from "@/lib/chat/order";

/**
 * The chat home: the spaces the viewer is in (with their topics), the viewer's DMs, and whether
 * the archive/oversight door is theirs. One query round per level, then one unread count per topic
 * and per DM — all computed from `lastReadAt`, never from a stored counter.
 */

/**
 * Who the viewer is inside ONE space, as far as its topics are concerned: the two rules below decide which topics of a space they LIST and which of those they may
 * WRITE in. The chat home and the forward sheet's door (`forward-targets.ts`) both ask them, so a topic is never offered as a place to forward to that the list
 * itself would hide.
 */
export interface SpaceViewer {
  oversight: boolean;
  /** the OWNER rank (a space ADMIN of every space; reading in silence is `oversight`) */
  isOwner: boolean;
  orgRole: string | undefined;
  spaceRole: string | null;
  /** muted in this space right now */
  spaceMuted: boolean;
  /** sees every «مقطع» and its topics (the owner, the space's admin, an org admin who is in it) */
  manager: boolean;
  /** the «مقاطع» the viewer sees */
  teamIds: ReadonlySet<string>;
}

export function spaceViewerOf(
  org: OrgFacts | null,
  space: { role: string | null; mutedUntil: Date | null },
  teams: readonly { id: string; members: readonly unknown[] }[],
): SpaceViewer {
  const isOwner = org?.role === "OWNER"; // oversight-ok: the rank manages every space; reading in silence is `oversight`
  const spaceRole = space.role ?? (isOwner ? "ADMIN" : null);
  const manager = isOwner || isSpaceAdmin(spaceRole) || (org?.role === "ADMIN" && spaceRole !== null);
  return {
    oversight: hasOversight(org),
    isOwner,
    orgRole: org?.role,
    spaceRole,
    spaceMuted: !!(space.mutedUntil && space.mutedUntil > new Date()),
    manager,
    teamIds: new Set(teams.filter((team) => manager || team.members.length > 0).map((team) => team.id)),
  };
}

/** Is the topic on the viewer's list? (a restricted one only by its own rows, a «مقطع»'s only for its people, an archived one only for managers, somebody's assistant chat only for them) */
export function topicListed(t: { restricted: boolean; teamId: string | null; archivedAt: Date | null; dmKey: string | null; memberCount: number }, v: SpaceViewer): boolean {
  if (isAssistantChatKey(t.dmKey) && t.memberCount === 0) return false;
  const passes = v.oversight || (!t.restricted && v.spaceRole !== null) || (t.restricted && t.memberCount > 0);
  if (!passes) return false;
  if (t.teamId && !v.teamIds.has(t.teamId)) return false;
  if (t.archivedAt && !(v.isOwner || isSpaceAdmin(v.spaceRole))) return false;
  return true;
}

/** May the viewer write in this (listed) topic? The list's hint: the server decides again with the policy on every send. */
export function topicPostable(t: { closedAt: Date | null; postingPolicy: string; topicType: string; memberCount: number }, v: SpaceViewer): boolean {
  if (t.closedAt) return false;
  if (v.oversight) return t.memberCount > 0;
  if (isSpaceAdmin(v.spaceRole)) return true;
  return !v.spaceMuted && t.postingPolicy !== "ADMINS" && !(v.orgRole === "GUEST" && t.topicType === "ANNOUNCEMENTS");
}

export async function chatHome(ctx: OrgAccessContext, opts: { spaceId?: string | null } = {}): Promise<HomeDto> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  // oversight-ok: the OWNER RANK manages every space (a space ADMIN of each, no row needed); what he reads in
  // silence is `oversight` — the capability archive.view — and nothing else
  const isOwner = org?.role === "OWNER"; // oversight-ok: the rank manages every space; reading in silence is `oversight`
  const oversight = hasOversight(org);

  // my spaces: the rows I am in, plus (for the OWNER rank) every space
  const mySpaceRows = await db.workspaceMember.findMany({
    where: { userId: ctx.userId, workspace: { organizationId: ctx.orgId } },
    select: { workspaceId: true, role: true, mutedUntil: true },
  });
  const mySpaceIds = new Set(mySpaceRows.map((r) => r.workspaceId));

  const spacesRows = await db.workspace.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(isOwner ? {} : { id: { in: [...mySpaceIds] } }),
      // inside the space the person is in (the route passes it): that space alone, like a separate site
      ...(opts.spaceId !== undefined ? { AND: [{ id: opts.spaceId ?? "" }] } : {}),
    },
    select: {
      id: true,
      name: true,
      emoji: true,
      kind: true,
      members: {
        where: {
          role: "GUEST",
          user: { memberships: { some: { organizationId: ctx.orgId, role: "GUEST", status: "ACTIVE" } } },
        },
        select: { id: true },
      },
      topicGroups: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, emoji: true, position: true, restricted: true, members: { where: { userId: ctx.userId }, select: { userId: true } } },
      },
      teams: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, name: true, members: { where: { userId: ctx.userId }, select: { id: true } } },
      },
      conversations: {
        where: { kind: "TOPIC" },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          emoji: true,
          topicType: true,
          restricted: true,
          postingPolicy: true,
          closedAt: true,
          archivedAt: true,
          pinnedAt: true,
          systemKey: true,
          dmKey: true,
          teamId: true,
          groupId: true,
          members: { where: { userId: ctx.userId }, select: { lastReadAt: true } },
        },
      },
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  // the person's OWN order of each list (their drag and drop): applied last, over the server's default order
  const myDmScope = dmScope(opts.spaceId ?? null);
  const savedOrders = await loadOrders(ctx, [...spacesRows.map((s) => spaceScope(s.id)), myDmScope]);

  const spaces: SpaceSummaryDto[] = [];
  for (const s of spacesRows) {
    const myRow = mySpaceRows.find((r) => r.workspaceId === s.id);
    // the rules of what a topic lists and who may write in it are `topicListed` / `topicPostable` (the forward sheet's door asks the same two)
    const viewer = spaceViewerOf(org, { role: myRow?.role ?? null, mutedUntil: myRow?.mutedUntil ?? null }, s.teams);
    const spaceRole = viewer.spaceRole;
    const topics: TopicSummaryDto[] = [];
    let spaceUnread = 0;
    // the «مقاطع»: a manager of the space (the OWNER, its ADMIN, an org ADMIN who is in it) sees them all and
    // their topics; anybody else their own
    const sections = s.teams.filter((team) => viewer.teamIds.has(team.id)).map((team) => ({ id: team.id, name: team.name }));

    for (const t of s.conversations) {
      // somebody's conversation with the assistant is listed for that person only (the owner reads it by its link, his list is not filled with them); a restricted
      // topic is read by its own rows (and by whoever holds oversight); a guest sees what everyone sees; a مقطع's topic is its people's (and the managers');
      // an archived topic is out of the list: its space's managers find it under «المؤرشفة»
      if (!topicListed({ restricted: t.restricted, teamId: t.teamId, archivedAt: t.archivedAt, dmKey: t.dmKey, memberCount: t.members.length }, viewer)) continue;
      const archived = !!t.archivedAt;

      const lastRead = t.members[0]?.lastReadAt ?? null;
      // a system line («انضم»، «ثبّت») is not a message to read: it never counts
      const countable = { conversationId: t.id, authorId: { not: ctx.userId }, deletedAt: null, kind: { not: "SYSTEM" as const } };
      // the OWNER's oversight never marks anything read, so a count there could never clear: 0
      const silentOversight = (oversight && t.members.length === 0) || archived;
      const [last, unread, mentions] = await Promise.all([
        db.chatMessage.findFirst({
          where: { conversationId: t.id },
          orderBy: { createdAt: "desc" },
          select: { body: true, kind: true, deletedAt: true, createdAt: true, authorId: true, author: { select: { name: true } } },
        }),
        silentOversight
          ? 0
          : lastRead
            ? db.chatMessage.count({ where: { ...countable, createdAt: { gt: lastRead } } })
            : db.chatMessage.count({ where: countable }),
        lastRead && !archived
          ? db.chatMessage.count({ where: { ...countable, createdAt: { gt: lastRead }, mentions: { hasSome: [ctx.userId, MENTION_ALL_ID] } } })
          : 0,
      ]);

      const canPost = topicPostable({ closedAt: t.closedAt, postingPolicy: t.postingPolicy, topicType: t.topicType, memberCount: t.members.length }, viewer);

      topics.push({
        id: t.id,
        title: t.title ?? "",
        emoji: t.emoji,
        topicType: t.topicType as TopicSummaryDto["topicType"],
        unread,
        mentions,
        closed: !!t.closedAt,
        restricted: t.restricted,
        teamId: t.teamId,
        groupId: t.groupId,
        pinned: !!t.pinnedAt,
        archived,
        system: !!t.systemKey,
        canPost,
        lastMessage: last
          ? {
              at: last.createdAt.toISOString(),
              preview: last.kind === "SYSTEM" ? systemSentenceOfBody(last.body, last.author.name) : previewOf(last.body, last.deletedAt),
              mine: last.authorId === ctx.userId,
            }
          : null,
      });
      spaceUnread += unread;
    }
    // pinned topics on top (the last pinned first), then the space's own order
    const pinnedAt = new Map(s.conversations.map((t) => [t.id, t.pinnedAt?.getTime() ?? 0]));
    topics.sort((a, b) => (pinnedAt.get(b.id) ?? 0) - (pinnedAt.get(a.id) ?? 0));
    // then the person's own order, inside the pinned group and inside the unpinned one (the pin still floats);
    // a topic it does not know keeps its default place, one it knows that is gone is ignored
    const mine = applySavedOrder(topics, savedOrders.get(spaceScope(s.id)), (t) => (t.archived ? "a" : t.pinned ? "p" : "u"));
    topics.splice(0, topics.length, ...mine);
    // a space where I read nothing is not on my list — except the space I am in: its page is never blank
    if (!topics.length && opts.spaceId === undefined) continue;

    // the groups: a restricted one only for the owner rank and its people; a group none of whose topics the viewer lists is shown to its managers only (to drop topics in)
    const groups: GroupSummaryDto[] = [];
    for (const g of s.topicGroups) {
      if (g.restricted && !isOwner && g.members.length === 0) continue;
      const inside = topics.filter((t) => t.groupId === g.id && !t.archived);
      if (!inside.length && !viewer.manager) continue;
      const newest = inside.reduce<TopicSummaryDto["lastMessage"]>((best, t) => (t.lastMessage && (!best || t.lastMessage.at > best.at) ? t.lastMessage : best), null);
      groups.push({
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        position: g.position,
        restricted: g.restricted,
        topicCount: inside.length,
        unread: inside.reduce((n, t) => n + t.unread, 0),
        mentions: inside.reduce((n, t) => n + t.mentions, 0),
        lastMessage: newest,
      });
    }

    spaces.push({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      kind: s.kind,
      hasExternal: s.members.length > 0,
      canModerate: isOwner || isSpaceAdmin(spaceRole),
      canCreateTopic: isOwner || isSpaceAdmin(spaceRole),
      sections,
      groups,
      unread: spaceUnread,
      topics,
    });
  }

  // DMs: never for a guest, never in the owner's oversight (a DM is not his to read)
  const defaultDms: DmSummaryDto[] = org?.role === "GUEST" ? [] : await listDms(ctx, opts.spaceId);
  const dms = applySavedOrder(defaultDms, org?.role === "GUEST" ? null : savedOrders.get(myDmScope));
  // the lists that have an order of their own now (the screen offers «رجّع الترتيب الأصلي» only for those)
  const ordered = [...spaces.map((sp) => spaceScope(sp.id)), ...(dms.length ? [myDmScope] : [])].filter((sc) => savedOrders.has(sc));

  const rowMenu = await isFeatureOn(ctx.orgId, "chatRowMenu");
  return { spaces, dms, canOversee: oversight, rowMenu, canPurge: rowMenu && isOwner /* oversight-ok: «حذف نهائي» stays the owner rank (D-A4) */, ordered, dmScope: myDmScope };
}
