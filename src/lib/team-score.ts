/**
 * «السكور» — THE PURE PART: periods, the normalisation of every indicator to 0-100, the weighted average and the bands.
 * No React, no Next, no database: the service reads the numbers, this file does the arithmetic, the screen prints the
 * formula from the SAME constants, and the tests pin fixed fixtures.
 *
 * THE RULES (each is printed on the screen next to its number):
 *
 *  - A score belongs to ONE person and ONE period: a calendar month («2026-10») or quarter («2026-Q4»).
 *  - Four indicators feed it, each normalised to 0-100:
 *      المراجعات (manual)   the reviewers' ratings 1-5, averaged per review and then over the reviews that count:
 *                           (average − 1) ÷ 4 × 100.
 *      الالتزام بالموعد     the on-time rate of the tasks finished in the period that had a due day, as it is (50% = 50).
 *      الإنجاز             tasks finished in the period ÷ the person's BASELINE × 100, never more than 100.
 *      الخطوات             steps ticked in the period ÷ the person's BASELINE × 100, never more than 100.
 *    The baseline is the median of the person's own last 3 periods in which they finished something (steps: ticked
 *    something); when there is no such period, the team's median for THIS period (only when at least 3 people have a number).
 *  - NEVER INVENT: an indicator with nothing to compute from is left out and shown as «—»; the weights of the ones that
 *    remain are re-normalised to 100%.
 *  - The composite is the weighted average of the present indicators; the weights are the owner's (default 50 / 20 / 20 / 10).
 *  - Bands: ممتاز from 80, جيد from 60, يحتاج دعم below. The suggested light: تمام from 70, انتبه from 50, يحتاج تدخل below.
 *    ⚠️ The light that counts is the reviewer's own; the system only SUGGESTS one and says so.
 *  - Shown beside the score but never part of it: tasks still open and overdue NOW, the number of chat messages (a count,
 *    never their text) and the time tracked. A number is not a judgement of quality.
 */

import { addDays, daysBetween, dayKeyOf, parseDayKey } from "./owner-board";
import { monthName } from "./format";

// ───────────────────────────────────────── periods ─────────────────────────────────────────

export type PeriodKind = "month" | "quarter";

export interface Period {
  /** «2026-10» or «2026-Q4». */
  key: string;
  kind: PeriodKind;
  year: number;
  /** 1-12 for a month, 1-4 for a quarter. */
  index: number;
  /** First and last company-day of the period, both included. */
  from: string;
  to: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

const lastDayOf = (year: number, month: number): string => {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(d)}`;
};

/** A period key as a `Period`; null for anything else (a year outside 2000-2100 included). */
export function parsePeriod(key: unknown): Period | null {
  if (typeof key !== "string") return null;
  const m = MONTH.exec(key);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year < 2000 || year > 2100) return null;
    return { key, kind: "month", year, index: month, from: `${year}-${pad2(month)}-01`, to: lastDayOf(year, month) };
  }
  const q = QUARTER.exec(key);
  if (q) {
    const year = Number(q[1]);
    const quarter = Number(q[2]);
    if (year < 2000 || year > 2100) return null;
    const firstMonth = (quarter - 1) * 3 + 1;
    return { key, kind: "quarter", year, index: quarter, from: `${year}-${pad2(firstMonth)}-01`, to: lastDayOf(year, firstMonth + 2) };
  }
  return null;
}

/** The period of this kind that holds a company day. */
export function periodOfDay(day: string, kind: PeriodKind): Period {
  const p = parseDayKey(day);
  if (!p) throw new Error("bad day");
  const key = kind === "month" ? `${p.year}-${pad2(p.month)}` : `${p.year}-Q${Math.floor((p.month - 1) / 3) + 1}`;
  return parsePeriod(key) as Period;
}

/** The period of this kind that holds today in the company's zone. */
export function currentPeriod(now: Date, timeZone: string, kind: PeriodKind = "month"): Period {
  return periodOfDay(dayKeyOf(now, timeZone), kind);
}

/** The period just before this one (same kind). */
export function previousPeriod(period: Period): Period {
  return periodOfDay(addDays(period.from, -1), period.kind);
}

/** The `n` periods before this one, nearest first. */
export function previousPeriods(period: Period, n: number): Period[] {
  const out: Period[] = [];
  let cursor = period;
  for (let i = 0; i < n; i++) {
    cursor = previousPeriod(cursor);
    out.push(cursor);
  }
  return out;
}

/** Days in the period (never more than 92: the board's longest window). */
export const periodDays = (period: Period): number => daysBetween(period.from, period.to).length;

/** A period that has not started yet in the company's zone has nothing to score. */
export function isFuture(period: Period, today: string): boolean {
  return period.from > today;
}

// ───────────────────────────────────────── the arithmetic ─────────────────────────────────────────

export type IndicatorKey = "manual" | "onTime" | "completed" | "steps";
export const INDICATOR_KEYS: readonly IndicatorKey[] = ["manual", "completed", "onTime", "steps"];

export type Weights = Record<IndicatorKey, number>;

/** The owner's default: half the reviewers' ratings, half the automatic indicators (20 / 20 / 10). */
export const DEFAULT_WEIGHTS: Readonly<Weights> = { manual: 50, completed: 20, onTime: 20, steps: 10 };

export const BAND_EXCELLENT = 80;
export const BAND_GOOD = 60;
export const LIGHT_GREEN = 70;
export const LIGHT_AMBER = 50;
/** The minimum number of people with a number before a team median is used as somebody's baseline. */
export const MIN_TEAM_FOR_MEDIAN = 3;

export type Band = "excellent" | "good" | "support";
export type Light = "GREEN" | "AMBER" | "RED";
export const LIGHTS: readonly Light[] = ["GREEN", "AMBER", "RED"];
export const isLight = (value: unknown): value is Light => LIGHTS.includes(value as Light);

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const clamp100 = (n: number) => Math.min(100, Math.max(0, n));

/** Reviewers' ratings 1-5 (their average) → 0-100. */
export const manualToScore = (average: number | null): number | null => (average === null ? null : clamp100(((average - 1) / 4) * 100));

/** The on-time rate as the board gives it (a whole percentage, 0-100) → 0-100 as it is. */
export const onTimeToScore = (rate: number | null): number | null => (rate === null ? null : clamp100(rate));

/** A count against its baseline: 100 at the baseline or above; nothing to compare with (no baseline, or 0) is «—». */
export function countToScore(count: number, baseline: number | null): number | null {
  if (baseline === null || baseline <= 0) return null;
  return clamp100((count / baseline) * 100);
}

export interface Baseline {
  value: number;
  /** own: the median of the person's own previous periods; team: the team's median for the period. */
  source: "own" | "team";
  /** How many numbers the median was taken over. */
  n: number;
}

/**
 * The baseline of a count: the median of the person's own last periods in which the count was above zero; with none, the team's
 * median of this period when at least `MIN_TEAM_FOR_MEDIAN` people have a count above zero; otherwise nothing.
 */
export function baselineFor(ownPrevious: readonly number[], teamThisPeriod: readonly number[]): Baseline | null {
  const own = ownPrevious.filter((n) => n > 0);
  const ownMedian = median(own);
  if (ownMedian !== null && ownMedian > 0) return { value: ownMedian, source: "own", n: own.length };
  const team = teamThisPeriod.filter((n) => n > 0);
  if (team.length >= MIN_TEAM_FOR_MEDIAN) {
    const teamMedian = median(team) as number;
    return { value: teamMedian, source: "team", n: team.length };
  }
  return null;
}

export function bandOf(score: number | null): Band | null {
  if (score === null) return null;
  return score >= BAND_EXCELLENT ? "excellent" : score >= BAND_GOOD ? "good" : "support";
}

/** The light the SYSTEM suggests (a suggestion: the reviewer's own light is the one that counts). */
export function suggestedLight(score: number | null): Light | null {
  if (score === null) return null;
  return score >= LIGHT_GREEN ? "GREEN" : score >= LIGHT_AMBER ? "AMBER" : "RED";
}

export interface IndicatorInput {
  key: IndicatorKey;
  /** 0-100, or null when there is nothing to compute from. */
  value: number | null;
}

export interface ScoreLine {
  key: IndicatorKey;
  /** 0-100, or null: «—». */
  value: number | null;
  /** The owner's weight (0-100). */
  weight: number;
  /** The weight after re-normalising over the present indicators, in percent; null for a missing indicator. */
  share: number | null;
}

export interface Composite {
  /** 0-100 (a float; the screen rounds it), or null when no indicator is present. */
  score: number | null;
  lines: ScoreLine[];
  band: Band | null;
  light: Light | null;
}

/**
 * The weighted average over the PRESENT indicators. A missing indicator (value null) or one with weight 0 is left out and the
 * weights of the others are re-normalised, so `share` always adds up to 100 over the present ones.
 */
export function composite(inputs: readonly IndicatorInput[], weights: Weights): Composite {
  const present = inputs.filter((i) => i.value !== null && (weights[i.key] ?? 0) > 0);
  const total = present.reduce((sum, i) => sum + (weights[i.key] ?? 0), 0);
  const lines: ScoreLine[] = inputs.map((i) => ({
    key: i.key,
    value: i.value,
    weight: weights[i.key] ?? 0,
    share: i.value !== null && (weights[i.key] ?? 0) > 0 && total > 0 ? ((weights[i.key] ?? 0) / total) * 100 : null,
  }));
  if (present.length === 0 || total <= 0) return { score: null, lines, band: null, light: null };
  const score = present.reduce((sum, i) => sum + (i.value as number) * (weights[i.key] ?? 0), 0) / total;
  return { score, lines, band: bandOf(score), light: suggestedLight(score) };
}

/** The score as shown: a whole number (the arithmetic above keeps the fraction). */
export const shownScore = (score: number | null): number | null => (score === null ? null : Math.round(score));

/** The owner's weights as stored: whole numbers 0-100, at least one above zero; anything else reads as the defaults. */
export function readWeights(stored: unknown): Weights {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_WEIGHTS };
  const out = { ...DEFAULT_WEIGHTS } as Weights;
  for (const key of INDICATOR_KEYS) {
    const v = (stored as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100) out[key] = v;
    else return { ...DEFAULT_WEIGHTS };
  }
  return INDICATOR_KEYS.some((k) => out[k] > 0) ? out : { ...DEFAULT_WEIGHTS };
}

/** The average of the ratings (1-5) of one review over the criteria it has a rating for; null when it has none. */
export function ratingAverage(ratings: Readonly<Record<string, number>>): number | null {
  const values = Object.values(ratings).filter((v) => Number.isFinite(v) && v >= 1 && v <= 5);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** The average over the reviews that count (each review's own average first, so a review with more criteria does not weigh more). */
export function manualAverage(reviews: readonly Readonly<Record<string, number>>[]): { average: number | null; count: number } {
  const averages = reviews.map(ratingAverage).filter((a): a is number => a !== null);
  return { average: averages.length === 0 ? null : averages.reduce((a, b) => a + b, 0) / averages.length, count: averages.length };
}

/** The period and the ones before it, newest first (what the period pickers offer): `count` in all. */
export function recentPeriods(current: Period, count: number): Period[] {
  return [current, ...previousPeriods(current, Math.max(0, count - 1))];
}

/** What a period picker offers on this company day: the last 12 months, then the last 5 quarters, newest first. */
export function pickerPeriods(today: string): Period[] {
  return [...recentPeriods(periodOfDay(today, "month"), 12), ...recentPeriods(periodOfDay(today, "quarter"), 5)];
}

type Say = (key: string, params?: Record<string, string | number>) => string;

/** A period as the screens name it: «تشرين الأول 2026» or «الربع 4 2026». */
export function periodLabel(p: Period, t: Say): string {
  return p.kind === "month" ? `${monthName(p.index - 1)} ${p.year}` : `${t("teamdev.period.quarter_n", { n: p.index })} ${p.year}`;
}

/** The periods a picker offers (`pickerPeriods`), each with its name: what the review form and the phone list. */
export function periodChoices(today: string, t: Say): { key: string; kind: PeriodKind; label: string }[] {
  return pickerPeriods(today).map((p) => ({ key: p.key, kind: p.kind, label: periodLabel(p, t) }));
}
