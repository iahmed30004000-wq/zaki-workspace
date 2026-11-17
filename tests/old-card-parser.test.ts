import { describe, expect, it } from "vitest";
import { applyOldCard, parseOldCard } from "../src/lib/cards/old-card-parser";
import { cleanProductData } from "../src/lib/cards/knowledge";
import { DEFAULT_TEMPLATES } from "../src/lib/cards/product-templates";

/** Q1.1: «الصقي كرت قديم» — an old Telegram card split into the sheet's fields by its markers. */
const OLD = `🔥 حراك زيت المساج
الوصف: زيت مساج دافي بالكركم والزنجبيل
✅ لشو بينفع:
- آلام الظهر
- شد عضلي، تنميل
🧴 طريقة الاستعمال:
1. دلّكي المنطقة
2) انتظري دقيقتين
المكونات: كركم، زنجبيل، زيت جوز الهند
السعر: 20$
عرض: عبوتين بـ 36$
كيف بيشتغل: بيدفّي العضلة وبيريحها
ملاحظة غريبة: لا تحطيه على جرح`;

describe("the parser", () => {
  const p = parseOldCard(OLD);
  it("takes the name from the first line and the description from its marker", () => {
    expect(p.name).toBe("🔥 حراك زيت المساج".replace("🔥 ", ""));
    expect(p.tagline).toBe("زيت مساج دافي بالكركم والزنجبيل");
  });
  it("splits the parts by their markers, bullets and numbers removed", () => {
    expect(p.parts["benefit"]).toEqual(["آلام الظهر", "شد عضلي، تنميل"]);
    expect(p.parts["usage"]).toEqual(["دلّكي المنطقة", "انتظري دقيقتين"]);
    expect(p.parts["ingredients"]).toEqual(["كركم، زنجبيل، زيت جوز الهند"]);
    expect(p.parts["how"]).toEqual(["بيدفّي العضلة وبيريحها"]);
  });
  it("never takes a price from an old card; it only says it saw some", () => {
    expect(JSON.stringify(p.parts)).not.toMatch(/20\$|36\$/);
    expect(p.priceSeen).toBe(2);
  });
  it("keeps what it does not know for the editor", () => {
    expect(p.unmatched.join(" ")).toContain("ملاحظة غريبة");
    expect(p.unmatched.join(" ")).toContain("لا تحطيه على جرح");
  });
  it("copes with CRLF, empty lines and Arabic-Indic numbering", () => {
    const q = parseOldCard("اسم المنتج: س\r\n\r\nطريقة الاستعمال:\r\n١. أولًا\r\n٢. ثانيًا");
    expect(q.name).toBe("س");
    expect(q.parts["usage"]?.length).toBe(2);
  });
  it("an empty paste gives an empty result", () => {
    expect(parseOldCard("")).toEqual({ name: null, tagline: null, parts: {}, unmatched: [], priceSeen: 0 });
  });
});

describe("placing it in a template", () => {
  const applied = applyOldCard(parseOldCard(OLD), DEFAULT_TEMPLATES.health);
  it("chips are split on commas, steps are lines, text is joined", () => {
    const by = Object.fromEntries(applied.data.sections.map((s) => [s.key, s]));
    expect(by["benefit"]!.items).toEqual(["آلام الظهر", "شد عضلي", "تنميل"]);
    expect(by["usage"]!.items).toEqual(["دلّكي المنطقة", "انتظري دقيقتين"]);
    expect(by["ingredients"]!.items).toEqual(["كركم", "زنجبيل", "زيت جوز الهند"]);
    expect(by["how"]!.text).toBe("بيدفّي العضلة وبيريحها");
    expect(applied.data.tagline).toBe("زيت مساج دافي بالكركم والزنجبيل");
  });
  it("adds no caution", () => {
    expect(applied.data.caution).toBeUndefined();
  });
  it("the result is a valid sheet", () => {
    expect(cleanProductData(applied.data).ok).toBe(true);
    expect(applied.overLimit).toEqual([]);
  });
  it("a part over its limit is kept and listed, never cut", () => {
    const long = "ا".repeat(500);
    const a = applyOldCard(parseOldCard(`كيف بيشتغل: ${long}`), DEFAULT_TEMPLATES.health);
    expect(a.overLimit).toEqual(["كيف بيشتغل"]);
    expect(a.data.sections.find((s) => s.key === "how")!.text).toBe(long);
  });
});
