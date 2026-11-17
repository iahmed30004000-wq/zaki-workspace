import { describe, expect, it } from "vitest";
import { buildOfferMessage, fmtMoney, fmtPiece } from "../src/lib/cards/copy-text";
import { CATEGORY_TEMPLATE, emptyProductData, templateFor, templateIdOf } from "../src/lib/cards/product-templates";
import type { ProductSnapshot } from "../src/lib/oms/snapshot";

/** Q1.1 review: the pure holes the independent review reproduced. */
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
const base = { name: "حراك", tagline: "زيت", unit: "عبوة", now: NOW };

describe("a category named like a member of Object", () => {
  it("is the «other» template, never a crash", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(templateIdOf(name), name).toBe("other");
      expect(() => emptyProductData(templateFor(name, {})), name).not.toThrow();
      expect(templateFor(name, { [name]: [] }).sections.length, name).toBeGreaterThan(0);
    }
    expect(Object.keys(CATEGORY_TEMPLATE)).toHaveLength(9);
  });
});

describe("the price is printed as it is", () => {
  it("a price keeps its cents: 12.99 is 12.99, 9.99 is 9.99, 0.05 is 0.05", () => {
    expect(fmtMoney(12.99)).toBe("12.99");
    expect(fmtMoney(9.99)).toBe("9.99");
    expect(fmtMoney(0.05)).toBe("0.05");
    expect(fmtMoney(20)).toBe("20");
    expect(fmtMoney(12.5)).toBe("12.5");
    expect(fmtMoney(12.25)).toBe("12.25");
  });
  it("only a price DERIVED for one piece is rounded to one decimal", () => {
    expect(fmtPiece(13.333)).toBe("13.3");
    expect(fmtPiece(20)).toBe("20");
  });
  it("the offer message prints the real price", () => {
    const r = buildOfferMessage({ ...base, snapshot: snap({ price: 12.99 }) });
    expect(r.ok && r.text).toContain("12.99$");
  });
});

describe("the offer message refuses and omits what is not true any more", () => {
  it("a product that is gone from the orders system gives no price to copy, however fresh the snapshot", () => {
    expect(buildOfferMessage({ ...base, snapshot: snap({ missingSince: NOW.toISOString() }) })).toEqual({ ok: false, reason: "no_price" });
  });
  it("an offer whose end date has passed is not printed", () => {
    const r = buildOfferMessage({
      ...base,
      snapshot: snap({ offers: [{ title: "عرض منتهي", quantity: 2, price: 36, expiresAt: "2026-11-16T00:00:00.000Z" }, { title: "عرض سارٍ", quantity: 3, price: 50, expiresAt: "2026-12-01T00:00:00.000Z" }, { title: "بلا نهاية", quantity: 1, price: 19 }] }),
    });
    expect(r.ok && r.text).not.toContain("عرض منتهي");
    expect(r.ok && r.text).toContain("عرض سارٍ");
    expect(r.ok && r.text).toContain("بلا نهاية");
  });
  it("a template line whose placeholder has nothing behind it is dropped whole", () => {
    const r = buildOfferMessage({ ...base, template: "{الاسم}\nالقطعة بـ {سعر_القطعة_بالعرض} فقط\n{سعر_الواحدة}", snapshot: snap({ offers: [{ title: "x", quantity: 2, price: 36 }] }) });
    expect(r.ok && r.text).toBe("حراك\nالعبوة 20$");
  });
  it("a value that looks like a placeholder is not expanded again", () => {
    const r = buildOfferMessage({ ...base, name: "{سعر_الواحدة}", template: "{الاسم}\n{سعر_الواحدة}", snapshot: snap() });
    expect(r.ok && r.text).toBe("{سعر_الواحدة}\nالعبوة 20$");
  });
});
