import { describe, expect, it } from "vitest";
import fixture from "./fixtures/oms-products.provisional.json";
import { STALE_AFTER_MS, isStale, normalizeProducts, priceChanged, staleNote, type ProductSnapshot } from "../src/lib/oms/snapshot";

/**
 * Q1.0: the snapshot of a product from the orders system, as pure functions. The fixture is PROVISIONAL (written from the
 * spec); the contract test is re-pointed at the system's own example once the owner brings it.
 */
const NOW = new Date("2026-11-17T12:00:00.000Z");
const snap = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  code: "TS-100",
  name: "x",
  price: 25,
  currency: "JOD",
  offers: [],
  stockStatus: "in_stock",
  fetchedAt: NOW.toISOString(),
  ...over,
});

describe("the stale rule", () => {
  it("is older than 30 minutes", () => {
    expect(STALE_AFTER_MS).toBe(30 * 60_000);
    expect(isStale(snap({ fetchedAt: new Date(NOW.getTime() - 29 * 60_000).toISOString() }), NOW)).toBe(false);
    expect(isStale(snap({ fetchedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString() }), NOW)).toBe(false);
    expect(isStale(snap({ fetchedAt: new Date(NOW.getTime() - 30 * 60_000 - 1).toISOString() }), NOW)).toBe(true);
  });
  it("treats a missing or broken date, or no snapshot at all, as stale", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(snap({ fetchedAt: "nonsense" }), NOW)).toBe(true);
    expect(isStale({} as ProductSnapshot, NOW)).toBe(true);
  });
  it("a date in the future is not stale (a skewed clock must not block a price)", () => {
    expect(isStale(snap({ fetchedAt: new Date(NOW.getTime() + 5 * 60_000).toISOString() }), NOW)).toBe(false);
  });
  it("says how long ago, in Arabic with Western digits", () => {
    expect(staleNote(snap({ fetchedAt: new Date(NOW.getTime() - 45 * 60_000).toISOString() }), NOW)).toBe("آخر تحديث قبل 45 دقيقة");
    expect(staleNote(snap({ fetchedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() }), NOW)).toBe("آخر تحديث قبل 3 ساعة");
    expect(staleNote(null, NOW)).toBe("ما في سعر محدّث");
  });
});

describe("what the products door sends", () => {
  const rows = normalizeProducts(fixture, NOW);
  it("reads every product with a code and a name", () => {
    expect(rows.map((r) => r.code)).toEqual(["TS-100", "TS-200", "TS-300"]);
  });
  it("maps the offers (the free units and the end date) and the flags", () => {
    expect(rows[0]).toMatchObject({
      id: "p_1001",
      store: "متجر تجريبي",
      category: "أجهزة العناية",
      price: 25,
      currency: "JOD",
      stockStatus: "in_stock",
      deliveryIncluded: true,
      link: "https://shop.example.test/p/ts-100",
      fetchedAt: NOW.toISOString(),
    });
    expect(rows[0]!.offers[1]).toEqual({ title: "اشتري 2 والتالتة هدية", quantity: 2, freeQuantity: 1, price: 50, expiresAt: "2026-12-31T00:00:00.000Z" });
  });
  it("a product with no internal id has none, and the fields the door has not added yet stay absent", () => {
    expect(rows[2]!.id).toBeUndefined();
    expect(rows[2]!.offers).toEqual([]);
    expect(rows[2]!.store).toBeUndefined();
    expect(rows[2]!.stockStatus).toBe("unknown");
  });
  it("drops a row with no code or a price that is not a number, never guessing one", () => {
    const out = normalizeProducts({ data: [{ name: "no code", price: 1 }, { code: "A", name: "bad price", price: "abc" }, { code: "B", name: "ok", price: 3 }] }, NOW);
    expect(out.map((r) => r.code)).toEqual(["B"]);
  });
  it("accepts a bare array and `products`, and refuses anything else with an empty list", () => {
    expect(normalizeProducts([{ code: "A", name: "a", price: 1 }], NOW)).toHaveLength(1);
    expect(normalizeProducts({ products: [{ code: "A", name: "a", price: 1 }] }, NOW)).toHaveLength(1);
    expect(normalizeProducts("<html>", NOW)).toEqual([]);
    expect(normalizeProducts(null, NOW)).toEqual([]);
  });
  it("never carries a review or any customer field across", () => {
    const out = normalizeProducts({ data: [{ code: "A", name: "a", price: 1, reviews: [{ first_name: "سارة", city: "عمان", text: "حلو" }], customer_phone: "0790000000" }] }, NOW);
    expect(JSON.stringify(out)).not.toMatch(/سارة|عمان|0790000000|reviews|customer/);
  });
});

describe("did the price or the offers change", () => {
  it("is false for the first snapshot of a product (nothing to compare with)", () => {
    expect(priceChanged(null, snap())).toBe(false);
  });
  it("is true when the price moves, an offer is added, removed or repriced", () => {
    expect(priceChanged(snap(), snap({ price: 30 }))).toBe(true);
    expect(priceChanged(snap(), snap({ offers: [{ title: "a", quantity: 2, price: 40 }] }))).toBe(true);
    expect(priceChanged(snap({ offers: [{ title: "a", quantity: 2, price: 40 }] }), snap({ offers: [{ title: "a", quantity: 2, price: 45 }] }))).toBe(true);
    expect(priceChanged(snap({ offers: [{ title: "a", quantity: 2, price: 40 }] }), snap())).toBe(true);
  });
  it("is false when only the time, the name or the stock changed", () => {
    expect(priceChanged(snap(), snap({ fetchedAt: "2030-01-01T00:00:00.000Z", name: "other", stockStatus: "out_of_stock" }))).toBe(false);
  });
  it("is false when the offers are the same in another order", () => {
    const a = { title: "a", quantity: 1, price: 10 };
    const b = { title: "b", quantity: 2, price: 18 };
    expect(priceChanged(snap({ offers: [a, b] }), snap({ offers: [b, a] }))).toBe(false);
  });
});
