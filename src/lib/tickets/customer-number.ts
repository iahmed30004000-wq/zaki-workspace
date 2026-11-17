import { normalizeDigits, PHONE_PATTERN } from "@/server/ai/redact";
import { findOrderNumbers } from "@/lib/oms/order-ref";

/**
 * A customer's number inside a message or a ticket (Q1.5). Found with the EXISTING phone pattern of `src/server/ai/redact.ts` (exported there, not written
 * a second time), after the order numbers are taken out of the text (their long digits are not a phone). Normalised: digits only, the country code folded
 * into a leading zero, so one person written four ways is one number. Masked through ONE helper (`maskPhone`) wherever the number must not show.
 */

/** Country codes of the places the company sells to (Syria, Jordan, Palestine, Lebanon, Iraq, Saudi, Gulf, Egypt). */
const COUNTRY_CODES = ["962", "963", "970", "972", "961", "964", "966", "965", "971", "974", "968", "973", "20"] as const;

/** Digits only, the country code folded into a leading zero; null when it cannot be a phone number (fewer than 7 or more than 15 digits). */
export function normalizePhone(raw: string): string | null {
  let digits = normalizeDigits(String(raw)).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  for (const code of COUNTRY_CODES) {
    if (digits.startsWith(code)) {
      const rest = digits.slice(code.length).replace(/^0+/, "");
      if (rest.length >= 8 && rest.length <= 10) return `0${rest}`;
    }
  }
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/** The text with its order numbers blanked out (same length, so indexes stay the same). */
function withoutOrderNumbers(text: string): string {
  let out = text;
  for (const h of findOrderNumbers(text)) out = out.slice(0, h.start) + " ".repeat(h.end - h.start) + out.slice(h.end);
  return out;
}

function phoneMatches(text: string): Array<{ index: number; text: string }> {
  const norm = normalizeDigits(withoutOrderNumbers(text));
  return [...norm.matchAll(new RegExp(PHONE_PATTERN.source, "g"))].map((m) => ({ index: m.index ?? 0, text: m[0] }));
}

/** The customer numbers written in a text, normalised, each once, in order. */
export function findCustomerNumbers(text: string): string[] {
  const seen = new Set<string>();
  for (const m of phoneMatches(String(text ?? ""))) {
    const n = normalizePhone(m.text);
    if (n) seen.add(n);
  }
  return [...seen];
}

/** «07••••••67»: the first two and the last two digits, the rest hidden. A number of four digits or fewer is hidden whole. */
export function maskPhone(number: string): string {
  const d = normalizeDigits(String(number)).replace(/\D/g, "");
  if (d.length <= 4) return "•".repeat(Math.max(d.length, 3));
  return `${d.slice(0, 2)}${"•".repeat(d.length - 4)}${d.slice(-2)}`;
}

/** Every customer number inside a text replaced by its masked form (order numbers and dates stay). */
export function maskPhonesIn(text: string): string {
  const source = String(text ?? "");
  const hits = phoneMatches(source);
  if (hits.length === 0) return source;
  let out = "";
  let at = 0;
  for (const h of hits) {
    out += source.slice(at, h.index) + (normalizePhone(h.text) ? maskPhone(h.text) : h.text);
    at = h.index + h.text.length;
  }
  return out + source.slice(at);
}
