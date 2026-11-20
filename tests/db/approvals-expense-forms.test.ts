import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/approvals",
}));

import { DetailBody } from "@/components/approvals/detail-view";
import { FillBridge } from "@/components/approvals/fill-bridge";
import { FormBuilder, presetEditor, schemaOf } from "@/components/approvals/form-builder";
import { RequestCard } from "@/components/approvals/request-card";
import {
  FORM_PURPOSES,
  amountAnswersOf,
  expenseSchema,
  moneyOf,
  purposeOf,
  renderAnswers,
  transferSchema,
  validateAnswers,
  validateSchema,
  type Answers,
  type FormSchema,
} from "@/lib/approvals/forms";
import type { ApprovalDetail, ListItem } from "@/lib/approvals/view";
import { AR } from "@/lib/i18n/dict";
import { classTokens, render, textOf, PALETTE_COLOUR, PHYSICAL_UTILITY } from "../ui-render";

/**
 * I1.3, the pure part: what a «طلب مصروف» / «تحويل بين الصناديق» template is, how its answers become an amount on the request (and
 * stay out of the words), and the screens that carry the ⚠️ + 🔧 («مصاريف داخلية بس») and the hidden-amount line. The database part is
 * tests/db/expense-requests.test.ts.
 */

const BOXES = ["صندوق المكتب", "صندوق المصاريف"];

function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(textOf(markup)).not.toMatch(/[A-Za-z]{2,}/);
}

describe("the two templates are pure data with a purpose", () => {
  it("the purposes are exactly two, and both presets pass the validator with the purpose kept", () => {
    expect([...FORM_PURPOSES]).toEqual(["expense", "transfer"]);
    for (const [kind, schema] of [
      ["expense", expenseSchema({ boxes: BOXES, approvers: ["u1"] })],
      ["transfer", transferSchema({ boxes: BOXES, approvers: ["u1"] })],
    ] as const) {
      const checked = validateSchema(schema);
      expect(checked.ok, kind).toBe(true);
      if (checked.ok) {
        expect(checked.value.purpose).toBe(kind);
        expect(purposeOf(checked.value)).toBe(kind);
      }
    }
    expect(expenseSchema({ boxes: BOXES, approvers: ["u1"] }).fields.map((f) => f.id)).toEqual(["amount", "currency", "box", "reason"]);
    expect(transferSchema({ boxes: BOXES, approvers: ["u1"] }).fields.map((f) => f.id)).toEqual(["amount", "currency", "from_box", "to_box", "reason"]);
  });

  it("an ordinary schema has no purpose key at all (nothing about old forms changes)", () => {
    const checked = validateSchema({ fields: [{ id: "f1", type: "text", label: "الاسم", required: true }], approvers: ["u1"] });
    expect(checked).toEqual({ ok: true, value: { fields: [{ id: "f1", type: "text", label: "الاسم", required: true }], approvers: ["u1"] } });
    expect(purposeOf(checked.ok ? checked.value : null)).toBeNull();
    expect(purposeOf({ fields: [], approvers: [], purpose: "salary" } as unknown as FormSchema)).toBeNull();
  });

  it("the currency options are the Arabic names of the five reward currencies, never a Latin code", () => {
    const currency = expenseSchema({ boxes: BOXES, approvers: ["u1"] }).fields.find((f) => f.id === "currency")!;
    expect(currency.options).toEqual(["دولار", "دينار", "ليرة سورية", "يورو", "ليرة تركية"]);
    expect(currency.options!.join(" ")).not.toMatch(/[A-Za-z]/);
  });
});

describe("the amount is lifted out of the answers", () => {
  const schema = expenseSchema({ boxes: BOXES, approvers: ["u1"] });
  const answers: Answers = { amount: 12.5, currency: "دينار", box: BOXES[0]!, reason: "ورق طباعة" };

  it("12.5 + «دينار» is 1250 minor units + JOD, with the rest kept", () => {
    const money = moneyOf(schema, answers);
    expect(money).toEqual({ ok: true, value: { amountMinor: 1250, currency: "JOD", rest: { box: BOXES[0], reason: "ورق طباعة" } } });
  });

  it("integer arithmetic: 0.1 + 0.2 typed as 0.3 is 30, 1000000 is the ceiling, three decimals and exponents are refused", () => {
    expect((moneyOf(schema, { ...answers, amount: 0.3 }) as { value: { amountMinor: number } }).value.amountMinor).toBe(30);
    expect((moneyOf(schema, { ...answers, amount: 1000000 }) as { value: { amountMinor: number } }).value.amountMinor).toBe(100_000_000);
    for (const amount of [12.345, 1e-7, 1e21]) {
      const res = moneyOf(schema, { ...answers, amount });
      expect(res, String(amount)).toMatchObject({ ok: false, issues: [{ path: "amount", message: "approvals.e.amount_invalid" }] });
    }
  });

  it("is `null` for a schema with no purpose (nothing is lifted out of an ordinary form)", () => {
    expect(moneyOf({ fields: [], approvers: [] }, answers)).toBeNull();
  });

  it("a transfer to the same box is refused at the second box", () => {
    const t = transferSchema({ boxes: BOXES, approvers: ["u1"] });
    const ok = { amount: 5, currency: "دولار", from_box: BOXES[0]!, to_box: BOXES[1]!, reason: "x" };
    expect(moneyOf(t, ok)).toMatchObject({ ok: true, value: { amountMinor: 500, currency: "USD", rest: { from_box: BOXES[0], to_box: BOXES[1], reason: "x" } } });
    expect(moneyOf(t, { ...ok, to_box: BOXES[0]! })).toEqual({ ok: false, issues: [{ path: "to_box", message: "approvals.f.same_box" }] });
  });

  it("the words written from the answers never carry the amount or the currency; the boxes and the reason stay", () => {
    const checked = validateAnswers(schema, answers);
    expect(checked.ok).toBe(true);
    const text = renderAnswers(schema, (checked as { value: Answers }).value);
    expect(text).toContain(BOXES[0]!);
    expect(text).toContain("ورق طباعة");
    expect(text).not.toMatch(/12|دينار|المبلغ|العملة/);
  });

  it("gives the requester's own amount back as the boxes hold it (a number in major units and the currency's name)", () => {
    expect(amountAnswersOf(1250, "JOD")).toEqual({ amount: 12.5, currency: "دينار" });
    expect(amountAnswersOf(100, "USD")).toEqual({ amount: 1, currency: "دولار" });
    expect(amountAnswersOf(null, null)).toEqual({});
  });
});

describe("the builder offers the two templates and carries the purpose", () => {
  it("a preset is a name, a description, editor rows (the four or five fixed fields, the boxes one per line) and the purpose", () => {
    const expense = presetEditor("expense");
    expect(expense.name).toBe(AR["expense.preset.expense.name"]);
    expect(expense.fields.map((f) => f.id)).toEqual(["amount", "currency", "box", "reason"]);
    expect(expense.fields.every((f) => f.required)).toBe(true);
    expect(expense.fields.find((f) => f.id === "box")!.optionsText.split("\n")).toHaveLength(2);
    const transfer = presetEditor("transfer");
    expect(transfer.fields.map((f) => f.id)).toEqual(["amount", "currency", "from_box", "to_box", "reason"]);
    // saved with the purpose, the preset is a schema the validator accepts
    const saved = schemaOf(expense.fields, ["u1"], "expense");
    expect(validateSchema(saved)).toMatchObject({ ok: true, value: { purpose: "expense" } });
    // an ordinary form is saved as before: no purpose key
    expect(Object.keys(schemaOf(expense.fields, ["u1"]) as object).sort()).toEqual(["approvers", "fields"]);
  });

  it("a NEW form shows the two preset buttons and the note; editing a form does not", () => {
    const people = [{ id: "u2", name: "خالد", role: "LEAD" }];
    const fresh = render(createElement(FormBuilder, { workspaceId: "w1", people }));
    expect(fresh).toContain('data-expense-preset="expense"');
    expect(fresh).toContain('data-expense-preset="transfer"');
    expect(textOf(fresh)).toContain("طلب مصروف");
    expect(textOf(fresh)).toContain("تحويل بين الصناديق");
    expect(fresh).toContain("data-expense-note");
    expectClean(fresh);
    const schema = expenseSchema({ boxes: BOXES, approvers: ["u2"] });
    const editing = render(createElement(FormBuilder, { workspaceId: "w1", people, initial: { familyId: "x", version: 1, name: "طلب مصروف", description: null, schema } }));
    expect(editing).not.toContain("data-expense-preset");
    expect(editing).toContain("data-expense-note");
    expectClean(editing);
  });
});

describe("the screens: ⚠️ internal expenses only + 🔧, and a hidden amount says so", () => {
  const note = `${AR["expense.note"]} ${AR["expense.note_fix"]}`;

  it("the note keeps the owner's rule in words: internal office spending, order money stays in the orders system, no approval from chat", () => {
    expect(AR["expense.note"]).toContain("⚠️");
    expect(AR["expense.note_fix"]).toContain("🔧");
    expect(note).toContain("نظام الطلبات");
    expect(note).not.toMatch(/[A-Za-z]/);
  });

  it("the page that fills an expense form shows the note and calls the receipt a photo of the invoice; an ordinary form shows neither", () => {
    const expense = render(createElement(FillBridge, { familyId: "f1", schema: expenseSchema({ boxes: BOXES, approvers: ["u1"] }) }));
    expect(expense).toContain("data-expense-note");
    expect(textOf(expense)).toContain(AR["expense.receipt"]!);
    expectClean(expense);
    const plain = render(createElement(FillBridge, { familyId: "f2", schema: { fields: [{ id: "f1", type: "text", label: "الاسم", required: true }], approvers: ["u1"] } }));
    expect(plain).not.toContain("data-expense-note");
    expect(textOf(plain)).not.toContain(AR["expense.receipt"]!);
  });

  const item = (over: Partial<ListItem> = {}): ListItem => ({
    id: "r1",
    workspaceId: "w1",
    workspaceName: "مساحة المبيعات",
    title: "طلب مصروف",
    status: "PENDING",
    version: 1,
    currentStep: 1,
    requester: { id: "u1", name: "سارة" },
    amount: null,
    createdAt: "2031-03-20T09:00:00.000Z",
    updatedAt: "2031-03-20T09:00:00.000Z",
    decidedAt: null,
    steps: [{ position: 1, approver: { id: "u2", name: "خالد" }, status: "PENDING" }],
    waitingOn: { id: "u2", name: "خالد" },
    fromForm: true,
    ...over,
  });

  it("a request whose amount was cut says so in the list and on its page, with no figure and no currency", () => {
    const card = render(createElement("ul", null, createElement(RequestCard, { item: item({ amountHidden: true }) })));
    expect(card).toContain("data-approval-amount-hidden");
    expect(textOf(card)).toContain(AR["approvals.amount_hidden"]!);
    expect(card).not.toContain('data-approval-amount=""');
    const detail: ApprovalDetail = {
      ...item({ amountHidden: true }),
      details: "السبب: ورق",
      linkedTo: null,
      attachments: [],
      stepsDetail: [],
      previous: [],
      form: null,
      formFill: null,
      you: { requester: false, approver: true, canDecide: true, canCancel: false, canResubmit: false, oversight: false },
    };
    const page = render(createElement(DetailBody, { detail }));
    expect(page).toContain("data-approval-amount-hidden");
    expect(textOf(page)).toContain(AR["approvals.amount_hidden"]!);
    expect(textOf(page)).toContain(AR["approvals.amount_hidden_fix"]!);
    expect(textOf(page)).not.toMatch(/دولار|دينار/);
    expectClean(page);
  });

  it("nothing is drawn for an amount that is simply absent (an ordinary request without one)", () => {
    const card = render(createElement("ul", null, createElement(RequestCard, { item: item() })));
    expect(card).not.toContain("data-approval-amount-hidden");
  });
});
