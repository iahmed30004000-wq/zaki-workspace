import { describe, expect, it } from "vitest";
import {
  costOfPieces,
  frac,
  fracAdd,
  fracRound,
  lotShare,
  perUnitText,
  planFifo,
  positionOf,
  requiredMicro,
  type LotFacts,
} from "@/lib/manufacturing/costing";

/**
 * «مخزون التصنيع», slice 2 — the pure arithmetic: lots as layers, the average with an unpriced lot in the book, first-in-first-out issuing
 * and the exact cost of an order. Quantities are micro-units (1 unit = 1 000 000), money minor units; everything is a bigint.
 */

const U = 1_000_000n;
const lot = (id: string, units: bigint, total: bigint | null, over: Partial<LotFacts> = {}): LotFacts => ({
  id,
  qtyMicro: units * U,
  totalMinor: total,
  lateCosted: false,
  flowQtyMicro: units * U,
  flowValueMinor: total ?? 0n,
  ...over,
});
const none = { qtyMicro: 0n, valueMinor: 0n };

describe("a lot's cost line", () => {
  it("a lot used up in pieces carries exactly its total, to the last minor unit", () => {
    // 100 minor units over three equal pieces: 33, 34, 33 - never 99 or 101
    const piece = (used: bigint, take: bigint) => lotShare(used + take, 3n * U, 100n) - lotShare(used, 3n * U, 100n);
    const parts = [piece(0n, U), piece(U, U), piece(2n * U, U)];
    expect(parts).toEqual([33n, 34n, 33n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(lotShare(3n * U, 3n * U, 100n)).toBe(100n);
    expect(lotShare(0n, 3n * U, 100n)).toBe(0n);
  });

  it("an order's total is rounded ONCE from the exact sum, not piece by piece", () => {
    // three pieces of half a minor unit each: the exact sum is 1.5 -> 2; rounding each piece first would give 3
    const piece = { currency: "JOD", qtyMicro: U, lot: { qtyMicro: 2n * U, totalMinor: 1n }, valueMinor: 0n };
    const cost = costOfPieces([piece, piece, piece]);
    expect(cost.complete).toBe(true);
    expect(cost.byCurrency.map((c) => [c.currency, c.totalMinor])).toEqual([["JOD", 2n]]);
    expect(fracRound(fracAdd(frac(1n, 2n), fracAdd(frac(1n, 2n), frac(1n, 2n))))).toBe(2n);
  });
});

describe("the position of a material", () => {
  it("with no unpriced lot it is the plain sum: the average is taken over the whole balance", () => {
    const pos = positionOf([lot("a", 10n, 100n), lot("b", 10n, 300n)], none);
    expect(pos).toMatchObject({ qtyMicro: 20n * U, valueMinor: 400n, ledgerValueMinor: 400n, lateValueMinor: 0n, unpricedQtyMicro: 0n, pricedQtyMicro: 20n * U });
  });

  it("an unpriced lot is in the balance but outside the average", () => {
    const pos = positionOf([lot("a", 10n, 100n), lot("p", 10n, null)], none);
    expect(pos.qtyMicro).toBe(20n * U);
    expect(pos.unpricedQtyMicro).toBe(10n * U);
    expect(pos.pricedQtyMicro).toBe(10n * U);
    expect(pos.valueMinor).toBe(100n);
  });

  it("the price filled in later brings the value of what is left of the lot, once", () => {
    // received without a price (value 0), priced afterwards at 100: the whole lot is worth 100
    const priced = positionOf([lot("p", 10n, 100n, { lateCosted: true, flowValueMinor: 0n })], none);
    expect(priced).toMatchObject({ valueMinor: 100n, lateValueMinor: 100n, unpricedQtyMicro: 0n, pricedQtyMicro: 10n * U });
    // 4 of its 10 went into an order BEFORE the price (the issue was written at value 0): the price brings the value of the 6 that are left
    const used = positionOf([lot("p", 10n, 100n, { lateCosted: true, flowQtyMicro: 6n * U, flowValueMinor: 0n })], none);
    expect(used).toMatchObject({ qtyMicro: 6n * U, valueMinor: 60n, pricedQtyMicro: 6n * U });
    // 4 went AFTER the price (written at 40): the ledger already took 40 off, the correction still adds the whole 100 less what was used before
    const after = positionOf([lot("p", 10n, 100n, { lateCosted: true, flowQtyMicro: 6n * U, flowValueMinor: -40n })], none);
    expect(after.valueMinor).toBe(60n);
  });

  it("a plain issue comes out of the priced lots, oldest first, and never out of the unpriced one", () => {
    // a (priced, 10), p (pending, 10), b (priced, 10); a plain issue of 12 was written (no lot)
    const pos = positionOf([lot("a", 10n, 100n), lot("p", 10n, null), lot("b", 10n, 200n)], { qtyMicro: -12n * U, valueMinor: -140n });
    expect(pos.layers.map((l) => [l.lotId, l.availMicro])).toEqual([
      ["a", 0n],
      ["p", 10n * U],
      ["b", 8n * U],
    ]);
    expect(pos.qtyMicro).toBe(18n * U);
    expect(pos.pricedQtyMicro).toBe(8n * U);
  });
});

describe("first in, first out", () => {
  it("takes the oldest lot first and values each piece by that lot's own price", () => {
    const pos = positionOf([lot("a", 10n, 100n), lot("b", 10n, 300n)], none);
    const plan = planFifo(pos, 14n * U);
    expect(plan.shortfall).toBe(0n);
    expect(plan.pieces).toEqual([
      { lotId: "a", qtyMicro: 10n * U, valueMinor: 100n, unpriced: false },
      { lotId: "b", qtyMicro: 4n * U, valueMinor: 120n, unpriced: false },
    ]);
  });

  it("a piece from an unpriced lot has no value and is flagged: never invented", () => {
    const pos = positionOf([lot("p", 5n, null), lot("b", 10n, 300n)], none);
    const plan = planFifo(pos, 7n * U);
    expect(plan.pieces).toEqual([
      { lotId: "p", qtyMicro: 5n * U, valueMinor: 0n, unpriced: true },
      { lotId: "b", qtyMicro: 2n * U, valueMinor: 60n, unpriced: false },
    ]);
  });

  it("reports what is short, and takes unlotted stock after the lots", () => {
    const pos = positionOf([lot("a", 3n, 30n)], { qtyMicro: 2n * U, valueMinor: 50n });
    const plan = planFifo(pos, 4n * U);
    expect(plan.pieces).toEqual([
      { lotId: "a", qtyMicro: 3n * U, valueMinor: 30n, unpriced: false },
      { lotId: null, qtyMicro: U, valueMinor: 25n, unpriced: false },
    ]);
    expect(planFifo(pos, 9n * U).shortfall).toBe(4n * U);
  });

  it("a lot used in two orders carries its total exactly across the two", () => {
    // 100 over 3 units: the first order takes 1 (33), the second the other 2 (67)
    const first = planFifo(positionOf([lot("a", 3n, 100n)], none), U);
    expect(first.pieces[0]?.valueMinor).toBe(33n);
    const second = planFifo(positionOf([lot("a", 3n, 100n, { flowQtyMicro: 2n * U, flowValueMinor: 67n })], none), 2n * U);
    expect(second.pieces[0]?.valueMinor).toBe(67n);
  });
});

describe("the cost of an order", () => {
  it("is the exact sum of its pieces, per currency; a piece with no price marks it incomplete and adds nothing", () => {
    const cost = costOfPieces([
      { currency: "JOD", qtyMicro: 4n * U, lot: { qtyMicro: 10n * U, totalMinor: 100n }, valueMinor: 0n },
      { currency: "JOD", qtyMicro: 2n * U, lot: { qtyMicro: 5n * U, totalMinor: null }, valueMinor: 0n },
      { currency: "USD", qtyMicro: U, lot: null, valueMinor: 250n },
    ]);
    expect(cost.complete).toBe(false);
    expect(cost.byCurrency.map((c) => [c.currency, c.totalMinor])).toEqual([
      ["JOD", 40n],
      ["USD", 250n],
    ]);
    expect(costOfPieces([{ currency: "JOD", qtyMicro: U, lot: null, valueMinor: 0n }]).complete).toBe(false);
  });

  it("the cost of one output unit is the exact total over the real output, with six decimals more than the currency", () => {
    const cost = costOfPieces([{ currency: "JOD", qtyMicro: U, lot: { qtyMicro: U, totalMinor: 1000n }, valueMinor: 0n }]).byCurrency[0]!;
    expect(perUnitText(cost, 3n * U)).toBe("0.333333333");
    expect(perUnitText(cost, 0n)).toBeNull();
  });

  it("what an order needs is the recipe quantity times the plan, rounded once; a tiny one rounds to zero (and is refused by the service)", () => {
    expect(requiredMicro(12_500n, 7n * U)).toBe(87_500n);
    expect(requiredMicro(1n, 1n)).toBe(0n);
  });
});
