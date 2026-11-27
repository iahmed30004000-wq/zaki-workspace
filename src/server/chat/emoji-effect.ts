import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { allowTyping, signalEmojiEffect } from "@/server/realtime/hub";
import { emojiTokens } from "@/lib/chat/zaki-emoji";

/**
 * «التأثير بيشوفه الطرفين» — a person tapped the big emoji of a message in a PRIVATE chat: the other person's open screen is told to play it too. Nothing
 * is stored and nothing is sent when they are not looking.
 *
 * Only one of the chat's own two people can ask (a row of their own: the owner's silent oversight never signals anything, it would give him away), only for
 * a living message that is exactly one emoji, and at most once every two seconds per message. A topic or a group answers quietly and signals nobody.
 */
export async function playForPeer(actor: Actor, messageId: string, now: number = Date.now()): Promise<{ signalled: number }> {
  const message = await db.chatMessage.findFirst({
    where: { id: messageId, orgId: actor.orgId, deletedAt: null, kind: "TEXT" },
    select: { body: true, conversationId: true, conversation: { select: { kind: true, members: { select: { userId: true } } } } },
  });
  const members = message?.conversation.members.map((m) => m.userId) ?? [];
  if (!message || !members.includes(actor.userId) || !(await canReadConversation(actor.userId, message.conversationId))) throw new NotFoundError("chat.e.not_found");
  if (message.conversation.kind !== "DM") return { signalled: 0 };
  if (emojiTokens(message.body)?.length !== 1) throw new NotFoundError("chat.e.not_found");
  const peer = members.find((id) => id !== actor.userId);
  if (!peer || !allowTyping(`fx|${actor.userId}|${messageId}`, now)) return { signalled: 0 };
  return { signalled: await signalEmojiEffect(actor.orgId, message.conversationId, peer, messageId) };
}
