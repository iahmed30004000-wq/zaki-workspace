import { describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import {
  correctPrice,
  costLot,
  completeOrder,
  detailOf,
  featureOff,
  issueOrder,
  makeMaterial,
  mfgWorld,
  micro,
  orderOk,
  orderView,
  receiveOk,
  receiveUnpricedOk,
  recipeOk,
  reportsOf,
  reverse,
  type MfgWorld,
} from "./mfg-helpers";
import type { ReportsView } from "@/lib/manufacturing/production-view";

/**
 * «تصحيح سعر دفعة» (slice 3): a wrong late price can be corrected by a holder of `manufacturing.cost`, with a written reason. A correction is a NEW append-only
 * row that supersedes the price before it; the effective price of a lot is its latest one; the average, the valuation and the cost of open orders read it;
 * and orders already COMPLETED keep the cost they were frozen with. The audit log carries no price.
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

/** Flour in grams: 100 g priced 0.010 a gram (total 1.000), and a lot of 100 g received without a price and priced later at `latePrice` a gram. */
async function flourWith(w: MfgWorld, latePrice = "0.02") {
  await loginAs(w.buyer.id);
  const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
  await receiveOk(flour, { qty: "100", unitCost: "0.01", receivedOn: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) });
  await loginAs(w.keeper.id);
  const late = await receiveUnpricedOk(flour, { qty: "100" });
  await loginAs(w.buyer.id);
  expect((await costLot(late.lotId, { unitCost: latePrice, currency: "JOD" })).status).toBe(201);
  return { flour, lotId: late.lotId };
}

describe("correcting a late price", () => {
  it("a cost holder posts a correction: a new row with its reason, the first price untouched, and the price in force is the new one", async () => {
    const w = await mfgWorld();
    const { flour, lotId } = await flourWith(w, "0.02"); // 100 g x 0.02 = 2.000
    const before = await db.materialCosting.findUniqueOrThrow({ where: { lotId } });
    const done = await correctPrice(lotId, { unitCost: "0.04", currency: "JOD", reason: "الفاتورة 0.04 مش 0.02" });
    expect(done.status, JSON.stringify(done.json)).toBe(201);
    expect(done.json).toMatchObject({ seq: 1 });
    // the first price is exactly what it was; the correction is a separate row with who, when and why
    expect(await db.materialCosting.findUniqueOrThrow({ where: { lotId } })).toEqual(before);
    const row = await db.materialPriceCorrection.findFirstOrThrow({ where: { lotId } });
    expect(row).toMatchObject({ seq: 1, unitCostMinor: 40n, totalCostMinor: 4_000n, currency: "JOD", reason: "الفاتورة 0.04 مش 0.02", createdById: w.buyer.id, materialId: flour });
    // the lot in force costs 4.000 now: the average is over 200 g worth 1.000 + 4.000
    const seen = await detailOf(flour);
    expect(seen.cost).toMatchObject({ valueMinor: 5_000, averageText: "0.025" });
    const lot = seen.lots.find((l) => l.id === lotId)!;
    expect(lot).toMatchObject({ cost: { currency: "JOD", unitCostMinor: 40, totalCostMinor: 4_000 }, correctionCount: 1, canCorrectPrice: true });
    // the history: the first price, then the correction with its reason; the newest is «in force»
    expect(lot.priceHistory.map((s) => [s.seq, s.unitCostMinor, s.totalCostMinor, s.reason, s.current, s.by])).toEqual([
      [0, 20, 2_000, null, false, "Buyer"],
      [1, 40, 4_000, "الفاتورة 0.04 مش 0.02", true, "Buyer"],
    ]);
    // the valuation report reads the same price
    const report = (await reportsOf(w.space.id)).json as unknown as ReportsView;
    expect(report.valuation.find((v) => v.materialId === flour)?.cost).toMatchObject({ valueMinor: 5_000 });
    expect(report.valuationTotals).toEqual([{ currency: "JOD", valueMinor: 5_000 }]);
  });

  it("a second correction supersedes the first: the latest one is the price, and every price stays in the history", async () => {
    const w = await mfgWorld();
    const { flour, lotId } = await flourWith(w, "0.02");
    expect((await correctPrice(lotId, { unitCost: "0.04" })).status).toBe(201);
    const second = await correctPrice(lotId, { unitCost: "0.03", reason: "رجعنا للسعر الصح" });
    expect(second.status, JSON.stringify(second.json)).toBe(201);
    expect(second.json).toMatchObject({ seq: 2 });
    const lot = (await detailOf(flour)).lots.find((l) => l.id === lotId)!;
    expect(lot.cost).toMatchObject({ unitCostMinor: 30, totalCostMinor: 3_000 });
    expect(lot.priceHistory.map((s) => [s.seq, s.unitCostMinor, s.current])).toEqual([
      [0, 20, false],
      [1, 40, false],
      [2, 30, true],
    ]);
    expect((await detailOf(flour)).cost).toMatchObject({ valueMinor: 4_000 });
  });

  it("the value of what is left of a lot already partly used follows the new price", async () => {
    const w = await mfgWorld();
    const { flour, lotId } = await flourWith(w, "0.02"); // the 100 g lot: 2.000
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }], { name: "برطمان", outputUnit: "برطمان" });
    // 15 jars need 150 g: the older priced lot first (100 g), then 50 g of the late-priced one
    const order = await orderOk(w.space.id, recipe.id, "15");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect((await detailOf(flour)).cost).toMatchObject({ valueMinor: 1_000 }); // 50 g left at 0.02
    expect((await correctPrice(lotId, { unitCost: "0.06" })).status).toBe(201);
    // 50 g left of a lot whose total is now 6.000: 3.000
    expect((await detailOf(flour)).cost).toMatchObject({ valueMinor: 3_000, averageText: "0.060" });
  });

  it("the reason is mandatory and the price must be a real, different one in the lot's own currency", async () => {
    const w = await mfgWorld();
    const { lotId } = await flourWith(w, "0.02");
    expect(messages(await correctPrice(lotId, { reason: "" }))).toContain("mfg.e.reason");
    expect(messages(await correctPrice(lotId, { reason: "x" }))).toContain("mfg.e.reason");
    expect((await correctPrice(lotId, { reason: undefined })).status).toBe(422);
    expect(messages(await correctPrice(lotId, { unitCost: "abc" }))).toContain("mfg.e.cost");
    expect(messages(await correctPrice(lotId, { unitCost: "0.0201" }))).toContain("mfg.e.cost");
    expect(messages(await correctPrice(lotId, { currency: "USD" }))).toContain("mfg.e.currency_mismatch");
    expect(messages(await correctPrice(lotId, { unitCost: "0.02" }))).toContain("mfg.e.correction_same");
    expect(await db.materialPriceCorrection.count({ where: { lotId } })).toBe(0);
    // after a correction, the same price again is refused too (against the price in force, not the first one)
    expect((await correctPrice(lotId, { unitCost: "0.05" })).status).toBe(201);
    expect(messages(await correctPrice(lotId, { unitCost: "0.05" }))).toContain("mfg.e.correction_same");
    expect((await correctPrice(lotId, { unitCost: "0.02" })).status).toBe(201);
  });

  it("only a lot that was received without a price AND has been priced is corrected", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    const priced = await receiveOk(id, { qty: "10", unitCost: "2" });
    expect(messages(await correctPrice(priced.lotId))).toContain("mfg.e.correction_not_priced");
    await loginAs(w.keeper.id);
    const pending = await receiveUnpricedOk(id, { qty: "10" });
    await loginAs(w.buyer.id);
    // not priced yet: the first price comes first
    expect(messages(await correctPrice(pending.lotId))).toContain("mfg.e.correction_not_priced");
    expect(await db.materialPriceCorrection.count({ where: { materialId: id } })).toBe(0);
    // a receipt that was taken back is not corrected
    expect((await costLot(pending.lotId, { unitCost: "3", currency: "JOD" })).status).toBe(201);
    const move = await db.materialMovement.findFirstOrThrow({ where: { lotId: pending.lotId, kind: "RECEIVE" } });
    expect((await reverse(move.id)).status).toBe(201);
    expect(messages(await correctPrice(pending.lotId))).toContain("mfg.e.costing_reversed");
  });

  it("only a holder of the cost may; a keeper, a viewer, a person outside the space and a partner may not, and the keeper sees no price and no history", async () => {
    const w = await mfgWorld();
    const { flour, lotId } = await flourWith(w, "0.02");
    expect((await correctPrice(lotId, { unitCost: "0.03" })).status).toBe(201);
    await loginAs(w.keeper.id);
    const denied = await correctPrice(lotId, { unitCost: "0.09" });
    expect(denied.status).toBe(403);
    expect(denied.json?.["message"]).toBe("mfg.cost_denied");
    await loginAs(w.viewer.id);
    expect((await correctPrice(lotId, { unitCost: "0.09" })).status).toBe(403);
    await loginAs(w.guest.id);
    expect((await correctPrice(lotId, { unitCost: "0.09" })).status).toBe(404);
    await loginAs(w.plain.id);
    expect((await correctPrice(lotId, { unitCost: "0.09" })).status).toBe(404);
    await loginAs(w.outsider.id);
    expect((await correctPrice(lotId, { unitCost: "0.09" })).status).toBe(404);
    expect(await db.materialPriceCorrection.count({ where: { lotId } })).toBe(1);
    // what the keeper reads: that it was corrected (a count), never a price, never the history
    await loginAs(w.keeper.id);
    const lot = (await detailOf(flour)).lots.find((l) => l.id === lotId)!;
    expect(lot).toMatchObject({ cost: null, correctionCount: 1, priceHistory: [], canCorrectPrice: false });
    expect(JSON.stringify(lot)).not.toMatch(/السعر كان غلط/);
    // the owner reads silently and, holding every capability, may correct
    await loginAs(w.owner.id);
    expect((await correctPrice(lotId, { unitCost: "0.09" })).status).toBe(201);
  });

  it("the audit log says which lot and which correction, never a price and never the reason's words", async () => {
    const w = await mfgWorld();
    const { lotId } = await flourWith(w, "0.02");
    const done = await correctPrice(lotId, { unitCost: "0.045", reason: "كتبنا 0.0456 وهاد صح" });
    expect(done.status, JSON.stringify(done.json)).toBe(201);
    const line = await db.auditLog.findFirstOrThrow({ where: { action: "mfg.lot_price_corrected", target: lotId } });
    expect(line.meta).toEqual({ materialId: expect.any(String), seq: 1 });
    // nothing but the lot's material and the number of the correction: no amount, no key that could hold one, none of the reason's words
    expect(Object.keys(line.meta as object).sort()).toEqual(["materialId", "seq"]);
  });

  it("is a 404 for everybody while the switch is off", async () => {
    const w = await mfgWorld();
    const { lotId } = await flourWith(w, "0.02");
    await featureOff(w.org.id);
    expect((await correctPrice(lotId)).status).toBe(404);
    await loginAs(w.owner.id);
    expect((await correctPrice(lotId)).status).toBe(404);
    expect(await db.materialPriceCorrection.count({ where: { lotId } })).toBe(0);
  });

  it("two corrections at the same moment are both written, one after the other, numbered 1 and 2", async () => {
    const w = await mfgWorld();
    const { lotId } = await flourWith(w, "0.02");
    const [a, b] = await Promise.all([correctPrice(lotId, { unitCost: "0.03" }), correctPrice(lotId, { unitCost: "0.04" })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const rows = await db.materialPriceCorrection.findMany({ where: { lotId }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
  });
});

describe("what is finished is not re-priced", () => {
  it("a completed order keeps its cost (frozen); an open order follows the new price; ⚠️ the screen says the past is not re-priced", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    await loginAs(w.keeper.id);
    const late = await receiveUnpricedOk(flour, { qty: "100" });
    await loginAs(w.buyer.id);
    expect((await costLot(late.lotId, { unitCost: "0.02", currency: "JOD" })).status).toBe(201);
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }], { name: "برطمان", outputUnit: "برطمان" });

    const first = await orderOk(w.space.id, recipe.id, "5"); // 50 g
    expect((await issueOrder(first.id)).status).toBe(200);
    expect((await completeOrder(first.id, { actualQty: "5" })).status).toBe(200);
    let seen = await orderView(w.space.id, first.id);
    expect(seen.cost).toMatchObject({ frozen: true, totals: [{ currency: "JOD", totalMinor: 1_000 }] });
    expect(await db.productionOrderCostLine.count({ where: { orderId: first.id } })).toBe(1);

    const second = await orderOk(w.space.id, recipe.id, "5"); // the other 50 g
    expect((await issueOrder(second.id)).status).toBe(200);
    expect((await orderView(w.space.id, second.id)).cost).toMatchObject({ frozen: false, totals: [{ totalMinor: 1_000 }] });

    // the price was wrong: 0.04, not 0.02
    expect((await correctPrice(late.lotId, { unitCost: "0.04" })).status).toBe(201);
    seen = await orderView(w.space.id, first.id);
    expect(seen.cost).toMatchObject({ frozen: true, totals: [{ totalMinor: 1_000 }] });
    expect(seen.cost?.lines[0]?.pieces[0]).toMatchObject({ unitText: "0.020", amountMinor: 1_000 }); // the formula of the past order is the past price
    // the open order reads the price in force
    expect((await orderView(w.space.id, second.id)).cost).toMatchObject({ frozen: false, totals: [{ totalMinor: 2_000 }] });
    // completing it freezes it at the new price; a later correction does not move it
    expect((await completeOrder(second.id, { actualQty: "5" })).status).toBe(200);
    expect((await orderView(w.space.id, second.id)).cost).toMatchObject({ frozen: true, totals: [{ totalMinor: 2_000 }] });
    expect((await correctPrice(late.lotId, { unitCost: "0.09" })).status).toBe(201);
    expect((await orderView(w.space.id, first.id)).cost?.totals[0]?.totalMinor).toBe(1_000);
    expect((await orderView(w.space.id, second.id)).cost?.totals[0]?.totalMinor).toBe(2_000);
    // the ledger itself was never rewritten
    const issues = await db.materialMovement.findMany({ where: { materialId: flour, kind: "ISSUE" }, orderBy: { createdAt: "asc" } });
    expect(issues.map((m) => m.valueMinor)).toEqual([-1_000n, -1_000n]);
  });

  it("an order completed with an incomplete cost is frozen the moment its last missing price arrives, and a correction then leaves it alone", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    const pending = await receiveUnpricedOk(flour, { qty: "100" });
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }], { name: "برطمان", outputUnit: "برطمان" });
    const order = await orderOk(w.space.id, recipe.id, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect((await completeOrder(order.id, { actualQty: "5" })).status).toBe(200);
    await loginAs(w.buyer.id);
    let seen = await orderView(w.space.id, order.id);
    expect(seen).toMatchObject({ costIncomplete: true });
    expect(seen.cost).toMatchObject({ frozen: false });
    expect(await db.productionOrderCostLine.count({ where: { orderId: order.id } })).toBe(0);
    // the first price completes it, and freezes it
    expect((await costLot(pending.lotId, { unitCost: "0.03", currency: "JOD" })).status).toBe(201);
    seen = await orderView(w.space.id, order.id);
    expect(seen).toMatchObject({ costIncomplete: false });
    expect(seen.cost).toMatchObject({ frozen: true, totals: [{ totalMinor: 1_500 }] });
    expect((await correctPrice(pending.lotId, { unitCost: "0.09" })).status).toBe(201);
    expect((await orderView(w.space.id, order.id)).cost).toMatchObject({ frozen: true, totals: [{ totalMinor: 1_500 }] });
  });

  it("an order that is complete but was never frozen (one completed before this release) is frozen by the correction, before the price moves", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    await loginAs(w.keeper.id);
    const late = await receiveUnpricedOk(flour, { qty: "100" });
    await loginAs(w.buyer.id);
    expect((await costLot(late.lotId, { unitCost: "0.02", currency: "JOD" })).status).toBe(201);
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }], { name: "برطمان", outputUnit: "برطمان" });
    const order = await orderOk(w.space.id, recipe.id, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect((await completeOrder(order.id, { actualQty: "5" })).status).toBe(200);
    // make it look like a legacy order: no frozen rows (the triggers are switched off for this one statement, as only the owner of the database can)
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM "ProductionOrderCostLine" WHERE "orderId" = ${order.id}`;
    });
    expect(await db.productionOrderCostLine.count({ where: { orderId: order.id } })).toBe(0);
    expect((await orderView(w.space.id, order.id)).cost).toMatchObject({ frozen: false, totals: [{ totalMinor: 1_000 }] });
    expect((await correctPrice(late.lotId, { unitCost: "0.08" })).status).toBe(201);
    // frozen at the price it had when the correction arrived
    expect((await orderView(w.space.id, order.id)).cost).toMatchObject({ frozen: true, totals: [{ totalMinor: 1_000 }] });
  });
});

describe("the database keeps the corrections honest", () => {
  it("a correction is never changed or removed, is numbered without a gap, keeps the currency, and exists only for a lot priced late", async () => {
    const w = await mfgWorld();
    const { flour, lotId } = await flourWith(w, "0.02");
    expect((await correctPrice(lotId, { unitCost: "0.03" })).status).toBe(201);
    const row = await db.materialPriceCorrection.findFirstOrThrow({ where: { lotId } });
    await expect(db.materialPriceCorrection.update({ where: { id: row.id }, data: { totalCostMinor: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.materialPriceCorrection.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    const base = { orgId: w.org.id, workspaceId: w.space.id, materialId: flour, lotId, unitCostMinor: 1n, totalCostMinor: 100n, currency: "JOD", reason: "تجربة", createdById: w.buyer.id };
    await expect(db.materialPriceCorrection.create({ data: { ...base, seq: 5 } })).rejects.toThrow(/without a gap/);
    await expect(db.materialPriceCorrection.create({ data: { ...base, seq: 2, currency: "USD" } })).rejects.toThrow(/currency/);
    await expect(db.materialPriceCorrection.create({ data: { ...base, seq: 2, reason: " " } })).rejects.toThrow();
    await expect(db.materialPriceCorrection.create({ data: { ...base, seq: 2, totalCostMinor: -1n } })).rejects.toThrow();
    // a lot that came with its price takes none, whoever asks
    await loginAs(w.buyer.id);
    const priced = await receiveOk(flour, { qty: "10", unitCost: "1" });
    await expect(db.materialPriceCorrection.create({ data: { ...base, lotId: priced.lotId, seq: 1 } })).rejects.toThrow(/received without one/);
    // a lot that has not been priced yet takes none either
    await loginAs(w.keeper.id);
    const pending = await receiveUnpricedOk(flour, { qty: "10" });
    await expect(db.materialPriceCorrection.create({ data: { ...base, lotId: pending.lotId, seq: 1 } })).rejects.toThrow(/first price/);
    expect(await db.materialPriceCorrection.count({ where: { lotId } })).toBe(1);
  });

  it("an order's frozen cost is written once, only for a completed order, and never changed", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    await receiveOk(flour, { qty: "100", unitCost: "0.01" });
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }], { name: "برطمان", outputUnit: "برطمان" });
    const order = await orderOk(w.space.id, recipe.id, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    const link = await db.productionOrderMovement.findFirstOrThrow({ where: { orderId: order.id } });
    const base = { orderId: order.id, lineId: link.lineId, movementId: link.movementId, qtyMicro: BigInt(micro(50)), valueMinor: 500n, currency: "JOD", position: 0 };
    await expect(db.productionOrderCostLine.create({ data: base })).rejects.toThrow(/only when the order is completed/);
    expect((await completeOrder(order.id, { actualQty: "5" })).status).toBe(200);
    const frozen = await db.productionOrderCostLine.findFirstOrThrow({ where: { orderId: order.id } });
    expect(frozen).toMatchObject({ valueMinor: 500n, currency: "JOD", qtyMicro: BigInt(micro(50)) });
    await expect(db.productionOrderCostLine.update({ where: { id: frozen.id }, data: { valueMinor: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.productionOrderCostLine.delete({ where: { id: frozen.id } })).rejects.toThrow(/append-only/);
    await expect(db.productionOrderCostLine.create({ data: base })).rejects.toThrow();
  });

  it("removing the space still works with corrections and frozen costs in it (the cascade is the one delete allowed)", async () => {
    const w = await mfgWorld();
    const { lotId } = await flourWith(w, "0.02");
    expect((await correctPrice(lotId, { unitCost: "0.05" })).status).toBe(201);
    await db.workspace.delete({ where: { id: w.space.id } });
    expect(await db.materialPriceCorrection.count({ where: { lotId } })).toBe(0);
  });
});
