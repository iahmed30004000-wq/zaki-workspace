import { describe, expect, it } from "vitest";
import { costOfPieces, costWithShares, finishedLotCost, frac, largestRemainder, type CostPiece } from "@/lib/manufacturing/costing";

/**
 * «مخزون التصنيع», slice 3 — the pure arithmetic of the shares of an order's cost (largest remainder) and of the finished goods' cost.
 * The rule: the pieces of an order ALWAYS add up to its total, to the minor unit; the total is the exact sum rounded half-up once.
 */

const U = 1_000_000n;

/** A small deterministic generator (no Math.random: a failure must be reproducible). */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

describe("largest remainder", () => {
  it("floors everybody, then gives the missing units to the biggest remainders, the earlier piece first on a tie", () => {
    // 12.5 + 12.5 = 25: both remainders are one half, the earlier piece takes the extra unit
    expect(largestRemainder([frac(25n, 2n), frac(25n, 2n)], 25n)).toEqual([13n, 12n]);
    // 10/3 + 10/3 + 10/3 = 10: three equal thirds, one extra unit to the first
    expect(largestRemainder([frac(10n, 3n), frac(10n, 3n), frac(10n, 3n)], 10n)).toEqual([4n, 3n, 3n]);
    // the biggest remainder wins wherever it sits: 0.9 + 0.1 + 0.9 = 1.9 -> 2, the extra unit goes to the first 0.9 (not to the 0.1)
    expect(largestRemainder([frac(9n, 10n), frac(1n, 10n), frac(9n, 10n)], 2n)).toEqual([1n, 0n, 1n]);
    // whole numbers are untouched
    expect(largestRemainder([frac(7n), frac(5n)], 12n)).toEqual([7n, 5n]);
  });

  it("refuses a total that is not the exact sum rounded (an invariant, never a silent fix)", () => {
    expect(() => largestRemainder([frac(1n, 2n)], 5n)).toThrow(/mfg.shares_total/);
    expect(() => largestRemainder([frac(5n, 1n)], 3n)).toThrow(/mfg.shares_total/);
  });

  it("is deterministic: the same input always gives the same shares", () => {
    const exacts = [frac(7n, 3n), frac(7n, 3n), frac(11n, 6n), frac(5n, 6n)];
    const total = 7n; // 7/3 + 7/3 + 11/6 + 5/6 = 7.333.. + 2.666.. = 7
    expect(largestRemainder(exacts, total)).toEqual(largestRemainder(exacts, total));
  });
});

describe("the shares of an order's cost add up to its total, exactly (property)", () => {
  it("holds for hundreds of orders with many fractional costs, in any mix of lots and currencies", () => {
    const next = rng(20261106);
    for (let round = 0; round < 400; round++) {
      const count = 1 + Math.floor(next() * 14);
      const pieces: CostPiece[] = [];
      for (let i = 0; i < count; i++) {
        const lotQty = BigInt(1 + Math.floor(next() * 5000)) * 1000n + BigInt(Math.floor(next() * 999));
        const lotTotal = BigInt(Math.floor(next() * 200_000));
        const qty = 1n + BigInt(Math.floor(next() * Number(lotQty - 1n)));
        const currency = next() < 0.8 ? "JOD" : "USD";
        const kind = next();
        if (kind < 0.1) pieces.push({ currency, qtyMicro: qty, lot: { qtyMicro: lotQty, totalMinor: null }, valueMinor: 0n }); // a lot without a price
        else if (kind < 0.2) pieces.push({ currency, qtyMicro: qty, lot: null, valueMinor: BigInt(1 + Math.floor(next() * 5000)) }); // stock no lot holds
        else pieces.push({ currency, qtyMicro: qty, lot: { qtyMicro: lotQty, totalMinor: lotTotal }, valueMinor: 0n });
      }
      const { cost, shares } = costWithShares(pieces);
      // the total is exactly what costOfPieces says: the exact sum, rounded once
      expect(cost).toEqual(costOfPieces(pieces));
      for (const total of cost.byCurrency) {
        const mine = pieces.flatMap((p, i) => (shares[i]?.priced && shares[i]?.currency === total.currency && p.qtyMicro > 0n ? [shares[i]!.shareMinor] : []));
        expect(
          mine.reduce((a, b) => a + b, 0n),
          `round ${round} ${total.currency}`,
        ).toBe(total.totalMinor);
        // no piece is further than one minor unit from its exact amount
        pieces.forEach((p, i) => {
          const share = shares[i];
          if (!share?.priced || share.currency !== total.currency || p.qtyMicro <= 0n) return;
          const exact = p.lot ? (p.qtyMicro * (p.lot.totalMinor ?? 0n)) / p.lot.qtyMicro : p.valueMinor;
          expect(share.shareMinor === exact || share.shareMinor === exact + 1n, `piece ${i} of round ${round}`).toBe(true);
        });
      }
      // a piece without a price carries nothing and flags the cost incomplete
      shares.forEach((share, i) => {
        if (!share.priced) expect(share.shareMinor).toBe(0n);
        const piece = pieces[i]!;
        if (piece.lot && piece.lot.totalMinor === null && piece.qtyMicro > 0n) expect(share.priced).toBe(false);
      });
      expect(cost.complete).toBe(shares.every((s) => s.priced));
    }
  });

  it("a thousand pieces of a third of a minor unit each add up to the rounded sum", () => {
    // each piece: 1/3 of a minor unit; 1000 of them = 333.33.. -> 333
    const piece: CostPiece = { currency: "JOD", qtyMicro: U, lot: { qtyMicro: 3n * U, totalMinor: 1n }, valueMinor: 0n };
    const pieces = Array.from({ length: 1000 }, () => piece);
    const { cost, shares } = costWithShares(pieces);
    expect(cost.byCurrency[0]?.totalMinor).toBe(333n);
    expect(shares.reduce((sum, s) => sum + s.shareMinor, 0n)).toBe(333n);
    // 333 pieces carry one unit and the rest nothing, the earliest first
    expect(shares.slice(0, 333).every((s) => s.shareMinor === 1n)).toBe(true);
    expect(shares.slice(333).every((s) => s.shareMinor === 0n)).toBe(true);
  });
});

describe("the finished goods' cost", () => {
  it("the lot carries the order's whole cost; the unit cost is total ÷ output rounded half-up once", () => {
    // 10.000 JOD (10000 minor) over 3 units: 3333.33.. minor per unit -> 3333
    expect(finishedLotCost(10_000n, 3n * U)).toEqual({ totalMinor: 10_000n, unitCostMinor: 3_333n });
    // a half rounds up: 5 minor over 2 units = 2.5 -> 3
    expect(finishedLotCost(5n, 2n * U)).toEqual({ totalMinor: 5n, unitCostMinor: 3n });
    // a fraction of a unit of output: 4500 over 0.5 -> 9000 per unit
    expect(finishedLotCost(4_500n, U / 2n)).toEqual({ totalMinor: 4_500n, unitCostMinor: 9_000n });
    // a free order costs nothing and is still a lot
    expect(finishedLotCost(0n, U)).toEqual({ totalMinor: 0n, unitCostMinor: 0n });
  });

  it("refuses an output of nothing or a negative cost", () => {
    expect(() => finishedLotCost(100n, 0n)).toThrow(/mfg.finished_cost/);
    expect(() => finishedLotCost(-1n, U)).toThrow(/mfg.finished_cost/);
  });

  it("the unit cost times the output is within half a minor unit per unit of the exact total, always", () => {
    const next = rng(77);
    for (let i = 0; i < 300; i++) {
      const total = BigInt(Math.floor(next() * 1_000_000));
      const output = BigInt(1 + Math.floor(next() * 50_000_000));
      const { unitCostMinor } = finishedLotCost(total, output);
      // |unit - total*U/output| <= 1/2  <=>  |2*unit*output - 2*total*U| <= output
      const diff = 2n * unitCostMinor * output - 2n * total * U;
      expect((diff < 0n ? -diff : diff) <= output).toBe(true);
    }
  });
});
