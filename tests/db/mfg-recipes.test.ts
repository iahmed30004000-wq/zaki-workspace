import { describe, expect, it } from "vitest";
import { db, loginAs, makeWorkspace, uid } from "./helpers";
import { addUnit, archiveRecipe, createRecipe, featureOff, makeMaterial, mfgWorld, newVersion, patchMaterial, recipeOk, recipesOf, receiveOk, createOrder } from "./mfg-helpers";

/**
 * «وصفات»: a finished item (a name, an output unit written as free text) with lines (a material and how much of it ONE output unit takes, typed in
 * any unit of the material and kept exactly in the base unit). A recipe is versioned append-only (a change is a new version; the old ones are never
 * edited) and archived instead of deleted. It holds no price.
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

async function twoMaterials(w: Awaited<ReturnType<typeof mfgWorld>>) {
  const box = await makeMaterial(w.space.id, { name: "علب", baseUnit: "علبة" });
  const unit = await addUnit(box, { label: "كرتونة", num: 24, den: 1 });
  expect(unit.status).toBe(201);
  const cartonId = (await db.materialUnit.findFirstOrThrow({ where: { materialId: box, label: "كرتونة" } })).id;
  const gram = await makeMaterial(w.space.id, { name: "مادة خام", baseUnit: "غرام" });
  return { box, gram, cartonId };
}

describe("a recipe and its lines", () => {
  it("a keeper writes one: the lines are typed in any unit of the material and kept exactly in the base unit", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box, gram, cartonId } = await twoMaterials(w);
    const made = await recipeOk(w.space.id, [{ materialId: box, qty: "0.5", unitId: cartonId }, { materialId: gram, qty: "12.5" }], { name: "كريم", outputUnit: "برطمان" });
    const version = await db.recipeVersion.findUniqueOrThrow({ where: { id: made.versionId }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(version).toMatchObject({ version: 1, name: "كريم", outputUnit: "برطمان", recipeId: made.id, createdById: w.keeper.id });
    // half a carton of 24 boxes is exactly 12 boxes
    expect(version.lines.map((l) => [l.materialId, l.qtyMicro, l.enteredQtyMicro, l.enteredUnitLabel])).toEqual([
      [box, 12_000_000n, 500_000n, "كرتونة"],
      [gram, 12_500_000n, 12_500_000n, "غرام"],
    ]);
    const seen = await recipesOf(w.space.id);
    expect(seen).toMatchObject({ canEdit: true, canCost: false });
    expect(seen.recipes).toHaveLength(1);
    expect(seen.recipes[0]).toMatchObject({ archived: false, current: { version: 1, name: "كريم", outputUnit: "برطمان" } });
    expect(seen.recipes[0]?.current.lines.map((l) => [l.materialName, l.qtyMicro, l.enteredUnitLabel])).toEqual([
      ["علب", 12_000_000, "كرتونة"],
      ["مادة خام", 12_500_000, "غرام"],
    ]);
    expect(seen.materials.map((m) => m.name).sort()).toEqual(["علب", "مادة خام"].sort());
  });

  it("a recipe holds no price, and reads the same for a viewer", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const { box } = await twoMaterials(w);
    expect((await receiveOk(box, { qty: "10", unitCost: "2" })).lotId).toBeTruthy();
    await recipeOk(w.space.id, [{ materialId: box, qty: "1" }]);
    await loginAs(w.viewer.id);
    const seen = await recipesOf(w.space.id);
    expect(seen).toMatchObject({ canEdit: false, canCost: false });
    expect(seen.recipes).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toMatch(/Minor|unitCost|average|value/);
  });

  it("refuses what makes no sense, and writes nothing", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box, gram, cartonId } = await twoMaterials(w);
    expect(messages(await createRecipe(w.space.id, []))).toContain("mfg.e.recipe_lines");
    expect(messages(await createRecipe(w.space.id, [{ materialId: box, qty: "1" }, { materialId: box, qty: "2" }]))).toContain("mfg.e.recipe_dup");
    expect(messages(await createRecipe(w.space.id, [{ materialId: box, qty: "0" }]))).toContain("mfg.e.qty");
    expect(messages(await createRecipe(w.space.id, [{ materialId: box, qty: "abc" }]))).toContain("mfg.e.qty");
    expect(messages(await createRecipe(w.space.id, [{ materialId: box, qty: "1", unitId: "nope" }]))).toContain("mfg.e.unit");
    expect(messages(await createRecipe(w.space.id, [{ materialId: "ghost", qty: "1" }]))).toContain("mfg.e.recipe_material");
    expect(messages(await createRecipe(w.space.id, [{ materialId: gram, qty: "1" }], { outputUnit: " " }))).toContain("mfg.e.output_unit");
    expect(messages(await createRecipe(w.space.id, [{ materialId: gram, qty: "1" }], { name: "" }))).toContain("mfg.e.name");
    // a quantity that does not turn into a whole number of base micro-units is refused, never rounded
    expect((await addUnit(gram, { label: "ثلث", num: 1, den: 3 })).status).toBe(201);
    const third = (await db.materialUnit.findFirstOrThrow({ where: { materialId: gram, label: "ثلث" } })).id;
    expect(messages(await createRecipe(w.space.id, [{ materialId: gram, qty: "0.000001", unitId: third }]))).toContain("mfg.e.qty_exact");
    // a material of another space, and one of another company, are not the recipe's to use
    const elsewhere = await makeMaterial(w.space.id);
    await loginAs(w.owner.id);
    const other = await mfgWorld();
    await loginAs(other.keeper.id);
    const foreign = await makeMaterial(other.space.id);
    await loginAs(w.keeper.id);
    expect(messages(await createRecipe(w.space.id, [{ materialId: foreign, qty: "1" }]))).toContain("mfg.e.recipe_material");
    const space2 = await makeWorkspace(w.org.id, [{ userId: w.keeper.id }, { userId: w.buyer.id }], `Factory2 ${uid()}`);
    await db.workspace.update({ where: { id: space2.id }, data: { layout: "MANUFACTURING" } });
    expect(messages(await createRecipe(space2.id, [{ materialId: elsewhere, qty: "1" }]))).toContain("mfg.e.recipe_material");
    // an archived material is not offered to a new recipe
    expect((await patchMaterial(elsewhere, { archived: true })).status).toBe(200);
    expect(messages(await createRecipe(w.space.id, [{ materialId: elsewhere, qty: "1" }]))).toContain("mfg.e.archived");
    expect(await db.recipe.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("versions are written once", () => {
  it("a change is a new version; the old one is exactly as it was, and an order keeps the version it was made from", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box, gram } = await twoMaterials(w);
    const made = await recipeOk(w.space.id, [{ materialId: box, qty: "1" }], { name: "نسخة أولى" });
    const first = await db.recipeVersion.findUniqueOrThrow({ where: { id: made.versionId }, include: { lines: true } });
    const order = await createOrder(w.space.id, made.id, "5");
    expect(order.status).toBe(201);

    const next = await newVersion(made.id, [{ materialId: box, qty: "2" }, { materialId: gram, qty: "3" }], { name: "نسخة ثانية", outputUnit: "قطعة" });
    expect(next.status, JSON.stringify(next.json)).toBe(201);
    expect(next.json).toMatchObject({ version: 2 });
    expect(await db.recipeVersion.findUniqueOrThrow({ where: { id: made.versionId }, include: { lines: true } })).toEqual(first);

    const seen = await recipesOf(w.space.id);
    expect(seen.recipes[0]).toMatchObject({ current: { version: 2, name: "نسخة ثانية", outputUnit: "قطعة" } });
    expect(seen.recipes[0]?.versions.map((v) => v.version)).toEqual([2, 1]);
    // the order that was already made still points at version 1; the next one takes version 2
    expect((await db.productionOrder.findFirstOrThrow({ where: { workspaceId: w.space.id }, include: { recipeVersion: true } })).recipeVersion.version).toBe(1);
    const again = await createOrder(w.space.id, made.id, "1");
    expect(again.status).toBe(201);
    expect((await db.productionOrder.findFirstOrThrow({ where: { workspaceId: w.space.id, seq: 2 }, include: { recipeVersion: true } })).recipeVersion.version).toBe(2);
  });

  it("two people saving at once get two different numbers", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box } = await twoMaterials(w);
    const made = await recipeOk(w.space.id, [{ materialId: box, qty: "1" }]);
    const results = await Promise.all([newVersion(made.id, [{ materialId: box, qty: "2" }]), newVersion(made.id, [{ materialId: box, qty: "3" }]), newVersion(made.id, [{ materialId: box, qty: "4" }])]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const versions = (await db.recipeVersion.findMany({ where: { recipeId: made.id }, orderBy: { version: "asc" } })).map((v) => v.version);
    expect(versions).toEqual([1, 2, 3, 4]);
  });

  it("the database refuses to change or remove a version or a line, and the checks keep the numbers honest", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box } = await twoMaterials(w);
    const made = await recipeOk(w.space.id, [{ materialId: box, qty: "1" }]);
    const line = await db.recipeLine.findFirstOrThrow({ where: { versionId: made.versionId } });
    await expect(db.recipeVersion.update({ where: { id: made.versionId }, data: { name: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.recipeLine.update({ where: { id: line.id }, data: { qtyMicro: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE "RecipeLine" SET "qtyMicro" = 5 WHERE "id" = ${line.id}`).rejects.toThrow(/append-only/);
    await expect(db.recipeVersion.delete({ where: { id: made.versionId } })).rejects.toThrow(/append-only/);
    await expect(db.recipeLine.delete({ where: { id: line.id } })).rejects.toThrow(/append-only/);
    await expect(db.recipe.delete({ where: { id: made.id } })).rejects.toThrow(/append-only/);
    await expect(db.recipeLine.create({ data: { versionId: made.versionId, materialId: box, position: 1, qtyMicro: 0n, enteredQtyMicro: 1n, enteredUnitLabel: "علبة" } })).rejects.toThrow();
    await expect(db.recipeVersion.create({ data: { recipeId: made.id, version: 0, name: "x", outputUnit: "y", createdById: w.keeper.id } })).rejects.toThrow();
    expect(await db.recipeVersion.count({ where: { recipeId: made.id } })).toBe(1);
  });
});

describe("a recipe is archived, never deleted", () => {
  it("an archived recipe takes no new version and no new order; restoring brings it back", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box } = await twoMaterials(w);
    const made = await recipeOk(w.space.id, [{ materialId: box, qty: "1" }]);
    expect((await archiveRecipe(made.id, true)).status).toBe(200);
    expect((await recipesOf(w.space.id)).recipes[0]?.archived).toBe(true);
    expect(messages(await newVersion(made.id, [{ materialId: box, qty: "2" }]))).toContain("mfg.e.recipe_archived");
    expect(messages(await createOrder(w.space.id, made.id, "1"))).toContain("mfg.e.recipe_archived");
    expect((await archiveRecipe(made.id, false)).status).toBe(200);
    expect((await createOrder(w.space.id, made.id, "1")).status).toBe(201);
    expect(await db.recipe.count({ where: { id: made.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: { in: ["mfg.recipe_archived", "mfg.recipe_restored", "mfg.recipe_created"] }, workspaceId: w.space.id } })).toBe(3);
  });
});

describe("who may touch recipes", () => {
  it("a viewer reads and is refused with 403; a partner, a person outside the space, a person without the capability and the switch off get 404", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const { box } = await twoMaterials(w);
    const made = await recipeOk(w.space.id, [{ materialId: box, qty: "1" }]);
    await loginAs(w.viewer.id);
    expect((await createRecipe(w.space.id, [{ materialId: box, qty: "1" }])).status).toBe(403);
    expect((await newVersion(made.id, [{ materialId: box, qty: "2" }])).status).toBe(403);
    expect((await archiveRecipe(made.id, true)).status).toBe(403);
    expect((await createOrder(w.space.id, made.id, "1")).status).toBe(403);
    for (const who of [w.guest, w.plain, w.outsider]) {
      await loginAs(who.id);
      expect((await createRecipe(w.space.id, [{ materialId: box, qty: "1" }])).status, who.name).toBe(404);
      expect((await newVersion(made.id, [{ materialId: box, qty: "2" }])).status, who.name).toBe(404);
      expect((await archiveRecipe(made.id, true)).status, who.name).toBe(404);
    }
    await loginAs(w.owner.id);
    expect((await recipesOf(w.space.id)).recipes).toHaveLength(1);
    await featureOff(w.org.id);
    expect((await newVersion(made.id, [{ materialId: box, qty: "2" }])).status).toBe(404);
    expect((await archiveRecipe(made.id, true)).status).toBe(404);
    expect(await db.recipeVersion.count({ where: { recipeId: made.id } })).toBe(1);
  });
});
