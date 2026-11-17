import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeProducts, priceChanged, readProducts, type ProductSnapshot } from "../src/lib/oms/snapshot";
import { omsErrorKey } from "../src/components/oms-link-card";
import { AR } from "../src/lib/i18n/dict";

/**
 * Q1.0 review: what the independent review of the orders-system link reproduced. Pure and client tests; the database ones are in
 * tests/db/oms-review-fixes.test.ts.
 */
const NOW = new Date("2026-11-17T12:00:00.000Z");
const state = vi.hoisted(() => ({ config: { baseUrl: "https://oms.example.test" } as Record<string, unknown> }));
const events: Array<Record<string, unknown>> = [];
vi.mock("@/server/services/integrations", () => ({
  requireConnected: vi.fn(async () => ({ row: { config: state.config, id: "i1" }, secrets: { token: "tok" } })),
  logEvent: vi.fn(async (_org: string, input: Record<string, unknown>) => void events.push(input)),
}));
const resolve = async () => ["93.184.216.34"];
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("the snapshot reader", () => {
  it("refuses a price that is zero, negative or not finite, and an offer with no quantity", () => {
    const rows = normalizeProducts({ data: [{ code: "Z", name: "z", price: 0 }, { code: "N", name: "n", price: -5 }, { code: "I", name: "i", price: Infinity }, { code: "OK", name: "ok", price: 5, offers: [{ title: "x", quantity: 0, price: 3 }, { title: "y", quantity: 2, price: -1 }, { title: "fine", quantity: 2, price: 8 }] }] }, NOW);
    expect(rows.map((r) => r.code)).toEqual(["OK"]);
    expect(rows[0]!.offers).toEqual([{ title: "fine", quantity: 2, price: 8 }]);
  });
  it("reads a numeric id and a numeric code as text", () => {
    const rows = normalizeProducts({ data: [{ id: 7, code: 1001, name: "a", price: 3 }] }, NOW);
    expect(rows[0]).toMatchObject({ id: "7", code: "1001" });
  });
  it("keeps a link only when it is an http or https address", () => {
    const rows = normalizeProducts({ data: [{ code: "A", name: "a", price: 1, link: "javascript:alert(1)" }, { code: "B", name: "b", price: 1, link: "https://shop.example.test/p" }, { code: "C", name: "c", price: 1, link: "data:text/html,x" }] }, NOW);
    expect(rows.map((r) => r.link)).toEqual([undefined, "https://shop.example.test/p", undefined]);
  });
  it("says which rows it could not read, by code and by id, so a sheet is not marked gone for them", () => {
    const r = readProducts({ data: [{ code: "A", name: "a", price: 1 }, { code: "B", id: "p_b", name: "b", price: "12.5" }, { code: null, id: "p_c", name: "c", price: 1 }] }, NOW);
    expect(r.shape).toBe("list");
    expect(r.products.map((p) => p.code)).toEqual(["A"]);
    expect([...r.unreadable.codes]).toEqual(["B"]);
    expect([...r.unreadable.ids].sort()).toEqual(["p_b", "p_c"]);
    expect(r.dropped).toBe(2);
  });
  it("knows an answer that is not a list at all", () => {
    expect(readProducts({ error: "rate limited" }, NOW).shape).toBe("other");
    expect(readProducts("<html>", NOW).shape).toBe("other");
    expect(readProducts({ data: [] }, NOW).shape).toBe("list");
  });
  it("priceChanged does not throw on a sheet whose offers are not a list", () => {
    const prev = { code: "A", name: "a", price: 1, currency: "", offers: "oops", stockStatus: "x", fetchedAt: "" } as unknown as ProductSnapshot;
    const next = { code: "A", name: "a", price: 1, currency: "", offers: [], stockStatus: "x", fetchedAt: "" } as ProductSnapshot;
    expect(() => priceChanged(prev, next)).not.toThrow();
  });
});

describe("the client", () => {
  let oms: typeof import("@/server/integrations/oms");
  beforeEach(async () => {
    events.length = 0;
    state.config = { baseUrl: "https://oms.example.test" };
    vi.resetModules();
    oms = await import("@/server/integrations/oms");
  });
  const code = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>).code;

  it("refuses an order id that could leave the path, before any request", async () => {
    const f = vi.fn();
    for (const bad of ["..", ".", "", "a/b", "a?x=1", "a#b", "a b", "x".repeat(200)]) {
      expect(await code(oms.orderStatus("o", bad, { fetchImpl: f as never, resolve })), JSON.stringify(bad)).toBe("bad_id");
      expect(await code(oms.addOrderNote("o", bad, "n", "k", { fetchImpl: f as never, resolve })), JSON.stringify(bad)).toBe("bad_id");
    }
    expect(f).not.toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
  });
  it("still takes an ordinary id", async () => {
    const f = vi.fn(async () => ok({ number: "1" }));
    await oms.orderStatus("o", "ord_123-AB", { fetchImpl: f, resolve });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://oms.example.test/api/v1/orders/ord_123-AB");
  });
  it("an answer that is a 200 but not a product list is a failed read", async () => {
    const f = vi.fn(async () => ok({ error: "rate limited" }));
    expect(await code(oms.readProductList("o", { fetchImpl: f, resolve }))).toBe("bad_body");
    expect(events[0]).toMatchObject({ status: "FAILED", detail: "oms.bad_body" });
  });
  it("an empty list is a good read", async () => {
    const f = vi.fn(async () => ok({ data: [] }));
    const r = await oms.readProductList("o", { fetchImpl: f, resolve });
    expect(r.products).toEqual([]);
  });
  it("an answer bigger than the cap is refused, and the request is never cached", async () => {
    const f = vi.fn(async () => new Response("[" + "0,".repeat(3_000_000) + "0]", { status: 200 }));
    expect(await code(oms.readProductList("o", { fetchImpl: f, resolve }))).toBe("too_big");
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].cache).toBe("no-store");
  });
});

describe("the card's sentences for every code", () => {
  const dict = AR as Record<string, string>;
  it("any code, even an unforeseen one, gives a real sentence and never a raw key", () => {
    for (const c of ["http_400", "http_408", "http_409", "http_410", "http_422", "http_418", "http_502", "unknown", "not_connected", "bad_id", "too_big", "weird_code"]) {
      expect(dict[omsErrorKey(c)], c).toBeTruthy();
    }
  });
  it("the warning and its fix carry no emoji of their own (the notice adds them)", () => {
    expect(dict["oms.card.warn"]).not.toMatch(/⚠|🔧/u);
    expect(dict["oms.card.fix"]).not.toMatch(/⚠|🔧/u);
    expect(dict["oms.card.off"]).not.toMatch(/⚠|🔧/u);
  });
});
