/**
 * An order number as the orders system writes it (Q1.4), and the states it reports.
 *
 * SOURCE of the pattern: the orders system (`zaki-ai-OSM`), `src/lib/order-ref.ts`, copied here as a constant and never edited by hand:
 * `^[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{4,8}$`.
 *
 * ONE addition of ours: the first part must hold a LETTER. The orders system's own shape would also accept «079-1234-5678», which is how a phone number
 * is often written; a chip on a phone number would send a customer's number to the orders system's door, so it is refused here.
 */
export const OMS_ORDER_NUMBER_SOURCE = "[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{4,8}";
const EXACT = new RegExp(`^${OMS_ORDER_NUMBER_SOURCE}$`);

export function isOrderNumber(text: string): boolean {
  if (!EXACT.test(text)) return false;
  return /[A-Z]/.test(text.slice(0, text.indexOf("-")));
}

export interface OrderNumberHit {
  number: string;
  /** index of its first character in the text */
  start: number;
  end: number;
}

/**
 * The order numbers written in a text, in order. A number is a whole word: «XZK-2026-1234» is read as one (and refused if it does not fit), never as
 * «ZK-2026-1234» inside it; a digit or letter right after it (or before it) means it is part of something longer.
 */
export function findOrderNumbers(text: string): OrderNumberHit[] {
  const hits: OrderNumberHit[] = [];
  const re = new RegExp(`(?<![A-Za-z0-9-])${OMS_ORDER_NUMBER_SOURCE}(?![A-Za-z0-9-])`, "g");
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || !isOrderNumber(m[0])) continue;
    hits.push({ number: m[0], start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

/** The text cut into plain pieces and order-number pieces (for the chips). */
export function splitOrderNumbers(text: string): Array<{ text: string; order: boolean }> {
  const out: Array<{ text: string; order: boolean }> = [];
  let at = 0;
  for (const h of findOrderNumbers(text)) {
    if (h.start > at) out.push({ text: text.slice(at, h.start), order: false });
    out.push({ text: h.number, order: true });
    at = h.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), order: false });
  return out;
}

/** A state word as the door sends it, made safe to look up: lower case, letters and underscores only; anything else is no known state. */
export function stateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return /^[a-z_]{2,40}$/.test(k) ? k : null;
}

/**
 * The state words the screen knows how to say in Arabic (`order.state.<word>` in `ar.quick-recall.json`). PROVISIONAL until the contract folder of the
 * orders system names its real states (the test `order-state-words` keeps this list and the dictionary equal). Any other word is shown as
 * «حالة غير معروفة»: the raw word is never put on a screen.
 */
export const KNOWN_ORDER_STATES = ["pending", "confirmed", "processing", "shipped", "out_for_delivery", "delivered", "returned", "cancelled", "on_hold", "postponed", "no_answer", "failed"] as const;

export function orderStateLabelKey(key: string | null | undefined): string {
  return key && (KNOWN_ORDER_STATES as readonly string[]).includes(key) ? `order.state.${key}` : "order.state.unknown";
}
