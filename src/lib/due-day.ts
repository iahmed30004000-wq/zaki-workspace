import { NOON_HOUR } from "@/lib/today";
import { nextZonedDayStart, zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * The day a task is DUE, as a person picked it: `YYYY-MM-DD` in the COMPANY's zone, never the browser's.
 *
 * A due date is stored as the instant of noon (company time) on the day chosen — noon so that no change of
 * the clocks can move it to another day (`zonedStandIn` says the same thing on the reading side). The
 * browser used to build that instant itself (`new Date("2026-11-05T12:00:00")`), which meant a person
 * working from another country — or a phone whose clock was set elsewhere — saved a day the company does
 * not live in, and the card showed yesterday or tomorrow (review B5).
 */

/** `YYYY-MM-DD` → `{ year, month, day }`, or null when the text is not a plain date (two digits, a real month and day). */
export function parseDayText(day: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayNumber = Number(m[3]);
  if (month < 1 || month > 12 || dayNumber < 1 || dayNumber > 31) return null;
  return { year, month, day: dayNumber };
}

/** The instant of noon (company time) on the day `day` — what the API stores. Null when the text is not a date. */
export function dueInstantForDay(day: string, timeZone: string): Date | null {
  const p = parseDayText(day);
  return p ? zonedWallTime({ ...p, hour: NOON_HOUR }, timeZone) : null;
}

/** The day (`YYYY-MM-DD`, company time) a stored due instant belongs to. */
export function dayOfInstant(instant: Date | string, timeZone: string): string {
  const p = zonedParts(new Date(instant), timeZone);
  return `${p.year.toString().padStart(4, "0")}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

/** The stored dueDate the screens are given: the day, plus noon in the company's zone for the wording (`fmtRelative`). */
export interface DueDay {
  /** `YYYY-MM-DD` in the company's zone — what the date box shows and sends back. */
  day: string;
  /** The instant to write that day: noon in the company's zone. */
  noon: Date;
}

/** A stored due instant (or null) as the screens need it. */
export function dueDayOf(instant: Date | string | null | undefined, timeZone: string): DueDay | null {
  if (instant == null) return null;
  const day = dayOfInstant(instant, timeZone);
  const noon = dueInstantForDay(day, timeZone);
  return noon ? { day, noon } : null;
}

// ---------- day AND time (the owner, 2026-11-25) ----------
//
// A due date has always been an instant; the screens now let a person pick its hour. Noon (company time) keeps its old meaning, «the whole day»: it is what
// every task saved before this has, and what a bare day still stores. A whole-day task is late once its day is over; a task with an hour, once the hour passes.

const two = (n: number) => String(n).padStart(2, "0");

/** Noon of the company's day that holds `instant`. */
function noonOfDay(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: NOON_HOUR }, timeZone);
}

/** No hour was picked: the whole day. */
export function isAllDayDue(due: Date | string, timeZone: string): boolean {
  const p = zonedParts(new Date(due), timeZone);
  return p.hour === NOON_HOUR && p.minute === 0 && p.second === 0;
}

/** Is an OPEN task with this due date late at `now`? */
export function isDueOverdue(due: Date | string, timeZone: string, now: Date = new Date()): boolean {
  const at = new Date(due);
  if (isAllDayDue(at, timeZone)) return dayOfInstant(at, timeZone) < dayOfInstant(now, timeZone);
  return at.getTime() < now.getTime();
}

/** Due today and not late yet. */
export function isDueToday(due: Date | string, timeZone: string, now: Date = new Date()): boolean {
  return dayOfInstant(due, timeZone) === dayOfInstant(now, timeZone) && !isDueOverdue(due, timeZone, now);
}

/** `isDueOverdue` as a filter on `dueDate`: before now, and not today's whole-day noon (an earlier day's noon is before now anyway). */
export function overdueDueFilter(now: Date, timeZone: string): { lt: Date; not: Date } {
  return { lt: now, not: noonOfDay(now, timeZone) };
}

/** Open and NOT late, for the database: from this moment on, or today's whole-day tasks. Put it under `AND`, so it never replaces another `OR`. */
export function notLateWhere(now: Date, timeZone: string): { OR: [{ dueDate: { gte: Date } }, { dueDate: Date }] } {
  return { OR: [{ dueDate: { gte: now } }, { dueDate: noonOfDay(now, timeZone) }] };
}

/** `isDueToday` for the database: what is left of today, and today's whole-day tasks. Put it under `AND`, so it never replaces another `OR`. */
export function dueLaterTodayWhere(now: Date, timeZone: string): { OR: [{ dueDate: { gte: Date; lt: Date } }, { dueDate: Date }] } {
  return { OR: [{ dueDate: { gte: now, lt: nextZonedDayStart(now, timeZone) } }, { dueDate: noonOfDay(now, timeZone) }] };
}

/** What a client may send: `YYYY-MM-DD` (the whole day), `YYYY-MM-DDTHH:mm` (the company's wall clock), or a full instant with its zone. Null: not a date. */
export function parseDueInput(text: string, timeZone: string): Date | null {
  const value = text.trim();
  if (parseDayText(value)) return dueInstantForDay(value, timeZone);
  const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (wall) {
    const day = parseDayText(wall[1]!);
    const hour = Number(wall[2]);
    const minute = Number(wall[3]);
    return day && hour <= 23 && minute <= 59 ? zonedWallTime({ ...day, hour, minute }, timeZone) : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** The company's wall clock of a stored due instant, as a `datetime-local` box shows it and sends it back. */
export function dueWallOfInstant(instant: Date | string, timeZone: string): string {
  const p = zonedParts(new Date(instant), timeZone);
  return `${dayOfInstant(instant, timeZone)}T${two(p.hour)}:${two(p.minute)}`;
}

/** The hour a due wall clock (`YYYY-MM-DDTHH:mm`) says to a person: empty for the whole day (noon). */
export function dueTimeText(wall: string | null | undefined): string {
  const time = wall?.slice(11, 16) ?? "";
  return time === "12:00" ? "" : time;
}

export const DEFAULT_DUE_HOUR = 18;

/** The company's hour for a new task's due date (`Organization.settings.defaultDueHour`): 0 to 23, or null for «no default date». Anything else: 18. */
export function defaultDueHourOf(settings: unknown): number | null {
  const value = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>)["defaultDueHour"] : undefined;
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23 ? value : DEFAULT_DUE_HOUR;
}

/** The due date of a task created without one: TODAY at the company's hour. */
export function defaultDueDate(settings: unknown, timeZone: string, now: Date = new Date()): Date | null {
  const hour = defaultDueHourOf(settings);
  if (hour === null) return null;
  const p = zonedParts(now, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day, hour }, timeZone);
}
