import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { loadOrgFacts } from "@/server/policy/conversation";
import { isOfSpace } from "@/server/chat/space-people";
import { chatAssistantOffered } from "@/server/services/chat-assistant";
import { isFeatureOn } from "@/server/services/features";
import { ASSISTANT_CHAT_EMOJI, ASSISTANT_CHAT_TITLE, assistantChatKey } from "@/lib/chat/assistant-chat";

/**
 * «المساعد» كجهة اتصال — the assistant as a name in the chat's people lists, with a private conversation of its own for each person.
 *
 *   WHAT   the row «المساعد» in the new-message list and in the little chat window opens (or finds) ONE conversation of the person with the
 *          assistant: a restricted topic of the space they are in, with only them as its audience, titled «المساعد». Every message the
 *          person writes THERE is answered, with no «@» needed (`answerMention`, src/server/services/chat-assistant.ts). Nothing else about
 *          the assistant changes: the same limits, the same filter, the same refusal for a guest, the same audit row, the same
 *          «this answer comes from an external model» line at its first answer.
 *   KEY    the conversation is found by `dmKey = assistant|<userId>@<spaceId>` (unique per company): the same column the private chats
 *          use for their pair, written only here. Only the person it names can wake the assistant in it.
 *   SEEN   by the person, and by the OWNER's silent oversight like every conversation (decision D-2); nobody else. The space's topic list
 *          draws it only for the person it belongs to, so the owner's list is not filled with everybody's assistant chats (he opens one
 *          by its link, as any conversation).
 *   SWITCH `assistantContact`, on by default, and only ever offered where «@المساعد» itself is (both of its switches and a ready model).
 *          Off: the row is not drawn, the route answers «not found», and the conversations already made stay as they are.
 */

/** Is the row «المساعد» to be drawn for this company: its own switch is on AND «@المساعد» is offered. */
export async function assistantContactOffered(orgId: string): Promise<boolean> {
  return (await isFeatureOn(orgId, "assistantContact")) && (await chatAssistantOffered(orgId));
}

/** Opens (or finds) the person's conversation with the assistant in the space they are in. */
export async function openAssistantChat(ctx: OrgAccessContext, spaceId: string | null): Promise<{ id: string; created: boolean }> {
  const me = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!me || me.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (me.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  if (!(await assistantContactOffered(ctx.orgId))) throw new NotFoundError("chat.e.not_found");
  // the conversation lives in a space (the one the person is in); the owner is in every space
  if (!spaceId || !(await isOfSpace(ctx.orgId, spaceId, ctx.userId))) throw new NotFoundError("chat.e.not_found");

  const dmKey = assistantChatKey(ctx.userId, spaceId);
  const find = () => db.conversation.findFirst({ where: { orgId: ctx.orgId, dmKey }, select: { id: true } });
  const found = await find();
  if (found) {
    // a row lost by an older cleanup is put back, so the person is never locked out of their own history
    await db.conversationMember.createMany({ data: [{ conversationId: found.id, userId: ctx.userId }], skipDuplicates: true });
    return { id: found.id, created: false };
  }
  try {
    const created = await db.conversation.create({
      data: {
        orgId: ctx.orgId,
        kind: "TOPIC",
        title: ASSISTANT_CHAT_TITLE,
        emoji: ASSISTANT_CHAT_EMOJI,
        spaceId,
        topicType: "DISCUSSION",
        restricted: true,
        dmKey,
        members: { create: [{ userId: ctx.userId }] },
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    // two taps at once: the second finds the first one's conversation
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
      const again = await find();
      if (again) return { id: again.id, created: false };
    }
    throw err;
  }
}
