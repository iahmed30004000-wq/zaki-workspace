import { describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import {
  archiveRecipe,
  cancelOrder,
  completeOrder,
  editOrder,
  featureOff,
  issueOrder,
  makeMaterial,
  mfgWorld,
  micro,
  newVersion,
  orderOk,
  orderView,
  receiveOk,
  recipeOk,
  type MfgWorld,
} from "./mfg-helpers";

/**
 * «تعديل المسودة» (slice 3): a production order that is still a DRAFT can be edited (planned quantity, recipe, note) by a holder of `manufacturing.edit`,
 * and ONLY while it is a DRAFT. What it needs of each material is fixed again from the recipe's newest version and the quantity, replacing the draft's
 * lines. The database trigger that keeps the plan unchanged lets it change only while the order is a DRAFT.
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

/** Flour (1000 g at 0.010) and boxes (100 at 0.500); recipe A takes 30 g flour per jar, recipe B takes 20 g flour and 1 box per jar. */
async function plant(w: MfgWorld) {
  await loginAs(w.buyer.id);
  const flour = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
  const box = await makeMaterial(w.space.id, { name: "علب", baseUnit: "علبة" });
  await receiveOk(flour, { qty: "1000", unitCost: "0.01" });
  await receiveOk(box, { qty: "100", unitCost: "0.5" });
  await loginAs(w.keeper.id);
  const a = await recipeOk(w.space.id, [{ materialId: flour, qty: "30" }], { name: "برطمان", outputUnit: "برطمان" });
  const b = await recipeOk(w.space.id, [{ materialId: flour, qty: "20" }, { materialId: box, qty: "1" }], { name: "برطمان مع علبة", outputUnit: "برطمان" });
  return { flour, box, a: a.id, b: b.id };
}

const requiredOf = async (orderId: string) => Object.fromEntries((await db.productionOrderLine.findMany({ where: { orderId }, orderBy: { position: "asc" } })).map((l) => [l.materialId, Number(l.requiredMicro) / 1_000_000]));

describe("editing a draft order", () => {
  it("changes the planned quantity and fixes what each material needs again; the order keeps its number and its place", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5", { note: "للمعرض" });
    expect(await requiredOf(order.id)).toEqual({ [p.flour]: 150 });
    const edited = await editOrder(order.id, { qty: "8" });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect(edited.json).toMatchObject({ id: order.id, seq: order.seq, status: "DRAFT", plannedMicro: micro(8), note: "للمعرض", canIssue: true, canEditDraft: true });
    expect(await requiredOf(order.id)).toEqual({ [p.flour]: 240 });
    expect(await db.productionOrderLine.count({ where: { orderId: order.id } })).toBe(1);
    expect((await orderView(w.space.id, order.id)).lines[0]).toMatchObject({ requiredMicro: micro(240), balanceMicro: micro(1000), enough: true });
    // a quantity that the stock cannot cover is still an edit: the issue is what is refused later
    expect((await editOrder(order.id, { qty: "100" })).status).toBe(200);
    expect((await orderView(w.space.id, order.id)).lines[0]).toMatchObject({ requiredMicro: micro(3000), enough: false });
  });

  it("switches the recipe (it is made from that recipe's newest version) and replaces the lines", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5");
    const edited = await editOrder(order.id, { recipeId: p.b });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect(edited.json).toMatchObject({ recipeId: p.b, recipeName: "برطمان مع علبة", plannedMicro: micro(5) });
    expect(await requiredOf(order.id)).toEqual({ [p.flour]: 100, [p.box]: 5 });
    // a new version of the same recipe is picked up by naming the recipe again
    expect((await newVersion(p.b, [{ materialId: p.flour, qty: "25" }, { materialId: p.box, qty: "2" }], { name: "برطمان مع علبة", outputUnit: "برطمان" })).status).toBe(201);
    expect(await requiredOf(order.id)).toEqual({ [p.flour]: 100, [p.box]: 5 }); // not before it is asked for
    const again = await editOrder(order.id, { recipeId: p.b, qty: "4" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ version: 2 });
    expect(await requiredOf(order.id)).toEqual({ [p.flour]: 100, [p.box]: 8 });
  });

  it("changes the note, and clears it with an empty one; nothing else moves", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5", { note: "قديمة" });
    const lineBefore = await db.productionOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    expect((await editOrder(order.id, { note: "جديدة" })).json).toMatchObject({ note: "جديدة", plannedMicro: micro(5) });
    // a note alone does not touch the lines
    expect((await db.productionOrderLine.findFirstOrThrow({ where: { orderId: order.id } })).id).toBe(lineBefore.id);
    expect((await editOrder(order.id, { note: "" })).json).toMatchObject({ note: null });
    expect((await editOrder(order.id, { note: "ثالثة" })).json).toMatchObject({ note: "ثالثة" });
    expect((await editOrder(order.id, { note: null })).json).toMatchObject({ note: null });
  });

  it("refuses an empty edit, a silly quantity, an unknown or archived recipe, and one of another space", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5");
    expect((await editOrder(order.id, {})).status).toBe(422);
    expect(messages(await editOrder(order.id, {}))).toContain("mfg.e.order_edit_empty");
    expect(messages(await editOrder(order.id, { qty: "0" }))).toContain("mfg.e.qty");
    expect(messages(await editOrder(order.id, { qty: "abc" }))).toContain("mfg.e.qty");
    expect(messages(await editOrder(order.id, { qty: "999999999999" }))).toContain("mfg.e.qty_big");
    expect(messages(await editOrder(order.id, { recipeId: "nope" }))).toContain("mfg.e.recipe");
    expect((await archiveRecipe(p.b, true)).status).toBe(200);
    expect(messages(await editOrder(order.id, { recipeId: p.b }))).toContain("mfg.e.recipe_archived");
    // a recipe of another space is not a recipe of this one
    await db.workspace.update({ where: { id: w.general.id }, data: { layout: "MANUFACTURING" } });
    await loginAs(w.keeper.id);
    const other = await makeMaterial(w.general.id, { name: "س", baseUnit: "غرام" });
    const foreign = await recipeOk(w.general.id, [{ materialId: other, qty: "1" }], { name: "غريبة", outputUnit: "قطعة" });
    expect(messages(await editOrder(order.id, { recipeId: foreign.id }))).toContain("mfg.e.recipe");
    // nothing changed through all of that
    expect(await requiredOf(order.id)).toEqual({ [p.flour]: 150 });
    expect((await orderView(w.space.id, order.id)).plannedMicro).toBe(micro(5));
  });

  it("an issue after the edit takes what the new plan needs", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5");
    expect((await editOrder(order.id, { recipeId: p.b, qty: "10" })).status).toBe(200);
    expect((await issueOrder(order.id)).status).toBe(200);
    const taken = await db.materialMovement.findMany({ where: { orderLink: { orderId: order.id } } });
    const byMaterial = new Map<string, bigint>();
    for (const m of taken) byMaterial.set(m.materialId, (byMaterial.get(m.materialId) ?? 0n) - m.qtyMicro);
    expect(byMaterial.get(p.flour)).toBe(BigInt(micro(200)));
    expect(byMaterial.get(p.box)).toBe(BigInt(micro(10)));
  });
});

describe("only while it is a draft", () => {
  it("refuses once the order is issued, completed or cancelled, and changes nothing", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const issued = await orderOk(w.space.id, p.a, "5", { note: "ن" });
    expect((await issueOrder(issued.id)).status).toBe(200);
    for (const body of [{ qty: "6" }, { note: "جديدة" }, { recipeId: p.b }]) {
      const res = await editOrder(issued.id, body);
      expect(res.status).toBe(422);
      expect(messages(res)).toContain("mfg.e.order_state");
    }
    expect((await orderView(w.space.id, issued.id))).toMatchObject({ status: "ISSUED", plannedMicro: micro(5), note: "ن", canEditDraft: false });
    expect(await requiredOf(issued.id)).toEqual({ [p.flour]: 150 });
    expect((await completeOrder(issued.id, { actualQty: "5" })).status).toBe(200);
    expect(messages(await editOrder(issued.id, { qty: "6" }))).toContain("mfg.e.order_state");
    const cancelled = await orderOk(w.space.id, p.a, "1");
    expect((await cancelOrder(cancelled.id)).status).toBe(200);
    expect(messages(await editOrder(cancelled.id, { qty: "2" }))).toContain("mfg.e.order_state");
    expect((await orderView(w.space.id, cancelled.id)).plannedMicro).toBe(micro(1));
  });

  it("an edit and an issue at the same moment leave a whole order: the issue took exactly what the plan then needed", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    for (let round = 0; round < 4; round++) {
      const order = await orderOk(w.space.id, p.a, "5");
      const [edit, issue] = await Promise.all([editOrder(order.id, { qty: "7" }), issueOrder(order.id)]);
      expect([200, 422]).toContain(edit.status);
      expect(issue.status).toBe(200);
      const row = await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
      const need = await requiredOf(order.id);
      // whichever came first, plan and lines agree: 30 g per jar
      expect(need[p.flour]).toBe(Number(row.plannedQtyMicro) / 1_000_000 * 30);
      const taken = await db.materialMovement.findMany({ where: { orderLink: { orderId: order.id } } });
      expect(taken.reduce((sum, m) => sum - m.qtyMicro, 0n)).toBe(BigInt(Math.round(need[p.flour]! * 1_000_000)));
      // an edit that came second was refused
      if (row.plannedQtyMicro === BigInt(micro(5))) expect(edit.status).toBe(422);
    }
  });

  it("the database lets the plan change only while the order is a draft", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "2");
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { plannedQtyMicro: BigInt(micro(3)), note: "مباشرة" } })).resolves.toMatchObject({ plannedQtyMicro: BigInt(micro(3)) });
    // the identity never changes, even in a draft
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { seq: 99 } })).rejects.toThrow(/keeps its plan/);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { createdById: w.buyer.id } })).rejects.toThrow(/keeps its plan/);
    // a draft's lines may be replaced, nobody else's
    const line = await db.productionOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(db.productionOrderLine.update({ where: { id: line.id }, data: { requiredMicro: 1n } })).rejects.toThrow(/append-only/);
    expect((await issueOrder(order.id)).status).toBe(200);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { plannedQtyMicro: 1n } })).rejects.toThrow(/keeps its plan/);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { recipeVersionId: (await db.recipeVersion.findFirstOrThrow({ where: { recipeId: p.b } })).id } })).rejects.toThrow(/keeps its plan/);
    await expect(db.productionOrder.update({ where: { id: order.id }, data: { note: "بعد الصرف" } })).rejects.toThrow(/keeps its plan/);
    await expect(db.productionOrderLine.deleteMany({ where: { orderId: order.id } })).rejects.toThrow(/append-only/);
    expect(await db.productionOrderLine.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe("who may edit a draft", () => {
  it("a holder of manufacturing.edit does; a viewer, a person outside the space and a partner do not; and it is off with the switch", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5");
    await loginAs(w.viewer.id);
    const denied = await editOrder(order.id, { qty: "6" });
    expect(denied.status).toBe(403);
    expect(denied.json?.["message"]).toBe("mfg.readonly");
    await loginAs(w.guest.id);
    expect((await editOrder(order.id, { qty: "6" })).status).toBe(404);
    await loginAs(w.plain.id);
    expect((await editOrder(order.id, { qty: "6" })).status).toBe(404);
    await loginAs(w.outsider.id);
    expect((await editOrder(order.id, { qty: "6" })).status).toBe(404);
    await loginAs(w.buyer.id);
    expect((await editOrder(order.id, { qty: "6" })).status).toBe(200);
    await loginAs(w.keeper.id);
    expect((await editOrder(order.id, { qty: "7" })).status).toBe(200);
    // the viewer sees no edit button's permission, and no price
    await loginAs(w.viewer.id);
    expect((await orderView(w.space.id, order.id)).canEditDraft).toBe(false);
    await featureOff(w.org.id);
    await loginAs(w.keeper.id);
    expect((await editOrder(order.id, { qty: "8" })).status).toBe(404);
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } })).plannedQtyMicro).toBe(BigInt(micro(7)));
  });

  it("is in the log by name, without a quantity's price (the log never carries one)", async () => {
    const w = await mfgWorld();
    const p = await plant(w);
    const order = await orderOk(w.space.id, p.a, "5");
    expect((await editOrder(order.id, { qty: "6", note: "x" })).status).toBe(200);
    const line = await db.auditLog.findFirstOrThrow({ where: { action: "mfg.order_edited", target: order.id } });
    expect(line.actorId).toBe(w.keeper.id);
    expect(Object.keys(line.meta as object).sort()).toEqual(["note", "plan", "seq"]);
  });
});
