import { describe, expect, it } from "vitest";
import { db, loginAs } from "./helpers";
import {
  costLot,
  detailOf,
  featureOff,
  issue,
  makeMaterial,
  mfgWorld,
  micro,
  overviewOf,
  receive,
  receiveOk,
  receiveUnpriced,
  receiveUnpricedOk,
  reverse,
} from "./mfg-helpers";

/**
 * «استلام بدون سعر»: a storekeeper who holds `manufacturing.edit` but not `manufacturing.cost` can still receive a lot. The lot is written with
 * its price UNSET (flagged), the quantity enters the ledger at value 0, and a holder of the cost fills the price ONCE later as a separate row
 * (the lot is never updated). Until then the lot is outside the weighted average, and the screen says so.
 */

const messages = (res: { json: Record<string, unknown> | null }) => ((res.json?.["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

describe("receiving without a price", () => {
  it("a keeper without the cost receives: the lot is flagged, the quantity is in the ledger at value 0, the material has no currency yet", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const id = await makeMaterial(w.space.id);
    const made = await receiveUnpricedOk(id, { qty: "10" });
    const lot = await db.materialLot.findUniqueOrThrow({ where: { id: made.lotId } });
    expect(lot).toMatchObject({ costPending: true, unitCostMinor: 0n, totalCostMinor: 0n, qtyMicro: BigInt(micro(10)) });
    const move = await db.materialMovement.findUniqueOrThrow({ where: { id: made.movementId } });
    expect(move).toMatchObject({ kind: "RECEIVE", qtyMicro: BigInt(micro(10)), valueMinor: 0n, lotId: lot.id });
    expect((await db.material.findUniqueOrThrow({ where: { id } })).currency).toBeNull();

    const seen = await detailOf(id);
    expect(seen).toMatchObject({ balanceMicro: micro(10), unpricedMicro: micro(10), canCost: false, cost: null });
    expect(seen.lots[0]).toMatchObject({ costPending: true, cost: null, canFillCost: false, costedLater: null });
    expect((await overviewOf(w.space.id)).materials[0]).toMatchObject({ unpricedMicro: micro(10), cost: null });
  });

  it("the priced receipt still needs the cost; an unpriced one carries no price or currency; both need their proof; a viewer and a partner are kept out", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const id = await makeMaterial(w.space.id);
    const priced = await receive(id);
    expect(priced.status).toBe(403);
    expect(priced.json?.["message"]).toBe("mfg.cost_denied");
    expect(messages(await receiveUnpriced(id, { unitCost: "1.5" }))).toContain("mfg.e.unpriced_has_cost");
    expect(messages(await receiveUnpriced(id, { currency: "JOD" }))).toContain("mfg.e.unpriced_has_cost");
    expect(messages(await receiveUnpriced(id, { proofNote: undefined }))).toContain("mfg.e.proof_required");
    expect(messages(await receiveUnpriced(id, { qty: "0" }))).toContain("mfg.e.qty");
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(0);
    await loginAs(w.viewer.id);
    expect((await receiveUnpriced(id)).status).toBe(403);
    await loginAs(w.guest.id);
    expect((await receiveUnpriced(id)).status).toBe(404);
    await loginAs(w.plain.id);
    expect((await receiveUnpriced(id)).status).toBe(404);
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(0);
  });

  it("the log says a lot was received without a price, and never a price", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const id = await makeMaterial(w.space.id);
    const made = await receiveUnpricedOk(id);
    const line = await db.auditLog.findFirstOrThrow({ where: { action: "mfg.received_unpriced", target: made.movementId } });
    expect(JSON.stringify(line.meta)).not.toMatch(/cost|price/i);
  });
});

describe("outside the average until it is priced", () => {
  it("the average is over the priced stock; a plain issue takes priced stock only and is refused beyond it, with the way out", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    await receiveOk(id, { qty: "10", unitCost: "2" });
    await loginAs(w.keeper.id);
    await receiveUnpricedOk(id, { qty: "10" });

    await loginAs(w.buyer.id);
    let seen = await detailOf(id);
    expect(seen.balanceMicro).toBe(micro(20));
    expect(seen.unpricedMicro).toBe(micro(10));
    // 10 units at 2.000 = 20.000; the unpriced 10 do not dilute it
    expect(seen.cost).toMatchObject({ currency: "JOD", valueMinor: 20_000, averageText: "2.000", formula: { value: "20.000", qty: "10", average: "2.000" } });

    await loginAs(w.keeper.id);
    const refused = await issue(id, "15");
    expect(refused.status).toBe(422);
    expect(messages(refused)).toContain("mfg.e.insufficient_priced");
    expect(await db.materialMovement.count({ where: { materialId: id, kind: "ISSUE" } })).toBe(0);
    expect((await issue(id, "4")).status).toBe(201);
    const move = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "ISSUE" } });
    expect(move.valueMinor).toBe(-8_000n); // 4 x 2.000, the unpriced lot did not change the price of what went out
    await loginAs(w.buyer.id);
    seen = await detailOf(id);
    expect(seen.cost).toMatchObject({ valueMinor: 12_000, averageText: "2.000" });
    expect(seen.unpricedMicro).toBe(micro(10));
  });
});

describe("filling the price, once", () => {
  async function pendingLot(w: Awaited<ReturnType<typeof mfgWorld>>, over: Record<string, unknown> = {}) {
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    await receiveOk(id, { qty: "10", unitCost: "2" });
    await loginAs(w.keeper.id);
    const made = await receiveUnpricedOk(id, { qty: "10", ...over });
    await loginAs(w.buyer.id);
    return { id, lotId: made.lotId };
  }

  it("a holder of the cost fills it: a separate row, the lot is untouched, and the lot joins the average from then on", async () => {
    const w = await mfgWorld();
    const { id, lotId } = await pendingLot(w);
    const before = await db.materialLot.findUniqueOrThrow({ where: { id: lotId } });
    const done = await costLot(lotId, { unitCost: "3", currency: "JOD" });
    expect(done.status, JSON.stringify(done.json)).toBe(201);
    const costing = await db.materialCosting.findUniqueOrThrow({ where: { lotId } });
    expect(costing).toMatchObject({ unitCostMinor: 3_000n, totalCostMinor: 30_000n, currency: "JOD", materialId: id, createdById: w.buyer.id });
    // the lot row is exactly what it was
    expect(await db.materialLot.findUniqueOrThrow({ where: { id: lotId } })).toEqual(before);

    const seen = await detailOf(id);
    expect(seen.unpricedMicro).toBe(0);
    expect(seen.lots.find((l) => l.id === lotId)).toMatchObject({ costPending: false, canFillCost: false, cost: { currency: "JOD", unitCostMinor: 3_000, totalCostMinor: 30_000 }, costedLater: { by: "Buyer" } });
    // 20.000 + 30.000 over 20 units = 2.500
    expect(seen.cost).toMatchObject({ valueMinor: 50_000, averageText: "2.500", formula: { value: "50.000", qty: "20", average: "2.500" } });
    // from now on a plain issue is valued at that average, and the book empties to exactly zero
    expect((await issue(id, "20")).status).toBe(201);
    const after = await detailOf(id);
    expect(after.balanceMicro).toBe(0);
    expect(after.cost).toMatchObject({ valueMinor: 0, averageText: null });
  });

  it("only once: a second price, even at the same moment from two people, is refused and the first stands", async () => {
    const w = await mfgWorld();
    const { lotId } = await pendingLot(w);
    const results = await Promise.all([costLot(lotId, { unitCost: "3" }), costLot(lotId, { unitCost: "5" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const loser = results.find((r) => r.status === 422)!;
    expect(messages(loser)).toContain("mfg.e.costing_not_pending");
    expect(await db.materialCosting.count({ where: { lotId } })).toBe(1);
    expect(messages(await costLot(lotId, { unitCost: "9" }))).toContain("mfg.e.costing_not_pending");
  });

  it("a lot that had a price from the start has none to fill; a lot taken back cannot be priced", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    const priced = await receiveOk(id, { qty: "5", unitCost: "1" });
    expect(messages(await costLot(priced.lotId))).toContain("mfg.e.costing_not_pending");
    await loginAs(w.keeper.id);
    const unpriced = await receiveUnpricedOk(id, { qty: "5" });
    expect((await reverse(unpriced.movementId)).status).toBe(201);
    await loginAs(w.buyer.id);
    expect(messages(await costLot(unpriced.lotId))).toContain("mfg.e.costing_reversed");
    expect(await db.materialCosting.count({ where: { materialId: id } })).toBe(0);
  });

  it("only the cost holder fills it: a keeper gets 403, a viewer 403, a partner and the switch off 404", async () => {
    const w = await mfgWorld();
    const { lotId } = await pendingLot(w);
    for (const [who, status] of [
      [w.keeper, 403],
      [w.viewer, 403],
      [w.guest, 404],
      [w.plain, 404],
      [w.outsider, 404],
    ] as const) {
      await loginAs(who.id);
      expect((await costLot(lotId)).status, who.name).toBe(status);
    }
    expect(await db.materialCosting.count({ where: { lotId } })).toBe(0);
    await loginAs(w.owner.id);
    await featureOff(w.org.id);
    expect((await costLot(lotId)).status).toBe(404);
    expect(await db.materialCosting.count({ where: { lotId } })).toBe(0);
  });

  it("one currency per material: the price is in the material's currency, and the first price fixes it when the material had none", async () => {
    const w = await mfgWorld();
    const { lotId } = await pendingLot(w);
    expect(messages(await costLot(lotId, { currency: "USD" }))).toContain("mfg.e.currency_mismatch");
    expect(messages(await costLot(lotId, { currency: "XXX" }))).toContain("mfg.e.currency");
    expect(messages(await costLot(lotId, { unitCost: "1.0005" }))).toContain("mfg.e.cost");
    expect(await db.materialCosting.count({ where: { lotId } })).toBe(0);

    // a material that only ever had unpriced lots takes its currency from the first price
    await loginAs(w.keeper.id);
    const fresh = await makeMaterial(w.space.id);
    const lot = await receiveUnpricedOk(fresh, { qty: "3" });
    await loginAs(w.buyer.id);
    expect((await costLot(lot.lotId, { currency: "USD", unitCost: "1.25" })).status).toBe(201);
    expect((await db.material.findUniqueOrThrow({ where: { id: fresh } })).currency).toBe("USD");
    expect((await receive(fresh, { currency: "JOD" })).status).toBe(422);
  });

  it("the log says which lot was priced and never the price", async () => {
    const w = await mfgWorld();
    const { lotId } = await pendingLot(w);
    expect((await costLot(lotId, { unitCost: "7.77" })).status).toBe(201);
    const line = await db.auditLog.findFirstOrThrow({ where: { action: "mfg.lot_costed", target: lotId } });
    expect(JSON.stringify(line.meta)).not.toMatch(/777|7\.77|cost|price/i);
  });

  it("the database keeps the price once and only for a lot received without one", async () => {
    const w = await mfgWorld();
    const { id, lotId } = await pendingLot(w);
    expect((await costLot(lotId)).status).toBe(201);
    const costing = await db.materialCosting.findUniqueOrThrow({ where: { lotId } });
    await expect(db.materialCosting.update({ where: { id: costing.id }, data: { totalCostMinor: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE "MaterialCosting" SET "unitCostMinor" = 1 WHERE "id" = ${costing.id}`).rejects.toThrow(/append-only/);
    await expect(db.materialCosting.delete({ where: { id: costing.id } })).rejects.toThrow(/append-only/);
    await expect(db.materialLot.update({ where: { id: lotId }, data: { costPending: false } })).rejects.toThrow(/append-only/);
    // a lot that came with its price takes no costing, whoever asks
    const priced = await db.materialLot.findFirstOrThrow({ where: { materialId: id, costPending: false } });
    await expect(
      db.materialCosting.create({ data: { orgId: w.org.id, workspaceId: w.space.id, materialId: id, lotId: priced.id, unitCostMinor: 1n, totalCostMinor: 1n, currency: "JOD", createdById: w.buyer.id } }),
    ).rejects.toThrow(/received without one/);
    // an unpriced lot carries no invented amount
    await expect(
      db.materialLot.create({
        data: { orgId: w.org.id, workspaceId: w.space.id, materialId: id, receivedOn: new Date(), qtyMicro: 1n, enteredQtyMicro: 1n, enteredUnitLabel: "علبة", unitCostMinor: 5n, totalCostMinor: 5n, currency: "JOD", costPending: true, proofNote: "x", createdById: w.buyer.id },
      }),
    ).rejects.toThrow();
  });
});
