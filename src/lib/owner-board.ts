/**
 * «لوحة المالك» — THE PURE PART: the window of days, the company's day buckets, the rate arithmetic and the CSV cell.
 *
 * No React, no Next, no database: the service (src/server/services/owner-board.ts) asks it for the days, the screens
 * ask it how to write a number, and the tests read it directly.
 *
 * ⚠️ A day here is ALWAYS the company's day (`Organization.timezone`, default Asia/Damascus), never a UTC day: a task
 *    finished at 23:30 in Damascus belongs to that day even though it is already the next day in UTC.
 * 🔧 `dayKeyOf` is the one bucketing rule of the JavaScript side; the SQL side buckets with the same zone
 *    (`(x AT TIME ZONE 'UTC') AT TIME ZONE <zone>`), and a database test pins that the two agree around midnight.
 */

import { zonedParts, zonedWallTime } from "./zoned-time";
import { fmtMinutes, fmtNumber } from "./format";

/** The longest window the board answers, in days (the owner's rule: bounded, so the page stays cheap). */
export const MAX_WINDOW_DAYS = 92;
/** The window when nobody picked one. */
export const DEFAULT_WINDOW_DAYS = 14;

export const WINDOW_PRESETS = ["today", "7", "14", "30"] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

const DAY_MS = 86_400_000;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "2026-10-30": the company's calendar day of an instant. */
export function dayKeyOf(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** A day key as numbers; null for anything that is not a real calendar day. */
export function parseDayKey(key: unknown): { year: number; month: number; day: number } | null {
  if (typeof key !== "string") return null;
  const m = KEY.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

const utcOf = (key: string): number => {
  const p = parseDayKey(key);
  return p ? Date.UTC(p.year, p.month - 1, p.day) : Number.NaN;
};

/** The day key `delta` days from another one (calendar arithmetic, no clock involved). */
export function addDays(key: string, delta: number): string {
  const d = new Date(utcOf(key) + delta * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** The days from `from` to `to`, both included. Empty when `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const n = Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** A refusal with a dictionary key (the service turns it into a 422). */
export class WindowError extends Error {
  constructor(readonly key: "ownerboard.range_invalid" | "ownerboard.range_too_long") {
    super(key);
  }
}

export interface BoardWindow {
  /** First and last day, both included, as company-day keys. */
  from: string;
  to: string;
  /** Every day of the window, oldest first. */
  days: string[];
  /** The instant the first day began and the instant the day after the last one begins (exclusive): what SQL filters by. */
  start: Date;
  end: Date;
  /** How the window was asked for (what the filter bar shows as chosen). */
  preset: WindowPreset | "custom";
  /** The company's today, as a key. */
  today: string;
}

export interface WindowInput {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * The window: a preset («اليوم» · 7 · 14 · 30 days, ending today) or a custom range of at most `MAX_WINDOW_DAYS` days.
 * A custom range that ends after today is cut at today (a future day has nothing in it). Nothing given: 14 days.
 * Throws `WindowError` for a range that is not two real days in order, or longer than the cap.
 */
export function resolveWindow(input: WindowInput, now: Date, timeZone: string): BoardWindow {
  const today = dayKeyOf(now, timeZone);
  let from: string;
  let to = today;
  let preset: BoardWindow["preset"];

  if (input.from || input.to) {
    if (!parseDayKey(input.from) || !parseDayKey(input.to)) throw new WindowError("ownerboard.range_invalid");
    from = input.from as string;
    to = input.to as string;
    if (utcOf(from) > utcOf(to)) throw new WindowError("ownerboard.range_invalid");
    if (daysBetween(from, to).length > MAX_WINDOW_DAYS) throw new WindowError("ownerboard.range_too_long");
    if (utcOf(to) > utcOf(today)) to = today;
    if (utcOf(from) > utcOf(to)) throw new WindowError("ownerboard.range_invalid");
    preset = "custom";
  } else {
    const wanted = (WINDOW_PRESETS as readonly string[]).includes(input.preset ?? "") ? (input.preset as WindowPreset) : String(DEFAULT_WINDOW_DAYS) as WindowPreset;
    const n = wanted === "today" ? 1 : Number(wanted);
    from = addDays(today, -(n - 1));
    preset = wanted;
  }

  const f = parseDayKey(from)!;
  const t = parseDayKey(to)!;
  return {
    from,
    to,
    days: daysBetween(from, to),
    start: zonedWallTime({ year: f.year, month: f.month, day: f.day }, timeZone),
    end: zonedWallTime({ year: t.year, month: t.month, day: t.day + 1 }, timeZone),
    preset,
    today,
  };
}

// ───────────────────────────────────────── the arithmetic ─────────────────────────────────────────

/**
 * «نسبة الالتزام بالموعد» = tasks finished on or before their due day ÷ tasks finished that HAD a due day.
 * Nothing to divide by (no finished task had a due day) is `null`, shown as «—»: never 0%, because 0% would say
 * "everything was late" about a person who simply had no deadline.
 */
export function onTimeRate(onTime: number, withDue: number): number | null {
  if (!Number.isFinite(onTime) || !Number.isFinite(withDue) || withDue <= 0) return null;
  return Math.round((onTime / withDue) * 100);
}

/** A rate as the screen writes it: «—» for nothing to divide by, otherwise «83%» (Western digits). */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

/** Days with one decimal («3.5»), or «—» when there is nothing to average. */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "—";
  return String(Math.round(days * 10) / 10);
}

/** The company's wall clock «21:05» of an instant (Western digits), or «—». */
export function timeOfDay(instant: Date | null | undefined, timeZone: string): string {
  if (!instant) return "—";
  const p = zonedParts(instant, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// ───────────────────────────────────────── a section's cell ─────────────────────────────────────────

/** How a section's value is written on screen: a duration as «س:دق», a count with thousands commas, text as it is, nothing as «—». */
export function sectionText(kind: "count" | "minutes" | "text", value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return kind === "minutes" ? fmtMinutes(value) : fmtNumber(value);
}

// ───────────────────────────────────────── CSV ─────────────────────────────────────────

/**
 * One CSV cell. A cell that starts with = + - @ (or a tab or a carriage return) would be run as a formula by a
 * spreadsheet, so it gets a leading apostrophe; quotes, commas and line breaks are quoted. Numbers are written as they are.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV file as bytes' text: UTF-8 with a BOM so a spreadsheet reads the Arabic, CRLF between rows. */
export function buildCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
