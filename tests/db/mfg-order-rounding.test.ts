import { describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import {
  addUnit,
  completeOrder,
  issueOrder,
  makeMaterial,
  mfgWorld,
  orderOk,
  orderView,
  receiveOk,
  recipeOk,
  type MfgWorld,
} from "./mfg-helpers";

/**
 * Rounding consistency (slice 3): the cost of an order is the exact sum of what it took, rounded half-up ONCE, and the pieces it is made of add up to it
 * to the minor unit. The rounding is distributed over the order's issue movements by the largest-remainder method, in a fixed order, so the same order
 * always gives the same split. Once the order is completed the split is written (`ProductionOrderCostLine`, one row per issue movement) and never changes.
 */

function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** Round half-up of a/b for positive bigints (the one rounding the ledger uses). */
const divRound = (a: bigint, b: bigint) => (a * 2n + b) / (b * 2n);

/**
 * `count` materials, each with ONE lot bought by the carton (a carton is `k` base units, `price` minor units a carton), so one base unit costs the
 * fraction price/k of a minor unit; a recipe takes `take` base units of each per jar. Returns the exact cost of ONE jar's worth as a fraction.
 */
async function fractionalPlant(w: MfgWorld, seed: number, count: number) {
  const next = rng(seed);
  await loginAs(w.buyer.id);
  const lines: { materialId: string; qty: string }[] = [];
  let exactNum = 0n;
  let exactDen = 1n;
  const pieces: { n: bigint; d: bigint }[] = [];
  for (let i = 0; i < count; i++) {
    const k = 2 + Math.floor(next() * 8); // base units in a carton: 2..9
    const price = 1 + Math.floor(next() * 997); // minor units a carton
    const take = 1 + Math.floor(next() * (k - 1)); // base units one jar takes: 1..k-1
    const id = await makeMaterial(w.space.id, { name: `مادة ${i}`, baseUnit: "غرام" });
    expect((await addUnit(id, { label: "كرتونة", num: k, den: 1 })).status).toBe(201);
    const carton = (await db.materialUnit.findFirstOrThrow({ where: { materialId: id } })).id;
    await receiveOk(id, { qty: "1", unitId: carton, unitCost: (price / 1000).toFixed(3) });
    lines.push({ materialId: id, qty: String(take) });
    // the piece costs take/k of the carton: take*price/k minor units, exactly
    const n = BigInt(take) * BigInt(price);
    const d = BigInt(k);
    pieces.push({ n, d });
    exactNum = exactNum * d + n * exactDen;
    exactDen = exactDen * d;
  }
  await loginAs(w.keeper.id);
  const recipe = await recipeOk(w.space.id, lines, { name: "منتج", outputUnit: "قطعة" });
  return { recipe: recipe.id, exact: { n: exactNum, d: exactDen }, lines, pieces };
}

describe("an order's cost equals the sum of its pieces, to the minor unit", () => {
  it("holds for orders of many fractional costs, before and after completion, and the split is the same every time", async () => {
    const w = await mfgWorld();
    for (const [seed, count] of [
      [1, 7],
      [2, 12],
      [3, 20],
    ] as const) {
      const p = await fractionalPlant(w, seed, count);
      const order = await orderOk(w.space.id, p.recipe, "1");
      expect((await issueOrder(order.id)).status).toBe(200);
      await loginAs(w.buyer.id);

      // the total is the exact sum rounded ONCE
      const expectedTotal = divRound(p.exact.n, p.exact.d);
      const open = await orderView(w.space.id, order.id);
      expect(open.cost?.totals).toEqual([{ currency: "JOD", totalMinor: Number(expectedTotal), perUnitText: null }]);
      const shownPieces = open.cost!.lines.flatMap((l) => l.pieces.map((x) => x.amountMinor!));
      expect(shownPieces).toHaveLength(count);
      // the pieces the screen lists add up to the total it shows
      expect(shownPieces.reduce((a, b) => a + b, 0)).toBe(Number(expectedTotal));
      // none is further than one minor unit from its exact amount (the floor, or the floor + 1), and the ones rounded UP are the ones with the biggest remainders
      const up: number[] = [];
      const down: number[] = [];
      shownPieces.forEach((amount, i) => {
        const piece = p.pieces[i]!;
        const floor = Number(piece.n / piece.d);
        expect([floor, floor + 1], `piece ${i} of seed ${seed}`).toContain(amount);
        if (piece.n % piece.d !== 0n) (amount === floor + 1 ? up : down).push(i);
      });
      for (const u of up) {
        for (const d of down) {
          const ru = p.pieces[u]!.n % p.pieces[u]!.d;
          const rd = p.pieces[d]!.n % p.pieces[d]!.d;
          // remainder(u) / den(u) >= remainder(d) / den(d)
          expect(ru * p.pieces[d]!.d >= rd * p.pieces[u]!.d, `up ${u} vs down ${d} (seed ${seed})`).toBe(true);
        }
      }

      // completed: the split is written once, one row per issue movement, adding up to the same total, and it is the same split
      await loginAs(w.keeper.id);
      expect((await completeOrder(order.id, { actualQty: "1" })).status).toBe(200);
      const rows = await db.productionOrderCostLine.findMany({ where: { orderId: order.id }, orderBy: { position: "asc" } });
      expect(rows).toHaveLength(count);
      expect(rows.reduce((sum, r) => sum + r.valueMinor, 0n)).toBe(expectedTotal);
      expect(rows.map((r) => Number(r.valueMinor))).toEqual(shownPieces);
      // each row points at ONE issue movement of the order, once
      const links = await db.productionOrderMovement.findMany({ where: { orderId: order.id } });
      expect(new Set(rows.map((r) => r.movementId))).toEqual(new Set(links.map((l) => l.movementId)));
      await loginAs(w.buyer.id);
      const done = await orderView(w.space.id, order.id);
      expect(done.cost).toMatchObject({ frozen: true, totals: [{ totalMinor: Number(expectedTotal) }] });
      expect(done.cost!.lines.flatMap((l) => l.pieces.map((x) => x.amountMinor!))).toEqual(shownPieces);
      await loginAs(w.keeper.id);
    }
  });

  it("each piece is its exact amount rounded down or up by one minor unit, and the biggest remainders are the ones rounded up", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    // four materials, each a carton of 3 base units at 0.010 (10 minor): a jar takes 1 base unit of each = 10/3 = 3.333.. minor each, 13.33.. in all -> 13
    const lines: { materialId: string; qty: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await makeMaterial(w.space.id, { name: `م${i}`, baseUnit: "غرام" });
      expect((await addUnit(id, { label: "كرتونة", num: 3, den: 1 })).status).toBe(201);
      const carton = (await db.materialUnit.findFirstOrThrow({ where: { materialId: id } })).id;
      await receiveOk(id, { qty: "1", unitId: carton, unitCost: "0.01" });
      lines.push({ materialId: id, qty: "1" });
    }
    await loginAs(w.keeper.id);
    const recipe = await recipeOk(w.space.id, lines, { name: "منتج", outputUnit: "قطعة" });
    const order = await orderOk(w.space.id, recipe.id, "1");
    expect((await issueOrder(order.id)).status).toBe(200);
    await loginAs(w.buyer.id);
    const seen = await orderView(w.space.id, order.id);
    expect(seen.cost?.totals[0]?.totalMinor).toBe(13);
    // 3 + 3 + 3 + 3 = 12, one unit missing: the first piece (equal remainders, the earlier piece first) takes it
    expect(seen.cost?.lines.map((l) => l.pieces[0]?.amountMinor)).toEqual([4, 3, 3, 3]);
  });

  it("the ledger's own movements are not rewritten: they keep the value each lot's cost line gave them", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id, { name: "طحين", baseUnit: "غرام" });
    expect((await addUnit(id, { label: "كرتونة", num: 3, den: 1 })).status).toBe(201);
    const carton = (await db.materialUnit.findFirstOrThrow({ where: { materialId: id } })).id;
    await receiveOk(id, { qty: "1", unitId: carton, unitCost: "0.01" });
    await loginAs(w.keeper.id);
    const recipe = await recipeOk(w.space.id, [{ materialId: id, qty: "1" }], { name: "منتج", outputUnit: "قطعة" });
    for (let i = 0; i < 3; i++) {
      const order = await orderOk(w.space.id, recipe.id, "1");
      expect((await issueOrder(order.id)).status).toBe(200);
      expect((await completeOrder(order.id, { actualQty: "1" })).status).toBe(200);
    }
    // three jars used the whole carton: its 10 minor units are spent exactly (3 + 4 + 3, the cost line of the lot), the book is empty and worth nothing
    const moves = await db.materialMovement.findMany({ where: { materialId: id, kind: "ISSUE" }, orderBy: { createdAt: "asc" } });
    expect(moves.reduce((sum, m) => sum - m.valueMinor, 0n)).toBe(10n);
    const bal = await db.$queryRaw<{ q: unknown; v: unknown }[]>`SELECT SUM("qtyMicro")::text AS q, SUM("valueMinor")::text AS v FROM "MaterialMovement" WHERE "materialId" = ${id}`;
    expect(String(bal[0]?.q)).toBe("0");
    expect(String(bal[0]?.v)).toBe("0");
  });
});
