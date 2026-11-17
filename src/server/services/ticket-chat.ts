import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";
import { isFeatureOn } from "@/server/services/features";
import { emitRealtime } from "@/server/realtime/emit";
import { maskPhonesIn } from "@/lib/tickets/customer-number";
import { canPost, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";

/**
 * A ticket made from a message tells its conversation (Q1.5): `ticket.changed` (ids only) so the chip under the message refreshes, and when the ticket
 * is RESOLVED a reply to the original message, «✅ انحلّت: <ملاحظة>», written as the person who resolved it. Only tickets this feature made (they carry a
 * `kindKey`), and only while the switch `autoTickets` is on. The note is masked: a customer's number never goes back into the chat.
 */
export async function announceTicketChange(ctx: OrgAccessContext, ticketId: string, opts: { resolved: boolean; note?: string | undefined }): Promise<void> {
  const t = await db.ticket.findFirst({ where: { id: ticketId, orgId: ctx.orgId }, select: { sourceMessageId: true, kindKey: true } });
  if (!t?.sourceMessageId || !t.kindKey) return;
  if (!(await isFeatureOn(ctx.orgId, "autoTickets"))) return;
  const source = await db.chatMessage.findUnique({ where: { id: t.sourceMessageId }, select: { id: true, conversationId: true, conversation: { select: { spaceId: true } } } });
  if (!source) return;
  await db.$transaction(async (tx) => {
    await emitRealtime(tx, ctx.orgId, "ticket.changed", { conversationId: source.conversationId, messageId: source.id, ...(source.conversation.spaceId ? { spaceId: source.conversation.spaceId } : {}) });
    if (!opts.resolved) return;
    // «✅ انحلّت» speaks in that conversation as the person who resolved: only if they may post there, and once per ticket
    const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, source.conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
    if (!facts || !org || !canPost(facts, org, { ownerJoined: facts.viewerIsMember })) return;
    const said = await tx.ticketActivity.count({ where: { ticketId, event: "resolved_in_chat" } });
    if (said > 0) return;
    await tx.ticketActivity.create({ data: { ticketId, actorId: ctx.userId, event: "resolved_in_chat" } });
    const note = opts.note?.trim() ? maskPhonesIn(opts.note.trim()).slice(0, 300) : "";
    const reply = await tx.chatMessage.create({
      data: { orgId: ctx.orgId, conversationId: source.conversationId, authorId: ctx.userId, replyToId: source.id, body: note ? `✅ انحلّت: ${note}` : "✅ انحلّت" },
      select: { id: true },
    });
    await tx.conversation.update({ where: { id: source.conversationId }, data: { updatedAt: new Date() } });
    await emitRealtime(tx, ctx.orgId, "message.created", { conversationId: source.conversationId, messageId: reply.id, ...(source.conversation.spaceId ? { spaceId: source.conversation.spaceId } : {}) });
  });
}
