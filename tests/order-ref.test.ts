import { describe, expect, it } from "vitest";
import { findOrderNumbers, isOrderNumber, splitOrderNumbers, stateKey } from "../src/lib/oms/order-ref";

/** Q1.4: what counts as an order number (the orders system's own shape) and what never does. */
describe("order numbers", () => {
  it("accepts the shapes of the orders system", () => {
    expect(isOrderNumber("ZK-2026-000123")).toBe(true);
    expect(isOrderNumber("A1-1234-5678")).toBe(true);
    expect(isOrderNumber("ZAKI2026X-0001-1234")).toBe(true);
  });
  it("refuses a phone number, however it is written", () => {
    for (const phone of ["0791234567", "+962791234567", "079-1234-5678", "962-7912-345678", "00962-7912-34567"]) {
      expect(isOrderNumber(phone), phone).toBe(false);
      expect(findOrderNumbers(`رقمه ${phone} اتصلوا فيه`), phone).toEqual([]);
    }
  });
  it("refuses a wrong shape: lower case, short parts, long parts", () => {
    for (const bad of ["zk-2026-000123", "ZK-26-000123", "ZK-2026-123", "ZK-2026-123456789", "TOOLONGPREFIX-2026-1234", "ZK_2026_1234", "ZK-2026-12a4"]) expect(isOrderNumber(bad), bad).toBe(false);
  });
  it("finds the numbers inside a message, as whole words only", () => {
    const text = "الطلب ZK-2026-000123 متأخر وكمان A1-1234-5678، بس XZK-2026-000123X لا";
    expect(findOrderNumbers(text).map((h) => h.number)).toEqual(["ZK-2026-000123", "A1-1234-5678"]);
    expect(findOrderNumbers("ZK-2026-0001234-9999")).toEqual([]);
  });
  it("cuts a text into plain pieces and numbers, losing nothing", () => {
    const text = "شو وضع ZK-2026-000123؟ و A1-1234-5678";
    const parts = splitOrderNumbers(text);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.order).map((p) => p.text)).toEqual(["ZK-2026-000123", "A1-1234-5678"]);
    expect(splitOrderNumbers("")).toEqual([]);
  });
  it("a state word is made into a safe key or nothing", () => {
    expect(stateKey("Shipped")).toBe("shipped");
    expect(stateKey("on-hold")).toBe("on_hold");
    expect(stateKey("<script>")).toBeNull();
    expect(stateKey("constructor ")).toBe("constructor");
    expect(stateKey(5)).toBeNull();
    expect(stateKey("")).toBeNull();
  });
});

import { AR } from "../src/lib/i18n/dict";
import { KNOWN_ORDER_STATES, orderStateLabelKey } from "../src/lib/oms/order-ref";

describe("the Arabic words of the order states", () => {
  it("every known state has its word, and the dictionary has no state the list does not know", () => {
    for (const k of KNOWN_ORDER_STATES) expect(AR[`order.state.${k}`], k).toBeTruthy();
    const inDict = Object.keys(AR).filter((k) => k.startsWith("order.state.") && k !== "order.state.unknown");
    expect(inDict.sort()).toEqual(KNOWN_ORDER_STATES.map((k) => `order.state.${k}`).sort());
  });
  it("an unknown or invented word shows «حالة غير معروفة», never itself", () => {
    for (const w of ["teleported", "constructor", "__proto__", "", null, undefined]) {
      expect(orderStateLabelKey(w as string | null)).toBe("order.state.unknown");
    }
    expect(AR["order.state.unknown"]).toBe("حالة غير معروفة");
    expect(orderStateLabelKey("shipped")).toBe("order.state.shipped");
  });
});
