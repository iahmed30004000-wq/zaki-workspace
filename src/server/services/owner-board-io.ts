import { z } from "zod";
import { enumLabel } from "@/lib/i18n/enums";
import type { ServerT } from "@/lib/i18n/server";
import { buildCsv, dayKeyOf, formatRate, sectionText, timeOfDay } from "@/lib/owner-board";
import type { BoardQuery, Overview } from "@/server/services/owner-board";

/**
 * «لوحة المالك» — what comes in (the query string, parsed once, the same for the pages and the routes) and what goes out
 * (the CSV of the people table: exactly the columns on the screen, nothing more).
 */

const text = z.string().trim().max(64);
const querySchema = z.object({
  range: text.optional(),
  from: text.optional(),
  to: text.optional(),
  space: text.optional(),
  person: text.optional(),
  sort: text.optional(),
  dir: text.optional(),
});

/** The board's query string as a `BoardQuery`; unknown keys are ignored and a value that is too long is cut to nothing. */
export function parseBoardQuery(source: URLSearchParams | Record<string, string | string[] | undefined>): BoardQuery {
  const read = (key: string): string | undefined => {
    const v = source instanceof URLSearchParams ? source.get(key) : source[key];
    const one = Array.isArray(v) ? v[0] : v;
    return one === null || one === undefined || one === "" ? undefined : one;
  };
  const parsed = querySchema.safeParse({
    range: read("range"),
    from: read("from"),
    to: read("to"),
    space: read("space"),
    person: read("person"),
    sort: read("sort"),
    dir: read("dir"),
  });
  const q = parsed.success ? parsed.data : {};
  return { preset: q.range ?? null, from: q.from ?? null, to: q.to ?? null, space: q.space ?? null, person: q.person ?? null, sort: q.sort ?? null, dir: q.dir ?? null };
}

/** The people table as a CSV file (UTF-8 with a BOM; a cell that starts with = + - @ is made safe from spreadsheet formulas). */
export function peopleCsv(o: Overview, t: ServerT): string {
  const tz = o.window.timeZone;
  const head = [
    t("ownerboard.col.name"),
    t("ownerboard.col.role"),
    t("ownerboard.col.status"),
    t("ownerboard.col.completed"),
    t("ownerboard.col.open"),
    t("ownerboard.col.overdue"),
    t("ownerboard.col.onTime"),
    t("ownerboard.col.steps"),
    t("ownerboard.col.messages"),
    t("ownerboard.col.lastActivity"),
    ...o.sections.map((c) => t(c.labelKey)),
  ];
  const rows = o.people.map((p) => [
    p.name,
    enumLabel("OrgRole", p.role),
    enumLabel("MemberStatus", p.status),
    p.completed,
    p.openTasks,
    p.overdue,
    formatRate(p.onTimeRate),
    p.steps,
    p.messages,
    p.lastActivity ? `${dayKeyOf(new Date(p.lastActivity), tz)} ${timeOfDay(new Date(p.lastActivity), tz)}` : "—",
    // a count stays a plain number in the file (no thousands commas); a duration is written «س:دق» like on the screen
    ...o.sections.map((c) => {
      const v = o.sectionValues[p.userId]?.[c.key];
      return c.kind === "count" ? (v ?? "—") : sectionText(c.kind, v);
    }),
  ]);
  return buildCsv([head, ...rows]);
}
