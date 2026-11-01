import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { db, loginAs } from "./helpers";
import {
  addSupplier,
  addUnit,
  adjust,
  archiveUnit,
  count,
  day,
  decide,
  detail,
  detailOf,
  issue,
  makeMaterial,
  makeProof,
  micro,
  mfgWorld,
  overviewOf,
  patchMaterial,
  patchSupplier,
  receive,
  reverse,
  sums,
} from "./mfg-helpers";

/**
 * «مخزون التصنيع»: the ledger itself, against a real database. The balance is the SUM of the movements and nothing else; a lot and a
 * movement are written once (the database refuses an UPDATE and a plain DELETE); a mistake is a reversing movement; an issue is valued at the
 * weighted average of its moment and the value of the book empties to exactly zero with the stock; a balance never goes below zero even when two
 * people ask at once; a stocktake changes nothing until a second person approves it; money and quantity are exact integers.
 */

const body = (res: { json: Record<string, unknown> | null }) => res.json as Record<string, unknown>;
const issues = (res: { json: Record<string, unknown> | null }) => ((body(res)["details"] as { message: string }[] | undefined) ?? []).map((d) => d.message);

describe("materials, conversions and suppliers", () => {
  it("a material has its own base unit, an optional unique code and a low-stock threshold; it is archived, never deleted", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const id = await makeMaterial(w.space.id, { name: "ستكر", baseUnit: "ستكر", code: "ST-1", lowStock: "100" });
    const row = await db.material.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name: "ستكر", baseUnit: "ستكر", code: "ST-1", lowStockMicro: BigInt(micro(100)), currency: null, archivedAt: null });

    const dup = await (await import("@/app/api/manufacturing/materials/route")).POST(
      new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify({ spaceId: w.space.id, name: "ثاني", baseUnit: "ستكر", code: "ST-1" }), headers: { "content-type": "application/json" } }),
    );
    expect(dup.status).toBe(422);
    expect(await dup.text()).toContain("mfg.e.code_taken");
    expect((await patchMaterial(id, { name: "ستكر شفاف", lowStock: null })).status).toBe(200);
    expect(await db.material.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "ستكر شفاف", lowStockMicro: null });

    expect((await patchMaterial(id, { archived: true })).status).toBe(200);
    expect((await detailOf(id)).archived).toBe(true);
    expect((await issue(id, "1")).status).toBe(422); // an archived material moves nothing
    expect((await patchMaterial(id, { archived: false })).status).toBe(200);
    expect(await db.material.count({ where: { id } })).toBe(1);
  });

  it("a conversion is an exact fraction kept in lowest terms; an archived one comes back with new numbers; the base unit needs none", async () => {
    const w = await mfgWorld();
    await loginAs(w.keeper.id);
    const id = await makeMaterial(w.space.id, { baseUnit: "علبة" });
    const made = await addUnit(id, { label: "كرتونة", num: 48, den: 2 });
    expect(made.status).toBe(201);
    expect(await db.materialUnit.findFirstOrThrow({ where: { materialId: id } })).toMatchObject({ label: "كرتونة", num: 24, den: 1 });
    expect((await addUnit(id, { label: "كرتونة", num: 12 })).status).toBe(422);
    expect(issues(await addUnit(id, { label: "علبة", num: 1 }))).toContain("mfg.e.unit_is_base");
    expect((await addUnit(id, { label: "ن", num: 0 })).status).toBe(422);
    expect((await addUnit(id, { label: "ن", num: 1.5 })).status).toBe(422);
    const unitId = (await detailOf(id)).units[0]!.id;
    expect((await archiveUnit(id, unitId)).status).toBe(200);
    expect((await detailOf(id)).units[0]).toMatchObject({ archived: true });
    expect((await addUnit(id, { label: "كرتونة", num: 20 })).status).toBe(201);
    expect(await db.materialUnit.findMany({ where: { materialId: id } })).toHaveLength(1);
    expect((await detailOf(id)).units[0]).toMatchObject({ archived: false, num: 20 });
  });

  it("suppliers are kept as names with an optional note, archived instead of deleted, and an archived one cannot receive", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const made = await addSupplier(w.space.id, { name: "مورد القماش", note: "0790000000" });
    expect(made.status).toBe(201);
    const supplier = (made.json as unknown as { supplier: { id: string } }).supplier;
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { supplierId: supplier.id })).status).toBe(201);
    expect((await patchSupplier(supplier.id, { archived: true })).status).toBe(200);
    expect((await receive(id, { supplierId: supplier.id })).status).toBe(422);
    expect((await overviewOf(w.space.id)).suppliers[0]).toMatchObject({ name: "مورد القماش", archived: true });
    // a supplier of another space is not offered
    const foreign = await mfgWorld();
    await loginAs(foreign.buyer.id);
    const theirs = (await addSupplier(foreign.space.id)).json as unknown as { supplier: { id: string } };
    await loginAs(w.buyer.id);
    expect((await receive(id, { supplierId: theirs.supplier.id })).status).toBe(422);
    expect((await patchSupplier(theirs.supplier.id, { name: "x" })).status).toBe(404);
  });
});

describe("receiving a lot", () => {
  it("quantities in a conversion become exact base units; the total is exact; the proof is stored and the balance is the sum", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id, { baseUnit: "علبة" });
    await addUnit(id, { label: "كرتونة", num: 24 });
    const unitId = (await detailOf(id)).units[0]!.id;
    const proof = await makeProof(w.org.id, w.buyer.id);
    const res = await receive(id, { unitId, qty: "3", unitCost: "12.5", currency: "JOD", proofFileId: proof, proofNote: undefined, expiresOn: day(300), note: "فاتورة 55" });
    expect(res.status, JSON.stringify(res.json)).toBe(201);

    const lot = await db.materialLot.findFirstOrThrow({ where: { materialId: id } });
    expect(lot).toMatchObject({
      qtyMicro: BigInt(micro(72)),
      enteredQtyMicro: BigInt(micro(3)),
      enteredUnitLabel: "كرتونة",
      unitCostMinor: 12_500n,
      totalCostMinor: 37_500n,
      currency: "JOD",
      proofFileId: proof,
      proofNote: null,
    });
    const movement = await db.materialMovement.findFirstOrThrow({ where: { materialId: id } });
    expect(movement).toMatchObject({ kind: "RECEIVE", qtyMicro: BigInt(micro(72)), valueMinor: 37_500n, lotId: lot.id, createdById: w.buyer.id });
    expect(await db.material.findUniqueOrThrow({ where: { id } })).toMatchObject({ currency: "JOD" });

    const seen = await detailOf(id);
    expect(seen.balanceMicro).toBe(micro(72));
    expect(seen.lots[0]).toMatchObject({ qtyMicro: micro(72), enteredQtyMicro: micro(3), enteredUnitLabel: "كرتونة", proof: { id: proof, url: `/api/files/${proof}/raw` }, proofNote: null });
    expect(seen.lots[0]?.cost).toEqual({ currency: "JOD", unitCostMinor: 12_500, totalCostMinor: 37_500 });
    const s = await sums(id);
    expect(s.qty).toBe(BigInt(seen.balanceMicro));
    expect(s.value).toBe(37_500n);
  });

  it("a quantity that does not turn into a whole base quantity, and a price with more decimals than the currency, are refused, never rounded", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    await addUnit(id, { label: "ثلث", num: 1, den: 3 });
    const third = (await detailOf(id)).units[0]!.id;
    expect(issues(await receive(id, { unitId: third, qty: "0.000001" }))).toContain("mfg.e.qty_exact");
    expect(issues(await receive(id, { qty: "1.0000001" }))).toContain("mfg.e.qty");
    expect(issues(await receive(id, { qty: "0" }))).toContain("mfg.e.qty");
    expect(issues(await receive(id, { qty: "abc" }))).toContain("mfg.e.qty");
    expect(issues(await receive(id, { qty: "-3" }))).toContain("mfg.e.qty");
    expect(issues(await receive(id, { unitCost: "1.2345" }))).toContain("mfg.e.cost");
    expect(issues(await receive(id, { currency: "JOD", unitCost: "1.5555" }))).toContain("mfg.e.cost");
    expect((await receive(id, { currency: "USD", unitCost: "1.555" })).status).toBe(422);
    expect(issues(await receive(id, { currency: "XXX" }))).toContain("mfg.e.currency");
    expect(issues(await receive(id, { receivedOn: day(5) }))).toContain("mfg.e.date_future");
    expect(issues(await receive(id, { receivedOn: day(0), expiresOn: day(-3) }))).toContain("mfg.e.expiry");
    expect(issues(await receive(id, { receivedOn: "2026-02-30" }))).toContain("mfg.e.date");
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(0);
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(0);
    // rounding happens once, on the total: 0.5 of a thousandth of a unit at 1 fils
    expect((await receive(id, { qty: "0.5", unitCost: "0.001" })).status).toBe(201);
    expect((await db.materialLot.findFirstOrThrow({ where: { materialId: id } })).totalCostMinor).toBe(1n);
  });

  it("a receipt needs its proof: a photo, or a written reason; without either it is refused and nothing is written", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect(issues(await receive(id, { proofNote: undefined }))).toContain("mfg.e.proof_required");
    expect(issues(await receive(id, { proofNote: "   " }))).toContain("mfg.e.proof_required");
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(0);
    expect((await receive(id, { proofNote: "الإيصال ضاع" })).status).toBe(201);
    const lot = await db.materialLot.findFirstOrThrow({ where: { materialId: id } });
    expect(lot).toMatchObject({ proofFileId: null, proofNote: "الإيصال ضاع" });
    // shown with a warning: the screen reads the same fields
    expect((await detailOf(id)).lots[0]).toMatchObject({ proof: null, proofNote: "الإيصال ضاع" });
  });

  it("every lot of a material shares one currency, fixed by the first receipt", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { currency: "USD", unitCost: "2" })).status).toBe(201);
    expect(issues(await receive(id, { currency: "JOD", unitCost: "2" }))).toContain("mfg.e.currency_mismatch");
    expect((await receive(id, { currency: "USD", unitCost: "3" })).status).toBe(201);
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(2);
  });

  it("the weighted average is the value of the book over its quantity; an issue is valued at it; the last unit takes what is left", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id, { baseUnit: "ستكر" });
    expect((await receive(id, { qty: "100", unitCost: "1.2" })).status).toBe(201);
    expect((await receive(id, { qty: "100", unitCost: "1.4" })).status).toBe(201);
    let seen = await detailOf(id);
    expect(seen.balanceMicro).toBe(micro(200));
    expect(seen.cost).toMatchObject({ currency: "JOD", valueMinor: 260_000, averageText: "1.300", formula: { value: "260.000", qty: "200", average: "1.300" } });

    expect((await issue(id, "50")).status).toBe(201);
    let moves = await db.materialMovement.findMany({ where: { materialId: id, kind: "ISSUE" } });
    expect(moves[0]).toMatchObject({ qtyMicro: -BigInt(micro(50)), valueMinor: -65_000n });
    seen = await detailOf(id);
    expect(seen.cost).toMatchObject({ valueMinor: 195_000, averageText: "1.300" });

    expect((await issue(id, "149.999999")).status).toBe(201);
    expect((await issue(id, "0.000001")).status).toBe(201);
    seen = await detailOf(id);
    expect(seen.balanceMicro).toBe(0);
    // exactly zero: nothing is left over from rounding, and the book has no average to show
    expect(seen.cost).toMatchObject({ valueMinor: 0, averageText: null, formula: null });
    expect(await sums(id)).toEqual({ qty: 0n, value: 0n });
    moves = await db.materialMovement.findMany({ where: { materialId: id } });
    expect(moves.filter((m) => m.kind === "ISSUE")).toHaveLength(3);
    expect(moves.every((m) => (m.qtyMicro > 0n ? m.valueMinor >= 0n : m.valueMinor <= 0n))).toBe(true);
  });
});

describe("issuing and adjusting", () => {
  it("an issue needs a reason and never takes more than is in stock, even for two people asking at once", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10" })).status).toBe(201);
    expect(issues(await issue(id, "11"))).toContain("mfg.e.insufficient");
    expect(issues(await issue(id, "1", " "))).toContain("mfg.e.reason");
    expect(issues(await issue(id, "0"))).toContain("mfg.e.qty");
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(1);

    const results = await Promise.all([issue(id, "6"), issue(id, "6"), issue(id, "6")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect((await detailOf(id)).balanceMicro).toBe(micro(4));
    expect(await sums(id)).toEqual({ qty: BigInt(micro(4)), value: 6_000n });
  });

  it("a manual adjustment is signed, needs a reason, brings stock in at the average (or the last lot's price) and never below zero", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10", unitCost: "2" })).status).toBe(201);
    expect((await adjust(id, "-4", "انكسرت")).status).toBe(201);
    expect((await adjust(id, "2", "وجدنا علب")).status).toBe(201);
    const moves = await db.materialMovement.findMany({ where: { materialId: id, kind: "ADJUST" }, orderBy: { createdAt: "asc" } });
    expect(moves.map((m) => [m.qtyMicro, m.valueMinor, m.reason])).toEqual([
      [-BigInt(micro(4)), -8_000n, "انكسرت"],
      [BigInt(micro(2)), 4_000n, "وجدنا علب"],
    ]);
    expect((await detailOf(id)).balanceMicro).toBe(micro(8));
    expect(issues(await adjust(id, "-9"))).toContain("mfg.e.insufficient");
    expect(issues(await adjust(id, "0"))).toContain("mfg.e.qty");
    expect(issues(await adjust(id, "5", ""))).toContain("mfg.e.reason");
    // a keeper (no cost) adjusts too, and sees no value
    await loginAs(w.keeper.id);
    expect((await adjust(id, "-1")).status).toBe(201);
  });
});

describe("the ledger is append-only", () => {
  it("the database refuses to change or remove a movement or a lot, and the checks keep the numbers honest", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "5" })).status).toBe(201);
    expect((await issue(id, "1")).status).toBe(201);
    const m = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "ISSUE" } });
    const lot = await db.materialLot.findFirstOrThrow({ where: { materialId: id } });

    await expect(db.materialMovement.update({ where: { id: m.id }, data: { reason: "تعديل" } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE "MaterialMovement" SET "qtyMicro" = 1 WHERE "id" = ${m.id}`).rejects.toThrow(/append-only/);
    await expect(db.materialMovement.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "MaterialMovement" WHERE "materialId" = ${id}`).rejects.toThrow(/append-only/);
    await expect(db.materialLot.update({ where: { id: lot.id }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.materialLot.delete({ where: { id: lot.id } })).rejects.toThrow(/append-only/);
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(2);

    // the checks: a movement points the way its kind says, a lot has its proof, a conversion is a positive fraction
    const base = { orgId: w.org.id, workspaceId: w.space.id, materialId: id, createdById: w.buyer.id };
    await expect(db.materialMovement.create({ data: { ...base, kind: "ISSUE", qtyMicro: 5n, valueMinor: 0n } })).rejects.toThrow();
    await expect(db.materialMovement.create({ data: { ...base, kind: "RECEIVE", qtyMicro: 5n, valueMinor: 0n } })).rejects.toThrow(); // no lot
    await expect(db.materialMovement.create({ data: { ...base, kind: "ADJUST", qtyMicro: 5n, valueMinor: -1n } })).rejects.toThrow();
    await expect(db.materialMovement.create({ data: { ...base, kind: "ADJUST", qtyMicro: 0n, valueMinor: 0n } })).rejects.toThrow();
    await expect(db.materialMovement.create({ data: { ...base, kind: "NONSENSE", qtyMicro: 5n, valueMinor: 0n } })).rejects.toThrow();
    await expect(
      db.materialLot.create({ data: { ...base, receivedOn: new Date(), qtyMicro: 1n, enteredQtyMicro: 1n, enteredUnitLabel: "علبة", unitCostMinor: 1n, totalCostMinor: 1n, currency: "JOD" } }),
    ).rejects.toThrow(); // no proof at all
    await expect(
      db.materialLot.create({ data: { ...base, receivedOn: new Date(), qtyMicro: 1n, enteredQtyMicro: 1n, enteredUnitLabel: "علبة", unitCostMinor: -1n, totalCostMinor: 1n, currency: "JOD", proofNote: "x" } }),
    ).rejects.toThrow();
    await expect(
      db.materialLot.create({ data: { ...base, receivedOn: new Date(), qtyMicro: 1n, enteredQtyMicro: 1n, enteredUnitLabel: "علبة", unitCostMinor: 1n, totalCostMinor: 1n, currency: "jod", proofNote: "x" } }),
    ).rejects.toThrow();
    await expect(db.materialUnit.create({ data: { materialId: id, label: "س", num: 0, den: 1 } })).rejects.toThrow();
  });

  it("removing a space or a company still works: the cascade is the one delete the ledger allows", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { proofFileId: await makeProof(w.org.id, w.buyer.id), proofNote: undefined })).status).toBe(201);
    expect((await issue(id, "1")).status).toBe(201);
    await db.workspace.delete({ where: { id: w.space.id } });
    expect(await db.material.count({ where: { id } })).toBe(0);
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(0);
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(0);

    const v = await mfgWorld();
    await loginAs(v.buyer.id);
    const other = await makeMaterial(v.space.id);
    expect((await receive(other, { proofFileId: await makeProof(v.org.id, v.buyer.id), proofNote: undefined })).status).toBe(201);
    await db.organization.delete({ where: { id: v.org.id } });
    expect(await db.materialMovement.count({ where: { materialId: other } })).toBe(0);
  });
});

describe("a mistake is fixed by a reversing movement", () => {
  it("the reversal has the opposite quantity and value and points at the original, which stays; once only, never a reversal", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10", unitCost: "3" })).status).toBe(201);
    expect((await issue(id, "4")).status).toBe(201);
    const issued = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "ISSUE" } });

    const undone = await reverse(issued.id, "صرفناها للمادة الغلط");
    expect(undone.status).toBe(201);
    const reversal = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "REVERSE" } });
    expect(reversal).toMatchObject({ qtyMicro: -issued.qtyMicro, valueMinor: -issued.valueMinor, reversesId: issued.id, reason: "صرفناها للمادة الغلط" });
    expect(await db.materialMovement.findUniqueOrThrow({ where: { id: issued.id } })).toMatchObject({ qtyMicro: issued.qtyMicro, valueMinor: issued.valueMinor, reason: issued.reason });
    expect((await detailOf(id)).balanceMicro).toBe(micro(10));
    expect(await sums(id)).toEqual({ qty: BigInt(micro(10)), value: 30_000n });
    const movements = (await detailOf(id)).movements;
    expect(movements.find((m) => m.id === issued.id)).toMatchObject({ reversedById: reversal.id, canReverse: false });
    expect(movements.find((m) => m.id === reversal.id)).toMatchObject({ reversesId: issued.id, canReverse: false });

    expect(issues(await reverse(issued.id))).toContain("mfg.e.already_reversed");
    expect(issues(await reverse(reversal.id))).toContain("mfg.e.reverse_reverse");
    expect(issues(await reverse(issued.id, " "))).toContain("mfg.e.reason");
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(3);
  });

  it("two people reversing the same movement at once: only one reversal exists", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10" })).status).toBe(201);
    expect((await issue(id, "4")).status).toBe(201);
    const issued = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "ISSUE" } });
    const results = await Promise.all([reverse(issued.id), reverse(issued.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await db.materialMovement.count({ where: { reversesId: issued.id } })).toBe(1);
  });

  it("reversing a receipt takes its lot out; refused once the stock was used (the balance would go below zero)", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10", unitCost: "2" })).status).toBe(201);
    const received = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "RECEIVE" } });
    expect((await issue(id, "3")).status).toBe(201);
    expect(issues(await reverse(received.id))).toContain("mfg.e.reverse_negative");
    const issued = await db.materialMovement.findFirstOrThrow({ where: { materialId: id, kind: "ISSUE" } });
    expect((await reverse(issued.id)).status).toBe(201);
    expect((await reverse(received.id)).status).toBe(201);
    const seen = await detailOf(id);
    expect(seen.balanceMicro).toBe(0);
    expect(seen.lots[0]).toMatchObject({ reversed: true });
    expect(await sums(id)).toEqual({ qty: 0n, value: 0n });
    await loginAs(w.viewer.id);
    expect((await reverse(received.id)).status).toBe(403);
  });
});

describe("a stocktake changes nothing until a second person approves it", () => {
  async function pending(w: Awaited<ReturnType<typeof mfgWorld>>, counted: string, onHand = "10") {
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: onHand, unitCost: "2" })).status).toBe(201);
    await loginAs(w.keeper.id);
    const started = await count(id, counted, "جرد الخميس");
    expect(started.status, JSON.stringify(started.json)).toBe(201);
    return { id, countId: (started.json as unknown as { count: { id: string } }).count.id };
  }

  it("the count records what was counted, what the book said and the difference; the balance does not move", async () => {
    const w = await mfgWorld();
    const { id, countId } = await pending(w, "8");
    const row = await db.materialCount.findUniqueOrThrow({ where: { id: countId } });
    expect(row).toMatchObject({ countedQtyMicro: BigInt(micro(8)), expectedQtyMicro: BigInt(micro(10)), diffMicro: -BigInt(micro(2)), status: "PENDING", countedById: w.keeper.id, decidedById: null });
    expect((await detailOf(id)).balanceMicro).toBe(micro(10));
    expect(await db.materialMovement.count({ where: { materialId: id, kind: "COUNT_ADJUST" } })).toBe(0);
    expect((await overviewOf(w.space.id)).pending[0]).toMatchObject({ id: countId, canDecide: false, diffMicro: -micro(2) }); // the counter cannot decide his own
    expect((await overviewOf(w.space.id)).materials[0]).toMatchObject({ pendingCount: true });
    // one count waits per material
    expect(issues(await count(id, "9"))).toContain("mfg.e.count_pending");
  });

  it("the counter cannot approve his own count (403, and the database refuses it too)", async () => {
    const w = await mfgWorld();
    const { id, countId } = await pending(w, "8");
    const own = await decide(countId, "approve");
    expect(own.status).toBe(403);
    expect(own.json?.["message"]).toBe("mfg.second_person");
    expect((await decide(countId, "reject")).status).toBe(403);
    expect((await db.materialCount.findUniqueOrThrow({ where: { id: countId } })).status).toBe("PENDING");
    expect((await detailOf(id)).balanceMicro).toBe(micro(10));
    await expect(db.$executeRaw`UPDATE "MaterialCount" SET "status" = 'APPROVED', "decidedById" = "countedById" WHERE "id" = ${countId}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "MaterialCount" SET "status" = 'APPROVED' WHERE "id" = ${countId}`).rejects.toThrow(); // approved by nobody
    await expect(db.$executeRaw`UPDATE "MaterialCount" SET "status" = 'WHATEVER' WHERE "id" = ${countId}`).rejects.toThrow();
  });

  it("a second editor approves: one COUNT_ADJUST movement for the difference, valued at the average; a second decision is refused", async () => {
    const w = await mfgWorld();
    const { id, countId } = await pending(w, "8");
    await loginAs(w.buyer.id);
    expect((await overviewOf(w.space.id)).pending[0]).toMatchObject({ canDecide: true });
    const ok = await decide(countId, "approve", "وافقت");
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const moves = await db.materialMovement.findMany({ where: { materialId: id, kind: "COUNT_ADJUST" } });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ qtyMicro: -BigInt(micro(2)), valueMinor: -4_000n, countId, createdById: w.buyer.id, reason: "وافقت" });
    expect(await db.materialCount.findUniqueOrThrow({ where: { id: countId } })).toMatchObject({ status: "APPROVED", decidedById: w.buyer.id, decisionNote: "وافقت" });
    expect((await detailOf(id)).balanceMicro).toBe(micro(8));
    expect(await sums(id)).toEqual({ qty: BigInt(micro(8)), value: 16_000n });
    expect(issues(await decide(countId, "approve"))).toContain("mfg.e.count_decided");
    expect(await db.materialMovement.count({ where: { countId } })).toBe(1);
    // a surplus counts the other way
    await loginAs(w.keeper.id);
    const more = (await count(id, "9")).json as unknown as { count: { id: string } };
    await loginAs(w.buyer.id);
    expect((await decide(more.count.id, "approve")).status).toBe(200);
    expect((await detailOf(id)).balanceMicro).toBe(micro(9));
  });

  it("rejecting changes nothing; a count with no difference is matched at once and writes no movement", async () => {
    const w = await mfgWorld();
    const { id, countId } = await pending(w, "7");
    await loginAs(w.buyer.id);
    expect((await decide(countId, "reject", "عدّ مرة ثانية")).status).toBe(200);
    expect(await db.materialCount.findUniqueOrThrow({ where: { id: countId } })).toMatchObject({ status: "REJECTED", decidedById: w.buyer.id });
    expect((await detailOf(id)).balanceMicro).toBe(micro(10));
    expect(await db.materialMovement.count({ where: { materialId: id, kind: "COUNT_ADJUST" } })).toBe(0);

    const same = await count(id, "10");
    expect(same.status).toBe(201);
    expect((same.json as unknown as { count: { status: string } }).count.status).toBe("MATCHED");
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(1);
  });

  it("only an editor decides; the book moving since the count makes an approval stale", async () => {
    const w = await mfgWorld();
    const { id, countId } = await pending(w, "8");
    await loginAs(w.viewer.id);
    expect((await decide(countId, "approve")).status).toBe(403);
    await loginAs(w.buyer.id);
    expect((await issue(id, "1")).status).toBe(201);
    expect(issues(await decide(countId, "approve"))).toContain("mfg.e.count_stale");
    expect((await detailOf(id)).balanceMicro).toBe(micro(9));
    expect((await decide(countId, "reject")).status).toBe(200);
    // the owner is a second person too, and may count zero («the shelf is empty»)
    await loginAs(w.keeper.id);
    const empty = (await count(id, "0")).json as unknown as { count: { id: string; diffMicro: number } };
    expect(empty.count.diffMicro).toBe(-micro(9));
    await loginAs(w.owner.id);
    expect((await decide(empty.count.id, "approve")).status).toBe(200);
    expect(await sums(id)).toEqual({ qty: 0n, value: 0n });
  });

  it("a material with stock or a stocktake waiting cannot be archived", async () => {
    const w = await mfgWorld();
    const { id, countId } = await pending(w, "8");
    expect(issues(await patchMaterial(id, { archived: true }))).toContain("mfg.e.archive_balance");
    await loginAs(w.buyer.id);
    expect((await issue(id, "10")).status).toBe(201);
    expect(issues(await patchMaterial(id, { archived: true }))).toContain("mfg.e.archive_pending");
    expect((await decide(countId, "reject")).status).toBe(200);
    expect((await patchMaterial(id, { archived: true })).status).toBe(200);
  });
});

describe("low stock and the front page", () => {
  it("a material at or under its threshold is marked low; the front page lists balances from the movements", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const low = await makeMaterial(w.space.id, { name: "ب", lowStock: "5" });
    const fine = await makeMaterial(w.space.id, { name: "أ", lowStock: "5" });
    expect((await receive(low, { qty: "6" })).status).toBe(201);
    expect((await receive(fine, { qty: "6" })).status).toBe(201);
    expect((await issue(low, "1")).status).toBe(201);
    const seen = await overviewOf(w.space.id);
    expect(seen.materials.map((m) => [m.name, m.balanceMicro, m.low])).toEqual([
      ["أ", micro(6), false],
      ["ب", micro(5), true],
    ]);
    expect((await detail(low)).json).toMatchObject({ material: { low: true } });
  });

  it("the audit log says who did what and never a price", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10", unitCost: "7.777" })).status).toBe(201);
    const rows = await db.auditLog.findMany({ where: { orgId: w.org.id, action: { startsWith: "mfg." } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["mfg.material_created", "mfg.received"]);
    expect(JSON.stringify(rows.map((r) => r.meta as Prisma.JsonValue))).not.toMatch(/7\.777|7777|unitCost|totalCost/);
    expect(rows.every((r) => r.actorId === w.buyer.id && r.workspaceId === w.space.id)).toBe(true);
  });
});
