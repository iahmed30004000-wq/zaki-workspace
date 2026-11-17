import { KNOWLEDGE_LIMITS, type ProductData } from "./knowledge";
import type { ProductTemplate } from "./product-templates";
import { foldForSearch } from "../search/arabic";

/**
 * «الصقي كرت قديم» (Q1.1): an old product card pasted from Telegram is split into the sheet's fields by its markers («لشو بينفع:»,
 * «طريقة الاستعمال:», «المكونات:»…). Pure and forgiving: a line that opens with an emoji or a bullet and a title before a colon starts a
 * part; the lines after it belong to it until the next marker. What it does not recognise is kept in `unmatched` for the editor to place,
 * never dropped. A PRICE in an old card is never taken (a price is read from the orders system only): it is counted in `priceSeen` so
 * the screen can say «السعر انتجاهل».
 */

type Target = "name" | "tagline" | "price" | string; // a section key for the others

const MARKERS: Array<{ target: Target; words: string[] }> = [
  { target: "name", words: ["اسم المنتج", "الاسم", "المنتج"] },
  { target: "tagline", words: ["الوصف", "وصف", "نبذة", "نبذه"] },
  { target: "price", words: ["السعر", "الاسعار", "سعر", "العرض", "العروض", "عرض", "عروض"] },
  { target: "benefit", words: ["لشو بينفع", "بينفع", "الفوائد", "فوائد", "الفائدة", "الاستخدامات", "المشاكل"] },
  { target: "how", words: ["كيف بيشتغل", "الية عمل المنتج", "الية العمل", "طريقة العمل", "كيف يعمل"] },
  { target: "usage", words: ["طريقة الاستعمال", "طريقة الاستخدام", "الاستعمال", "الاستخدام", "الجرعة", "الية الاستخدام"] },
  { target: "operation", words: ["طريقة التشغيل", "التشغيل"] },
  { target: "ingredients", words: ["المكونات", "مكونات", "التركيبة", "التركيب"] },
  { target: "sizes", words: ["المقاسات", "المقاس"] },
  { target: "fabric", words: ["الخامة", "الخامه", "القماش"] },
  { target: "colors", words: ["الالوان", "اللون"] },
  { target: "care", words: ["العناية والغسيل", "الغسيل", "العناية"] },
  { target: "specs", words: ["المواصفات", "مواصفات"] },
  { target: "warranty", words: ["الكفالة", "الضمان"] },
];

const folded = (s: string): string => foldForSearch(s).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const LOOKUP = new Map<string, Target>(MARKERS.flatMap((m) => m.words.map((w) => [folded(w), m.target] as const)));

/** A marker line: optional emoji or bullet, a title, a colon, then maybe the first words of the part. */
const MARKER_LINE = /^[\s\p{Extended_Pictographic}\p{P}\p{S}‏‎️]*([^:：\n]{2,40})[:：]\s*(.*)$/u;
const BULLET = /^[\s‏‎]*(?:[-•·*▪●✅✔☑✓]|\d+[.)\-])\s*/u;

export interface ParsedOldCard {
  name: string | null;
  tagline: string | null;
  /** Lines of each recognised part, bullets and numbering removed, in order. */
  parts: Record<string, string[]>;
  /** Lines before any marker, or after a marker that is not known: kept for the editor. */
  unmatched: string[];
  /** How many price lines were seen (and ignored). */
  priceSeen: number;
}

export function parseOldCard(raw: string): ParsedOldCard {
  const out: ParsedOldCard = { name: null, tagline: null, parts: {}, unmatched: [], priceSeen: 0 };
  let current: Target | null = null;
  let unknownMarker = false;
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const m = MARKER_LINE.exec(text);
    const target = m ? LOOKUP.get(folded(m[1] ?? "")) : undefined;
    if (m && target) {
      current = target;
      unknownMarker = false;
      const rest = (m[2] ?? "").trim();
      if (target === "price") out.priceSeen += 1;
      else if (rest) push(out, target, rest);
      continue;
    }
    if (m && !target && (m[1] ?? "").trim().split(/\s+/).length <= 3) {
      // a marker we do not know: its lines go to `unmatched`, with its own title kept so the editor sees what it was
      current = null;
      unknownMarker = true;
      out.unmatched.push(text);
      continue;
    }
    const clean = text.replace(BULLET, "").trim();
    if (!clean) continue;
    if (current === "price") {
      out.priceSeen += 1;
      continue;
    }
    if (current && !unknownMarker) push(out, current, clean);
    else if (!current && out.name === null && !unknownMarker && out.unmatched.length === 0 && Object.keys(out.parts).length === 0) out.name = clean.replace(/^[^\p{L}\p{N}]+/u, "");
    else out.unmatched.push(clean);
  }
  return out;
}

function push(out: ParsedOldCard, target: Target, text: string): void {
  const value = text.replace(BULLET, "").trim();
  if (!value) return;
  if (target === "name") out.name = out.name ? `${out.name} ${value}` : value;
  else if (target === "tagline") out.tagline = out.tagline ? `${out.tagline} ${value}` : value;
  else (out.parts[target] ??= []).push(value);
}

const SPLIT = /[،,;؛\/|·•]+/u;

export interface AppliedOldCard {
  data: ProductData;
  /** The titles of the sections that are over their limit: the editor refuses them until they are shortened. */
  overLimit: string[];
}

/**
 * Places the parsed parts into the sections of a template (by key). A chips part is split on commas and bars; a steps part is its lines;
 * a text part is its lines joined. Nothing is cut: a part over its limit is listed in `overLimit` and the editor asks for it shorter.
 */
export function applyOldCard(parsed: ParsedOldCard, template: ProductTemplate): AppliedOldCard {
  const overLimit: string[] = [];
  const sections = template.sections.map((spec) => {
    const lines = parsed.parts[spec.key] ?? [];
    if (spec.kind === "text") {
      const text = lines.join(" ").trim();
      if (text.length > KNOWLEDGE_LIMITS.text) overLimit.push(spec.title);
      return { key: spec.key, title: spec.title, kind: spec.kind, ...(text ? { text } : {}) };
    }
    const items = (spec.kind === "chips" ? lines.flatMap((l) => l.split(SPLIT)) : lines).map((s) => s.trim()).filter(Boolean);
    const each = spec.kind === "chips" ? KNOWLEDGE_LIMITS.chip : KNOWLEDGE_LIMITS.step;
    const most = spec.kind === "chips" ? KNOWLEDGE_LIMITS.chips : KNOWLEDGE_LIMITS.steps;
    if (items.length > most || items.some((i) => i.length > each)) overLimit.push(spec.title);
    return { key: spec.key, title: spec.title, kind: spec.kind, ...(items.length ? { items } : {}) };
  });
  const tagline = (parsed.tagline ?? "").trim();
  if (tagline.length > KNOWLEDGE_LIMITS.tagline) overLimit.push("الوصف");
  return { data: { tagline, badges: [], sections, faq: [] }, overLimit };
}
