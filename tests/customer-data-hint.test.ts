import { describe, expect, it } from "vitest";
import { customerDataHint, looksLikeOrderTemplate, MODEL_SENDING_FEATURES, showModelWarning } from "../src/lib/chat/customer-data-hint";
import { AR } from "../src/lib/i18n/dict";

/** Q1.7: what the chat says when customer data is typed into an open topic. Hints only: nothing is blocked, hidden or changed. */
const TEMPLATE = `الاسم: سلمى الأحمد
رقم الهاتف: 0791234567
المحافظة: عمان
العنوان: شارع الجامعة، بناية 5
المنتج: حراك
الكمية: 2`;

describe("the hand-typed order template", () => {
  it("is recognised by its labelled lines, however the letters are written", () => {
    expect(looksLikeOrderTemplate(TEMPLATE)).toBe(true);
    expect(looksLikeOrderTemplate("الإسم - أحمد\nالمحافظه - إربد\nالعنوان - وسط البلد")).toBe(true);
    expect(customerDataHint(TEMPLATE)).toBe("template");
  });
  it("an ordinary message, a single label or a question is not a template", () => {
    expect(looksLikeOrderTemplate("شو العنوان تبع المحل؟")).toBe(false);
    expect(looksLikeOrderTemplate("الاسم: أحمد")).toBe(false);
    expect(looksLikeOrderTemplate("الكمية: 3\nالسعر: 20")).toBe(false);
    expect(looksLikeOrderTemplate("")).toBe(false);
  });
});

describe("a phone-shaped number", () => {
  it("is a hint to put it in a ticket; an order number, a date and a price are not phones", () => {
    expect(customerDataHint("الزبون رقمه 0791234567")).toBe("phone");
    expect(customerDataHint("اتصلوا +962 79 123 4567")).toBe("phone");
    expect(customerDataHint("الطلب ZK-2026-000123 متأخر")).toBeNull();
    expect(customerDataHint("يوم 15-11-2026 الساعة 10")).toBeNull();
    expect(customerDataHint("السعر 45 دينار")).toBeNull();
    expect(customerDataHint("مرحبا")).toBeNull();
  });
  it("the template wins when a message is both", () => {
    expect(customerDataHint(TEMPLATE)).toBe("template");
  });
});

describe("the warning beside the three switches that send text to a model", () => {
  it("is for «@المساعد», «ترجم» and «بحث بالمعنى» only, and only while automatic tickets are on", () => {
    expect([...MODEL_SENDING_FEATURES].sort()).toEqual(["chatAssistant", "messageTranslate", "semanticSearch"]);
    const on = [{ key: "autoTickets", on: true }];
    const off = [{ key: "autoTickets", on: false }];
    for (const k of MODEL_SENDING_FEATURES) {
      expect(showModelWarning(on as never, k), k).toBe(true);
      expect(showModelWarning(off as never, k), k).toBe(false);
    }
    expect(showModelWarning(on as never, "watch" as never)).toBe(false);
  });
  it("its words exist", () => {
    expect(AR["features.model_warn"]).toBeTruthy();
    expect(AR["features.orderTemplateHint.name"]).toBeTruthy();
    expect(AR["features.orderTemplateHint.hint"]).toBeTruthy();
    expect(AR["hints.template"]).toBeTruthy();
    expect(AR["hints.phone"]).toBeTruthy();
  });
});
