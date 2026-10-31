/**
 * «حقول مخصصة» — a project's field values as a CSV file (pure: the service reads the rows, this writes the text).
 *
 * UTF-8 with a byte order mark so a spreadsheet reads the Arabic, CRLF between rows, and every cell made safe from formulas:
 * the titles, the labels, the choices and the texts are typed by people, so a cell that starts with = + - @ (or a tab or a
 * carriage return) gets a leading apostrophe (`csvCell`). A number is written as a number, not as text, so a negative one is
 * still a number and not an apostrophe.
 */
import { AR } from "./i18n/dict";
import { buildCsv } from "./owner-board";
import { optionLabel, type FieldDefDto } from "./custom-fields";

export interface ExportRow {
  /** «MAIN-12». */
  key: string;
  title: string;
  /** The board column's name, already in words. */
  status: string;
  assignee: string | null;
  /** fieldId → the canonical value (see src/lib/custom-fields.ts); a field with no answer is absent. */
  values: Readonly<Record<string, unknown>>;
}

const word = (key: string): string => AR[key] ?? key;

/** A decimal text as a number when no digit would be lost (at most 15 digits), else the exact text. */
function numberCell(text: string): string | number {
  return /^-?\d+(\.\d+)?$/.test(text) && text.replace(/[-.]/g, "").length <= 15 ? Number(text) : text;
}

/** One value as a cell of the file; `names` maps a person's id to their name. */
export function exportCell(def: FieldDefDto, value: unknown, names: ReadonlyMap<string, string>): string | number | null {
  if (value === undefined || value === null) return null;
  switch (def.type) {
    case "TEXT":
    case "LONG_TEXT":
    case "LINK":
    case "DATE":
      return typeof value === "string" ? value : null;
    case "NUMBER":
      return typeof value === "string" ? numberCell(value) : null;
    case "MONEY":
      return typeof value === "number" ? value : null;
    case "BOOLEAN":
      return typeof value === "boolean" ? word(value ? "fields.yes" : "fields.no") : null;
    case "PERSON":
      return typeof value === "string" ? (names.get(value) ?? word("fields.person_gone")) : null;
    case "SINGLE_CHOICE":
      return typeof value === "string" ? optionLabel(def.options, value, word("fields.deleted")).label : null;
    case "MULTI_CHOICE":
      return Array.isArray(value)
        ? value
            .filter((v): v is string => typeof v === "string")
            .map((id) => optionLabel(def.options, id, word("fields.deleted")).label)
            .join("، ")
        : null;
  }
}

/** The header of a field's column: its label, with the unit or the currency the project gave it. */
export function exportHeader(def: FieldDefDto): string {
  const unit = def.type === "NUMBER" ? def.unit : def.type === "MONEY" ? def.currency : null;
  return unit ? `${def.label} (${unit})` : def.label;
}

/** The file: the task's number, title, status and holder, then one column per live field, in the project's order. */
export function fieldsCsv(defs: readonly FieldDefDto[], rows: readonly ExportRow[], names: ReadonlyMap<string, string>): string {
  const head = [word("fields.csv.key"), word("fields.csv.title"), word("fields.csv.status"), word("fields.csv.assignee"), ...defs.map(exportHeader)];
  const body = rows.map((r) => [r.key, r.title, r.status, r.assignee ?? "", ...defs.map((d) => exportCell(d, r.values[d.id], names))]);
  return buildCsv([head, ...body]);
}
