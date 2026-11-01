import { describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import {
  archiveRecipe,
  completeOrder,
  costLot,
  correctPrice,
  detailOf,
  enableFinished,
  featureOff,
  issueOrder,
  makeMaterial,
  mfgWorld,
  micro,
  newVersion,
  orderOk,
  orderView,
  patchMaterial,
  receiveOk,
  receiveUnpricedOk,
  recipeOk,
  recipesOf,
  returnOrder,
  reverse,
  type MfgWorld,
} from "./mfg-helpers";

/**
 * Finished goods enter stock (slice 3). A recipe whose owner picked «سجّل المنتج النهائي بالمخزون» points at a Material (the finished item). Completing an
 * order of it receives the real output into that material as ONE lot and a RECEIVE movement linked to the order, carrying the order's whole cost:
 * unit cost = total ÷ real output, rounded half-up once. A cost that is incomplete makes the finished lot «بدون سعر» (never invented). Reversing a
 * completed order is NOT part of this (a mistake in the output is a reversal of its receipt).
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

/** Flour: 1000 g in a priced lot at 0.010 a gram; recipe «برطمان»: 30 g per jar. The keeper runs the recipes and orders, the buyer prices. */
async function plant(w: MfgWorld, opts: { stocked?: boolean } = {}) {
  await loginAs(w.buyer.id);
  const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
  const lot = await receiveOk(flour, { qty: "1000", unitCost: "0.01" });
  await loginAs(w.keeper.id);
  const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "30" }], { name: "برطمان", outputUnit: "برطمان" });
  let finished: string | null = null;
  if (opts.stocked !== false) {
    const on = await enableFinished(recipe.id);
    expect(on.status, JSON.stringify(on.json)).toBe(201);
    finished = (on.json as unknown as { materialId: string }).materialId;
  }
  return { flour, lot: lot.lotId, recipe: recipe.id, finished };
}

async function runOrder(w: MfgWorld, p: { recipe: string }, planned: string, actual: string) {
  await loginAs(w.keeper.id);
  const order = await orderOk(w.space.id, p.recipe, planned);
  expect((await issueOrder(order.id)).status).toBe(200);
  const done = await completeOrder(order.id, { actualQty: actual });
  expect(done.status, JSON.stringify(done.json)).toBe(200);
  return order.id;
}

describe("keeping the finished item in stock", () => {
  it("makes the finished item a material of the space (once), named like the recipe, in the recipe's output unit, and asking again changes nothing", async () => {
    const w = await mfgWorld();
    const p = await plant(w, { stocked: false });
    expect((await recipesOf(w.space.id)).recipes[0]).toMatchObject({ finished: null, canStock: true });
    const before = await db.material.count({ where: { workspaceId: w.space.id } });
    const on = await enableFinished(p.recipe);
    expect(on.status).toBe(201);
    expect(on.json).toMatchObject({ created: true });
    const materialId = (on.json as unknown as { materialId: string }).materialId;
    const material = await db.material.findUniqueOrThrow({ where: { id: materialId } });
    expect(material).toMatchObject({ name: "برطمان", baseUnit: "برطمان", workspaceId: w.space.id, currency: null, createdById: w.keeper.id });
    expect(await db.material.count({ where: { workspaceId: w.space.id } })).toBe(before + 1);
    expect((await db.recipe.findUniqueOrThrow({ where: { id: p.recipe } })).outputMaterialId).toBe(materialId);
    const again = await enableFinished(p.recipe);
    expect(again.json).toMatchObject({ materialId, created: false });
    expect(await db.material.count({ where: { workspaceId: w.space.id } })).toBe(before + 1);
    expect((await recipesOf(w.space.id)).recipes[0]).toMatchObject({ finished: { materialId, name: "برطمان" }, canStock: false });
    const line = await db.auditLog.findFirstOrThrow({ where: { action: "mfg.finished_stock_on", target: p.recipe } });
    expect(Object.keys(line.meta as object).sort()).toEqual(["materialId", "name"]);
    // two at once make one material
    const other = await recipeOk(w.space.id, [{ materialId: p.flour, qty: "10" }], { name: "منتج ثاني", outputUnit: "قطعة" });
    const both = await Promise.all([enableFinished(other.id), enableFinished(other.id)]);
    expect(new Set(both.map((r) => (r.json as unknown as { materialId: string }).materialId)).size).toBe(1);
    expect(await db.material.count({ where: { workspaceId: w.space.id, name: "منتج ثاني" } })).toBe(1);
  });

  it("needs manufacturing.edit, an open recipe and the switch; a partner and an outsider never learn of it", async () => {
    const w = await mfgWorld();
    const p = await plant(w, { stocked: false });
    await loginAs(w.viewer.id);
    expect((await enableFinished(p.recipe)).status).toBe(403);
    await loginAs(w.guest.id);
    expect((await enableFinished(p.recipe)).status).toBe(404);
    await loginAs(w.plain.id);
    expect((await enableFinished(p.recipe)).status).toBe(404);
    await loginAs(w.outsider.id);
    expect((await enableFinished(p.recipe)).status).toBe(404);
    await loginAs(w.keeper.id);
    expect((await archiveRecipe(p.recipe, true)).status).toBe(200);
    expect(messages(await enableFinished(p.recipe))).toContain("mfg.e.recipe_archived");
    expect((await archiveRecipe(p.recipe, false)).status).toBe(200);
    await featureOff(w.org.id);
    expect((await enableFinished(p.recipe)).status).toBe(404);
    expect((await db.recipe.findUniqueOrThrow({ where: { id: p.recipe } })).outputMaterialId).toBeNull();
  });

  it("the output unit of such a recipe is the material's base unit, so a new version may not change it", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const lines = [{ materialId: p.flour, qty: "35" }];
    expect(messages(await newVersion(p.recipe, lines, { name: "برطمان", outputUnit: "علبة" }))).toContain("mfg.e.output_unit_locked");
    expect((await newVersion(p.recipe, lines, { name: "برطمان كبير", outputUnit: "برطمان" })).status).toBe(201);
  });
});

describe("completing an order puts its output into stock", () => {
  it("receives the real output as one lot and one RECEIVE movement linked to the order, carrying the whole cost; the unit cost is total ÷ output, rounded once", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    // 5 jars take 150 g at 0.010 = 1.500; 7 came out: 1500 minor / 7 = 214.28.. -> 214 a jar; the lot carries the whole 1.500
    const orderId = await runOrder(w, p, "5", "7");
    const order = await db.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.outputLotId).not.toBeNull();
    const lot = await db.materialLot.findUniqueOrThrow({ where: { id: order.outputLotId! } });
    expect(lot).toMatchObject({ materialId: p.finished, qtyMicro: BigInt(micro(7)), enteredQtyMicro: BigInt(micro(7)), enteredUnitLabel: "برطمان", unitCostMinor: 214n, totalCostMinor: 1_500n, currency: "JOD", costPending: false, createdById: w.keeper.id, supplierId: null });
    expect(lot.proofFileId).toBeNull();
    expect(lot.proofNote).toContain(String(order.seq));
    const receive = await db.materialMovement.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(receive).toMatchObject({ kind: "RECEIVE", materialId: p.finished, qtyMicro: BigInt(micro(7)), valueMinor: 1_500n });
    // the finished material now holds them
    await loginAs(w.buyer.id);
    const seen = await detailOf(p.finished!);
    expect(seen).toMatchObject({ balanceMicro: micro(7), unpricedMicro: 0, cost: { currency: "JOD", valueMinor: 1_500 } });
    expect(seen.lots[0]).toMatchObject({ qtyMicro: micro(7), cost: { unitCostMinor: 214, totalCostMinor: 1_500 }, costPending: false });
    // what left stock as flour entered it as jars: the value moved, none was made or lost
    const flour = await detailOf(p.flour);
    expect(flour.cost?.valueMinor).toBe(10_000 - 1_500);
    expect((await db.material.findUniqueOrThrow({ where: { id: p.finished! } })).currency).toBe("JOD");
    // the order's own cost, frozen, is the same 1.500; and the order says where its output went (a quantity and a flag, no price)
    const view = await orderView(w.space.id, orderId);
    expect(view.cost).toMatchObject({ frozen: true, totals: [{ currency: "JOD", totalMinor: 1_500 }] });
    expect(view.finished).toEqual({ materialId: p.finished, materialName: "برطمان", qtyMicro: micro(7), costPending: false });
    expect(view.recipeStocked).toBe(true);
  });

  it("the unit cost rounds half up, once: a half goes up, and the lot's total is never recomputed from it", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    // 2 jars take 60 g = 0.600 JOD = 600 minor; 1.5 jars out -> 400 minor a jar exactly
    const exact = await runOrder(w, p, "2", "1.5");
    const a = await db.materialLot.findFirstOrThrow({ where: { producedBy: { id: exact } } });
    expect(a).toMatchObject({ unitCostMinor: 400n, totalCostMinor: 600n });
    // 1 jar takes 30 g = 300 minor; 4 out -> 75
    const second = await runOrder(w, p, "1", "4");
    expect((await db.materialLot.findFirstOrThrow({ where: { producedBy: { id: second } } }))).toMatchObject({ unitCostMinor: 75n, totalCostMinor: 300n });
    // 3 jars take 90 g = 900 minor; 7 out -> 128.57 -> 129 a jar, and the lot still carries 900, not 7 x 129 = 903
    const third = await runOrder(w, p, "3", "7");
    expect((await db.materialLot.findFirstOrThrow({ where: { producedBy: { id: third } } }))).toMatchObject({ unitCostMinor: 129n, totalCostMinor: 900n });
    // the book of the finished item: the sum of the whole costs
    await loginAs(w.buyer.id);
    expect((await detailOf(p.finished!)).cost?.valueMinor).toBe(600 + 300 + 900);
  });

  it("a recipe that keeps no finished stock completes exactly as before: no lot, no movement", async () => {
    const w = await mfgWorld();
    const p = await plant(w, { stocked: false });
    const orderId = await runOrder(w, p, "5", "5");
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: orderId } })).outputLotId).toBeNull();
    expect(await db.materialLot.count({ where: { workspaceId: w.space.id, proofNote: { contains: "ناتج أمر تصنيع" } } })).toBe(0);
    await loginAs(w.buyer.id);
    const view = await orderView(w.space.id, orderId);
    expect(view.finished).toBeNull();
    expect(view.recipeStocked).toBe(false);
  });

  it("an incomplete cost makes the finished lot «بدون سعر»: flagged, value 0, never invented; the cost holder prices it, and may correct that price", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    await receiveUnpricedOk(flour, { qty: "1000" });
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "30" }], { name: "برطمان", outputUnit: "برطمان" });
    const on = await enableFinished(recipe.id);
    const finished = (on.json as unknown as { materialId: string }).materialId;
    const orderId = await runOrder(w, { recipe: recipe.id }, "5", "5");
    const order = await db.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    const lot = await db.materialLot.findUniqueOrThrow({ where: { id: order.outputLotId! } });
    expect(lot).toMatchObject({ costPending: true, unitCostMinor: 0n, totalCostMinor: 0n, currency: "XXX", qtyMicro: BigInt(micro(5)) });
    expect((await db.materialMovement.findFirstOrThrow({ where: { lotId: lot.id } })).valueMinor).toBe(0n);
    expect((await db.material.findUniqueOrThrow({ where: { id: finished } })).currency).toBeNull();
    // the keeper reads that it is waiting for a price, never a price
    const keeperView = await orderView(w.space.id, orderId);
    expect(keeperView.finished).toMatchObject({ qtyMicro: micro(5), costPending: true });
    expect(keeperView.cost).toBeNull();
    const keeperMaterial = await detailOf(finished);
    expect(keeperMaterial).toMatchObject({ balanceMicro: micro(5), unpricedMicro: micro(5), cost: null });
    expect(keeperMaterial.lots[0]).toMatchObject({ costPending: true, cost: null, canFillCost: false });
    // the buyer prices the finished lot like any other pending lot (unit cost of ONE jar), and may correct it later
    await loginAs(w.buyer.id);
    expect((await detailOf(finished)).lots[0]).toMatchObject({ canFillCost: true });
    expect((await costLot(lot.id, { unitCost: "0.3", currency: "JOD" })).status).toBe(201);
    expect((await detailOf(finished)).cost).toMatchObject({ valueMinor: 1_500 });
    expect((await correctPrice(lot.id, { unitCost: "0.4" })).status).toBe(201);
    expect((await detailOf(finished)).cost).toMatchObject({ valueMinor: 2_000 });
    expect((await orderView(w.space.id, orderId)).finished).toMatchObject({ costPending: false });
  });

  it("a cost in two currencies cannot make one price, so the finished lot waits for one too", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    const box = await makeMaterial(w.space.id, { name: "علب", baseUnit: "علبة" });
    await receiveOk(flour, { qty: "1000", unitCost: "0.01", currency: "JOD" });
    await receiveOk(box, { qty: "100", unitCost: "0.5", currency: "USD" });
    await loginAs(w.keeper.id);
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "30" }, { materialId: box, qty: "1" }], { name: "برطمان", outputUnit: "برطمان" });
    expect((await enableFinished(recipe.id)).status).toBe(201);
    const orderId = await runOrder(w, { recipe: recipe.id }, "5", "5");
    const order = await db.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(await db.materialLot.findUniqueOrThrow({ where: { id: order.outputLotId! } })).toMatchObject({ costPending: true, totalCostMinor: 0n });
    // the order's own cost is complete (two currencies, each exact) and frozen
    await loginAs(w.buyer.id);
    const view = await orderView(w.space.id, orderId);
    expect(view.cost?.frozen).toBe(true);
    expect(view.cost?.totals.map((t) => t.currency)).toEqual(["JOD", "USD"]);
  });

  it("a finished item that was archived blocks the completion until it is restored, and nothing half-happens", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.keeper.id);
    const order = await orderOk(w.space.id, p.recipe, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect((await patchMaterial(p.finished!, { archived: true })).status).toBe(200);
    const refused = await completeOrder(order.id, { actualQty: "5" });
    expect(refused.status).toBe(422);
    expect(messages(refused)).toContain("mfg.e.finished_archived");
    const row = await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ status: "ISSUED", outputLotId: null });
    expect(await db.materialLot.count({ where: { materialId: p.finished! } })).toBe(0);
    expect((await patchMaterial(p.finished!, { archived: false })).status).toBe(200);
    expect((await completeOrder(order.id, { actualQty: "5" })).status).toBe(200);
    expect(await db.materialLot.count({ where: { materialId: p.finished! } })).toBe(1);
  });

  it("a completed order is not reversed (out of scope); a mistake in the output is a reversal of the receipt, with its reason", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const orderId = await runOrder(w, p, "5", "5");
    expect(messages(await returnOrder(orderId))).toContain("mfg.e.order_state");
    // the receipt can be reversed like any other while the jars are still there
    const order = await db.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    const receive = await db.materialMovement.findFirstOrThrow({ where: { lotId: order.outputLotId!, kind: "RECEIVE" } });
    const done = await reverse(receive.id, "عددنا غلط، الناتج كان أقل");
    expect(done.status, JSON.stringify(done.json)).toBe(201);
    await loginAs(w.buyer.id);
    expect((await detailOf(p.finished!)).balanceMicro).toBe(0);
  });

  it("the finished item is an ordinary material: its stock can be an ingredient of another recipe", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await runOrder(w, p, "10", "10"); // 10 jars in stock
    await loginAs(w.keeper.id);
    const carton = await recipeOk(w.space.id, [{ materialId: p.finished!, qty: "6" }], { name: "كرتونة برطمانات", outputUnit: "كرتونة" });
    const order = await orderOk(w.space.id, carton.id, "1");
    expect((await issueOrder(order.id)).status).toBe(200);
    await loginAs(w.buyer.id);
    const seen = await detailOf(p.finished!);
    expect(seen.balanceMicro).toBe(micro(4));
    // 6 of 10 jars at 300 minor each = 1.800 went into the carton, 1.200 is left
    expect(seen.cost?.valueMinor).toBe(1_200);
    expect((await orderView(w.space.id, order.id)).cost?.totals).toEqual([{ currency: "JOD", totalMinor: 1_800, perUnitText: null }]);
  });
});

describe("the database keeps the finished goods honest", () => {
  it("the output lot of an order is written once, with its completion, and never changed or moved", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await loginAs(w.keeper.id);
    const order = await orderOk(w.space.id, p.recipe, "2");
    expect((await issueOrder(order.id)).status).toBe(200);
    const stray = await db.materialLot.findFirstOrThrow({ where: { materialId: p.flour } });
    // not before the completion
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { outputLotId: stray.id } })).rejects.toThrow(/recorded once/);
    expect((await completeOrder(order.id, { actualQty: "2" })).status).toBe(200);
    const row = await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
    // not after it
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { outputLotId: stray.id } })).rejects.toThrow(/closed|recorded once/);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { outputLotId: null } })).rejects.toThrow(/closed|recorded once/);
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } })).outputLotId).toBe(row.outputLotId);
  });

  it("removing the space still works with finished goods and frozen costs in it", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    await runOrder(w, p, "2", "2");
    await db.workspace.delete({ where: { id: w.space.id } });
    expect(await db.productionOrder.count({ where: { workspaceId: w.space.id } })).toBe(0);
    expect(await db.productionOrderCostLine.count()).toBeGreaterThanOrEqual(0);
    expect(await db.materialLot.count({ where: { workspaceId: w.space.id } })).toBe(0);
  });
});
