import { foldForSearch } from "@/lib/search/arabic";
import { findCustomerNumbers } from "@/lib/tickets/customer-number";
import type { FeatureKey } from "@/lib/features";

/**
 * Customer data in the open chat (Q1.7): the HINTS. A message shaped like the hand-typed order template (name, phone, province, address…) or carrying a
 * phone-shaped number gets a line for its author and the moderators that says where the data belongs. NOTHING is blocked, hidden, masked or changed (the
 * owner's decision: the team must be able to work with the customer's data in the chat). Pure: the screen decides from the text it already has.
 */
export type CustomerDataHint = "template" | "phone" | null;

/** The labels of the order template, as people type them (folded: hamza, ta marbuta and marks do not matter). */
const LABELS = ["الاسم", "الاسم الكامل", "اسم الزبون", "اسم العميل", "رقم الهاتف", "رقم الجوال", "رقم الموبايل", "رقم التلفون", "رقم التواصل", "الهاتف", "الجوال", "الموبايل", "التلفون", "المحافظه", "المدينه", "المنطقه", "العنوان", "المنتج", "اسم المنتج", "الكميه", "السعر", "المبلغ", "ملاحظات"].map((l) => foldForSearch(l));
/** at least one of these must be among the labels: «الكمية» and «السعر» alone are not a customer's data */
const IDENTITY = ["الاسم", "الاسم الكامل", "اسم الزبون", "اسم العميل", "رقم الهاتف", "رقم الجوال", "رقم الموبايل", "رقم التلفون", "رقم التواصل", "الهاتف", "الجوال", "الموبايل", "التلفون", "المحافظه", "العنوان"].map((l) => foldForSearch(l));
const MIN_LABELLED_LINES = 3;

export function looksLikeOrderTemplate(body: string): boolean {
  const found = new Set<string>();
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    // a bullet, an emoji or stars around the label do not matter: «👤 الاسم: …», «- الاسم: …», «*الاسم*: …»
    const line = foldForSearch(raw).replace(/[*_~`]/g, "").replace(/^[^\p{L}\p{N}]+/u, "");
    const m = /^([^:：\-–]{2,20})\s*[:：\-–]\s*\S/.exec(line);
    if (m && LABELS.includes(m[1]!.trim())) found.add(m[1]!.trim());
  }
  return found.size >= MIN_LABELLED_LINES && IDENTITY.some((l) => found.has(l));
}

export function customerDataHint(body: string): CustomerDataHint {
  if (looksLikeOrderTemplate(body)) return "template";
  return findCustomerNumbers(body).length > 0 ? "phone" : null;
}

/**
 * Three company switches send the text of messages to a model after masking numbers, e-mails and links — but a customer's NAME has no shape a program can
 * find: «@المساعد» (`chatAssistant`), «ترجم» (`messageTranslate`) and «بحث بالمعنى» (`semanticSearch`). While automatic tickets are on the «الميزات»
 * screen warns beside each of them.
 */
export const MODEL_SENDING_FEATURES = ["chatAssistant", "messageTranslate", "semanticSearch"] as const satisfies readonly FeatureKey[];

export function showModelWarning(items: ReadonlyArray<{ key: FeatureKey; on: boolean }>, key: FeatureKey): boolean {
  return (MODEL_SENDING_FEATURES as readonly string[]).includes(key) && items.some((i) => i.key === "autoTickets" && i.on);
}
