import { z } from "zod";
import { db } from "@/server/db";
import { ValidationError, type OrgAccessContext } from "@/server/auth";
import { assertFeatureOn } from "@/server/services/features";
import { createInstantTicket, createTicket, addTicketComment } from "@/server/services/tickets";
import { assertConfirmed, describe, sourceOf, titleFrom } from "@/server/chat/make-work";
import { encryptSecrets, keyedHash } from "@/server/crypto";
import { findOrderNumbers, isOrderNumber } from "@/lib/oms/order-ref";
import { findCustomerNumbers, maskPhonesIn, normalizePhone } from "@/lib/tickets/customer-number";
import { problemKind, problemKindsOf } from "@/lib/tickets/problem-kinds";

/**
 * «🎫 مشكلة» (Q1.5): a ticket made where the message is. Through the EXISTING doors (`createInstantTicket`, `createTicket`); the message keeps what it
 * became (`sourceMessageId`). The creator is the person who asked.
 *
 *  - WHO GETS IT: the person named in the form → exactly ONE @-mentioned person (an instant ticket) → the department named → the kind's department →
 *    the kind's person → the asker's supervisor (`OrganizationMember.managerId`) → the space's manager. "Never to management": an empty supervisor field
 *    is not the owner here.
 *  - ONE PROBLEM, ONE TICKET: a message with the order number (or the customer's number) of an OPEN ticket becomes a comment on it.
 *  - A CUSTOMER'S NUMBER: normalised, kept ENCRYPTED with a keyed hash only for matching; masked in the title, the text and every comment (one helper);
 *    read in full only through `ticketDetail`, which is the ticket's own readers; wiped 30 days after the ticket was resolved (`wipeCustomerNumbers`).
 *  - PRIVATE SOURCE: a DM, a group, a restricted topic needs the confirmation (the ticket is read by its department), as «اعمل منها تذكرة».
 *  - A kind that asks for a screen recording («مشكلة بالموقع») is refused unless the message carries a video.
 */
export const problemSchema = z.object({
  kindKey: z.string().min(1).max(41),
  departmentId: z.string().min(1).max(64).optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  /** the form asks for the order number first */
  orderNumber: z.string().trim().max(40).optional(),
  /** then offers «ما في رقم طلب؟ رقم الزبون» */
  customerNumber: z.string().trim().max(40).optional(),
  /** «بدها يوم متابعة» (a kind that has it): the day, `YYYY-MM-DD` */
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional(),
  confirmPublic: z.boolean().optional(),
});

export const WIPE_AFTER_DAYS = 30;
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

function bad(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

/** Who gets it when the form did not say: see the list above. Returns the department or the person; null when nobody can be found. */
async function target(
  ctx: OrgAccessContext,
  input: { departmentId?: string | undefined; assigneeId?: string | undefined },
  kind: { departmentId?: string | null | undefined; assigneeId?: string | null | undefined },
  msg: { mentions: string[]; authorId: string; conversationId: string },
): Promise<{ departmentId: string } | { assigneeId: string } | null> {
  if (input.assigneeId) return { assigneeId: input.assigneeId };
  const mentioned = [...new Set(msg.mentions)].filter((id) => id !== msg.authorId);
  if (mentioned.length === 1) return { assigneeId: mentioned[0]! };
  if (input.departmentId) return { departmentId: input.departmentId };
  if (kind.departmentId) return { departmentId: kind.departmentId };
  if (kind.assigneeId) return { assigneeId: kind.assigneeId };
  const me = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } }, select: { managerId: true } });
  if (me?.managerId) return { assigneeId: me.managerId };
  // no supervisor: the space's manager (never the owner by default)
  const conv = await db.conversation.findUnique({ where: { id: msg.conversationId }, select: { spaceId: true } });
  if (conv?.spaceId) {
    const lead = await db.workspaceMember.findFirst({
      where: { workspaceId: conv.spaceId, role: "ADMIN", userId: { not: ctx.userId } },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (lead) return { assigneeId: lead.userId };
  }
  return null;
}

export interface ProblemResult {
  ticketId: string;
  /** true: the message was added as a comment on an open ticket about the same order or customer */
  merged: boolean;
}

export async function reportProblem(ctx: OrgAccessContext, messageId: string, input: z.infer<typeof problemSchema>): Promise<ProblemResult> {
  await assertFeatureOn(ctx.orgId, "autoTickets");
  const msg = await sourceOf(ctx, messageId);
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } });
  const kind = problemKind(problemKindsOf(org?.settings), input.kindKey);
  if (!kind) bad("kindKey", "tickets.e.kind");
  // a ticket is read by its department: from a private conversation that is «for others» and must be confirmed
  assertConfirmed(msg.privateSource, true, input.confirmPublic);
  if (kind.needsRecording && !msg.attachments.some((a) => a.kind === "VIDEO")) bad("recording", "tickets.e.recording_required");

  // the order number: the form's, else the one written in the message; the customer's number likewise
  const orderNumber = input.orderNumber ? (isOrderNumber(input.orderNumber.toUpperCase()) ? input.orderNumber.toUpperCase() : bad("orderNumber", "orders.e.number")) : (findOrderNumbers(msg.body)[0]?.number ?? null);
  const typed = input.customerNumber ? (normalizePhone(input.customerNumber) ?? bad("customerNumber", "tickets.e.customer_number")) : null;
  const customer = typed ?? findCustomerNumbers(msg.body)[0] ?? null;
  const customerHash = customer ? keyedHash(`customer:${ctx.orgId}`, customer) : null;

  const masked = maskPhonesIn(msg.body);
  const text = maskPhonesIn(await describe({ ...msg, body: masked }));

  // one problem, one ticket
  if (orderNumber || customerHash) {
    const open = await db.ticket.findFirst({
      where: { orgId: ctx.orgId, status: { in: [...OPEN_STATUSES] }, OR: [...(orderNumber ? [{ externalRef: orderNumber }] : []), ...(customerHash ? [{ customerRefHash: customerHash }] : [])] },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (open) {
      await addTicketComment(ctx, open.id, text.slice(0, 2000));
      return { ticketId: open.id, merged: true };
    }
  }

  const to = await target(ctx, input, kind, msg);
  if (!to) bad("target", "tickets.e.no_target");
  const title = titleFrom(masked, 190);
  const base = { title: title.length >= 3 ? title : `${title}…`.padEnd(3, "…"), description: text, priority: input.priority ?? ("NORMAL" as const) };
  const ticket = "assigneeId" in to ? await createInstantTicket(ctx, { ...base, assigneeId: to.assigneeId }) : await createTicket(ctx, to.departmentId, base);
  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      sourceMessageId: msg.id,
      kindKey: kind.key,
      ...(orderNumber ? { externalRef: orderNumber } : {}),
      ...(kind.needsFollowUp && input.followUpDate ? { followUpAt: new Date(`${input.followUpDate}T00:00:00.000Z`) } : {}),
      ...(customer && customerHash ? { customerRefCipher: encryptSecrets({ n: customer }), customerRefHash: customerHash } : {}),
    },
  });
  return { ticketId: ticket.id, merged: false };
}

/**
 * The customer's number is kept until 30 days after the ticket was resolved (D-Q8 sets the days), then the cipher and the hash are removed: the ticket
 * stays, the number does not. Run by the jobs runner; also safe to run twice.
 */
export async function wipeCustomerNumbers(now: Date = new Date(), days = WIPE_AFTER_DAYS): Promise<{ wiped: number }> {
  const before = new Date(now.getTime() - days * 86_400_000);
  const r = await db.ticket.updateMany({
    where: { customerRefCipher: { not: null }, status: { in: ["RESOLVED", "CLOSED"] }, resolvedAt: { lt: before } },
    data: { customerRefCipher: null, customerRefHash: null },
  });
  return { wiped: r.count };
}
