import { db } from "@/server/db";
import { NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { canRead } from "@/server/policy/conversation";
import { guard } from "@/server/chat/messages";
import { isOrderNumber } from "@/lib/oms/order-ref";
import { ORDER_STATE_FRESH_MS, type OrderStateRead } from "@/lib/oms/order-state";
import { OmsError, orderByNumber } from "@/server/integrations/oms";

/**
 * AN ORDER'S STATE (Q1.4): what the chip and the «/طلب» card show. Asked by NUMBER, inside a conversation the person can read.
 *
 *   switches   `orderStatus` AND `omsLink` on, the orders system connected — else 404
 *   who        staff only (a guest or an external partner: 404); the conversation must be readable by the person (else 404, and the
 *              orders system is not asked)
 *   cache      `OmsOrderState`, kept 60 seconds fresh; only the fields of the door's contract are ever stored
 *   answers    ready · waits_update (the orders system has no by-number door yet) · not_found · unreachable (no state known)
 *              a failed refresh with an old state known shows it, marked `stale`
 */
export type OrderLookupState = "ready" | "waits_update" | "not_found" | "unreachable";

export interface OrderStateDto {
  number: string;
  state: OrderLookupState;
  status?: string | null;
  confirmation?: string | null;
  shipping?: string | null;
  productName?: string | null;
  quantity?: number | null;
  /** when the order last moved, as the orders system says */
  movedAt?: string | null;
  /** when we last asked the orders system */
  fetchedAt?: string;
  /** shown from the cache because the orders system could not be asked just now */
  stale?: boolean;
}

function assertStaff(actor: Actor): void {
  if (actor.isExternal || actor.role === "GUEST") throw new NotFoundError("features.off");
}

/** The two switches (and the same for the «/طلب» door). */
export async function assertOrderStatusOn(orgId: string): Promise<void> {
  await assertFeatureOn(orgId, "orderStatus");
  await assertFeatureOn(orgId, "omsLink");
  // linked: the owner saved the address and the token (an unlinked orders system is the same as the switch off)
  const link = await db.integration.findUnique({ where: { orgId_type: { orgId, type: "OMS" } }, select: { connected: true } });
  if (!link?.connected) throw new NotFoundError("features.off");
}

function dtoOf(row: { orderNumber: string; status: string | null; confirmationState: string | null; shippingState: string | null; productName: string | null; quantity: number | null; movedAt: Date | null; fetchedAt: Date }, stale: boolean): OrderStateDto {
  return {
    number: row.orderNumber,
    state: "ready",
    status: row.status,
    confirmation: row.confirmationState,
    shipping: row.shippingState,
    productName: row.productName,
    quantity: row.quantity,
    movedAt: row.movedAt ? row.movedAt.toISOString() : null,
    fetchedAt: row.fetchedAt.toISOString(),
    stale,
  };
}

/**
 * A lookup that came back with no state (waits for the update, not found, unreachable) is remembered for 20 seconds, per company and number, in this
 * process: tapping again or typing a number in the dialog does not ask the orders system over and over. A state is never kept here (the table is).
 */
const NEGATIVE_MS = 20_000;
const negative = new Map<string, { until: number; dto: OrderStateDto }>();
export function clearOrderNegativeCache(): void {
  negative.clear();
}

export async function lookupOrderState(ctx: OrgAccessContext, actor: Actor, input: { number: string; conversationId: string }, now: Date = new Date()): Promise<OrderStateDto> {
  assertStaff(actor);
  await assertOrderStatusOn(actor.orgId);
  if (!isOrderNumber(input.number)) throw new ValidationError([{ path: "number", message: "orders.e.number" }]);
  // the same rule as reading the conversation: a person who cannot read it is told it does not exist
  const { facts, org } = await guard(ctx, input.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");

  const where = { orgId_orderNumber: { orgId: actor.orgId, orderNumber: input.number } };
  const cached = await db.omsOrderState.findUnique({ where });
  if (cached && now.getTime() - cached.fetchedAt.getTime() < ORDER_STATE_FRESH_MS) return dtoOf(cached, false);

  const memoryKey = `${actor.orgId}:${input.number}`;
  const remembered = negative.get(memoryKey);
  if (remembered && remembered.until > now.getTime()) return remembered.dto;

  let read: OrderStateRead;
  try {
    read = await orderByNumber(actor.orgId, input.number);
  } catch (err) {
    const code = err instanceof OmsError ? err.code : "network";
    // an old state we know is better than none, and says it is old
    if (cached && code !== "unsupported" && code !== "http_404") return dtoOf(cached, true);
    const none: OrderStateDto = code === "unsupported" || code === "bad_body" ? { number: input.number, state: "waits_update" } : code === "http_404" ? { number: input.number, state: "not_found" } : { number: input.number, state: "unreachable" };
    if (negative.size > 500) negative.clear();
    negative.set(memoryKey, { until: now.getTime() + NEGATIVE_MS, dto: none });
    return none;
  }
  const data = {
    orderId: read.orderId,
    status: read.status,
    confirmationState: read.confirmationState,
    shippingState: read.shippingState,
    productName: read.productName,
    quantity: read.quantity,
    movedAt: read.movedAt,
    fetchedAt: now,
  };
  const row = await db.omsOrderState.upsert({ where, create: { orgId: actor.orgId, orderNumber: input.number, ...data }, update: data });
  return dtoOf(row, false);
}
