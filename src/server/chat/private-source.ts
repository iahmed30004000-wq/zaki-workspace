import { db } from "@/server/db";

/**
 * Is this message somebody's private talk (a DM, a group, a restricted topic, a «مقطع»'s topic)? What is made from it is
 * private until the person confirms otherwise (P0.3), and so is a task made from it that is later published (P0 review).
 * Kept apart from make-work.ts so the task service can ask without importing the code that imports it.
 */
export async function sourceIsPrivate(orgId: string, messageId: string): Promise<boolean> {
  const msg = await db.chatMessage.findFirst({
    where: { id: messageId, orgId },
    select: { conversation: { select: { kind: true, restricted: true, teamId: true } } },
  });
  if (!msg) return false;
  return msg.conversation.kind !== "TOPIC" || msg.conversation.restricted || !!msg.conversation.teamId;
}
