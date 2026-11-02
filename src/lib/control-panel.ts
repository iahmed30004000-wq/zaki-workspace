/**
 * «لوحة التحكم» — THE PURE PART: what the owner is told, and how each sentence is worked out.
 *
 * No React, no Next, no database: the service (src/server/services/control-panel.ts) reads the numbers and asks `buildInsights` what is worth
 * the owner's eye; the screens write each result in Arabic through the dictionary (`cp.i.<id>` for the sentence, `cp.f.<id>` for its formula),
 * and the tests read this file directly.
 *
 * The rule of «لوحة المالك» stays: EVERY SENTENCE CARRIES ITS FORMULA. An insight is a fact with a threshold written next to it, never a verdict
 * on a person: «ما سجّل نشاط من ٣ أيام» is a count of recorded actions, not a judgement; it can be somebody on leave, and the screen says so.
 *
 * ⚠️ An insight about people names them, so it is for the OWNER alone (the page and the routes decide that on the server).
 * 🔧 Nothing here reads a customer, a price or the text of a message: only counts, dates and the names of the company's own staff.
 */

export type InsightTone = "good" | "warn" | "info";

/** One sentence for the owner: a key into the dictionary, its numbers and names, and where to look next. */
export interface Insight {
  /** Stable: the dictionary key is `cp.i.<id>` (its sentence) and `cp.f.<id>` (its formula). */
  id: InsightId;
  tone: InsightTone;
  params: Record<string, string | number>;
  /** The people the sentence names (their ids), so a screen can link them. */
  people: string[];
  /** Where the sentence leads (a page of the app). */
  href: string | null;
}

export const INSIGHT_IDS = [
  "overdue",
  "late_people",
  "idle_people",
  "trend_up",
  "trend_down",
  "trend_same",
  "trend_none",
  "on_time_down",
  "on_time_up",
  "overloaded",
  "unassigned",
  "stale",
  "forecast",
  "top",
  "ideas_waiting",
  "all_clear",
] as const;
export type InsightId = (typeof INSIGHT_IDS)[number];

// ───────────────────────────────────────── the thresholds, in one place ─────────────────────────────────────────

/** A person with at least this many overdue tasks is named under «متأخرين». */
export const LATE_PERSON_MIN = 2;
/** A person with no recorded action for this many company days (today included) is named under «ساكتين». */
export const IDLE_DAYS = 3;
/** An open task nobody touched for this many days is «واقفة». */
export const STALE_DAYS = 14;
/** An idea still «جديدة» after this many days is waiting for a review. */
export const IDEA_WAIT_DAYS = 7;
/** The on-time rate moves the owner's eye when it changes by at least this many points. */
export const ON_TIME_POINTS = 10;
/** A person holds «أكتر من المعدل» when their open tasks are at least this many and at least double the median. */
export const OVERLOAD_MIN = 8;
/** The window the forecast is taken over. */
export const FORECAST_DAYS = 28;
/** The most names one sentence lists before «وغيرهم». */
export const NAMES_MAX = 3;

// ───────────────────────────────────────── the inputs ─────────────────────────────────────────

/** One ACTIVE member of staff over the last 7 company days (the board's own per-person numbers). */
export interface PersonWeek {
  userId: string;
  name: string;
  completed: number;
  openTasks: number;
  overdue: number;
  /** The company day (a key «2026-11-02») of the last recorded action in the window; null: none. */
  lastActiveDay: string | null;
}

export interface WeekTotals {
  completed: number;
  /** Finished on or before their day, of those that had a day. */
  onTime: number;
  withDue: number;
}

export interface InsightInput {
  /** The company's today, as a day key. */
  today: string;
  week: PersonWeek[];
  thisWeek: WeekTotals;
  prevWeek: WeekTotals;
  /** The company's open work right now. */
  open: number;
  overdue: number;
  unassigned: number;
  stale: number;
  /** Tasks finished in the last `FORECAST_DAYS` days. */
  completedForecastWindow: number;
  ideasWaiting: number;
  overdueBySpace: { name: string; n: number }[];
}

// ───────────────────────────────────────── small arithmetic ─────────────────────────────────────────

/** The change of `cur` against `prev`, as a whole percent. `null` when there is nothing to compare with (`prev` is 0). */
export function changePercent(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** «نسبة الالتزام بالموعد»: whole percent, `null` when no finished task had a day (never 0% for «nothing to divide by»). */
export function rateOf(onTime: number, withDue: number): number | null {
  return withDue > 0 ? Math.round((onTime / withDue) * 100) : null;
}

/** The middle value of a list (the mean of the two middle ones for an even length); 0 for an empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Days to clear the open work at the pace of the last `FORECAST_DAYS` days: `open ÷ (finished ÷ days)`, rounded up. `null` when nothing was
 * finished in the window (no pace to speak of) or nothing is open. A forecast is arithmetic, not a promise: the screen writes its formula.
 */
export function forecastDays(open: number, completedInWindow: number, windowDays: number = FORECAST_DAYS): number | null {
  if (open <= 0 || completedInWindow <= 0 || windowDays <= 0) return null;
  return Math.ceil(open / (completedInWindow / windowDays));
}

/** The calendar days from one day key to a later one (0: the same day). */
export function dayGap(from: string, to: string): number {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!f || !t) return Number.NaN;
  const ms = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((ms(t) - ms(f)) / 86_400_000);
}

/** «أحمد، سارة، خالد» up to `NAMES_MAX` names, then the count of the rest is a separate parameter. */
export function namesOf(names: readonly string[]): { list: string; rest: number } {
  return { list: names.slice(0, NAMES_MAX).join("، "), rest: Math.max(0, names.length - NAMES_MAX) };
}

// ───────────────────────────────────────── the insights ─────────────────────────────────────────

/**
 * What is worth the owner's eye, the most urgent first. Pure and deterministic: the same numbers give the same sentences in the same order.
 * A sentence is written only when its fact is true and past its threshold, so a quiet company gets one «ما في شي لافت» and nothing else.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const add = (id: InsightId, tone: InsightTone, params: Record<string, string | number> = {}, people: string[] = [], href: string | null = null) =>
    out.push({ id, tone, params, people, href });

  // 1. the company's late work, and where most of it is
  if (input.overdue > 0) {
    const top = [...input.overdueBySpace].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ar"))[0];
    add("overdue", "warn", { n: input.overdue, space: top?.name ?? "—", spaceN: top?.n ?? 0 }, [], "/list?filter=overdue");
  }

  // 2. the people holding the most late tasks
  const late = input.week.filter((p) => p.overdue >= LATE_PERSON_MIN).sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name, "ar"));
  if (late.length > 0) {
    const { list, rest } = namesOf(late.map((p) => `${p.name} (${p.overdue})`));
    add("late_people", "warn", { n: late.length, names: list, rest, min: LATE_PERSON_MIN }, late.map((p) => p.userId));
  }

  // 3. the people with no recorded action for a few days (it can be a leave: the sentence says so)
  const idle = input.week
    .filter((p) => p.lastActiveDay === null || dayGap(p.lastActiveDay, input.today) >= IDLE_DAYS)
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  if (idle.length > 0) {
    const { list, rest } = namesOf(idle.map((p) => p.name));
    add("idle_people", "warn", { n: idle.length, names: list, rest, days: IDLE_DAYS }, idle.map((p) => p.userId));
  }

  // 4. the week against the one before it
  const change = changePercent(input.thisWeek.completed, input.prevWeek.completed);
  if (input.thisWeek.completed === 0 && input.prevWeek.completed === 0) add("trend_none", "info");
  else if (change === null) add("trend_up", "good", { cur: input.thisWeek.completed, prev: input.prevWeek.completed, pct: 100 });
  else if (change > 0) add("trend_up", "good", { cur: input.thisWeek.completed, prev: input.prevWeek.completed, pct: change });
  else if (change < 0) add("trend_down", "warn", { cur: input.thisWeek.completed, prev: input.prevWeek.completed, pct: Math.abs(change) });
  else add("trend_same", "info", { cur: input.thisWeek.completed });

  // 5. the on-time rate moved by ten points or more
  const rateNow = rateOf(input.thisWeek.onTime, input.thisWeek.withDue);
  const ratePrev = rateOf(input.prevWeek.onTime, input.prevWeek.withDue);
  if (rateNow !== null && ratePrev !== null) {
    if (ratePrev - rateNow >= ON_TIME_POINTS) add("on_time_down", "warn", { cur: rateNow, prev: ratePrev, points: ON_TIME_POINTS });
    else if (rateNow - ratePrev >= ON_TIME_POINTS) add("on_time_up", "good", { cur: rateNow, prev: ratePrev, points: ON_TIME_POINTS });
  }

  // 6. somebody holding far more than the middle of the team
  const mid = median(input.week.map((p) => p.openTasks));
  const loaded = input.week.filter((p) => p.openTasks >= OVERLOAD_MIN && p.openTasks >= mid * 2).sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name, "ar"));
  if (loaded.length > 0) {
    const { list, rest } = namesOf(loaded.map((p) => `${p.name} (${p.openTasks})`));
    add("overloaded", "info", { n: loaded.length, names: list, rest, median: Math.round(mid * 10) / 10, min: OVERLOAD_MIN }, loaded.map((p) => p.userId));
  }

  // 7. work nobody holds, and work that stopped
  if (input.unassigned > 0) add("unassigned", "info", { n: input.unassigned });
  if (input.stale > 0) add("stale", "info", { n: input.stale, days: STALE_DAYS });

  // 8. how long the open work takes at the recent pace
  const days = forecastDays(input.open, input.completedForecastWindow);
  if (days !== null) {
    add("forecast", "info", { open: input.open, rate: Math.round((input.completedForecastWindow / FORECAST_DAYS) * 10) / 10, days, window: FORECAST_DAYS });
  }

  // 9. who finished the most this week
  const top = [...input.week].filter((p) => p.completed > 0).sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name, "ar"))[0];
  if (top) add("top", "good", { name: top.name, n: top.completed }, [top.userId]);

  // 10. ideas waiting for a first look
  if (input.ideasWaiting > 0) add("ideas_waiting", "info", { n: input.ideasWaiting, days: IDEA_WAIT_DAYS }, [], "/ideas");

  // nothing past a threshold at all: say so, once
  if (!out.some((i) => i.tone === "warn")) add("all_clear", "good");

  return sortInsights(out);
}

const TONE_ORDER: Record<InsightTone, number> = { warn: 0, info: 1, good: 2 };

/** Warnings first, then the things to know, then the good news; inside a tone the order they were written in. */
export function sortInsights(list: readonly Insight[]): Insight[] {
  return list.map((item, index) => ({ item, index })).sort((a, b) => TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || a.index - b.index).map((x) => x.item);
}

// ───────────────────────────────────────── the weekly series ─────────────────────────────────────────

/** One 7-day bucket of the company's work: `ago` 0 is the last 7 days (today included), 1 the 7 before, and so on. */
export interface WeekPoint {
  ago: number;
  created: number;
  completed: number;
}

/** The series oldest first, with a point for every one of `weeks` buckets (a week with nothing is a zero, not a gap). */
export function fillSeries(rows: readonly WeekPoint[], weeks: number): WeekPoint[] {
  const by = new Map(rows.map((r) => [r.ago, r] as const));
  const out: WeekPoint[] = [];
  for (let ago = weeks - 1; ago >= 0; ago--) out.push(by.get(ago) ?? { ago, created: 0, completed: 0 });
  return out;
}

/** The tallest bar of a series (at least 1, so a bar's height is never a division by zero). */
export function seriesMax(points: readonly WeekPoint[]): number {
  return Math.max(1, ...points.map((p) => Math.max(p.created, p.completed)));
}
