import { describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import {
  addUnit,
  cancelOrder,
  completeOrder,
  createOrder,
  detailOf,
  featureOff,
  issueOrder,
  makeMaterial,
  mfgWorld,
  micro,
  orderOk,
  orderView,
  ordersOf,
  patchMaterial,
  receiveOk,
  receiveUnpricedOk,
  recipeOk,
  returnOrder,
  reverse,
  costLot,
  issue,
  type MfgWorld,
} from "./mfg-helpers";

/**
 * «أوامر التصنيع»: a planned quantity of a recipe version. ISSUE takes the materials out of stock first-in-first-out by lot, atomically, as ISSUE
 * movements linked to the order; COMPLETE records the real output; RETURN puts the materials back by reversing movements; a draft can be cancelled.
 * The cost is read from what was taken, lot by lot at the lot's price, rounded once; a lot without a price makes it incomplete, never guessed.
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

/**
 * The standard plant: flour (grams) in two lots, 100 g at 0.010 and 100 g at 0.020 a gram (the older first), and 50 boxes at 0.500. A recipe takes
 * 30 g of flour and 1 box for ONE jar. Receipts are the buyer's; the keeper runs the orders.
 */
async function plant(w: MfgWorld) {
  await loginAs(w.buyer.id);
  const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
  const box = await makeMaterial(w.space.id, { name: "علب", baseUnit: "علبة" });
  const lot1 = await receiveOk(flour, { qty: "100", unitCost: "0.01", receivedOn: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) });
  const lot2 = await receiveOk(flour, { qty: "100", unitCost: "0.02", receivedOn: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10) });
  const boxes = await receiveOk(box, { qty: "50", unitCost: "0.5" });
  await loginAs(w.keeper.id);
  const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "30" }, { materialId: box, qty: "1" }], { name: "برطمان", outputUnit: "برطمان" });
  return { flour, box, lot1: lot1.lotId, lot2: lot2.lotId, boxes: boxes.lotId, recipe: recipe.id };
}

const balanceOf = async (materialId: string) => (await detailOf(materialId)).balanceMicro;

describe("making an order", () => {
  it("is a draft that fixes what each material needs and moves nothing", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const before = await db.materialMovement.count({ where: { orgId: w.org.id } });
    const order = await orderOk(w.space.id, p.recipe, "5", { note: "للمعرض" });
    expect(order).toMatchObject({ seq: 1, status: "DRAFT", plannedMicro: micro(5), note: "للمعرض", recipeName: "برطمان", outputUnit: "برطمان", canIssue: true, canCancel: true, canComplete: false, canReturn: false, cost: null, costIncomplete: false });
    expect(order.lines.map((l) => [l.materialName, l.perUnitMicro, l.requiredMicro, l.balanceMicro, l.enough])).toEqual([
      ["طحين", micro(30), micro(150), micro(200), true],
      ["علب", micro(1), micro(5), micro(50), true],
    ]);
    expect(await db.materialMovement.count({ where: { orgId: w.org.id } })).toBe(before);
    expect((await orderOk(w.space.id, p.recipe, "1")).seq).toBe(2);
  });

  it("refuses a zero or a silly plan, an unknown recipe, and a quantity so small a material needs none", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    expect(messages(await createOrder(w.space.id, p.recipe, "0"))).toContain("mfg.e.qty");
    expect(messages(await createOrder(w.space.id, p.recipe, "abc"))).toContain("mfg.e.qty");
    expect(messages(await createOrder(w.space.id, "ghost", "1"))).toContain("mfg.e.recipe");
    const tiny = await recipeOk(w.space.id, [{ materialId: p.box, qty: "0.000001" }]);
    expect(messages(await createOrder(w.space.id, tiny.id, "0.4"))).toContain("mfg.e.order_tiny");
    expect(await db.productionOrder.count({ where: { workspaceId: w.space.id } })).toBe(0);
  });
});

describe("issuing the materials", () => {
  it("takes them oldest lot first as linked ISSUE movements, in one go; the balance, the lots and the book follow", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "5");
    const res = await issueOrder(order.id);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ status: "ISSUED", canIssue: false, canComplete: true, canReturn: true, canCancel: false });

    const links = await db.productionOrderMovement.findMany({ where: { orderId: order.id }, include: { movement: true }, orderBy: { createdAt: "asc" } });
    const pieces = links.map((l) => ({ material: l.movement.materialId, lot: l.movement.lotId, qty: l.movement.qtyMicro, value: l.movement.valueMinor, kind: l.movement.kind }));
    // 150 g of flour: the whole older lot (100 g at 0.010 a gram = 1.000) and 50 g of the newer one (at 0.020 = 1.000); 5 boxes at 0.500
    expect(pieces).toEqual(
      expect.arrayContaining([
        { material: p.flour, lot: p.lot1, qty: -BigInt(micro(100)), value: -1_000n, kind: "ISSUE" },
        { material: p.flour, lot: p.lot2, qty: -BigInt(micro(50)), value: -1_000n, kind: "ISSUE" },
        { material: p.box, lot: p.boxes, qty: -BigInt(micro(5)), value: -2_500n, kind: "ISSUE" },
      ]),
    );
    expect(pieces).toHaveLength(3);
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } })).issuedById).toBe(w.keeper.id);

    expect(await balanceOf(p.flour)).toBe(micro(50));
    expect(await balanceOf(p.box)).toBe(micro(45));
    // what is left of the newer lot is worth its own price: 50 g at 0.020
    await loginAs(w.buyer.id);
    expect((await detailOf(p.flour)).cost).toMatchObject({ valueMinor: 1_000, averageText: "0.020" });
    const reason = links[0]?.movement.reason ?? "";
    expect(reason).toContain("1");
  });

  it("the cost is the sum of the consumed lots, with the formula; the cost per unit comes with the real output; waste changes nothing", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "5");
    expect((await issueOrder(order.id)).status).toBe(200);

    await loginAs(w.buyer.id);
    let seen = await orderView(w.space.id, order.id);
    expect(seen.costIncomplete).toBe(false);
    // 1.000 + 1.000 for the flour, 2.500 for the boxes
    expect(seen.cost?.totals).toEqual([{ currency: "JOD", totalMinor: 4_500, perUnitText: null }]);
    const flour = seen.cost?.lines.find((l) => l.materialName === "طحين");
    expect(flour?.qtyMicro).toBe(micro(150));
    expect(flour?.pieces.map((x) => [x.qtyMicro, x.unitText, x.amountMinor])).toEqual([
      [micro(100), "0.010", 1_000],
      [micro(50), "0.020", 1_000],
    ]);

    await loginAs(w.keeper.id);
    const done = await completeOrder(order.id, { actualQty: "5", wasteQty: "1", wasteNote: "انكسرت وحدة" });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json).toMatchObject({ status: "COMPLETED", actualMicro: micro(5), wasteMicro: micro(1), wasteNote: "انكسرت وحدة", canReturn: false, canComplete: false });
    await loginAs(w.buyer.id);
    seen = await orderView(w.space.id, order.id);
    // 4.500 over the 5 jars that were really made: 0.900 each (the waste is not taken off the output)
    expect(seen.cost?.totals).toEqual([{ currency: "JOD", totalMinor: 4_500, perUnitText: "0.900" }]);
  });

  it("a person without the cost reads the quantities and the «incomplete» flag, and never a price", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    for (const who of [w.keeper, w.viewer]) {
      await loginAs(who.id);
      const view = await ordersOf(w.space.id);
      expect(view.canCost).toBe(false);
      const seen = view.orders[0]!;
      expect(seen.cost).toBeNull();
      expect(seen.costIncomplete).toBe(false);
      expect(seen.lines.find((l) => l.materialName === "طحين")?.issuedMicro).toBe(micro(150));
      expect(JSON.stringify(view)).not.toMatch(/Minor|unitText|perUnitText|amount|currency/);
    }
  });

  it("is all or nothing: a material that is short stops the whole order, and nothing else is taken", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    // flour is enough for 6 jars, the boxes for 50: an order for 7 jars is short of flour only, an order for 60 jars of boxes only
    const flourShort = await orderOk(w.space.id, p.recipe, "7");
    const refused = await issueOrder(flourShort.id);
    expect(refused.status).toBe(422);
    expect(messages(refused)).toContain("mfg.e.order_short");
    const boxShort = await recipeOk(w.space.id, [{ materialId: p.flour, qty: "1" }, { materialId: p.box, qty: "10" }]);
    const second = await orderOk(w.space.id, boxShort.id, "6");
    expect(messages(await issueOrder(second.id))).toContain("mfg.e.order_short");
    expect(await db.materialMovement.count({ where: { kind: "ISSUE", orgId: w.org.id } })).toBe(0);
    expect(await balanceOf(p.flour)).toBe(micro(200));
    expect(await balanceOf(p.box)).toBe(micro(50));
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: flourShort.id } })).status).toBe("DRAFT");
    // the draft shows what is short, and the shortage is a quantity, so a person without the cost reads it too
    const view = await orderView(w.space.id, flourShort.id);
    expect(view.lines.find((l) => l.materialName === "طحين")).toMatchObject({ enough: false });
  });

  it("two orders asking for the same stock at once: one gets it, the other is refused, and a balance never goes below zero", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const a = await orderOk(w.space.id, p.recipe, "4"); // 120 g
    const b = await orderOk(w.space.id, p.recipe, "4"); // 120 g, but only 200 g exist
    const results = await Promise.all([issueOrder(a.id), issueOrder(b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await balanceOf(p.flour)).toBe(micro(80));
    expect(await db.productionOrderMovement.count({ where: { order: { workspaceId: w.space.id } } })).toBe(3);
    // the same order issued twice at once takes its materials once
    const c = await orderOk(w.space.id, p.recipe, "1");
    const twice = await Promise.all([issueOrder(c.id), issueOrder(c.id)]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await balanceOf(p.box)).toBe(micro(50 - 4 - 1));
  });

  it("an exact total: rounded once from the exact pieces, not piece by piece", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    // two materials, each a carton of 24 boxes at 0.100: 3 boxes of either cost exactly 12.5 minor units
    const x = await makeMaterial(w.space.id, { name: "س", baseUnit: "علبة" });
    const y = await makeMaterial(w.space.id, { name: "ص", baseUnit: "علبة" });
    for (const id of [x, y]) {
      expect((await addUnit(id, { label: "كرتونة", num: 24, den: 1 })).status).toBe(201);
      const carton = (await db.materialUnit.findFirstOrThrow({ where: { materialId: id } })).id;
      await receiveOk(id, { qty: "1", unitId: carton, unitCost: "0.1" });
    }
    await loginAs(w.keeper.id);
    const recipe = await recipeOk(w.space.id, [{ materialId: x, qty: "3" }, { materialId: y, qty: "3" }]);
    const order = await orderOk(w.space.id, recipe.id, "1");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect((await completeOrder(order.id, { actualQty: "1" })).status).toBe(200);
    await loginAs(w.buyer.id);
    const seen = await orderView(w.space.id, order.id);
    // 12.5 + 12.5 = 25 exactly (rounding each piece first would say 26)
    expect(seen.cost?.totals).toEqual([{ currency: "JOD", totalMinor: 25, perUnitText: "0.025" }]);
    expect(seen.cost?.lines.map((l) => l.pieces[0]?.amountMinor)).toEqual([13, 13]);
  });
});

describe("a lot without a price", () => {
  it("is used by the order, makes its cost incomplete for everybody, and the price filled later completes it by itself", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const first = await orderOk(w.space.id, p.recipe, "5");
    expect((await issueOrder(first.id)).status).toBe(200);
    // a newer lot of flour arrives without a price: 100 g
    await loginAs(w.keeper.id);
    const pending = await receiveUnpricedOk(p.flour, { qty: "100" });
    // 3 jars need 90 g: the 50 g left of the second lot, then 40 g of the unpriced one
    const order = await orderOk(w.space.id, p.recipe, "3");
    expect((await issueOrder(order.id)).status).toBe(200);

    const keeperView = await orderView(w.space.id, order.id);
    expect(keeperView).toMatchObject({ costIncomplete: true, cost: null });
    await loginAs(w.buyer.id);
    let seen = await orderView(w.space.id, order.id);
    expect(seen.costIncomplete).toBe(true);
    // what is known: 50 g at 0.020 = 1.000, and 3 boxes at 0.500 = 1.500; the 40 g without a price add nothing and are shown as such
    expect(seen.cost?.totals[0]).toMatchObject({ currency: "JOD", totalMinor: 2_500 });
    const piece = seen.cost?.lines.find((l) => l.materialName === "طحين")?.pieces.find((x) => x.qtyMicro === micro(40));
    expect(piece).toMatchObject({ unitText: null, amountMinor: null });
    // the movement of that piece was written at value 0: nothing was invented
    const ledgerPiece = await db.materialMovement.findFirstOrThrow({ where: { lotId: pending.lotId, kind: "ISSUE" } });
    expect(ledgerPiece.valueMinor).toBe(0n);

    // the price comes: 100 g at 0.030 = 3.000, and the order is complete without being touched
    expect((await costLot(pending.lotId, { unitCost: "0.03", currency: "JOD" })).status).toBe(201);
    seen = await orderView(w.space.id, order.id);
    expect(seen.costIncomplete).toBe(false);
    expect(seen.cost?.totals[0]).toMatchObject({ totalMinor: 2_500 + 1_200 }); // + 40 g x 0.030
    // and what is left of that lot (60 g) is in the book at its price: 60 x 0.030
    expect((await detailOf(p.flour)).cost).toMatchObject({ valueMinor: 1_800, averageText: "0.030" });
    await loginAs(w.keeper.id);
    expect((await orderView(w.space.id, order.id)).costIncomplete).toBe(false);
  });

  it("is taken by an order but never by a plain issue", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    await receiveUnpricedOk(flour, { qty: "100" });
    expect(messages(await issue(flour, "10"))).toContain("mfg.e.insufficient_priced");
    const recipe = await recipeOk(w.space.id, [{ materialId: flour, qty: "10" }]);
    const order = await orderOk(w.space.id, recipe.id, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect(await balanceOf(flour)).toBe(micro(50));
    expect((await orderView(w.space.id, order.id)).costIncomplete).toBe(true);
  });
});

describe("taking the materials back", () => {
  it("returns them by reversing movements: the originals stay, the stock is back, the order is closed", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "5");
    expect((await issueOrder(order.id)).status).toBe(200);
    const res = await returnOrder(order.id, "الكمية غلط");
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ status: "RETURNED", closeNote: "الكمية غلط", canReturn: false, canComplete: false, cost: null, costIncomplete: false });

    expect(await balanceOf(p.flour)).toBe(micro(200));
    expect(await balanceOf(p.box)).toBe(micro(50));
    const moves = await db.materialMovement.findMany({ where: { orgId: w.org.id, kind: { in: ["ISSUE", "REVERSE"] } } });
    expect(moves.filter((m) => m.kind === "ISSUE")).toHaveLength(3);
    expect(moves.filter((m) => m.kind === "REVERSE")).toHaveLength(3);
    for (const back of moves.filter((m) => m.kind === "REVERSE")) {
      const original = moves.find((m) => m.id === back.reversesId)!;
      expect(back.qtyMicro).toBe(-original.qtyMicro);
      expect(back.valueMinor).toBe(-original.valueMinor);
      expect(back.lotId).toBe(original.lotId);
    }
    expect(await db.productionOrderMovement.count({ where: { orderId: order.id } })).toBe(6);
    await loginAs(w.buyer.id);
    // the lots hold their full value again
    expect((await detailOf(p.flour)).cost).toMatchObject({ valueMinor: 3_000 });

    // it cannot be completed, returned again, issued again or cancelled
    await loginAs(w.keeper.id);
    for (const step of [completeOrder(order.id), returnOrder(order.id), issueOrder(order.id), cancelOrder(order.id)]) {
      expect(messages(await step)).toContain("mfg.e.order_state");
    }
    // and the freed stock serves the next order in the same order of lots
    const next = await orderOk(w.space.id, p.recipe, "5");
    expect((await issueOrder(next.id)).status).toBe(200);
    expect((await db.materialMovement.findFirstOrThrow({ where: { lotId: p.lot1, kind: "ISSUE" }, orderBy: { createdAt: "desc" } })).qtyMicro).toBe(-BigInt(micro(100)));
  });

  it("a movement an order wrote is reversed through the order, not on its own", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "1");
    expect((await issueOrder(order.id)).status).toBe(200);
    const link = await db.productionOrderMovement.findFirstOrThrow({ where: { orderId: order.id } });
    expect(messages(await reverse(link.movementId))).toContain("mfg.e.reverse_order");
    // the receipt of a lot an order used cannot be taken back either, while the lot is short
    const lot = await db.materialMovement.findFirstOrThrow({ where: { lotId: p.boxes, kind: "RECEIVE" } });
    expect(messages(await reverse(lot.id))).toContain("mfg.e.reverse_negative");
  });

  it("a completed order cannot be returned, and a draft is cancelled, not returned", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const done = await orderOk(w.space.id, p.recipe, "1");
    expect((await issueOrder(done.id)).status).toBe(200);
    expect((await completeOrder(done.id, { actualQty: "1" })).status).toBe(200);
    expect(messages(await returnOrder(done.id))).toContain("mfg.e.order_state");
    expect(messages(await completeOrder(done.id))).toContain("mfg.e.order_state");
    const draft = await orderOk(w.space.id, p.recipe, "1");
    expect(messages(await returnOrder(draft.id))).toContain("mfg.e.order_state");
    expect(messages(await completeOrder(draft.id))).toContain("mfg.e.order_state");
    const cancelled = await cancelOrder(draft.id, "ما عاد بدنا");
    expect(cancelled.status).toBe(200);
    expect(cancelled.json).toMatchObject({ status: "CANCELLED", closeNote: "ما عاد بدنا", canIssue: false });
    expect(messages(await issueOrder(draft.id))).toContain("mfg.e.order_state");
    // an issued order cannot be «cancelled»: the way back after the issue is the return
    const issued = await orderOk(w.space.id, p.recipe, "1");
    expect((await issueOrder(issued.id)).status).toBe(200);
    expect(messages(await cancelOrder(issued.id))).toContain("mfg.e.order_state");
    expect(messages(await completeOrder(issued.id, { actualQty: "0" }))).toContain("mfg.e.qty");
  });
});

describe("the database keeps the order honest", () => {
  it("allows only the steps, keeps the plan, never touches a closed order, and refuses to remove anything", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "2");
    const row = () => db.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { status: "COMPLETED", actualQtyMicro: 1n, finishedAt: new Date(), finishedById: w.keeper.id } })).rejects.toThrow(/cannot go from/);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { plannedQtyMicro: 1n } })).rejects.toThrow(/keeps its plan/);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { status: "WHATEVER" } })).rejects.toThrow();
    await expect(db.productionOrder.delete({ where: { id: order.id } })).rejects.toThrow(/append-only/);
    const line = await db.productionOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(db.productionOrderLine.update({ where: { id: line.id }, data: { requiredMicro: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.productionOrderLine.delete({ where: { id: line.id } })).rejects.toThrow(/append-only/);
    expect((await row()).status).toBe("DRAFT");

    expect((await issueOrder(order.id)).status).toBe(200);
    const link = await db.productionOrderMovement.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(db.productionOrderMovement.update({ where: { id: link.id }, data: { lineId: line.id } })).rejects.toThrow(/append-only/);
    await expect(db.productionOrderMovement.delete({ where: { id: link.id } })).rejects.toThrow(/append-only/);
    // a completed order needs its real output
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { status: "COMPLETED", finishedAt: new Date(), finishedById: w.keeper.id } })).rejects.toThrow();
    expect((await completeOrder(order.id, { actualQty: "2" })).status).toBe(200);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { note: "بعد الإغلاق" } })).rejects.toThrow(/closed/);
    // an order that never says who issued it, or who closed it, is not accepted
    await expect(db.productionOrder.create({ data: { orgId: w.org.id, workspaceId: w.space.id, seq: 99, recipeVersionId: (await db.recipeVersion.findFirstOrThrow({ where: { recipeId: p.recipe } })).id, plannedQtyMicro: 1n, status: "ISSUED", createdById: w.keeper.id } })).rejects.toThrow();
  });

  it("removing the space still works: the cascade is the one delete the orders allow", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "1");
    expect((await issueOrder(order.id)).status).toBe(200);
    await db.workspace.delete({ where: { id: w.space.id } });
    expect(await db.productionOrder.count({ where: { workspaceId: w.space.id } })).toBe(0);
    expect(await db.recipe.count({ where: { workspaceId: w.space.id } })).toBe(0);
    expect(await db.materialMovement.count({ where: { workspaceId: w.space.id } })).toBe(0);

    // the whole company, with a lot priced late, a recipe and an order
    const v = await mfgWorld();
    const q = await plant(v);
    await loginAs(v.keeper.id);
    const lot = await receiveUnpricedOk(q.flour, { qty: "10" });
    await loginAs(v.buyer.id);
    expect((await costLot(lot.lotId)).status).toBe(201);
    await loginAs(v.keeper.id);
    const o = await orderOk(v.space.id, q.recipe, "1");
    expect((await issueOrder(o.id)).status).toBe(200);
    await db.organization.delete({ where: { id: v.org.id } });
    expect(await db.materialCosting.count({ where: { orgId: v.org.id } })).toBe(0);
    expect(await db.productionOrder.count({ where: { orgId: v.org.id } })).toBe(0);
    expect(await db.recipeVersion.count({ where: { recipe: { orgId: v.org.id } } })).toBe(0);
  });
});

describe("who may run orders", () => {
  it("a viewer reads and is refused every step with 403; a partner, a person outside the space and the switch off get 404", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "1");
    await loginAs(w.viewer.id);
    expect((await ordersOf(w.space.id)).orders).toHaveLength(1);
    expect((await createOrder(w.space.id, p.recipe, "1")).status).toBe(403);
    for (const step of [issueOrder(order.id), completeOrder(order.id), cancelOrder(order.id), returnOrder(order.id)]) expect((await step).status).toBe(403);
    for (const who of [w.guest, w.plain, w.outsider]) {
      await loginAs(who.id);
      expect((await createOrder(w.space.id, p.recipe, "1")).status, who.name).toBe(404);
      expect((await issueOrder(order.id)).status, who.name).toBe(404);
      expect((await cancelOrder(order.id)).status, who.name).toBe(404);
    }
    await loginAs(w.owner.id);
    await featureOff(w.org.id);
    expect((await issueOrder(order.id)).status).toBe(404);
    expect((await createOrder(w.space.id, p.recipe, "1")).status).toBe(404);
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DRAFT");
  });

  it("an archived material stops its order; the log names the steps and never a price", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.recipe, "1");
    expect((await issueOrder(order.id)).status).toBe(200);
    expect((await completeOrder(order.id, { actualQty: "1" })).status).toBe(200);
    const lines = await db.auditLog.findMany({ where: { workspaceId: w.space.id, action: { startsWith: "mfg.order_" } } });
    expect(lines.map((l) => l.action).sort()).toEqual(["mfg.order_completed", "mfg.order_created", "mfg.order_issued"]);
    expect(JSON.stringify(lines.map((l) => l.meta))).not.toMatch(/cost|price|Minor/i);

    // a material that was archived after the draft was made blocks the issue (it can only be archived when empty: empty it first)
    const empty = await makeMaterial(w.space.id, { name: "فاضية", baseUnit: "قطعة" });
    const recipe = await recipeOk(w.space.id, [{ materialId: empty, qty: "1" }]);
    const draft = await orderOk(w.space.id, recipe.id, "1");
    expect((await patchMaterial(empty, { archived: true })).status).toBe(200);
    expect(messages(await issueOrder(draft.id))).toContain("mfg.e.archived");
  });
});
