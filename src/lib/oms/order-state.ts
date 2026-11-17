import { isOrderNumber, stateKey } from "@/lib/oms/order-ref";

/**
 * What the orders system's order-by-number door answers, read into the ONLY shape Zaki keeps (Q1.4). Provisional field names (the door is item 3 of the
 * ordered prompt; the contract folder `contracts/oms-workspace.v1/` replaces them with the real example): `number`, `status`, `confirmation_state`,
 * `shipping_state`, `updated_at`, `order_id`, `product_name`, `quantity`. EVERY other field is dropped on reading: the cache never stores a field the
 * door was not asked for (a customer's name, phone, address or city would be among them if the door ever sent them).
 */
export interface OrderStateRead {
  number: string;
  orderId: string | null;
  status: string | null;
  confirmationState: string | null;
  shippingState: string | null;
  productName: string | null;
  quantity: number | null;
  movedAt: Date | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** a state word is kept as a short key (letters and underscores), anything else is no state */
const stateOf = (v: unknown): string | null => stateKey(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * `body` is the door's answer for `wanted` (the number asked about). An answer for ANOTHER number, with no number, or that is not an object is no
 * answer (null): a wrong order's state is never shown under the right number.
 */
export function readOrderAnswer(body: unknown, wanted: string): OrderStateRead | null {
  let o: unknown = body;
  if (isObj(o) && "data" in o) o = o["data"];
  if (Array.isArray(o)) o = o.length === 1 ? o[0] : null;
  if (!isObj(o)) return null;
  const number = typeof o["number"] === "string" || typeof o["number"] === "number" ? String(o["number"]).trim() : "";
  if (!isOrderNumber(wanted) || number !== wanted) return null;
  const qty = o["quantity"];
  const moved = typeof o["updated_at"] === "string" ? new Date(o["updated_at"]) : null;
  const id = typeof o["order_id"] === "string" || typeof o["order_id"] === "number" ? String(o["order_id"]).trim() : "";
  return {
    number,
    orderId: /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null,
    status: stateOf(o["status"]),
    confirmationState: stateOf(o["confirmation_state"]),
    shippingState: stateOf(o["shipping_state"]),
    productName: text(o["product_name"], 200),
    quantity: typeof qty === "number" && Number.isInteger(qty) && qty > 0 && qty < 100000 ? qty : null,
    movedAt: moved && !Number.isNaN(moved.getTime()) ? moved : null,
  };
}

/** the cache is fresh for this long; a lookup inside it never calls the orders system */
export const ORDER_STATE_FRESH_MS = 60_000;
