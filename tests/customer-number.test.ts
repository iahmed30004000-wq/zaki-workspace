import { describe, expect, it } from "vitest";
import { findCustomerNumbers, maskPhone, maskPhonesIn, normalizePhone } from "../src/lib/tickets/customer-number";

/** Q1.5: a customer's number — found with the existing phone pattern after order numbers are taken out, normalised, masked. */
describe("normalising a number", () => {
  it("keeps digits only and folds the country code into a leading zero", () => {
    expect(normalizePhone("0791234567")).toBe("0791234567");
    expect(normalizePhone("+962 79 123 4567")).toBe("0791234567");
    expect(normalizePhone("00962791234567")).toBe("0791234567");
    expect(normalizePhone("962-79-1234567")).toBe("0791234567");
    expect(normalizePhone("+963 944 123 456")).toBe("0944123456");
    expect(normalizePhone("٠٧٩١٢٣٤٥٦٧")).toBe("0791234567");
  });
  it("the same person written four ways is one number", () => {
    const set = new Set(["0791234567", "+962791234567", "٠٧٩١٢٣٤٥٦٧", "079 123 4567"].map(normalizePhone));
    expect(set.size).toBe(1);
  });
  it("refuses what is too short or too long to be a number", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("1".repeat(20))).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("finding the numbers in a message", () => {
  it("finds a phone number written in any way", () => {
    expect(findCustomerNumbers("الزبون رقمه 0791234567 ما بيرد")).toEqual(["0791234567"]);
    expect(findCustomerNumbers("اتصلوا ٠٧٩١٢٣٤٥٦٧ او +962 78 765 4321")).toEqual(["0791234567", "0787654321"]);
  });
  it("an order number is not a phone number, even with its long digits", () => {
    expect(findCustomerNumbers("الطلب ZK-2026-000123 متأخر")).toEqual([]);
    expect(findCustomerNumbers("الطلب ZK-2026-000123 والزبون 0791234567")).toEqual(["0791234567"]);
  });
  it("a date or a short number is not one", () => {
    expect(findCustomerNumbers("يوم 2026-10-30 الساعة 10")).toEqual([]);
    expect(findCustomerNumbers("3 قطع بـ 45 دينار")).toEqual([]);
  });
  it("the same number twice is found once", () => {
    expect(findCustomerNumbers("0791234567 وكمان +962791234567")).toEqual(["0791234567"]);
  });
});

describe("masking", () => {
  it("shows the first two and the last two digits only", () => {
    expect(maskPhone("0791234567")).toBe("07••••••67");
    expect(maskPhone("123")).toBe("•••");
  });
  it("masks every number inside a text, in any digits, and leaves order numbers and dates alone", () => {
    const out = maskPhonesIn("الزبون ٠٧٩١٢٣٤٥٦٧ والطلب ZK-2026-000123 يوم 2026-10-30");
    expect(out).toBe("الزبون 07••••••67 والطلب ZK-2026-000123 يوم 2026-10-30");
    expect(maskPhonesIn("بدون ارقام")).toBe("بدون ارقام");
    expect(maskPhonesIn("")).toBe("");
  });
});
