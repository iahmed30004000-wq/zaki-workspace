import { z } from "zod";
import { db } from "@/server/db";
import { ValidationError, type OrgAccessContext } from "@/server/auth";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { log } from "@/server/log";
import { autoRulesOf, matchRule, ruleMode } from "@/lib/tickets/auto-rules";
import { addTicketComment, canReadTicket, createInstantTicket, createTicket, type TicketExtra } from "@/server/services/tickets";
import { announceTicketChange } from "@/server/services/ticket-chat";
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
 *    is not the owner here. Every person in the chain must be ACTIVE and not a guest: one who is not is SKIPPED and the next is tried (a person CHOSEN by
 *    hand who is not eligible is refused instead).
 *  - ONE PROBLEM, ONE TICKET: a message with the order number (or the customer's number) of an OPEN ticket the asker may read becomes a comment on it; the
 *    same message reported twice is one ticket; two reports of one order at the same moment are made one after the other (a lock per company and key).
 *  - A CUSTOMER'S NUMBER: normalised, kept ENCRYPTED with a keyed hash only for matching; masked in the title, the text and every comment (one helper);
 *    read in full only through `ticketDetail`, which is the ticket's own readers; wiped 30 days after the ticket was resolved (`wipeCustomerNumbers`).
 *  - PRIVATE SOURCE: a DM, a group, a restricted topic needs the confirmation (the ticket is read by its department), as «اعمل منها تذكرة».
 *  - A kind that asks for a screen recording («مشكلة بالموقع») is refused unless the message carries a video.
 *  - The ticket and everything that links it (kind, message, order, number, follow-up day) are ONE write: there is no ticket without its link.
 */
export const problemSchema = z.object({
  kindKey: z.string().min(1).max(41),
  departmentId: z.string().min(1).max(64).optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  /** the form asks for the order number first */
  orderNumber: z.string().trim().max(40).optional(),
  /** then offers «ما في رقم طلب؟ رقم الزبون» */
  customerNumber: z.string().trim().max(40).optional(),
  /** «بدها يوم متابعة» (a kind that has it): the day, `YYYY-MM-DD`, a real day */
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(`${v}T00:00:00.000Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
    }, "tickets.e.follow_up")
    .optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional(),
  confirmPublic: z.boolean().optional(),
});

export const WIPE_AFTER_DAYS = 30;
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

function bad(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

/** One at a time per key, inside this process (the app is one container): the finding of an open ticket and the making of a new one cannot interleave. */
const chains = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = chains.get(key) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(fn);
  chains.set(key, run);
  try {
    return await run;
  } finally {
    if (chains.get(key) === run) chains.delete(key);
  }
}

/** The people (of these ids) who may hold a ticket: ACTIVE in this company and not a guest. */
async function eligible(orgId: string, ids: Array<string | null | undefined>): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === "string" && i !== "*" && i.length > 0))];
  if (wanted.length === 0) return new Set();
  const rows = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: wanted }, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

/** Who gets it when the form did not say: see the list above. Returns the department or the person; null when nobody can be found. */
async function target(
  ctx: OrgAccessContext,
  input: { departmentId?: string | undefined; assigneeId?: string | undefined },
  kind: { departmentId?: string | null | undefined; assigneeId?: string | null | undefined },
  msg: { mentions: string[]; authorId: string; conversationId: string },
): Promise<{ departmentId: string } | { assigneeId: string } | null> {
  const me = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } }, select: { managerId: true } });
  const conv = await db.conversation.findUnique({ where: { id: msg.conversationId }, select: { spaceId: true } });
  const leads = conv?.spaceId ? await db.workspaceMember.findMany({ where: { workspaceId: conv.spaceId, role: "ADMIN", userId: { not: ctx.userId } }, orderBy: { createdAt: "asc" }, select: { userId: true } }) : [];
  const mentioned = [...new Set(msg.mentions)].filter((id) => id !== msg.authorId && id !== "*");
  const ok = await eligible(ctx.orgId, [input.assigneeId, ...mentioned, kind.assigneeId, me?.managerId, ...leads.map((l) => l.userId)]);
  // a person CHOSEN in the form who cannot hold a ticket is a refusal, not a silent change of mind
  if (input.assigneeId) {
    if (!ok.has(input.assigneeId)) bad("assigneeId", "tickets.e.assignee");
    return { assigneeId: input.assigneeId };
  }
  if (mentioned.length === 1 && ok.has(mentioned[0]!)) return { assigneeId: mentioned[0]! };
  if (input.departmentId) return { departmentId: input.departmentId };
  if (kind.departmentId) return { departmentId: kind.departmentId };
  if (kind.assigneeId && ok.has(kind.assigneeId)) return { assigneeId: kind.assigneeId };
  if (me?.managerId && ok.has(me.managerId)) return { assigneeId: me.managerId };
  // no supervisor: the space's manager (never the owner by default)
  const lead = leads.find((l) => ok.has(l.userId));
  return lead ? { assigneeId: lead.userId } : null;
}

export interface ProblemResult {
  ticketId: string;
  /** true: nothing new was made — the message is a comment on an open ticket of the same order or customer, or was already reported */
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

  const lockKey = `${ctx.orgId}:${orderNumber ?? customerHash ?? `m:${msg.id}`}`;
  const result = await serial(lockKey, async (): Promise<ProblemResult> => {
    // this message already became a ticket of this kind: the same ticket, nothing new
    const already = await db.ticket.findFirst({ where: { orgId: ctx.orgId, sourceMessageId: msg.id, kindKey: { not: null } }, select: { id: true } });
    if (already) return { ticketId: already.id, merged: true };

    // one problem, one ticket — into an open ticket the asker may read (anybody else gets a ticket of their own and learns nothing of the other)
    if (orderNumber || customerHash) {
      const openOnes = await db.ticket.findMany({
        where: { orgId: ctx.orgId, status: { in: [...OPEN_STATUSES] }, OR: [...(orderNumber ? [{ externalRef: orderNumber }] : []), ...(customerHash ? [{ customerRefHash: customerHash }] : [])] },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, creatorId: true, assigneeId: true, departmentId: true },
      });
      for (const open of openOnes) {
        if (await canReadTicket(ctx, open)) {
          await addTicketComment(ctx, open.id, text.slice(0, 2000));
          return { ticketId: open.id, merged: true };
        }
      }
    }

    const to = await target(ctx, input, kind, msg);
    if (!to) bad("target", "tickets.e.no_target");
    const title = titleFrom(masked, 190);
    const base = { title: title.length >= 3 ? title : `${title}…`.padEnd(3, "…"), description: text, priority: input.priority ?? ("NORMAL" as const) };
    // the ticket and its link are ONE write
    const extra: TicketExtra = {
      sourceMessageId: msg.id,
      kindKey: kind.key,
      ...(orderNumber ? { externalRef: orderNumber } : {}),
      ...(kind.needsFollowUp && input.followUpDate ? { followUpAt: new Date(`${input.followUpDate}T00:00:00.000Z`) } : {}),
      ...(customer && customerHash ? { customerRefCipher: encryptSecrets({ n: customer }), customerRefHash: customerHash } : {}),
    };
    const ticket = "assigneeId" in to ? await createInstantTicket(ctx, { ...base, assigneeId: to.assigneeId }, extra) : await createTicket(ctx, to.departmentId, base, extra);
    return { ticketId: ticket.id, merged: false };
  });
  // the chip appears for the others at once (a failure here never undoes the ticket)
  try {
    await announceTicketChange(ctx, result.ticketId, { resolved: false });
  } catch (err) {
    log.warn("ticket_chat.skipped", { message: err instanceof Error ? err.message : String(err) });
  }
  return result;
}

/**
 * The customer's number is kept until 30 days after the ticket was resolved or closed (D-Q8 sets the days), then the cipher and the hash are removed: the
 * ticket stays, the number does not. A ticket closed straight from OPEN has no resolve date: its last change counts. Run by the jobs runner; safe twice.
 */
export async function wipeCustomerNumbers(now: Date = new Date(), days = WIPE_AFTER_DAYS): Promise<{ wiped: number }> {
  const before = new Date(now.getTime() - days * 86_400_000);
  const r = await db.ticket.updateMany({
    where: {
      customerRefCipher: { not: null },
      status: { in: ["RESOLVED", "CLOSED"] },
      OR: [{ resolvedAt: { lt: before } }, { resolvedAt: null, updatedAt: { lt: before } }],
    },
    data: { customerRefCipher: null, customerRefHash: null },
  });
  return { wiped: r.count };
}

/**
 * The rules at send time (Q1.5). Called after a human TEXT message was stored, never before: whatever happens here never stops the message. Only
 * OPEN topics are read (a private conversation, a restricted topic or a team's topic gets a ticket by hand only). A rule in mode «تلقائي» makes the
 * ticket as the author through `reportProblem`; a rule in mode «اقترح» does nothing here (the screen offers the one tap). The first matching rule wins.
 */
export async function applyAutoTicketRules(
  ctx: OrgAccessContext,
  message: { id: string; body: string; conversationId: string },
  conversation: { spaceId: string | null; kind: string; restricted: boolean; teamId: string | null },
): Promise<void> {
  try {
    if (conversation.kind !== "TOPIC" || conversation.restricted || conversation.teamId || !conversation.spaceId) return;
    if (!(await isFeatureOn(ctx.orgId, "autoTickets"))) return;
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } });
    const rule = autoRulesOf(org?.settings).find((r) => matchRule(r, { body: message.body, conversationId: message.conversationId, spaceId: conversation.spaceId }));
    if (!rule || ruleMode(rule) !== "auto") return;
    await reportProblem(ctx, message.id, { kindKey: rule.kindKey, ...(rule.departmentId ? { departmentId: rule.departmentId } : {}), ...(rule.assigneeId ? { assigneeId: rule.assigneeId } : {}) });
  } catch (err) {
    // a rule that cannot make its ticket (nobody to give it to, a switch turned off meanwhile) is logged and forgotten: the message is already sent
    log.warn("auto_tickets.skipped", { message: err instanceof Error ? err.message : String(err) });
  }
}
