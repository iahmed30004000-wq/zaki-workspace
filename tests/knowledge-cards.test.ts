import { describe, expect, it } from "vitest";
import { KNOWLEDGE_LIMITS, cleanProductData, cleanReplyBody, emptySectionTitles, sheetGaps, type ProductData } from "../src/lib/cards/knowledge";
import { DEFAULT_TEMPLATES, emptyProductData, templateFor, templateIdOf } from "../src/lib/cards/product-templates";

/** Q1.1: the data of a product sheet, its limits («بدون عجقة») and the templates by category. */
const ok = (raw: unknown) => {
  const r = cleanProductData(raw);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (raw: unknown) => {
  const r = cleanProductData(raw);
  return r.ok ? null : r.error;
};
const sec = (over: Record<string, unknown> = {}) => ({ key: "benefit", title: "لشو بينفع", kind: "chips", items: ["a"], ...over });

describe("the limits", () => {
  it("the one line is at most 120", () => {
    expect(err({ tagline: "ا".repeat(121) })).toBe("knowledge.e.tagline");
    expect(ok({ tagline: "ا".repeat(120) }).tagline).toHaveLength(120);
  });
  it("a step is at most 80, a text at most 400, a chip at most 60, an answer at most 300", () => {
    expect(err({ sections: [sec({ kind: "steps", items: ["ا".repeat(81)] })] })).toBe("knowledge.e.steps");
    expect(err({ sections: [{ key: "how", title: "كيف", kind: "text", text: "ا".repeat(401) }] })).toBe("knowledge.e.text");
    expect(err({ sections: [sec({ items: ["ا".repeat(61)] })] })).toBe("knowledge.e.chips");
    expect(err({ faq: [{ q: "س", a: "ا".repeat(301) }] })).toBe("knowledge.e.answer");
    expect(ok({ sections: [sec({ items: ["ا".repeat(60)] })] }).sections[0]!.items![0]).toHaveLength(60);
  });
  it("at most 20 chips, 8 sections, 30 questions", () => {
    expect(err({ sections: [sec({ items: Array.from({ length: 21 }, (_, i) => `c${i}`) })] })).toBe("knowledge.e.chips");
    expect(err({ sections: Array.from({ length: 9 }, (_, i) => sec({ key: `k${i}` })) })).toBe("knowledge.e.sections");
    expect(err({ faq: Array.from({ length: 31 }, () => ({ q: "س", a: "ج" })) })).toBe("knowledge.e.faq");
    expect(KNOWLEDGE_LIMITS.sections).toBe(8);
  });
  it("the caution is at most 200 and the test note 120, the offer template 600", () => {
    expect(err({ caution: { text: "ا".repeat(201) } })).toBe("knowledge.e.caution");
    expect(err({ testNote: "ا".repeat(121) })).toBe("knowledge.e.test_note");
    expect(err({ offerMessageTemplate: "ا".repeat(601) })).toBe("knowledge.e.template");
  });
  it("two sections cannot share a key, and a key is a plain word", () => {
    expect(err({ sections: [sec(), sec()] })).toBe("knowledge.e.section");
    expect(err({ sections: [sec({ key: "Bad Key" })] })).toBe("knowledge.e.section");
    expect(err({ sections: [sec({ kind: "table" })] })).toBe("knowledge.e.section");
  });
});

describe("what it keeps", () => {
  it("trims, drops empty items, keeps no caution unless one was written", () => {
    const d = ok({ tagline: "  زيت  ", sections: [sec({ items: ["  أ ", "", "   ", "ب"] })], faq: [{ q: " س ", a: " ج ", keywords: [" ك ", ""] }], caution: { text: "   " } });
    expect(d.tagline).toBe("زيت");
    expect(d.sections[0]!.items).toEqual(["أ", "ب"]);
    expect(d.faq[0]).toEqual({ q: "س", a: "ج", keywords: ["ك"] });
    expect(d.caution).toBeUndefined();
  });
  it("only the two badges exist", () => {
    expect(ok({ badges: ["test", "new", "test"] }).badges).toEqual(["test", "new"]);
    expect(err({ badges: ["hot"] })).toBe("knowledge.e.shape");
  });
  it("is not a product at all", () => {
    expect(err(null)).toBe("knowledge.e.shape");
    expect(err([])).toBe("knowledge.e.shape");
    expect(err("x")).toBe("knowledge.e.shape");
  });
  it("a reply is a short body", () => {
    expect(cleanReplyBody("  التوصيل مجاني  ")).toEqual({ ok: true, value: "التوصيل مجاني" });
    expect(cleanReplyBody("").ok).toBe(false);
    expect(cleanReplyBody("ا".repeat(601)).ok).toBe(false);
  });
});

describe("what a sheet lacks", () => {
  it("a new sheet lacks everything; a filled one lacks only what is missing", () => {
    expect(sheetGaps(null, { hasPhoto: false })).toEqual(["photo", "tagline", "sections", "faq"]);
    const data: ProductData = { tagline: "x", badges: [], sections: [{ key: "benefit", title: "لشو بينفع", kind: "chips", items: ["a"] }, { key: "how", title: "كيف بيشتغل", kind: "text" }], faq: [] };
    expect(sheetGaps(data, { hasPhoto: true })).toEqual(["faq"]);
    expect(emptySectionTitles(data)).toEqual(["كيف بيشتغل"]);
  });
});

describe("the templates", () => {
  it("each group has its sections and its unit word", () => {
    expect(DEFAULT_TEMPLATES.health.sections.map((s) => s.title)).toEqual(["لشو بينفع", "كيف بيشتغل", "طريقة الاستعمال", "المكونات"]);
    expect(DEFAULT_TEMPLATES.clothing.sections.map((s) => s.title)).toEqual(["المقاسات", "الخامة", "الألوان", "العناية والغسيل"]);
    expect(DEFAULT_TEMPLATES.devices.sections.map((s) => s.title)).toEqual(["لشو بينفع", "كيف بيشتغل", "طريقة التشغيل", "المواصفات", "الكفالة"]);
    expect(DEFAULT_TEMPLATES.other.sections).toHaveLength(3);
    expect(DEFAULT_TEMPLATES.health.unit).toBe("عبوة");
    expect(DEFAULT_TEMPLATES.clothing.unit).toBe("قطعة");
  });
  it("the nine categories of the orders system map to their group; anything else is «other»", () => {
    expect(templateIdOf("العناية بالبشرة والجسم")).toBe("health");
    expect(templateIdOf("ملابس")).toBe("clothing");
    expect(templateIdOf("إلكترونيات")).toBe("devices");
    expect(templateIdOf("مستلزمات منزلية")).toBe("other");
    expect(templateIdOf("غريبة")).toBe("other");
    expect(templateIdOf(null)).toBe("other");
  });
  it("no template adds a caution, and a template has at most 8 sections", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      expect(t.sections.length).toBeLessThanOrEqual(8);
      expect(emptyProductData(t).caution).toBeUndefined();
    }
  });
  it("the owner's template for a category wins when it is valid, and a broken one is ignored", () => {
    const own = { ملابس: [{ key: "sizes", title: "المقاسات", kind: "chips" }, { key: "custom_1", title: "ملاحظة", kind: "text" }] };
    expect(templateFor("ملابس", own).sections.map((s) => s.key)).toEqual(["sizes", "custom_1"]);
    expect(templateFor("ملابس", { ملابس: [{ key: "x", title: "", kind: "chips" }] }).sections).toHaveLength(4);
    expect(templateFor("ملابس", { ملابس: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, title: "ت", kind: "text" })) }).sections).toHaveLength(4);
  });
  it("a new sheet carries every section of its template, empty", () => {
    const d = emptyProductData(DEFAULT_TEMPLATES.devices);
    expect(d.sections.map((s) => s.key)).toEqual(["benefit", "how", "operation", "specs", "warranty"]);
    expect(d.sections.every((s) => s.text === undefined && s.items === undefined)).toBe(true);
    expect(cleanProductData(d).ok).toBe(true);
  });
});
