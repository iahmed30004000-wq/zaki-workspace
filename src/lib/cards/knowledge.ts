/**
 * «كرت المنتج» (Q1.1) — what a PRODUCT card carries in `Card.data`, and the limits that keep it from becoming a wall of text.
 * Pure: no database, no React. The orders system's facts (name, price, offers, stock) are NOT here: they live in `Card.external`
 * (Q1.0) and are never typed. The caution is OPTIONAL and belongs to the team: no category adds one, and it is never part of any text
 * copied for a customer (see copy-text.ts).
 */

export const KNOWLEDGE_LIMITS = {
  /** The one line under the name. */
  tagline: 120,
  sectionTitle: 40,
  sections: 8,
  chips: 20,
  chip: 60,
  steps: 20,
  step: 80,
  text: 400,
  question: 140,
  answer: 300,
  faq: 30,
  keywords: 10,
  keyword: 30,
  caution: 200,
  testNote: 120,
  offerTemplate: 600,
  /** A general approved answer (REPLY): delivery, payment… */
  replyBody: 600,
} as const;

export const SECTION_KINDS = ["text", "steps", "chips"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface ProductSection {
  /** `benefit`, `how`, `usage`… for the template's own sections, `custom_1`… for one the owner added. */
  key: string;
  title: string;
  kind: SectionKind;
  /** For `text`. */
  text?: string;
  /** For `steps` and `chips`. */
  items?: string[];
}

export interface FaqItem {
  q: string;
  a: string;
  keywords?: string[];
}

export type ProductBadge = "test" | "new";
export const PRODUCT_BADGES: readonly ProductBadge[] = ["test", "new"];

export interface ProductData {
  tagline: string;
  badges: ProductBadge[];
  sections: ProductSection[];
  faq: FaqItem[];
  /** A note for the TEAM (what not to promise). Absent unless somebody added it. */
  caution?: { text: string };
  testNote?: string;
  offerMessageTemplate?: string;
}

/** The machine keys of the refusals (each has an Arabic sentence in ar.knowledge.json). */
export type KnowledgeError =
  | "knowledge.e.shape"
  | "knowledge.e.tagline"
  | "knowledge.e.sections"
  | "knowledge.e.section"
  | "knowledge.e.chips"
  | "knowledge.e.steps"
  | "knowledge.e.text"
  | "knowledge.e.faq"
  | "knowledge.e.question"
  | "knowledge.e.answer"
  | "knowledge.e.caution"
  | "knowledge.e.test_note"
  | "knowledge.e.template"
  | "knowledge.e.reply";

export type KnowledgeCleaned<T> = { ok: true; value: T } | { ok: false; error: KnowledgeError };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (error: KnowledgeError): { ok: false; error: KnowledgeError } => ({ ok: false, error });
const SECTION_KEY = /^[a-z][a-z0-9_]{0,29}$/;

function cleanItems(raw: unknown, max: number, each: number, error: KnowledgeError): KnowledgeCleaned<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail(error);
  const out: string[] = [];
  for (const it of raw) {
    if (typeof it !== "string") return fail(error);
    const text = it.trim();
    if (text.length > each) return fail(error);
    if (text) out.push(text);
  }
  if (out.length > max) return fail(error);
  return { ok: true, value: out };
}

function cleanSection(raw: unknown): KnowledgeCleaned<ProductSection> {
  if (!isObj(raw)) return fail("knowledge.e.section");
  const key = typeof raw["key"] === "string" ? raw["key"] : "";
  const title = typeof raw["title"] === "string" ? raw["title"].trim() : "";
  const kind = raw["kind"];
  if (!SECTION_KEY.test(key) || !title || title.length > KNOWLEDGE_LIMITS.sectionTitle) return fail("knowledge.e.section");
  if (kind !== "text" && kind !== "steps" && kind !== "chips") return fail("knowledge.e.section");
  if (kind === "text") {
    const text = typeof raw["text"] === "string" ? raw["text"].trim() : "";
    if (raw["text"] !== undefined && typeof raw["text"] !== "string") return fail("knowledge.e.text");
    if (text.length > KNOWLEDGE_LIMITS.text) return fail("knowledge.e.text");
    return { ok: true, value: { key, title, kind, ...(text ? { text } : {}) } };
  }
  const items = kind === "steps" ? cleanItems(raw["items"], KNOWLEDGE_LIMITS.steps, KNOWLEDGE_LIMITS.step, "knowledge.e.steps") : cleanItems(raw["items"], KNOWLEDGE_LIMITS.chips, KNOWLEDGE_LIMITS.chip, "knowledge.e.chips");
  if (!items.ok) return items;
  return { ok: true, value: { key, title, kind, ...(items.value.length ? { items: items.value } : {}) } };
}

function cleanFaq(raw: unknown): KnowledgeCleaned<FaqItem> {
  if (!isObj(raw)) return fail("knowledge.e.faq");
  const q = typeof raw["q"] === "string" ? raw["q"].trim() : "";
  const a = typeof raw["a"] === "string" ? raw["a"].trim() : "";
  if (!q || q.length > KNOWLEDGE_LIMITS.question) return fail("knowledge.e.question");
  if (!a || a.length > KNOWLEDGE_LIMITS.answer) return fail("knowledge.e.answer");
  let keywords: string[] | undefined;
  if (raw["keywords"] !== undefined) {
    const k = cleanItems(raw["keywords"], KNOWLEDGE_LIMITS.keywords, KNOWLEDGE_LIMITS.keyword, "knowledge.e.faq");
    if (!k.ok) return k;
    if (k.value.length) keywords = k.value;
  }
  return { ok: true, value: { q, a, ...(keywords ? { keywords } : {}) } };
}

/** The `data` of a PRODUCT card, clean (trimmed, empty items dropped) or the reason it was refused. */
export function cleanProductData(raw: unknown): KnowledgeCleaned<ProductData> {
  if (!isObj(raw)) return fail("knowledge.e.shape");
  const tagline = typeof raw["tagline"] === "string" ? raw["tagline"].trim() : "";
  if (raw["tagline"] !== undefined && typeof raw["tagline"] !== "string") return fail("knowledge.e.tagline");
  if (tagline.length > KNOWLEDGE_LIMITS.tagline) return fail("knowledge.e.tagline");

  const badges: ProductBadge[] = [];
  if (raw["badges"] !== undefined) {
    if (!Array.isArray(raw["badges"])) return fail("knowledge.e.shape");
    for (const b of raw["badges"]) {
      if (b !== "test" && b !== "new") return fail("knowledge.e.shape");
      if (!badges.includes(b)) badges.push(b);
    }
  }

  const sectionsRaw = raw["sections"] === undefined ? [] : raw["sections"];
  if (!Array.isArray(sectionsRaw) || sectionsRaw.length > KNOWLEDGE_LIMITS.sections) return fail("knowledge.e.sections");
  const sections: ProductSection[] = [];
  for (const s of sectionsRaw) {
    const c = cleanSection(s);
    if (!c.ok) return c;
    if (sections.some((x) => x.key === c.value.key)) return fail("knowledge.e.section");
    sections.push(c.value);
  }

  const faqRaw = raw["faq"] === undefined ? [] : raw["faq"];
  if (!Array.isArray(faqRaw) || faqRaw.length > KNOWLEDGE_LIMITS.faq) return fail("knowledge.e.faq");
  const faq: FaqItem[] = [];
  for (const f of faqRaw) {
    const c = cleanFaq(f);
    if (!c.ok) return c;
    faq.push(c.value);
  }

  let caution: { text: string } | undefined;
  if (raw["caution"] !== undefined && raw["caution"] !== null) {
    const c = raw["caution"];
    const text = isObj(c) && typeof c["text"] === "string" ? c["text"].trim() : null;
    if (text === null || text.length > KNOWLEDGE_LIMITS.caution) return fail("knowledge.e.caution");
    if (text) caution = { text };
  }

  let testNote: string | undefined;
  if (raw["testNote"] !== undefined && raw["testNote"] !== null) {
    const t = typeof raw["testNote"] === "string" ? raw["testNote"].trim() : null;
    if (t === null || t.length > KNOWLEDGE_LIMITS.testNote) return fail("knowledge.e.test_note");
    if (t) testNote = t;
  }

  let offerMessageTemplate: string | undefined;
  if (raw["offerMessageTemplate"] !== undefined && raw["offerMessageTemplate"] !== null) {
    const t = typeof raw["offerMessageTemplate"] === "string" ? raw["offerMessageTemplate"].trim() : null;
    if (t === null || t.length > KNOWLEDGE_LIMITS.offerTemplate) return fail("knowledge.e.template");
    if (t) offerMessageTemplate = t;
  }

  return { ok: true, value: { tagline, badges, sections, faq, ...(caution ? { caution } : {}), ...(testNote ? { testNote } : {}), ...(offerMessageTemplate ? { offerMessageTemplate } : {}) } };
}

/** A REPLY card (a general approved answer): its words are `Card.body`. */
export function cleanReplyBody(raw: unknown): KnowledgeCleaned<string> {
  if (typeof raw !== "string") return fail("knowledge.e.reply");
  const text = raw.trim();
  if (!text || text.length > KNOWLEDGE_LIMITS.replyBody) return fail("knowledge.e.reply");
  return { ok: true, value: text };
}

/** What a sheet still lacks, for the editors' «ناقص: …» line and the list «كروت ناقصة». The order is the order they are shown in. */
export const GAP_KEYS = ["photo", "tagline", "sections", "faq"] as const;
export type GapKey = (typeof GAP_KEYS)[number];

export function sheetGaps(data: ProductData | null, opts: { hasPhoto: boolean }): GapKey[] {
  const gaps: GapKey[] = [];
  if (!opts.hasPhoto) gaps.push("photo");
  if (!data || !data.tagline) gaps.push("tagline");
  const filled = data?.sections.filter((s) => (s.kind === "text" ? !!s.text : (s.items?.length ?? 0) > 0)).length ?? 0;
  if (!data || filled === 0) gaps.push("sections");
  if (!data || data.faq.length === 0) gaps.push("faq");
  return gaps;
}

/** The section keys a sheet has no content in (for «ناقص: لشو بينفع · …»). */
export function emptySectionTitles(data: ProductData | null): string[] {
  return (data?.sections ?? []).filter((s) => (s.kind === "text" ? !s.text : (s.items?.length ?? 0) === 0)).map((s) => s.title);
}
