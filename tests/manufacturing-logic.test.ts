import { describe, expect, it } from "vitest";
import {
  MICRO,
  averageFormula,
  averageText,
  balanceOf,
  currencyExponent,
  displayIn,
  formatMinor,
  formatQty,
  isDayText,
  isLow,
  lineTotalMinor,
  parseMinor,
  parseQtyMicro,
  parseScaled,
  toBaseMicro,
  valueOfIn,
  valueOfOut,
} from "@/lib/manufacturing/shared";

describe("exact quantities", () => {
  it("reads typed text into micro-units without a float, in any digit script", () => {
    expect(parseQtyMicro("12.5")).toBe(12_500_000n);
    expect(parseQtyMicro("١٢٫٥")).toBe(12_500_000n);
    expect(parseQtyMicro("1,250")).toBe(1_250_000_000n);
    expect(parseQtyMicro("0.000001")).toBe(1n);
    expect(parseQtyMicro("0")).toBe(0n);
  });

  it("refuses what is not a plain number: letters, exponents, too many decimals, empty", () => {
    for (const bad of ["", "abc", "1e3", "1.0000001", "--1", "1.2.3", "٣٫", "NaN", "Infinity"]) expect(parseQtyMicro(bad), bad).toBeNull();
    expect(parseQtyMicro("-5")).toBeNull();
    expect(parseQtyMicro("-5", { signed: true })).toBe(-5_000_000n);
    expect(parseQtyMicro("−5", { signed: true })).toBe(-5_000_000n);
  });

  it("formats back exactly (no 0.30000000000000004)", () => {
    expect(formatQty(300_000n)).toBe("0.3");
    expect(formatQty(1_250_500_000n)).toBe("1,250.5");
    expect(formatQty(-2_000_000)).toBe("-2");
    expect(formatQty(0n)).toBe("0");
    expect(parseQtyMicro("0.1")! + parseQtyMicro("0.2")!).toBe(parseQtyMicro("0.3"));
  });

  it("a conversion is an exact fraction: it turns into a whole number of base micro-units or it is refused", () => {
    const carton = { num: 24, den: 1 };
    expect(toBaseMicro(parseQtyMicro("3")!, carton)).toBe(72_000_000n);
    expect(toBaseMicro(parseQtyMicro("0.5")!, carton)).toBe(12_000_000n);
    const third = { num: 1, den: 3 };
    expect(toBaseMicro(3_000_000n, third)).toBe(1_000_000n);
    expect(toBaseMicro(1n, third)).toBeNull();
    expect(toBaseMicro(1_000_000n, third)).toBeNull();
  });

  it("shows a balance in another unit, rounded for the eyes only", () => {
    expect(displayIn(72_000_000n, { num: 24, den: 1 })).toBe("3");
    expect(displayIn(100_000_000n, { num: 24, den: 1 })).toBe("4.167");
    expect(displayIn(5_000_000n, { num: 1, den: 12 })).toBe("60");
  });
});

describe("exact money", () => {
  it("reads a price into minor units using the currency's own decimals, never rounding for the person", () => {
    expect(currencyExponent("JOD")).toBe(3);
    expect(currencyExponent("USD")).toBe(2);
    expect(parseMinor("12.5", "JOD")).toBe(12_500n);
    expect(parseMinor("12.5", "USD")).toBe(1_250n);
    expect(parseMinor("0.001", "JOD")).toBe(1n);
    expect(parseMinor("0.001", "USD")).toBeNull();
    expect(parseMinor("-1", "USD")).toBeNull();
    expect(formatMinor(12_500n, "JOD")).toBe("12.500");
    expect(formatMinor(123_456_789n, "USD")).toBe("1,234,567.89");
  });

  it("a receipt line total is the quantity times the price of one entered unit, rounded half-up once", () => {
    // 3 cartons at 12.500 JOD
    expect(lineTotalMinor(3_000_000n, 12_500n)).toBe(37_500n);
    // 0.5 of a carton at 0.001 JOD = 0.0005 -> 1 fils (half-up), 0.4 -> 0
    expect(lineTotalMinor(500_000n, 1n)).toBe(1n);
    expect(lineTotalMinor(400_000n, 1n)).toBe(0n);
    // 10 000 stickers at 0.0125: the price is typed per entered unit, so the total stays exact
    expect(lineTotalMinor(10_000n * MICRO, 12n)).toBe(120_000n);
  });
});

describe("the balance is the sum of the movements, and the weighted average comes from them", () => {
  const receive = (qty: string, total: bigint) => ({ qtyMicro: parseQtyMicro(qty)!, valueMinor: total });

  it("sums quantity and value", () => {
    const moves = [receive("100", 120_000n), { qtyMicro: -30_000_000n, valueMinor: -36_000n }];
    expect(balanceOf(moves)).toEqual({ qtyMicro: 70_000_000n, valueMinor: 84_000n });
  });

  it("an issue takes the share of the value at the average of that moment; the last unit takes what is left", () => {
    // 100 units worth 1200: average 12 per unit
    expect(valueOfOut(30_000_000n, 100_000_000n, 120_000n)).toBe(36_000n);
    // 3 of 7 units worth 10: 4.2857 -> 4
    expect(valueOfOut(3_000_000n, 7_000_000n, 10n)).toBe(4n);
    // everything out: the whole value, never a cent left over
    expect(valueOfOut(7_000_000n, 7_000_000n, 10n)).toBe(10n);
    expect(valueOfOut(8_000_000n, 7_000_000n, 10n)).toBe(10n);
    expect(valueOfOut(0n, 7_000_000n, 10n)).toBe(0n);
  });

  it("issuing in pieces and issuing in one go empty the book to exactly zero value", () => {
    let qty = 7_000_000n;
    let value = 10n;
    for (const out of [3_000_000n, 2_000_000n, 2_000_000n]) {
      const v = valueOfOut(out, qty, value);
      qty -= out;
      value -= v;
    }
    expect(qty).toBe(0n);
    expect(value).toBe(0n);
  });

  it("an adjustment that brings stock in is valued at the average, else at the last lot's price, else at nothing", () => {
    expect(valueOfIn(10_000_000n, 100_000_000n, 120_000n, null)).toBe(12_000n);
    expect(valueOfIn(10_000_000n, 0n, 0n, { qtyMicro: 50_000_000n, totalCostMinor: 100_000n })).toBe(20_000n);
    expect(valueOfIn(10_000_000n, 0n, 0n, null)).toBe(0n);
  });

  it("the average has the formula box's three numbers, with six decimals more than the currency, trimmed", () => {
    expect(averageText(120_000n, 100_000_000n, "JOD")).toBe("1.200");
    // a sticker: 1 fils for 3000 stickers is a third of a thousandth of a fils each, and the box still says so
    expect(averageText(1n, 3_000n * MICRO, "JOD")).toBe("0.000000333");
    expect(averageText(3n, 1_000n * MICRO, "JOD")).toBe("0.000003");
    expect(averageText(0n, 0n, "JOD")).toBeNull();
    expect(averageFormula(120_000n, 100_000_000n, "JOD")).toEqual({ value: "120.000", qty: "100", average: "1.200" });
    expect(averageFormula(5n, 0n, "JOD")).toBeNull();
  });
});

describe("low stock", () => {
  it("is marked at or under the threshold, never without one", () => {
    expect(isLow(5_000_000n, 5_000_000n)).toBe(true);
    expect(isLow(4_999_999n, 5_000_000n)).toBe(true);
    expect(isLow(5_000_001n, 5_000_000n)).toBe(false);
    expect(isLow(0n, null)).toBe(false);
    expect(isLow(0, undefined)).toBe(false);
  });
});

describe("dates and scaled numbers", () => {
  it("accepts only a real calendar day", () => {
    expect(isDayText("2026-11-01")).toBe(true);
    expect(isDayText("2026-02-30")).toBe(false);
    expect(isDayText("2026-1-1")).toBe(false);
    expect(isDayText(20261101)).toBe(false);
  });

  it("parseScaled keeps whole numbers whole at any scale", () => {
    expect(parseScaled("5", 3)).toBe(5_000n);
    expect(parseScaled("5.25", 0)).toBeNull();
  });
});
