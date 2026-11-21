import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";
import { loadOrgFacts } from "@/server/policy/conversation";
import { isFeatureOn } from "@/server/services/features";
import { isAssistantChatKey } from "@/lib/chat/assistant-chat";
import { isSelfDmKey, savedKeyOf, dmPairOf } from "@/server/chat/dm";
import { spaceViewerOf, topicListed, topicPostable } from "@/server/chat/home";
import { FORWARD_RECENTS, type ForwardTargetDto, type ForwardTargetsDto } from "@/lib/chat/forward";

/**
 * S5.2 — the forward sheet's picker: every place the person may WRITE in, in EVERY space they are in (not only the one they stand in) and every private chat of theirs,
 * plus their saved chat on its own. It is a hint for the screen, never a permission: `forwardMessages` / `forwardMessage` decide every target again on send.
 *
 * What is listed is what the chat list would list (`topicListed`) AND the person may write in (`topicPostable`): a restricted topic they are not in, a closed or archived
 * one, an announcements topic a guest only reads, a space they are muted in, a space they are not in, another company's, and a private chat whose other person is no
 * longer ACTIVE never appear — their existence is not told. A guest has no private chats and no saved chat.
 */
export async function listForwardTargets(ctx: OrgAccessContext): Promise<ForwardTargetsDto> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!org || org.status !== "ACTIVE") return { saved: null, targets: [], recents: [] };
  const isGuest = org.role === "GUEST";

  const mySpaceRows = await db.workspaceMember.findMany({
    where: { userId: ctx.userId, workspace: { organizationId: ctx.orgId } },
    select: { workspaceId: true, role: true, mutedUntil: true },
  });
  const mine = new Map(mySpaceRows.map((r) => [r.workspaceId, r]));
  // the OWNER rank is in every space (no row needed); anybody else only in the spaces they hold a row of
  const spaces = await db.workspace.findMany({
    where: { organizationId: ctx.orgId, ...(org.role === "OWNER" /* oversight-ok: the rank puts the owner in every space; reading in silence is `oversight` */ ? {} : { id: { in: [...mine.keys()] } }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      teams: { select: { id: true, members: { where: { userId: ctx.userId }, select: { id: true } } } },
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
          dmKey: true,
          teamId: true,
          lastMessageAt: true,
          members: { where: { userId: ctx.userId }, select: { userId: true } },
        },
      },
    },
  });

  const targets: ForwardTargetDto[] = [];
  for (const s of spaces) {
    const my = mine.get(s.id);
    const viewer = spaceViewerOf(org, { role: my?.role ?? null, mutedUntil: my?.mutedUntil ?? null }, s.teams);
    for (const t of s.conversations) {
      const memberCount = t.members.length;
      // the person's chat with the assistant is not a place to forward to (a forward is never answered there, and its title is the assistant's, not a topic's)
      if (isAssistantChatKey(t.dmKey)) continue;
      if (!topicListed({ restricted: t.restricted, teamId: t.teamId, archivedAt: t.archivedAt, dmKey: t.dmKey, memberCount }, viewer)) continue;
      // an archived topic is read-only and a closed one takes no messages: neither is a place to forward to
      if (t.archivedAt || !topicPostable({ closedAt: t.closedAt, postingPolicy: t.postingPolicy, topicType: t.topicType, memberCount }, viewer)) continue;
      targets.push({ id: t.id, kind: "TOPIC", title: t.title ?? "", emoji: t.emoji, avatarUrl: null, spaceId: s.id, spaceName: s.name, lastAt: t.lastMessageAt?.toISOString() ?? null });
    }
  }

  // private chats and groups: never for a guest; the saved chat is not among them
  let savedId: string | null = null;
  if (!isGuest) {
    const rows = await db.conversation.findMany({
      where: { orgId: ctx.orgId, kind: { in: ["DM", "GROUP"] }, members: { some: { userId: ctx.userId } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        kind: true,
        title: true,
        emoji: true,
        dmKey: true,
        lastMessageAt: true,
        space: { select: { id: true, name: true } },
        members: { select: { userId: true, user: { select: { id: true, name: true, avatarUrl: true } } } },
      },
    });
    // a private chat is a place to write in only while the other person is ACTIVE (the policy's rule for a DM)
    const peerIds = new Set<string>();
    for (const c of rows) {
      if (c.kind !== "DM" || (c.dmKey && isSelfDmKey(c.dmKey))) continue;
      // the pair comes from the DM's key when it has one (the policy's rule), else from the rows that are left
      for (const id of c.dmKey ? dmPairOf(c.dmKey) : c.members.map((m) => m.userId)) if (id !== ctx.userId) peerIds.add(id);
    }
    const active = new Set(
      (await db.organizationMember.findMany({ where: { organizationId: ctx.orgId, userId: { in: [...peerIds] }, status: "ACTIVE" }, select: { userId: true } })).map((m) => m.userId),
    );
    for (const c of rows) {
      if (c.kind === "DM" && c.dmKey && isSelfDmKey(c.dmKey)) {
        if (c.dmKey === savedKeyOf(ctx.userId)) savedId = c.id;
        continue;
      }
      if (c.kind === "DM") {
        const otherId = c.dmKey ? dmPairOf(c.dmKey).find((id) => id !== ctx.userId) : c.members.find((m) => m.userId !== ctx.userId)?.userId;
        if (!otherId || !active.has(otherId)) continue;
        const other = c.members.find((m) => m.userId === otherId)?.user;
        if (!other) continue;
        targets.push({ id: c.id, kind: "DM", title: other.name, emoji: null, avatarUrl: other.avatarUrl, spaceId: c.space?.id ?? null, spaceName: c.space?.name ?? null, lastAt: c.lastMessageAt?.toISOString() ?? null });
      } else {
        targets.push({ id: c.id, kind: "GROUP", title: c.title ?? "", emoji: c.emoji, avatarUrl: null, spaceId: null, spaceName: null, lastAt: c.lastMessageAt?.toISOString() ?? null });
      }
    }
  }

  const savedOn = !isGuest && (await isFeatureOn(ctx.orgId, "savedMessages"));
  const recents = targets
    .filter((t) => t.lastAt)
    .sort((a, b) => (a.lastAt! < b.lastAt! ? 1 : a.lastAt! > b.lastAt! ? -1 : 0))
    .slice(0, FORWARD_RECENTS)
    .map((t) => t.id);
  return { saved: savedOn ? { id: savedId } : null, targets, recents };
}
