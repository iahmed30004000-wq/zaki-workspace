import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  COLOR_CLASS,
  FIELD_COLORS,
  FIELD_TYPES,
  MAX_ACTIVE_FIELDS,
  MAX_OPTIONS,
  addDecimals,
  cleanLabel,
  fromStored,
  isFilled,
  isHttpsLink,
  isValidDay,
  mergeOptions,
  missingRequired,
  normalizeDecimal,
  optionLabel,
  readConfig,
  requiredFieldsOf,
  sumDecimals,
  validateValue,
  type FieldConfig,
  type FieldType,
} from "@/lib/custom-fields";
import { cellOf, fmtDay, fmtDecimalText } from "@/lib/custom-fields-display";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { ApiError } from "@/lib/api-client";

const OPTIONS = [
  { id: "o1", label: "عالي", color: "danger" as const },
  { id: "o2", label: "منخفض", color: "ok" as const },
  { id: "o3", label: "قديم", color: "muted" as const, deleted: true },
];
const def = (type: FieldType, config: FieldConfig = {}) => ({ type, config });
const stored = (r: ReturnType<typeof validateValue>) => (r.ok && !r.empty ? r.stored : null);

describe("«حقول مخصصة»: the switch", () => {
  it("is a feature, on by default, with its two lines of Arabic", () => {
    expect(FEATURES).toContain("customFields");
    expect(FEATURE_DEFAULTS.customFields).toBe(true);
    expect(AR["features.customFields.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.customFields.hint"]).toMatch(/[؀-ۿ]/);
  });

  it("every type has an Arabic name and every colour token one too", () => {
    for (const t of FIELD_TYPES) expect(AR[`fields.type.${t}`], t).toMatch(/[؀-ۿ]/);
    for (const c of FIELD_COLORS) {
      expect(AR[`fields.color.${c}`], c).toMatch(/[؀-ۿ]/);
      expect(COLOR_CLASS[c], c).toMatch(/text-/);
    }
  });
});

describe("«حقول مخصصة»: the label", () => {
  it("is 1 to 60 characters, trimmed, with no control characters", () => {
    expect(cleanLabel("  الميزانية  ")).toEqual({ ok: true, value: "الميزانية" });
    expect(cleanLabel("a\u0000b\nc")).toEqual({ ok: true, value: "a b c" });
    expect(cleanLabel("   ")).toMatchObject({ ok: false, key: "fields.label_required" });
    expect(cleanLabel(5)).toMatchObject({ ok: false });
    expect(cleanLabel("ا".repeat(60)).ok).toBe(true);
    expect(cleanLabel("ا".repeat(61))).toMatchObject({ ok: false, key: "fields.label_long" });
  });
});

describe("«حقول مخصصة»: the exact decimal", () => {
  it("reads a typed number with at most 12 digits before the point and 4 after, in any digits", () => {
    expect(normalizeDecimal("12.50")).toBe("12.5");
    expect(normalizeDecimal(" ٣٫١٥ ")).toBe("3.15");
    expect(normalizeDecimal("1,250.5")).toBe("1250.5");
    expect(normalizeDecimal(0.1)).toBe("0.1");
    expect(normalizeDecimal("-0")).toBe("0");
    expect(normalizeDecimal("-3.2000")).toBe("-3.2");
    expect(normalizeDecimal("007")).toBe("7");
    expect(normalizeDecimal("999999999999.9999")).toBe("999999999999.9999");
  });

  it("refuses a 13th digit, a 5th decimal, an exponent, text and a non-finite number", () => {
    for (const bad of ["1234567890123", "1.23456", "1e5", "abc", "", "1.", ".5", "--1", Number.NaN, Number.POSITIVE_INFINITY, 1e21, 1e-7, null, {}, true]) {
      expect(normalizeDecimal(bad as never), String(bad)).toBeNull();
    }
  });

  it("adds without a float: 0.1 + 0.2 is 0.3, and a long column sums exactly", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the very thing this avoids
    expect(addDecimals("0.1", "0.2")).toBe("0.3");
    expect(sumDecimals(["0.1", "0.2", "0.3"])).toBe("0.6");
    expect(sumDecimals(["999999999999.9999", "0.0001"])).toBe("1000000000000");
    expect(sumDecimals(["-1.5", "0.5"])).toBe("-1");
    expect(sumDecimals(Array.from({ length: 10 }, () => "0.1"))).toBe("1");
    expect(sumDecimals([])).toBe("0");
    expect(sumDecimals(["x", null, undefined, "2"])).toBe("2");
  });

  it("groups the whole part with commas and keeps the fraction as typed", () => {
    expect(fmtDecimalText("1250000.25")).toBe("1,250,000.25");
    expect(fmtDecimalText("-12")).toBe("-12");
  });
});

describe("«حقول مخصصة»: a value, per type", () => {
  it("text: trimmed, flattened, at most 200; long text keeps its lines, at most 2000; blank clears", () => {
    expect(stored(validateValue(def("TEXT"), "  مرحبا   بك "))).toMatchObject({ valueText: "مرحبا بك" });
    expect(validateValue(def("TEXT"), "   ")).toEqual({ ok: true, empty: true });
    expect(validateValue(def("TEXT"), null)).toEqual({ ok: true, empty: true });
    expect(validateValue(def("TEXT"), "ا".repeat(200)).ok).toBe(true);
    expect(validateValue(def("TEXT"), "ا".repeat(201))).toMatchObject({ ok: false, key: "fields.text_long" });
    expect(validateValue(def("TEXT"), 5)).toMatchObject({ ok: false });
    expect(stored(validateValue(def("LONG_TEXT"), "سطر 1\nسطر 2"))).toMatchObject({ valueText: "سطر 1\nسطر 2" });
    expect(validateValue(def("LONG_TEXT"), "ا".repeat(2000)).ok).toBe(true);
    expect(validateValue(def("LONG_TEXT"), "ا".repeat(2001))).toMatchObject({ ok: false, key: "fields.long_text_long" });
  });

  it("number: a decimal string, bounds as above", () => {
    expect(stored(validateValue(def("NUMBER"), "12.5"))).toMatchObject({ valueNumber: "12.5" });
    expect(stored(validateValue(def("NUMBER"), 3))).toMatchObject({ valueNumber: "3" });
    expect(validateValue(def("NUMBER"), "")).toEqual({ ok: true, empty: true });
    expect(validateValue(def("NUMBER"), "1234567890123")).toMatchObject({ ok: false, key: "fields.number_invalid" });
    expect(validateValue(def("NUMBER"), "1.00001")).toMatchObject({ ok: false, key: "fields.number_invalid" });
  });

  it("date: a real calendar day only", () => {
    expect(stored(validateValue(def("DATE"), "2026-02-28"))).toMatchObject({ valueDate: "2026-02-28" });
    for (const bad of ["2026-02-30", "2026-13-01", "26-02-01", "2026/02/01", "1800-01-01", "2026-02-28T10:00:00Z", 20260228]) {
      expect(validateValue(def("DATE"), bad), String(bad)).toMatchObject({ ok: false, key: "fields.date_invalid" });
    }
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2027-02-29")).toBe(false);
  });

  it("single choice: a live option's id; a deleted option cannot be picked again, an unknown id is refused", () => {
    const d = def("SINGLE_CHOICE", { options: OPTIONS });
    expect(stored(validateValue(d, "o1"))).toMatchObject({ valueText: "o1" });
    expect(validateValue(d, "o3")).toMatchObject({ ok: false, key: "fields.option_invalid" });
    expect(validateValue(d, "zzz")).toMatchObject({ ok: false });
    expect(validateValue(d, "")).toEqual({ ok: true, empty: true });
  });

  it("multiple choice: distinct live ids; an empty list clears", () => {
    const d = def("MULTI_CHOICE", { options: OPTIONS });
    expect(stored(validateValue(d, ["o1", "o2", "o1"]))).toMatchObject({ valueJson: ["o1", "o2"] });
    expect(validateValue(d, [])).toEqual({ ok: true, empty: true });
    expect(validateValue(d, ["o1", "o3"])).toMatchObject({ ok: false, key: "fields.option_invalid" });
    expect(validateValue(d, "o1")).toMatchObject({ ok: false });
  });

  it("yes/no: a boolean is an answer, «no» too", () => {
    expect(stored(validateValue(def("BOOLEAN"), true))).toMatchObject({ valueNumber: "1" });
    expect(stored(validateValue(def("BOOLEAN"), false))).toMatchObject({ valueNumber: "0" });
    expect(validateValue(def("BOOLEAN"), "yes")).toMatchObject({ ok: false });
    expect(validateValue(def("BOOLEAN"), 1)).toMatchObject({ ok: false });
  });

  it("person: an id-shaped string (membership is the server's to read)", () => {
    expect(stored(validateValue(def("PERSON"), "ckabc123_-"))).toMatchObject({ valueText: "ckabc123_-" });
    expect(validateValue(def("PERSON"), "a b")).toMatchObject({ ok: false, key: "fields.person_invalid" });
    expect(validateValue(def("PERSON"), "x".repeat(65))).toMatchObject({ ok: false });
  });

  it("link: https only, a real host, no credentials, no spaces", () => {
    expect(stored(validateValue(def("LINK"), " https://example.com/a?b=1 "))).toMatchObject({ valueText: "https://example.com/a?b=1" });
    for (const bad of ["http://example.com", "javascript:alert(1)", "ftp://example.com", "https://user:pw@example.com", "https://", "https://exa mple.com", "example.com", "//example.com", "data:text/html,x", "HTTPS://example.com/\u0000"]) {
      const r = validateValue(def("LINK"), bad);
      // the one upper-case scheme is still https: it is accepted when it is clean
      if (bad === "HTTPS://example.com/\u0000") expect(r.ok).toBe(false);
      else expect(r, bad).toMatchObject({ ok: false, key: "fields.link_invalid" });
    }
    expect(isHttpsLink("https://example.com/" + "a".repeat(2000))).toBe(false);
  });

  it("money: integer minor units, never negative, the field's own currency", () => {
    const d = def("MONEY", { currency: "JOD" });
    expect(stored(validateValue(d, 15050))).toMatchObject({ valueNumber: "15050" });
    expect(stored(validateValue(d, "300"))).toMatchObject({ valueNumber: "300" });
    expect(stored(validateValue(d, { amountMinor: 100, currency: "JOD" }))).toMatchObject({ valueNumber: "100" });
    expect(validateValue(d, { amountMinor: 100, currency: "USD" })).toMatchObject({ ok: false, key: "fields.currency_mismatch" });
    expect(validateValue(d, 12.5)).toMatchObject({ ok: false, key: "fields.money_invalid" });
    expect(validateValue(d, -1)).toMatchObject({ ok: false, key: "fields.money_invalid" });
    expect(validateValue(d, 1_000_000_000_000)).toMatchObject({ ok: false, key: "fields.money_big" });
    expect(validateValue(def("MONEY", { currency: "ZZZ" }), 5)).toMatchObject({ ok: false, key: "fields.currency_invalid" });
    expect(validateValue(def("MONEY", {}), 5)).toMatchObject({ ok: false, key: "fields.currency_invalid" });
  });
});

describe("«حقول مخصصة»: options", () => {
  const fresh = (() => {
    let n = 0;
    return () => `n${++n}`;
  })();

  it("keeps the id of an option that stays, mints one for a new option, and MARKS a dropped option deleted instead of removing it", () => {
    const r = mergeOptions(
      [{ id: "a", label: "أ", color: "ok" }, { id: "b", label: "ب", color: "warn" }],
      [{ id: "a", label: "أ معدّل", color: "info" }, { label: "ج" }],
      fresh,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((o) => [o.id, o.label, o.color, o.deleted ?? false])).toEqual([
      ["a", "أ معدّل", "info", false],
      ["n1", "ج", "muted", false],
      ["b", "ب", "warn", true],
    ]);
  });

  it("does not trust an id that is not the field's own, and refuses duplicates, blanks, long labels, a colour outside the set and a 31st live option", () => {
    const r = mergeOptions([], [{ id: "someone-elses", label: "x" }], fresh);
    expect(r.ok && r.value[0]!.id).not.toBe("someone-elses");
    expect(mergeOptions([], [{ label: "x" }, { label: "x" }], fresh)).toMatchObject({ ok: false, key: "fields.option_duplicate" });
    expect(mergeOptions([], [{ label: "  " }], fresh)).toMatchObject({ ok: false, key: "fields.option_label_required" });
    expect(mergeOptions([], [{ label: "ا".repeat(41) }], fresh)).toMatchObject({ ok: false, key: "fields.option_label_long" });
    expect(mergeOptions([], [{ label: "x", color: "#ff0000" }], fresh)).toMatchObject({ ok: false, key: "fields.option_color_invalid" });
    expect(mergeOptions([], Array.from({ length: MAX_OPTIONS }, (_, i) => ({ label: `x${i}` })), fresh).ok).toBe(true);
    expect(mergeOptions([], Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ label: `x${i}` })), fresh)).toMatchObject({ ok: false, key: "fields.options_too_many" });
  });

  it("reads a deleted option (or an unknown id) as «محذوف»", () => {
    expect(optionLabel(OPTIONS, "o1", "محذوف")).toEqual({ label: "عالي", color: "danger", deleted: false });
    expect(optionLabel(OPTIONS, "o3", "محذوف")).toEqual({ label: "محذوف", color: "muted", deleted: true });
    expect(optionLabel(OPTIONS, "nope", "محذوف").deleted).toBe(true);
  });

  it("reads a stored config defensively", () => {
    expect(readConfig(null)).toEqual({});
    expect(readConfig("x")).toEqual({});
    expect(readConfig({ options: [{ id: "a", label: "x", color: "nope" }, 5, { id: 1 }] })).toEqual({ options: [{ id: "a", label: "x", color: "muted" }] });
    expect(readConfig({ unit: "كغ", currency: "USD" })).toEqual({ unit: "كغ", currency: "USD" });
  });
});

describe("«حقول مخصصة»: stored columns and back", () => {
  const row = (r: Partial<{ valueText: string | null; valueNumber: string | null; valueDate: Date | string | null; valueJson: unknown }>) => ({
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueJson: null,
    ...r,
  });

  it("joins the typed columns into the canonical value", () => {
    expect(fromStored("TEXT", row({ valueText: "x" }))).toBe("x");
    expect(fromStored("NUMBER", row({ valueNumber: "12.5000" }))).toBe("12.5");
    expect(fromStored("MONEY", row({ valueNumber: "15050.0000" }))).toBe(15050);
    expect(fromStored("BOOLEAN", row({ valueNumber: "1.0000" }))).toBe(true);
    expect(fromStored("BOOLEAN", row({ valueNumber: "0" }))).toBe(false);
    expect(fromStored("DATE", row({ valueDate: new Date("2026-03-05T00:00:00.000Z") }))).toBe("2026-03-05");
    expect(fromStored("MULTI_CHOICE", row({ valueJson: ["a", 5, "b"] }))).toEqual(["a", "b"]);
    expect(fromStored("TEXT", row({}))).toBeUndefined();
  });

  it("an answer «no» counts as filled; a blank text, an empty list and a missing row do not", () => {
    expect(isFilled("BOOLEAN", row({ valueNumber: "0" }))).toBe(true);
    expect(isFilled("TEXT", row({ valueText: "  " }))).toBe(false);
    expect(isFilled("MULTI_CHOICE", row({ valueJson: [] }))).toBe(false);
    expect(isFilled("NUMBER", row({ valueNumber: "0" }))).toBe(true);
    expect(isFilled("TEXT", undefined)).toBe(false);
  });

  it("lists the required, live fields that hold no answer, in the project's order", () => {
    const fields = [
      { id: "f1", label: "الأول", type: "TEXT" as const, required: true, archived: false },
      { id: "f2", label: "الثاني", type: "NUMBER" as const, required: true, archived: false },
      { id: "f3", label: "ثالث اختياري", type: "TEXT" as const, required: false, archived: false },
      { id: "f4", label: "مؤرشف", type: "TEXT" as const, required: true, archived: true },
    ];
    const rows = new Map([["f1", row({ valueText: "x" })]]);
    expect(missingRequired(fields, rows)).toEqual([{ id: "f2", label: "الثاني" }]);
    expect(missingRequired(fields, new Map())).toEqual([
      { id: "f1", label: "الأول" },
      { id: "f2", label: "الثاني" },
    ]);
  });
});

describe("«حقول مخصصة»: chips", () => {
  const dto = (type: FieldType, over: Record<string, unknown> = {}) => ({ id: "f", label: "حقل", type, required: false, archived: false, unit: null, currency: null, options: OPTIONS, ...over });

  it("reads each type aloud with Western digits and Arabic words", () => {
    expect(cellOf(dto("NUMBER", { unit: "كغ" }), "1250.5")?.text).toBe("1,250.5 كغ");
    expect(cellOf(dto("MONEY", { currency: "JOD" }), 15050)?.text).toBe("150.50 دينار");
    expect(cellOf(dto("DATE"), "2026-03-05")?.text).toBe("5 آذار 2026");
    expect(fmtDay("2026-12-31")).toBe("31 كانون الأول 2026");
    expect(cellOf(dto("BOOLEAN"), true)?.text).toBe("نعم");
    expect(cellOf(dto("BOOLEAN"), false)?.text).toBe("لا");
    expect(cellOf(dto("SINGLE_CHOICE"), "o1")).toMatchObject({ text: "عالي", color: "danger" });
    expect(cellOf(dto("SINGLE_CHOICE"), "o3")).toMatchObject({ text: "محذوف", color: "muted" });
    expect(cellOf(dto("MULTI_CHOICE"), ["o1", "o2"])?.text).toBe("عالي، منخفض");
    expect(cellOf(dto("PERSON"), "u1", new Map([["u1", "سارة"]]))?.text).toBe("سارة");
    expect(cellOf(dto("PERSON"), "gone")?.text).toBe("شخص سابق");
    expect(cellOf(dto("LINK"), "https://www.example.com/path?x=1")?.text).toBe("example.com");
    expect(cellOf(dto("TEXT"), "ا".repeat(100))?.text.length).toBe(40);
    expect(cellOf(dto("TEXT"), undefined)).toBeNull();
    expect(cellOf(dto("TEXT"), "  ")).toBeNull();
  });
});

describe("«حقول مخصصة»: how a refused completion is read back", () => {
  it("is the labels of a 422 `fields.required`, and nothing for any other error", () => {
    const err = new ApiError("validation.failed", 422, { missing: [{ id: "f1", label: "الميزانية" }, { id: "f2", label: "المسؤول" }] }, "fields.required");
    expect(requiredFieldsOf(err)).toEqual([{ id: "f1", label: "الميزانية" }, { id: "f2", label: "المسؤول" }]);
    expect(requiredFieldsOf(new ApiError("forbidden", 403, undefined, "reward.owner_only"))).toBeNull();
    expect(requiredFieldsOf(new ApiError("validation.failed", 422, undefined, "validation.failed"))).toBeNull();
    expect(requiredFieldsOf(new ApiError("validation.failed", 422, undefined, "fields.required"))).toEqual([]);
    expect(requiredFieldsOf(null)).toBeNull();
    expect(requiredFieldsOf("x")).toBeNull();
  });
});

describe("«حقول مخصصة»: the limits", () => {
  it("is 15 live fields", () => {
    expect(MAX_ACTIVE_FIELDS).toBe(15);
  });
});

// ---------------------------------------------------------------------------------------------------------
// source pins: the things a database test cannot see
// ---------------------------------------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("«حقول مخصصة»: the only writers of a task's completion are the two that ask for the required fields", () => {
  it("no code under src writes `completedAt` except createTaskInTx (born finished: quick-add is never blocked), moveTask and setTaskCompletion", () => {
    const writers: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const [i, line] of text.split(/\r?\n/).entries()) {
        // an assignment of a VALUE (not null, not a filter object): `completedAt: column.done ? ...`, `completedAt: new Date()`
        // W1.1 «مهامي» only READS the column: `src/lib/work/my-tasks.ts` is the pure client model (type + optimistic reducers, no database), `my-work.ts` maps rows to a DTO
        const dtoRead = file.replace(/\\/g, "/").endsWith("src/lib/work/my-tasks.ts") || /\bcompletedAt:\s*\w+\.completedAt\?\.toISOString\(\) \?\? null/.test(line);
        if (!dtoRead && /\bcompletedAt:\s*(?!null\b|\{|true\b|t\.|Date \|)\S/.test(line) &&!/^\s*(\/\/|\*)/.test(line)) writers.push(`${path.relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}`);
      }
    }
    expect(writers.map((w) => w.split(":")[0])).toEqual(["src/server/services/tasks.ts", "src/server/services/tasks.ts", "src/server/services/tasks.ts"]);
    const tasks = readFileSync(path.join(ROOT, "src/server/services/tasks.ts"), "utf8");
    const guards = tasks.match(/assertRequiredFilled\(tx,/g) ?? [];
    expect(guards.length).toBe(2);
    // each guard sits in its own function, before the row is written
    const move = tasks.slice(tasks.indexOf("export async function moveTask"), tasks.indexOf("export interface TaskUpdateData"));
    expect(move.indexOf("assertRequiredFilled")).toBeGreaterThan(-1);
    expect(move.indexOf("assertRequiredFilled")).toBeLessThan(move.indexOf("tx.task.update"));
    const complete = tasks.slice(tasks.indexOf("export async function setTaskCompletion"), tasks.indexOf("// ---------- reads"));
    expect(complete.indexOf("assertRequiredFilled")).toBeGreaterThan(-1);
    expect(complete.indexOf("assertRequiredFilled")).toBeLessThan(complete.indexOf("tx.task.update"));
    // and the guard is the one that answers 422 `fields.required`
    expect(readFileSync(path.join(ROOT, "src/server/api.ts"), "utf8")).toMatch(/RequiredFieldsError[^\n]*"fields\.required"/);
  });

  it("raw SQL never writes it either", () => {
    for (const file of walk(path.join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      expect(/SET[^;`]*"completedAt"\s*=/i.test(text), file).toBe(false);
    }
  });
});

describe("«حقول مخصصة»: the list query never builds SQL from text", () => {
  it("the field sort picks its column and direction from closed lists and passes every id as a parameter", () => {
    const views = readFileSync(path.join(ROOT, "src/server/services/views.ts"), "utf8");
    const pool = views.slice(views.indexOf("async function sortedPool"), views.indexOf("async function loadByFieldSort"));
    expect(pool).toContain("Prisma.sql`");
    expect(pool).toContain("${s.fieldId}");
    expect(pool).toContain("${q.orgId}");
    expect(pool).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/);
    // the only `Prisma.raw` calls are literals
    for (const m of pool.matchAll(/Prisma\.raw\(([^)]*)\)/g)) expect(m[1]).toMatch(/^\s*(['"])(?:(?!\1).)*\1\s*$/);
  });
});
