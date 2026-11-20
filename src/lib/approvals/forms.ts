/**
 * «نموذج» — the pure part: what a form template may contain, how an answer is checked against it, and how the answers are
 * written out as labelled lines.
 *
 * Pure (no React, no Next, no server imports). A form is DATA, never code: six field types, a fixed list of properties per
 * type, and any property outside that list is refused — there is nowhere to put a script, a formula, a default expression or
 * a file. A template is edited by adding a new version (the service), so a request keeps exactly the questions it was filled with.
 */
import { AR } from "@/lib/i18n/dict";
import { fmtDMY } from "@/lib/format";
import { REWARD_CURRENCIES, REWARD_MAX_MINOR, amountTextToMinor, currencyName, minorToAmountText, type RewardCurrency } from "@/lib/rewards";
import { APPROVAL_LIMITS } from "./shared";

export const FIELD_TYPES = ["text", "textarea", "number", "date", "choice", "yesno"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FORM_LIMITS = {
  fields: 20,
  options: 20,
  name: 80,
  description: 300,
  label: 80,
  option: 80,
  text: 200,
  textarea: 1000,
  /** A number answer is bounded so a typo cannot be a 30-digit value. */
  numberAbs: 1_000_000_000_000,
} as const;

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  /** `choice` only: two to twenty distinct options. */
  options?: string[];
  /** `number` only. */
  min?: number;
  max?: number;
}

/**
 * I1.3 - a form that carries OFFICE MONEY: «طلب مصروف» (`expense`) and «تحويل بين الصناديق» (`transfer`). Still a plain form (the same six
 * field types, the same versions): the purpose only says that the fields `amount` and `currency` are the AMOUNT of the request - they are
 * lifted out of the answers into the request's own columns (cut for people without `prices.view` / `cash.view`), never written into its
 * words - and that a decision is posted as a card into the space's topic. Internal office spending only: order money, wallets and cash
 * balances stay in the orders system.
 */
export const FORM_PURPOSES = ["expense", "transfer"] as const;
export type FormPurpose = (typeof FORM_PURPOSES)[number];

export interface FormSchema {
  fields: FormField[];
  /** The preset chain: one to three people, in order. */
  approvers: string[];
  /** Set for a money form (see `FORM_PURPOSES`); absent on every ordinary form. */
  purpose?: FormPurpose;
}

export type AnswerValue = string | number | boolean;
export type Answers = Record<string, AnswerValue>;

export interface Issue {
  path: string;
  message: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const FIELD_ID = /^[a-z][a-z0-9_]{0,23}$/;
const SCHEMA_KEYS = new Set(["fields", "approvers", "purpose"]);
const COMMON_KEYS = ["id", "type", "label", "required"];
const KEYS_BY_TYPE: Record<FieldType, string[]> = {
  text: COMMON_KEYS,
  textarea: COMMON_KEYS,
  number: [...COMMON_KEYS, "min", "max"],
  date: COMMON_KEYS,
  choice: [...COMMON_KEYS, "options"],
  yesno: COMMON_KEYS,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

export function isFormPurpose(value: unknown): value is FormPurpose {
  return typeof value === "string" && (FORM_PURPOSES as readonly string[]).includes(value);
}

/** The purpose of a form's schema, or `null` for an ordinary form (and for anything that is not a schema). */
export function purposeOf(schema: unknown): FormPurpose | null {
  if (!isRecord(schema)) return null;
  const purpose = schema["purpose"];
  return isFormPurpose(purpose) ? purpose : null;
}

/** The fixed fields of each money form: id and the types it may have. All of them are required; the boxes are choices. */
const PURPOSE_FIELDS: Record<FormPurpose, readonly { id: string; types: readonly FieldType[] }[]> = {
  expense: [
    { id: "amount", types: ["number"] },
    { id: "currency", types: ["choice"] },
    { id: "box", types: ["choice"] },
    { id: "reason", types: ["text", "textarea"] },
  ],
  transfer: [
    { id: "amount", types: ["number"] },
    { id: "currency", types: ["choice"] },
    { id: "from_box", types: ["choice"] },
    { id: "to_box", types: ["choice"] },
  ],
};

/** The ids a money form keeps OUT of its words and its stored answers: they become the request's amount. */
const MONEY_IDS = new Set(["amount", "currency"]);

/** The Arabic names of the currencies a money form may offer (the same five as everywhere: src/lib/rewards.ts). */
export const CURRENCY_NAMES: readonly string[] = REWARD_CURRENCIES.map((code) => currencyName(code));

function currencyCodeOf(name: string): RewardCurrency | null {
  return REWARD_CURRENCIES.find((code) => currencyName(code) === name) ?? null;
}

/** The reason a money form's fields are refused (a key); `null` = fine. Checked on top of the ordinary field rules. */
function purposeProblem(purpose: FormPurpose, fields: readonly FormField[]): string | null {
  for (const want of PURPOSE_FIELDS[purpose]) {
    const field = fields.find((f) => f.id === want.id);
    if (!field || !want.types.includes(field.type) || !field.required) return "approvals.f.purpose_fields";
  }
  const currency = fields.find((f) => f.id === "currency");
  if ((currency?.options ?? []).some((o) => !CURRENCY_NAMES.includes(o))) return "approvals.f.purpose_currency";
  return null;
}

/**
 * A template's structure, checked and tidied (labels and options trimmed). Every refusal is an Arabic key under
 * `approvals.f.*` and names the field it is about (`fields.2.options`). Nothing outside the lists above is accepted.
 */
export function validateSchema(raw: unknown): Checked<FormSchema> {
  const issues: Issue[] = [];
  const fail = (path: string, message: string) => void issues.push({ path, message });
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "schema", message: "approvals.f.schema_invalid" }] };
  for (const key of Object.keys(raw)) if (!SCHEMA_KEYS.has(key)) fail(key, "approvals.f.unknown_property");

  const fields: FormField[] = [];
  const rawFields = raw["fields"];
  if (!Array.isArray(rawFields) || rawFields.length === 0) fail("fields", "approvals.f.fields_empty");
  else if (rawFields.length > FORM_LIMITS.fields) fail("fields", "approvals.f.fields_long");
  else {
    const seen = new Set<string>();
    rawFields.forEach((item, i) => {
      const at = `fields.${i}`;
      if (!isRecord(item)) return fail(at, "approvals.f.field_invalid");
      const type = item["type"];
      if (!isFieldType(type)) return fail(`${at}.type`, "approvals.f.type_invalid");
      for (const key of Object.keys(item)) if (!KEYS_BY_TYPE[type].includes(key)) fail(`${at}.${key}`, "approvals.f.unknown_property");
      const id = item["id"];
      if (typeof id !== "string" || !FIELD_ID.test(id)) fail(`${at}.id`, "approvals.f.id_invalid");
      else if (seen.has(id)) fail(`${at}.id`, "approvals.f.id_duplicate");
      else seen.add(id);
      const label = typeof item["label"] === "string" ? clean(item["label"]) : "";
      if (!label) fail(`${at}.label`, "approvals.f.label_required");
      else if (label.length > FORM_LIMITS.label) fail(`${at}.label`, "approvals.f.label_long");
      const required = item["required"];
      if (required !== undefined && typeof required !== "boolean") fail(`${at}.required`, "approvals.f.required_invalid");

      const field: FormField = { id: typeof id === "string" ? id : "", type, label, required: required === true };
      if (type === "choice") {
        const options = item["options"];
        if (!Array.isArray(options) || options.some((o) => typeof o !== "string")) fail(`${at}.options`, "approvals.f.options_invalid");
        else {
          const tidy = (options as string[]).map(clean);
          if (tidy.length < 2) fail(`${at}.options`, "approvals.f.options_few");
          else if (tidy.length > FORM_LIMITS.options) fail(`${at}.options`, "approvals.f.options_long");
          else if (tidy.some((o) => !o || o.length > FORM_LIMITS.option)) fail(`${at}.options`, "approvals.f.option_invalid");
          else if (new Set(tidy).size !== tidy.length) fail(`${at}.options`, "approvals.f.options_duplicate");
          else field.options = tidy;
        }
      }
      if (type === "number") {
        for (const bound of ["min", "max"] as const) {
          const v = item[bound];
          if (v === undefined) continue;
          if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > FORM_LIMITS.numberAbs) fail(`${at}.${bound}`, "approvals.f.bound_invalid");
          else field[bound] = v;
        }
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(`${at}.min`, "approvals.f.bound_order");
      }
      fields.push(field);
    });
  }

  const approvers = raw["approvers"];
  let chain: string[] = [];
  if (!Array.isArray(approvers) || approvers.length === 0) fail("approvers", "approvals.e.chain_empty");
  else if (approvers.length > APPROVAL_LIMITS.approvers) fail("approvers", "approvals.e.chain_long");
  else if (approvers.some((a) => typeof a !== "string" || !a)) fail("approvers", "approvals.e.chain_invalid");
  else if (new Set(approvers).size !== approvers.length) fail("approvers", "approvals.e.chain_duplicate");
  else chain = approvers as string[];

  let purpose: FormPurpose | undefined;
  const rawPurpose = raw["purpose"];
  if (rawPurpose !== undefined) {
    if (!isFormPurpose(rawPurpose)) fail("purpose", "approvals.f.purpose_invalid");
    else purpose = rawPurpose;
  }
  // a money form's fixed fields are checked only when the fields themselves were fine (one reason at a time)
  if (purpose && issues.length === 0) {
    const problem = purposeProblem(purpose, fields);
    if (problem) fail("fields", problem);
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { fields, approvers: chain, ...(purpose ? { purpose } : {}) } };
}

/** A calendar date written YYYY-MM-DD that exists (no 31 February). */
export function isCalendarDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/**
 * The answers of one filling, checked against ONE version of a template. Each type has its own rule; an optional field left
 * empty is simply absent; an answer for a field the template does not have is refused. Returns only the checked answers.
 */
export function validateAnswers(schema: FormSchema, raw: unknown): Checked<Answers> {
  const issues: Issue[] = [];
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "answers", message: "approvals.f.answers_invalid" }] };
  const ids = new Set(schema.fields.map((f) => f.id));
  for (const key of Object.keys(raw)) if (!ids.has(key)) issues.push({ path: key, message: "approvals.f.unknown_field" });

  const answers: Answers = {};
  for (const field of schema.fields) {
    const fail = (message: string) => void issues.push({ path: field.id, message });
    const value = raw[field.id];
    const empty = value === undefined || value === null || (typeof value === "string" && clean(value) === "");
    if (empty) {
      if (field.required) fail("approvals.f.answer_required");
      continue;
    }
    switch (field.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string") {
          fail("approvals.f.answer_type");
          break;
        }
        // a long text keeps its line breaks; a short one is one line
        const text = field.type === "text" ? clean(value) : value.replace(/\r\n?/g, "\n").trim();
        const max = field.type === "text" ? FORM_LIMITS.text : FORM_LIMITS.textarea;
        if (text.length > max) fail("approvals.f.answer_long");
        else answers[field.id] = text;
        break;
      }
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) fail("approvals.f.answer_type");
        else if (Math.abs(value) > FORM_LIMITS.numberAbs) fail("approvals.f.number_range");
        else if (field.min !== undefined && value < field.min) fail("approvals.f.number_low");
        else if (field.max !== undefined && value > field.max) fail("approvals.f.number_high");
        else answers[field.id] = value;
        break;
      }
      case "date": {
        if (typeof value !== "string" || !isCalendarDay(value.trim())) fail("approvals.f.date_invalid");
        else answers[field.id] = value.trim();
        break;
      }
      case "choice": {
        if (typeof value !== "string" || !(field.options ?? []).includes(clean(value))) fail("approvals.f.choice_invalid");
        else answers[field.id] = clean(value);
        break;
      }
      case "yesno": {
        if (typeof value !== "boolean") fail("approvals.f.answer_type");
        else answers[field.id] = value;
        break;
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: answers };
}

/** One answer as a person reads it: «نعم», «20 آذار 2031», the number as written, the text itself. */
export function answerText(field: FormField, value: AnswerValue | undefined): string {
  if (value === undefined) return "—";
  if (field.type === "yesno") return value === true ? (AR["approvals.yes"] ?? "") : (AR["approvals.no"] ?? "");
  if (field.type === "date" && typeof value === "string") {
    const [y, m, d] = value.split("-").map(Number);
    return fmtDMY(new Date(y!, m! - 1, d!));
  }
  return String(value);
}

/**
 * The details of the request a form creates: one labelled line per answered field, in the template's order
 * («التاريخ: 20 آذار 2031»). A field left empty is a line that says so, so a reader never wonders whether it was skipped.
 */
export function renderAnswers(schema: FormSchema, answers: Answers): string {
  return schema.fields
    .filter((field) => !(schema.purpose && MONEY_IDS.has(field.id)))
    .map((field) => {
      const value = answers[field.id];
      const text = value === undefined ? (AR["approvals.f.not_answered"] ?? "—") : answerText(field, value);
      // a long text goes under its label so its own line breaks stay readable
      return field.type === "textarea" && value !== undefined ? `${field.label}:\n${text}` : `${field.label}: ${text}`;
    })
    .join("\n");
}

/** The details are bounded like any request's; a form whose answers are longer is refused with this key. */
export function renderedProblem(details: string): string | null {
  return details.length > APPROVAL_LIMITS.details ? "approvals.f.details_long" : null;
}

export interface MoneyAnswers {
  /** Integer minor units (src/lib/rewards.ts): never a float. */
  amountMinor: number;
  /** The ISO code the request stores. */
  currency: RewardCurrency;
  /** The answers without the amount and the currency: what the request keeps in `answers`. */
  rest: Answers;
}

/**
 * The amount of a money form's (already checked) answers, as the request stores it. `null` for an ordinary form. The amount is a number of
 * the major unit with at most two decimals (the text goes through the one integer parser, so 0.3 is 30 and 1e-7 is refused); the currency is
 * one of the five Arabic names; a transfer between a box and itself is refused at the second box.
 */
export function moneyOf(schema: FormSchema, answers: Answers): Checked<MoneyAnswers> | null {
  if (!schema.purpose) return null;
  const issues: Issue[] = [];
  const raw = answers["amount"];
  const minor = typeof raw === "number" ? amountTextToMinor(String(raw)) : null;
  if (minor === null || minor <= 0 || minor > REWARD_MAX_MINOR) issues.push({ path: "amount", message: "approvals.e.amount_invalid" });
  const code = typeof answers["currency"] === "string" ? currencyCodeOf(answers["currency"]) : null;
  if (!code) issues.push({ path: "currency", message: "approvals.e.currency_invalid" });
  if (schema.purpose === "transfer" && answers["from_box"] !== undefined && answers["from_box"] === answers["to_box"]) issues.push({ path: "to_box", message: "approvals.f.same_box" });
  if (issues.length > 0 || minor === null || !code) return { ok: false, issues };
  const rest: Answers = {};
  for (const [id, value] of Object.entries(answers)) if (!MONEY_IDS.has(id)) rest[id] = value;
  return { ok: true, value: { amountMinor: minor, currency: code, rest } };
}

/** A request's own amount back as the boxes of its form hold it (for the person who asked, when the request is sent back). */
export function amountAnswersOf(minor: number | null | undefined, currency: string | null | undefined): Answers {
  if (minor == null || !currency || !(REWARD_CURRENCIES as readonly string[]).includes(currency)) return {};
  return { amount: Number(minorToAmountText(minor)), currency: currencyName(currency) };
}

function moneyFields(purpose: FormPurpose, boxes: readonly string[]): FormField[] {
  const text = (key: string) => AR[key] ?? "";
  const boxField = (id: string, labelKey: string): FormField => ({ id, type: "choice", label: text(labelKey), required: true, options: [...boxes] });
  const head: FormField[] = [
    { id: "amount", type: "number", label: text("expense.field.amount"), required: true, min: 0.01, max: REWARD_MAX_MINOR / 100 },
    { id: "currency", type: "choice", label: text("expense.field.currency"), required: true, options: [...CURRENCY_NAMES] },
  ];
  if (purpose === "expense") return [...head, boxField("box", "expense.field.box"), { id: "reason", type: "textarea", label: text("expense.field.reason"), required: true }];
  return [...head, boxField("from_box", "expense.field.from_box"), boxField("to_box", "expense.field.to_box"), { id: "reason", type: "textarea", label: text("expense.field.reason_optional"), required: false }];
}

/** «طلب مصروف» to start from: amount, currency, which box, reason. The manager names the boxes and the chain. */
export function expenseSchema(opts: { boxes: readonly string[]; approvers: string[] }): FormSchema & { purpose: "expense" } {
  return { fields: moneyFields("expense", opts.boxes), approvers: opts.approvers, purpose: "expense" };
}

/** «تحويل بين الصناديق» to start from: amount, currency, from which box, to which box, an optional reason. */
export function transferSchema(opts: { boxes: readonly string[]; approvers: string[] }): FormSchema & { purpose: "transfer" } {
  return { fields: moneyFields("transfer", opts.boxes), approvers: opts.approvers, purpose: "transfer" };
}

/** An empty template to start from: one short-text field. */
export function blankSchema(): FormSchema {
  return { fields: [{ id: "f1", type: "text", label: "", required: true }], approvers: [] };
}

/** The next free field id (`f1`, `f2`, …) of a list being edited. */
export function nextFieldId(fields: readonly { id: string }[]): string {
  const used = new Set(fields.map((f) => f.id));
  for (let n = 1; n <= FORM_LIMITS.fields + 1; n += 1) if (!used.has(`f${n}`)) return `f${n}`;
  return `f${Date.now()}`;
}
