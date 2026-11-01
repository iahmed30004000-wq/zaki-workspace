import { describe, expect, it } from "vitest";
import type { ReportsView } from "@/lib/manufacturing/production-view";
import { db, loginAs } from "./helpers";
import {
  completeOrder,
  costLot,
  featureOff,
  issue,
  issueOrder,
  makeMaterial,
  mfgWorld,
  micro,
  orderOk,
  patchMaterial,
  receiveOk,
  receiveUnpricedOk,
  recipeOk,
  reportCsvOf,
  reportsOf,
  returnOrder,
  reverse,
  type MfgWorld,
} from "./mfg-helpers";

/**
 * «تقارير»: stock valuation per material (with the formula), consumption per material per period, the cost of every order, and the low-stock list.
 * Read only. Quantities for whoever may view; money only for a holder of the cost, decided on the server, so the CSV (built from the same answer)
 * has no price column for anybody else.
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);
const report = async (spaceId: string, query = "") => {
  const res = await reportsOf(spaceId, query);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as unknown as ReportsView;
};

/** Flour in two lots (100 g at 0.010, then 100 g at 0.020), 50 boxes at 0.500, a jar recipe (30 g + 1 box), and one order of 5 jars issued and completed. */
async function plant(w: MfgWorld) {
  await loginAs(w.buyer.id);
  const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
  const box = await makeMaterial(w.space.id, { name: "علب", baseUnit: "علبة" });
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await receiveOk(flour, { qty: "100", unitCost: "0.01", receivedOn: day(2) });
  await receiveOk(flour, { qty: "100", unitCost: "0.02", receivedOn: day(1) });
  await receiveOk(box, { qty: "50", unitCost: "0.5" });
  await loginAs(w.keeper.id);
  const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "30" }, { materialId: box, qty: "1" }], { name: "برطمان", outputUnit: "برطمان" });
  const order = await orderOk(w.space.id, recipe.id, "5");
  expect((await issueOrder(order.id)).status).toBe(200);
  expect((await completeOrder(order.id, { actualQty: "5" })).status).toBe(200);
  return { flour, box, recipe: recipe.id, order: order.id };
}

describe("valuation", () => {
  it("is quantity × the weighted average with the formula, per material and in total, for a holder of the cost", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.buyer.id);
    const r = await report(w.space.id);
    expect(r.canCost).toBe(true);
    const flour = r.valuation.find((v) => v.materialId === p.flour)!;
    // 50 g of the newer lot are left: 1.000 over 50 g
    expect(flour).toMatchObject({ name: "طحين", qtyMicro: micro(50), unpricedMicro: 0, cost: { currency: "JOD", valueMinor: 1_000, averageText: "0.020", formula: { value: "1.000", qty: "50", average: "0.020" } } });
    const box = r.valuation.find((v) => v.materialId === p.box)!;
    expect(box).toMatchObject({ qtyMicro: micro(45), cost: { valueMinor: 22_500, averageText: "0.500" } });
    expect(r.valuationTotals).toEqual([{ currency: "JOD", valueMinor: 23_500 }]);
  });

  it("a person without the cost reads the quantities and the stock without a price, and not one money field", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.keeper.id);
    await receiveUnpricedOk(p.flour, { qty: "25" });
    for (const who of [w.keeper, w.viewer]) {
      await loginAs(who.id);
      const r = await report(w.space.id);
      expect(r.canCost).toBe(false);
      expect(r.valuationTotals).toBeNull();
      expect(r.valuation.find((v) => v.materialId === p.flour)).toMatchObject({ qtyMicro: micro(75), unpricedMicro: micro(25), cost: null });
      expect(JSON.stringify(r)).not.toMatch(/Minor|averageText|formula|perUnit|"currency"|unitText/);
    }
    // the unpriced 25 g are outside the average for the cost holder, and the value is of the priced 50 g
    await loginAs(w.buyer.id);
    expect((await report(w.space.id)).valuation.find((v) => v.materialId === p.flour)?.cost).toMatchObject({ valueMinor: 1_000, averageText: "0.020" });
  });
});

describe("consumption", () => {
  it("is what issues took in the period, net of what was reversed; the part by orders, and the cost from the lots it came from", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.keeper.id);
    expect((await issue(p.flour, "20")).status).toBe(201);
    const plain = await db.materialMovement.findFirstOrThrow({ where: { materialId: p.flour, kind: "ISSUE", reason: "صرف للتشغيل" } });
    await loginAs(w.buyer.id);
    let r = await report(w.space.id);
    const flour = r.consumption.find((c) => c.materialId === p.flour)!;
    // 150 g by the order (1.000 + 1.000) and 20 g by a plain issue at the average of that moment (20 x 0.020 = 0.400)
    expect(flour).toMatchObject({ qtyMicro: micro(170), viaOrdersMicro: micro(150), cost: { currency: "JOD", totalMinor: 2_400, incomplete: false } });
    expect(r.consumption.find((c) => c.materialId === p.box)).toMatchObject({ qtyMicro: micro(5), viaOrdersMicro: micro(5), cost: { totalMinor: 2_500 } });

    // the plain issue is reversed: it no longer counts
    await loginAs(w.keeper.id);
    expect((await reverse(plain.id)).status).toBe(201);
    await loginAs(w.buyer.id);
    r = await report(w.space.id);
    expect(r.consumption.find((c) => c.materialId === p.flour)).toMatchObject({ qtyMicro: micro(150), viaOrdersMicro: micro(150), cost: { totalMinor: 2_000 } });
    // nothing was consumed a year ago
    r = await report(w.space.id, "&from=2020-01-01&to=2020-01-31");
    expect(r.consumption).toEqual([]);
    expect(r.orders).toEqual([]);
    expect(r.period).toEqual({ from: "2020-01-01", to: "2020-01-31" });
    // …but the valuation is of now, whatever the period
    expect(r.valuation.length).toBe(2);
  });

  it("a piece without a price makes the cost incomplete, and the price filled later completes it", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    const lot = await receiveUnpricedOk(flour, { qty: "100" });
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }]);
    const order = await orderOk(w.space.id, recipe.id, "4");
    expect((await issueOrder(order.id)).status).toBe(200);
    await loginAs(w.buyer.id);
    let r = await report(w.space.id);
    expect(r.consumption[0]).toMatchObject({ qtyMicro: micro(40), cost: { totalMinor: 0, incomplete: true } });
    expect(r.orders[0]).toMatchObject({ seq: 1, costIncomplete: true });
    expect((await costLot(lot.lotId, { unitCost: "0.05", currency: "JOD" })).status).toBe(201);
    r = await report(w.space.id);
    // 40 g at 0.050
    expect(r.consumption[0]).toMatchObject({ cost: { currency: "JOD", totalMinor: 2_000, incomplete: false } });
    expect(r.orders[0]).toMatchObject({ costIncomplete: false, cost: { totals: [{ currency: "JOD", totalMinor: 2_000 }] } });
  });

  it("asks for a sane period", async () => {
    const w = await mfgWorld();
    await plant(w);
    await loginAs(w.buyer.id);
    expect(messages(await reportsOf(w.space.id, "&from=2026-02-31"))).toContain("mfg.e.date");
    expect(messages(await reportsOf(w.space.id, "&to=nonsense"))).toContain("mfg.e.date");
    expect(messages(await reportsOf(w.space.id, "&from=2026-10-10&to=2026-10-01"))).toContain("mfg.e.period_order");
    expect(messages(await reportsOf(w.space.id, "&from=2024-01-01&to=2026-01-01"))).toContain("mfg.e.period_long");
    expect((await reportsOf(w.space.id)).status).toBe(200);
  });
});

describe("the cost of the orders", () => {
  it("lists every order issued in the period with its exact cost and the cost of one unit", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.buyer.id);
    const r = await report(w.space.id);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toMatchObject({
      orderId: p.order,
      seq: 1,
      status: "COMPLETED",
      recipeName: "برطمان",
      plannedMicro: micro(5),
      actualMicro: micro(5),
      costIncomplete: false,
      cost: { totals: [{ currency: "JOD", totalMinor: 4_500, perUnitText: "0.900" }] },
    });
    // an order that was returned, and one still a draft, are not in it
    await loginAs(w.keeper.id);
    const draft = await orderOk(w.space.id, p.recipe, "1");
    const back = await orderOk(w.space.id, p.recipe, "1");
    expect((await issueOrder(back.id)).status).toBe(200);
    expect((await returnOrder(back.id)).status).toBe(200);
    await loginAs(w.buyer.id);
    expect((await report(w.space.id)).orders.map((o) => o.orderId)).toEqual([p.order]);
    void draft;
    // a keeper reads the same list without a cent
    await loginAs(w.keeper.id);
    const plain = await report(w.space.id);
    expect(plain.orders[0]).toMatchObject({ seq: 1, actualMicro: micro(5), cost: null });
  });
});

describe("low stock", () => {
  it("lists the materials that came down to their threshold, with the fix", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.keeper.id);
    expect((await patchMaterial(p.flour, { lowStock: "60" })).status).toBe(200);
    expect((await patchMaterial(p.box, { lowStock: "10" })).status).toBe(200);
    const r = await report(w.space.id);
    // flour: 50 g left against 60; boxes: 45 against 10
    expect(r.low).toEqual([{ materialId: p.flour, name: "طحين", baseUnit: "غرام", qtyMicro: micro(50), lowStockMicro: micro(60) }]);
    await loginAs(w.viewer.id);
    expect((await report(w.space.id)).low).toHaveLength(1);
  });
});

describe("the CSV is what the viewer reads", () => {
  it("a keeper's file has the quantities and no price column; a buyer's has the value and the average; both are formula-safe", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.buyer.id);
    expect((await patchMaterial(p.flour, { name: "=HYPERLINK(\"x\")" })).status).toBe(200);
    const priced = await reportCsvOf(w.space.id, "valuation");
    expect(priced.status).toBe(200);
    expect(priced.headers.get("content-type")).toContain("text/csv");
    expect(priced.text).toContain("1.000");
    expect(priced.text).toContain("0.020");
    expect(priced.text).toContain("'=HYPERLINK");
    expect(priced.text).not.toMatch(/(^|,|\n)=HYPERLINK/);

    await loginAs(w.keeper.id);
    for (const kind of ["valuation", "consumption", "orders", "low"]) {
      const file = await reportCsvOf(w.space.id, kind);
      expect(file.status, kind).toBe(200);
      expect(file.text, kind).not.toMatch(/JOD|دينار|0\.020|4\.500|1\.000|22\.500/);
    }
    const plain = await reportCsvOf(w.space.id, "valuation");
    expect(plain.text.split("\r\n")[0]!.split(",")).toHaveLength(4);
    expect((await reportCsvOf(w.space.id, "orders")).text).toContain("برطمان");
    expect((await reportCsvOf(w.space.id, "consumption")).text).toContain("150");
  });

  it("the buyer's orders file carries the total and the cost of one unit; an unknown report is refused", async () => {
    const w = await mfgWorld();
    await plant(w);
    await loginAs(w.buyer.id);
    const file = await reportCsvOf(w.space.id, "orders");
    expect(file.text).toContain("4.500");
    expect(file.text).toContain("0.900");
    expect((await reportCsvOf(w.space.id, "everything")).status).toBe(422);
    expect((await reportCsvOf(w.space.id, "")).status).toBe(422);
  });
});

describe("who reads the reports", () => {
  it("a viewer reads them; a partner, a person outside the space, a person without the capability and the switch off get 404", async () => {
    const w = await mfgWorld();
    await plant(w);
    await loginAs(w.viewer.id);
    expect((await reportsOf(w.space.id)).status).toBe(200);
    expect((await reportCsvOf(w.space.id, "low")).status).toBe(200);
    for (const who of [w.guest, w.plain, w.outsider]) {
      await loginAs(who.id);
      expect((await reportsOf(w.space.id)).status, who.name).toBe(404);
      expect((await reportCsvOf(w.space.id, "valuation")).status, who.name).toBe(404);
    }
    await loginAs(w.owner.id);
    expect((await reportsOf(w.space.id)).status).toBe(200);
    await featureOff(w.org.id);
    expect((await reportsOf(w.space.id)).status).toBe(404);
    expect((await reportCsvOf(w.space.id, "valuation")).status).toBe(404);
  });
});
