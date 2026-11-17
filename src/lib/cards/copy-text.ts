import type { FaqItem, ProductData, ProductSection } from "./knowledge";
import { DEFAULT_OFFER_TEMPLATE } from "./product-templates";
import { isStale, type ProductSnapshot } from "../oms/snapshot";
import { foldForSearch } from "../search/arabic";

/**
 * Every text the «انسخي» buttons copy (Q1.1), built here and nowhere else. Pure: plain text, no markup, Western digits. The copy itself is
 * the existing `copyText()` of clipboard.ts. What these builders must never do: put the team's caution in a text for a customer, print a
 * price that is stale or missing (the offer message refuses instead), or print a number in Arabic-Indic digits.
 */

const CHIPS_JOIN = "، ";

/** A section as it is copied: its title first, then chips on one line, steps as numbered lines, or the text. Empty when it has nothing. */
export function sectionText(section: ProductSection): string {
  if (section.kind === "text") {
    return section.text ? `${section.title}\n${section.text}` : "";
  }
  const items = section.items ?? [];
  if (items.length === 0) return "";
  if (section.kind === "chips") return `${section.title}\n${items.join(CHIPS_JOIN)}`;
  return `${section.title}\n${items.map((it, i) => `${i + 1}. ${it}`).join("\n")}`;
}

/** One answer as it is copied (the answer only: the customer asked the question). */
export function answerText(item: FaqItem): string {
  return item.a;
}

// ---------- prices ----------

const CURRENCY_WORD: Record<string, string> = { USD: "$", JOD: "دينار", SYP: "ليرة", EUR: "€", SAR: "ريال", AED: "درهم", TRY: "ليرة تركية" };

/** A price as the orders system gave it: 20 → «20», 12.99 → «12.99», 12.5 → «12.5» (cents are never rounded away), Western digits. */
export function fmtMoney(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A price DERIVED for one piece (an offer divided by its pieces): one decimal at most, 13.333 → «13.3». */
export function fmtPiece(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function withCurrency(value: number, currency: string, format: (v: number) => string = fmtMoney): string {
  const word = CURRENCY_WORD[currency] ?? currency;
  const n = format(value);
  return word === "$" || word === "€" ? `${n}${word}` : word ? `${n} ${word}` : n;
}

export interface OfferMessageInput {
  name: string;
  tagline: string;
  /** The word of one piece: «عبوة» or «قطعة» (the template's). */
  unit: string;
  snapshot: ProductSnapshot | null;
  /** The sentence the owner set for delivery («توصيل مجاني · دفع عند الاستلام»); the product's own flag decides whether it applies. */
  deliveryLine?: string | null;
  template?: string | null;
  now?: Date;
}

export type OfferMessage = { ok: true; text: string } | { ok: false; reason: "no_price" | "stale" };

/** The price part of one offer: «عبوتين + هدية 40$ · العبوة 13.3$» — the price of one piece only when the gift units are known. */
export function offerLine(offer: ProductSnapshot["offers"][number], currency: string, unit: string): string {
  const free = offer.freeQuantity;
  const head = `${offer.title || `${offer.quantity} ${unit}`}`;
  const price = withCurrency(offer.price, currency);
  if (free === undefined) return `${head} — ${price}`;
  const pieces = offer.quantity + free;
  return pieces > 0 ? `${head} — ${price} · ${unit === "عبوة" ? "العبوة" : "القطعة"} ${withCurrency(offer.price / pieces, currency, fmtPiece)}` : `${head} — ${price}`;
}

/**
 * «انسخي رسالة العرض»: the template filled from the LIVE snapshot. With no snapshot, no price, or a product that is gone from the orders system →
 * `no_price`; with a snapshot older than 30 minutes → `stale` (the screen shows «⚠️ السعر مش محدّث» and «حدّثي هلّق» instead of copying). An offer whose
 * end date has passed is left out. Placeholders: `{الاسم}` `{الوصف}` `{سعر_الواحدة}` `{العروض}` `{سعر_القطعة_بالعرض}` (the cheapest piece among the
 * offers whose gift units are known) `{التوصيل}`. The template is read in ONE pass: a value that looks like a placeholder is never expanded again,
 * and a line whose placeholder has nothing behind it is dropped whole.
 */
export function buildOfferMessage(input: OfferMessageInput): OfferMessage {
  const snap = input.snapshot;
  // a product that is gone from the orders system has no price to give, however fresh its last snapshot is
  if (!snap || !(snap.price > 0) || snap.missingSince) return { ok: false, reason: "no_price" };
  const now = input.now ?? new Date();
  if (isStale(snap, now)) return { ok: false, reason: "stale" };
  const live = snap.offers.filter((o) => !o.expiresAt || !(Date.parse(o.expiresAt) <= now.getTime()));
  const known = live.filter((o) => o.freeQuantity !== undefined && o.quantity + (o.freeQuantity ?? 0) > 0);
  const cheapest = known.length ? Math.min(...known.map((o) => o.price / (o.quantity + (o.freeQuantity ?? 0)))) : null;
  const delivery = snap.deliveryIncluded && input.deliveryLine ? input.deliveryLine : "";
  const values: Record<string, string> = {
    "{الاسم}": input.name,
    "{الوصف}": input.tagline,
    "{سعر_الواحدة}": `${input.unit === "عبوة" ? "العبوة" : "القطعة"} ${withCurrency(snap.price, snap.currency)}`,
    "{العروض}": live.map((o) => offerLine(o, snap.currency, input.unit)).join("\n"),
    "{سعر_القطعة_بالعرض}": cheapest === null ? "" : withCurrency(cheapest, snap.currency, fmtPiece),
    "{التوصيل}": delivery,
  };
  const template = input.template?.trim() ? input.template : DEFAULT_OFFER_TEMPLATE;
  const lines: string[] = [];
  for (const line of template.split("\n")) {
    let empty = false;
    const filled = line.replace(/\{[^{}\n]+\}/g, (token) => {
      if (!Object.prototype.hasOwnProperty.call(values, token)) return token;
      const v = values[token] ?? "";
      if (v === "") empty = true;
      return v;
    });
    if (!empty) lines.push(filled);
  }
  // a placeholder with nothing behind it leaves no empty line behind
  return { ok: true, text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

// ---------- «انسخي الكل» ----------

export type CopyPart = "description" | "sections" | "price" | "link";
export const COPY_PARTS: readonly CopyPart[] = ["description", "sections", "price", "link"];

export interface CopyAllInput extends OfferMessageInput {
  data: ProductData;
  /** The section keys to include (all of them when absent). */
  sectionKeys?: string[];
  parts: CopyPart[];
}

/**
 * «انسخي الكل ▾»: the ticked parts in a fixed order. The caution is NEVER among them. The price part follows the stale rule: with a price
 * that is missing or stale it is left out and `priceSkipped` says why, so the screen can show the warning instead of a silent gap.
 */
export function buildCopyAll(input: CopyAllInput): { text: string; priceSkipped: "no_price" | "stale" | null } {
  const blocks: string[] = [];
  let priceSkipped: "no_price" | "stale" | null = null;
  if (input.parts.includes("description")) {
    const head = [input.name, input.data.tagline].filter(Boolean).join("\n");
    if (head) blocks.push(head);
  }
  if (input.parts.includes("sections")) {
    for (const s of input.data.sections) {
      if (input.sectionKeys && !input.sectionKeys.includes(s.key)) continue;
      const t = sectionText(s);
      if (t) blocks.push(t);
    }
  }
  if (input.parts.includes("price")) {
    const offer = buildOfferMessage({ ...input, template: "{سعر_الواحدة}\n{العروض}\n{التوصيل}" });
    if (offer.ok) blocks.push(offer.text);
    else priceSkipped = offer.reason;
  }
  if (input.parts.includes("link") && input.snapshot?.link) blocks.push(input.snapshot.link);
  return { text: blocks.join("\n\n"), priceSkipped };
}

// ---------- questions and answers ----------

/** The questions that match what was typed, by the Arabic folding (hamza, ta marbuta, diacritics, digits): in the order they are kept. */
export function searchFaq(faq: FaqItem[], typed: string): FaqItem[] {
  const needle = foldForSearch(typed).trim();
  if (!needle) return faq;
  return faq.filter((f) => [f.q, f.a, ...(f.keywords ?? [])].some((s) => foldForSearch(s).includes(needle)));
}
