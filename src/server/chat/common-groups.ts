import { db } from "@/server/db";
import { NotFoundError, type OrgAccessContext } from "@/server/auth";
import { dmPairOf } from "@/server/chat/dm";
import { chatScope, listViewerOf, sharedConversations, type ListViewer } from "@/server/chat/list";

/**
 * «مجموعات مشتركة» — what the profile of a private chat's other person says the two of them share.
 *
 * Only where BOTH are ordinary members counts (`sharedConversations`): a group's own rows, the people of an open topic's space, the named people of a restricted
 * topic. Neither the owner's silent eye nor his rank adds a conversation, so the list can never name something the asker only watches, or put the other person
 * somewhere they do not belong. The door answers only for a private chat the asker is one of the two people of.
 */
export interface CommonGroupDto {
  id: string;
  kind: "GROUP" | "TOPIC";
  title: string;
  emoji: string | null;
  /** a topic's space, to tell two «عام» apart (a group has none) */
  spaceName: string | null;
}

export async function commonGroups(ctx: OrgAccessContext, conversationId: string): Promise<{ groups: CommonGroupDto[] }> {
  const org = await chatScope(ctx).org();
  if (!org || org.status !== "ACTIVE" || org.role === "GUEST") throw new NotFoundError("chat.e.not_found");
  const chat = await db.conversation.findFirst({
    where: { id: conversationId, orgId: ctx.orgId, kind: "DM", members: { some: { userId: ctx.userId } } },
    select: { dmKey: true, members: { select: { userId: true } } },
  });
  if (!chat) throw new NotFoundError("chat.e.not_found");
  const pair = chat.dmKey ? dmPairOf(chat.dmKey) : chat.members.map((m) => m.userId);
  const peerId = pair.find((id) => id !== ctx.userId);
  if (!peerId) return { groups: [] }; // «الرسائل المحفوظة»: a chat with myself has no other person
  const peer = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: peerId } },
    select: { role: true, status: true },
  });
  if (!peer || peer.status !== "ACTIVE") return { groups: [] };

  const me = listViewerOf(ctx, org);
  const them: ListViewer = {
    userId: peerId,
    orgId: ctx.orgId,
    org: { orgId: ctx.orgId, role: peer.role, status: peer.status, oversight: false },
    scope: me.scope,
    ownerRank: false,
    oversight: false,
    guest: peer.role === "GUEST",
    orgAdmin: peer.role === "ADMIN",
  };
  const records = await sharedConversations(me, them);
  const groups = records.map(
    (r): CommonGroupDto => ({ id: r.id, kind: r.kind === "GROUP" ? "GROUP" : "TOPIC", title: r.title ?? "", emoji: r.emoji, spaceName: r.kind === "TOPIC" ? r.shownSpaceName : null }),
  );
  return { groups: groups.sort((a, b) => a.title.localeCompare(b.title, "ar") || a.id.localeCompare(b.id)) };
}
