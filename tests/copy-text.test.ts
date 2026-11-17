import { describe, expect, it } from "vitest";
import { answerText, buildCopyAll, buildOfferMessage, fmtMoney, offerLine, searchFaq, sectionText } from "../src/lib/cards/copy-text";
import type { ProductData } from "../src/lib/cards/knowledge";
import type { ProductSnapshot } from "../src/lib/oms/snapshot";

/** Q1.1: every text a copy button copies. Plain, Western digits, never the caution, never a stale or missing price. */
const NOW = new Date("2026-11-17T12:00:00.000Z");
const snap = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  code: "H-1",
  name: "حراك",
  price: 20,
  currency: "USD",
  offers: [],
  stockStatus: "in_stock",
  fetchedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  ...over,
});
const data: ProductData = {
  tagline: "زيت مساج دافي",
  badges: [],
  sections: [
    { key: "benefit", title: "لشو بينفع", kind: "chips", items: ["آلام الظهر", "شد عضلي"] },
    { key: "usage", title: "طريقة الاستعمال", kind: "steps", items: ["نظّف المكان", "دلّك دقيقتين"] },
    { key: "how", title: "كيف بيشتغل", kind: "text", text: "بيدفّي العضلة" },
    { key: "ingredients", title: "المكونات", kind: "chips" },
  ],
  faq: [{ q: "هل بينفع للأطفال؟", a: "لا، للكبار بس.", keywords: ["طفل"] }],
  caution: { text: "لا تعدي بشفاء" },
};
const base = { name: "حراك", tagline: data.tagline, unit: "عبوة", now: NOW };

describe("a section", () => {
  it("chips are one line joined with «، », steps are numbered, the title comes first", () => {
    expect(sectionText(data.sections[0]!)).toBe("لشو بينفع\nآلام الظهر، شد عضلي");
    expect(sectionText(data.sections[1]!)).toBe("طريقة الاستعمال\n1. نظّف المكان\n2. دلّك دقيقتين");
    expect(sectionText(data.sections[2]!)).toBe("كيف بيشتغل\nبيدفّي العضلة");
  });
  it("an empty section copies nothing", () => {
    expect(sectionText(data.sections[3]!)).toBe("");
  });
  it("an answer is the answer only", () => {
    expect(answerText(data.faq[0]!)).toBe("لا، للكبار بس.");
  });
});

describe("money", () => {
  it("one decimal at most, Western digits", () => {
    expect(fmtMoney(20)).toBe("20");
    expect(fmtMoney(13.333)).toBe("13.3");
    expect(fmtMoney(12.5)).toBe("12.5");
    expect(fmtMoney(0.04)).toBe("0");
  });
  it("the price of one piece in an offer shows only when the gift units are known", () => {
    expect(offerLine({ title: "عبوتين + هدية", quantity: 2, freeQuantity: 1, price: 40 }, "USD", "عبوة")).toBe("عبوتين + هدية — 40$ · العبوة 13.3$");
    expect(offerLine({ title: "عبوتين", quantity: 2, price: 36 }, "USD", "عبوة")).toBe("عبوتين — 36$");
    expect(offerLine({ title: "قطعتين", quantity: 2, freeQuantity: 0, price: 50 }, "USD", "قطعة")).toBe("قطعتين — 50$ · القطعة 25$");
  });
});

describe("the offer message", () => {
  it("is built from the live prices", () => {
    const r = buildOfferMessage({ ...base, snapshot: snap({ offers: [{ title: "عبوتين + هدية", quantity: 2, freeQuantity: 1, price: 40 }], deliveryIncluded: true }), deliveryLine: "توصيل مجاني · دفع عند الاستلام" });
    expect(r).toEqual({ ok: true, text: "حراك\nزيت مساج دافي\n\nالعبوة 20$\nعبوتين + هدية — 40$ · العبوة 13.3$\nتوصيل مجاني · دفع عند الاستلام" });
  });
  it("leaves no empty line for a placeholder with nothing behind it", () => {
    const r = buildOfferMessage({ ...base, snapshot: snap() });
    expect(r.ok && r.text).toBe("حراك\nزيت مساج دافي\n\nالعبوة 20$");
  });
  it("delivery appears only when the product says so", () => {
    const r = buildOfferMessage({ ...base, snapshot: snap({ deliveryIncluded: false }), deliveryLine: "توصيل مجاني" });
    expect(r.ok && r.text).not.toContain("توصيل");
  });
  it("the placeholders of the owner's own template are filled, the cheapest piece too", () => {
    const r = buildOfferMessage({
      ...base,
      template: "{الاسم} بـ {سعر_الواحدة} وبالعرض القطعة بـ {سعر_القطعة_بالعرض}",
      snapshot: snap({ offers: [{ title: "x", quantity: 2, freeQuantity: 1, price: 40 }, { title: "y", quantity: 1, freeQuantity: 0, price: 18 }] }),
    });
    expect(r.ok && r.text).toBe("حراك بـ العبوة 20$ وبالعرض القطعة بـ 13.3$");
  });
  it("refuses with no snapshot or no price", () => {
    expect(buildOfferMessage({ ...base, snapshot: null })).toEqual({ ok: false, reason: "no_price" });
    expect(buildOfferMessage({ ...base, snapshot: snap({ price: 0 }) })).toEqual({ ok: false, reason: "no_price" });
  });
  it("refuses a snapshot older than 30 minutes, and says why", () => {
    expect(buildOfferMessage({ ...base, snapshot: snap({ fetchedAt: new Date(NOW.getTime() - 31 * 60_000).toISOString() }) })).toEqual({ ok: false, reason: "stale" });
  });
});

describe("«انسخي الكل»", () => {
  const input = { ...base, data, snapshot: snap(), parts: ["description", "sections", "price", "link"] as const };
  it("copies the ticked parts in a fixed order", () => {
    const r = buildCopyAll({ ...input, parts: [...input.parts], snapshot: snap({ link: "https://shop.example.test/p" }) });
    expect(r.priceSkipped).toBeNull();
    expect(r.text.split("\n\n")).toEqual(["حراك\nزيت مساج دافي", "لشو بينفع\nآلام الظهر، شد عضلي", "طريقة الاستعمال\n1. نظّف المكان\n2. دلّك دقيقتين", "كيف بيشتغل\nبيدفّي العضلة", "العبوة 20$", "https://shop.example.test/p"]);
  });
  it("NEVER carries the caution, whatever is ticked", () => {
    const r = buildCopyAll({ ...input, parts: [...input.parts] });
    expect(r.text).not.toContain("لا تعدي بشفاء");
  });
  it("only the ticked sections", () => {
    const r = buildCopyAll({ ...input, parts: ["sections"], sectionKeys: ["usage"] });
    expect(r.text).toBe("طريقة الاستعمال\n1. نظّف المكان\n2. دلّك دقيقتين");
  });
  it("a stale price is left out and the reason is returned", () => {
    const r = buildCopyAll({ ...input, parts: ["description", "price"], snapshot: snap({ fetchedAt: new Date(NOW.getTime() - 40 * 60_000).toISOString() }) });
    expect(r.priceSkipped).toBe("stale");
    expect(r.text).toBe("حراك\nزيت مساج دافي");
  });
  it("uses no Arabic-Indic digit anywhere", () => {
    const r = buildCopyAll({ ...input, parts: [...input.parts] });
    expect(r.text).not.toMatch(/[٠-٩]/);
  });
});

describe("the questions", () => {
  const faq = [
    { q: "هل بينفع للأطفال؟", a: "لا، للكبار بس.", keywords: ["طفل"] },
    { q: "كم مدة التوصيل؟", a: "يومين." },
  ];
  it("finds by the Arabic folding (hamza, ta marbuta, diacritics)", () => {
    expect(searchFaq(faq, "اطفال").map((f) => f.q)).toEqual(["هل بينفع للأطفال؟"]);
    expect(searchFaq(faq, "مُدَّة").map((f) => f.q)).toEqual(["كم مدة التوصيل؟"]);
    expect(searchFaq(faq, "طفل")).toHaveLength(1);
  });
  it("nothing typed shows all; no match shows none (the screen then offers «اسألي مشرفتك»)", () => {
    expect(searchFaq(faq, "  ")).toHaveLength(2);
    expect(searchFaq(faq, "غسالة")).toEqual([]);
  });
});
