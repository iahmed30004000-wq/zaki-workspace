import type { ProductData, ProductSection, SectionKind } from "./knowledge";
import { KNOWLEDGE_LIMITS } from "./knowledge";

/**
 * The sections a sheet has, by the product's CATEGORY (D-Q6: the category name comes from the orders system). The defaults live here;
 * the owner edits them in the knowledge settings (`Organization.settings.productTemplates`, keyed by category name). A template has at
 * most 8 sections. «لشو بينفع» is the owner's «المشاكل» (D-Q10); «كيف بيشتغل» is «آلية عمل المنتج»; «طريقة الاستعمال» / «طريقة التشغيل»
 * is «آلية الاستخدام». No template adds a caution: it is added by hand, per sheet (D-Q5).
 */

export type TemplateId = "health" | "clothing" | "devices" | "other";

export interface SectionSpec {
  key: string;
  title: string;
  kind: SectionKind;
}

export interface ProductTemplate {
  id: TemplateId;
  /** «عبوة» or «قطعة»: the word of one piece in the offer message. */
  unit: string;
  sections: SectionSpec[];
}

const HEALTH: ProductTemplate = {
  id: "health",
  unit: "عبوة",
  sections: [
    { key: "benefit", title: "لشو بينفع", kind: "chips" },
    { key: "how", title: "كيف بيشتغل", kind: "text" },
    { key: "usage", title: "طريقة الاستعمال", kind: "steps" },
    { key: "ingredients", title: "المكونات", kind: "chips" },
  ],
};

const CLOTHING: ProductTemplate = {
  id: "clothing",
  unit: "قطعة",
  sections: [
    { key: "sizes", title: "المقاسات", kind: "chips" },
    { key: "fabric", title: "الخامة", kind: "text" },
    { key: "colors", title: "الألوان", kind: "chips" },
    { key: "care", title: "العناية والغسيل", kind: "steps" },
  ],
};

const DEVICES: ProductTemplate = {
  id: "devices",
  unit: "قطعة",
  sections: [
    { key: "benefit", title: "لشو بينفع", kind: "chips" },
    { key: "how", title: "كيف بيشتغل", kind: "text" },
    { key: "operation", title: "طريقة التشغيل", kind: "steps" },
    { key: "specs", title: "المواصفات", kind: "chips" },
    { key: "warranty", title: "الكفالة", kind: "text" },
  ],
};

const OTHER: ProductTemplate = {
  id: "other",
  unit: "قطعة",
  sections: [
    { key: "benefit", title: "لشو بينفع", kind: "chips" },
    { key: "usage", title: "طريقة الاستعمال", kind: "steps" },
    { key: "specs", title: "المواصفات", kind: "chips" },
  ],
};

export const DEFAULT_TEMPLATES: Record<TemplateId, ProductTemplate> = { health: HEALTH, clothing: CLOTHING, devices: DEVICES, other: OTHER };

/** The orders system's categories (today) and the template of each. */
export const CATEGORY_TEMPLATE: Record<string, TemplateId> = {
  "الصحة والعلاجات": "health",
  "العناية بالبشرة والجسم": "health",
  "العناية بالشعر": "health",
  "صحة وأعشاب": "health",
  "ملابس": "clothing",
  "أجهزة العناية والليزر": "devices",
  "أجهزة منزلية وتدفئة": "devices",
  "إلكترونيات": "devices",
  "مستلزمات منزلية": "other",
};

export function templateIdOf(category: string | null | undefined): TemplateId {
  return (category && CATEGORY_TEMPLATE[category.trim()]) || "other";
}

/** What the owner saved as templates: a list of sections per category name. Anything broken is ignored (the default applies). */
export type TemplateOverrides = Record<string, Array<{ key?: unknown; title?: unknown; kind?: unknown }>>;

function cleanSpecs(raw: unknown): SectionSpec[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > KNOWLEDGE_LIMITS.sections) return null;
  const out: SectionSpec[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) return null;
    const { key, title, kind } = s as Record<string, unknown>;
    if (typeof key !== "string" || !/^[a-z][a-z0-9_]{0,29}$/.test(key)) return null;
    if (typeof title !== "string" || !title.trim() || title.trim().length > KNOWLEDGE_LIMITS.sectionTitle) return null;
    if (kind !== "text" && kind !== "steps" && kind !== "chips") return null;
    if (out.some((x) => x.key === key)) return null;
    out.push({ key, title: title.trim(), kind });
  }
  return out;
}

/** The template of a category: the owner's if he saved a valid one for that name, else the default of its group. */
export function templateFor(category: string | null | undefined, overrides?: TemplateOverrides | null): ProductTemplate {
  const base = DEFAULT_TEMPLATES[templateIdOf(category)];
  const own = category && overrides ? cleanSpecs(overrides[category.trim()]) : null;
  return own ? { ...base, sections: own } : base;
}

/** A new sheet's data for a category: every section of its template, empty, and no caution. */
export function emptyProductData(template: ProductTemplate): ProductData {
  const sections: ProductSection[] = template.sections.map((s) => ({ key: s.key, title: s.title, kind: s.kind }));
  return { tagline: "", badges: [], sections, faq: [] };
}

/** The offer message when the sheet has no template of its own: the placeholders are filled from the LIVE snapshot (copy-text.ts). */
export const DEFAULT_OFFER_TEMPLATE = "{الاسم}\n{الوصف}\n\n{سعر_الواحدة}\n{العروض}\n{التوصيل}";

/** The sentence a health template offers in the editor for «أضيفي تنبيه للفريق». It is only a suggestion: nothing adds it by itself. */
export const SUGGESTED_CAUTION = "ما منوعد بعلاج: بنحكي عن الاستعمال والمكونات بس، وبننصح الزبون يستشير الطبيب إذا عنده حالة.";
