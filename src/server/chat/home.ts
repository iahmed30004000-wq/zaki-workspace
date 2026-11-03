import { db } from "@/server/db";
import { MENTION_ALL_ID } from "@/lib/chat/conversation/mentions";
import { isAssistantChatKey } from "@/lib/chat/assistant-chat";
import { isFeatureOn } from "@/server/services/features";
import type { OrgAccessContext } from "@/server/auth";
import { loadOrgFacts, isSpaceAdmin } from "@/server/policy/conversation";
import { listDms } from "@/server/chat/dm";
import type { DmSummaryDto, HomeDto, SpaceSummaryDto, TopicSummaryDto } from "@/server/chat/dto";
import { previewOf } from "@/server/chat/redact";
import { systemSentenceOfBody } from "@/lib/chat/system-sentence";
import { loadOrders } from "@/server/chat/order";
import { applySavedOrder, dmScope, spaceScope } from "@/lib/chat/order";

/**
 * The chat home: the spaces the viewer is in (with their topics), the viewer's DMs, and whether
 * the archive/oversight door is theirs. One query round per level, then one unread count per topic
 * and per DM — all computed from `lastReadAt`, never from a stored counter.
 */

export async function chatHome(ctx: OrgAccessContext, opts: { spaceId?: string | null } = {}): Promise<HomeDto> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const isOwner = org?.role === "OWNER";

  // my spaces: the rows I am in, plus (for the OWNER) every space — he reads silently
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
    const spaceRole = mySpaceRows.find((r) => r.workspaceId === s.id)?.role ?? null;
    const spaceMuted = mySpaceRows.find((r) => r.workspaceId === s.id)?.mutedUntil ?? null;
    const topics: TopicSummaryDto[] = [];
    let spaceUnread = 0;
    // the «مقاطع»: a manager of the space (the OWNER, its ADMIN, an org ADMIN who is in it) sees them all and
    // their topics; anybody else their own
    const manager = isOwner || isSpaceAdmin(spaceRole) || (org?.role === "ADMIN" && spaceRole !== null);
    const sections = s.teams.filter((team) => manager || team.members.length > 0).map((team) => ({ id: team.id, name: team.name }));
    const seen = new Set(sections.map((team) => team.id));

    for (const t of s.conversations) {
      // somebody's conversation with the assistant is listed for that person only (the owner reads it by its link, his list is not filled with them)
      if (isAssistantChatKey(t.dmKey) && t.members.length === 0) continue;
      // a restricted topic is read by its own rows (and by the OWNER); a guest sees what everyone sees
      const passes =
        isOwner || (!t.restricted && spaceRole !== null) || (t.restricted && t.members.length > 0);
      if (!passes) continue;
      // a مقطع's topic is its people's (and the managers')
      if (t.teamId && !seen.has(t.teamId)) continue;
      // an archived topic is out of the list: its space's managers find it under «المؤرشفة»
      const archived = !!t.archivedAt;
      if (archived && !(isOwner || isSpaceAdmin(spaceRole))) continue;

      const lastRead = t.members[0]?.lastReadAt ?? null;
      // a system line («انضم»، «ثبّت») is not a message to read: it never counts
      const countable = { conversationId: t.id, authorId: { not: ctx.userId }, deletedAt: null, kind: { not: "SYSTEM" as const } };
      // the OWNER's oversight never marks anything read, so a count there could never clear: 0
      const silentOversight = (isOwner && t.members.length === 0) || archived;
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

      const canPost =
        !t.closedAt &&
        (isOwner
          ? t.members.length > 0
          : isSpaceAdmin(spaceRole)
            ? true
            : !(spaceMuted && spaceMuted > new Date()) && t.postingPolicy !== "ADMINS" && !(org?.role === "GUEST" && t.topicType === "ANNOUNCEMENTS"));

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

    spaces.push({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      kind: s.kind,
      hasExternal: s.members.length > 0,
      canModerate: isOwner || isSpaceAdmin(spaceRole),
      canCreateTopic: isOwner || isSpaceAdmin(spaceRole),
      sections,
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
  return { spaces, dms, canOversee: isOwner, rowMenu, canPurge: rowMenu && isOwner, ordered, dmScope: myDmScope };
}
