import { z } from "zod";
import { NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { isOrderNumber } from "@/lib/oms/order-ref";
import { assertOrderStatusOn } from "@/server/services/order-state";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { approvedHead, listSheets, searchApprovedAnswers, type RecalledAnswer } from "@/server/services/knowledge";
import { sendMessage } from "@/server/chat/messages";
import type { MessageDto } from "@/server/chat/dto";

/**
 * «/» في صندوق الكتابة (Q1.3). Two doors, both behind `quickRecall` (and «المنتجات»):
 *
 *  - SEARCH (`recallSearch`): the approved products (with their live price, for staff) or the approved answers, for the menu of the composer.
 *  - SEND (`recallToConversation`): an approved product sheet goes into a conversation as a CARD message. The message stores ONLY
 *    `{ type: "product", cardId }` and a readable line WITHOUT a price («كرت منتج: حراك»): the name, the one line and the price chips are
 *    asked for by each reader's screen when the card is opened, so a guest never gets a price and a forward is resolved again for its new
 *    readers. It checks, in this order: the person is staff who may read the sheet, the sheet is approved, then the ordinary send path checks
 *    that they may post in the conversation (and its rate limit). `sendCard` of the cards service (words only) is not touched.
 */

// exactly one of: a product sheet (`cardId`) or an order number (`order`, «/طلب»)
export const recallSchema = z
  .object({ cardId: z.string().min(1).max(64).optional(), order: z.string().min(1).max(40).optional(), clientId: z.string().min(1).max(64).optional() })
  .refine((v) => (v.cardId === undefined) !== (v.order === undefined), { message: "recall.e.one", path: ["cardId"] });
export const recallQuerySchema = z.object({ q: z.string().max(100).default(""), kind: z.enum(["product", "reply"]).default("product") });

export interface RecalledProduct {
  id: string;
  name: string;
  category: string | null;
  tagline: string;
  price: number | null;
  currency: string | null;
  stale: boolean;
  stockStatus: string | null;
}

export type RecallResults = { kind: "product"; results: RecalledProduct[] } | { kind: "reply"; results: RecalledAnswer[] };

export async function recallSearch(actor: Actor, input: z.infer<typeof recallQuerySchema>): Promise<RecallResults> {
  await assertFeatureOn(actor.orgId, "quickRecall");
  if (input.kind === "reply") return { kind: "reply", results: await searchApprovedAnswers(actor, input.q) };
  const list = await listSheets(actor, { ...(input.q.trim() ? { q: input.q } : {}), asReader: true });
  return {
    kind: "product",
    results: list.sheets.slice(0, 20).map((s) => ({ id: s.id, name: s.name, category: s.category, tagline: s.tagline, price: s.price, currency: s.currency, stale: s.stale, stockStatus: s.stockStatus })),
  };
}

/**
 * «/طلب» (Q1.4): an order number goes into a conversation as a CARD message holding ONLY `{ type: "order", number }` and the line «طلب <number>». The
 * state is asked for by each reader's screen (the door of `lookupOrderState`), so the message never holds a state, and a person who cannot read the
 * conversation never gets one. The orders system is not asked here.
 */
export async function orderToConversation(ctx: OrgAccessContext, actor: Actor, conversationId: string, number: string, clientId?: string): Promise<MessageDto> {
  if (actor.isExternal || actor.role === "GUEST") throw new NotFoundError("features.off");
  await assertFeatureOn(ctx.orgId, "quickRecall");
  await assertOrderStatusOn(ctx.orgId);
  if (!isOrderNumber(number)) throw new ValidationError([{ path: "order", message: "orders.e.number" }]);
  return sendMessage(ctx, conversationId, { body: `طلب ${number}`, ...(clientId ? { clientId } : {}) }, { card: { type: "order", number } });
}

export async function recallToConversation(ctx: OrgAccessContext, actor: Actor, conversationId: string, cardId: string, clientId?: string): Promise<MessageDto> {
  await assertFeatureOn(ctx.orgId, "quickRecall");
  const head = await approvedHead(actor, cardId);
  return sendMessage(ctx, conversationId, { body: `كرت منتج: ${head.name}`, ...(clientId ? { clientId } : {}) }, { card: { type: "product", cardId } });
}
