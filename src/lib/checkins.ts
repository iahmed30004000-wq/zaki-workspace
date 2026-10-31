import { AR } from "@/lib/i18n/dict";
import { dayKey } from "@/lib/time-tracking";
import { nextZonedDayStart, zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * «التسجيل اليومي» — the pure rules: what a configuration may hold, when a round opens and closes in the COMPANY's zone,
 * when the single nudge is due, what an answer may hold, and the arithmetic of the counts. No React, no database: the
 * service, the job and the screens read these, and the tests read them directly.
 *
 * THE COMPANY'S WEEK counts days the way the platform does and the Today page does: 0 = الأحد … 6 = السبت. A new
 * check-in works Sunday to Thursday (0 to 4), at 09:00, with three questions.
 */

export const MAX_QUESTIONS = 5;
export const MAX_QUESTION_LENGTH = 200;
/** One answer, per question. */
export const MAX_ANSWER_LENGTH = 1000;
/** «مهام اليوم»: at most this many tasks are attached to one answer. */
export const MAX_ATTACHED_TASKS = 10;
/** The one extra nudge goes out this long after the round opened. */
export const NUDGE_DELAY_MS = 3 * 3_600_000;
export const DEFAULT_TIME_OF_DAY = "09:00";
/** الأحد to الخميس. */
export const DEFAULT_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4];

/** The questions a new check-in starts with (the owner's own words, in the dictionary). */
export function defaultQuestions(): string[] {
  return ["checkins.default.q1", "checkins.default.q2", "checkins.default.q3"].map((key) => AR[key] ?? "");
}

export type ParticipantsMode = "ALL" | "LIST";
export const isParticipantsMode = (value: unknown): value is ParticipantsMode => value === "ALL" || value === "LIST";

// ───────────────────────────────────────── the schedule ─────────────────────────────────────────

/** `HH:MM` (24 hours) → its parts, or null. */
export function parseTimeOfDay(text: unknown): { hour: number; minute: number } | null {
  if (typeof text !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/** Days of the week, each 0 to 6, no repeats, sorted; null when there is none or one is not a whole number in range. */
export function normalizeWeekdays(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 7) return null;
  const out = new Set<number>();
  for (const v of input) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 6) return null;
    out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** The week a stored column holds, tolerant of a broken one (falls back to the default week). */
export function weekdaysOf(stored: unknown): number[] {
  return normalizeWeekdays(stored) ?? [...DEFAULT_WEEKDAYS];
}

export interface Opening {
  /** The company's day the round belongs to (`YYYY-MM-DD`). */
  day: string;
  /** The wall-clock moment the round was due (today's configured time in the company's zone). */
  scheduledAt: Date;
  /** The end of the company's day: the instant after which the round takes no more answers. */
  closesAt: Date;
}

/**
 * Is a round due at `now`? Yes when the company's today is one of the configured weekdays and the configured time of
 * day has come (a runner that was down in the morning still opens it, any time up to the end of the day). The round
 * belongs to the COMPANY's day and closes at that day's end, so a day of 23 or 25 hours (the clocks changing) is exact.
 * Null: not a working day, or too early.
 */
export function openingFor(now: Date, timeZone: string, schedule: { timeOfDay: string; weekdays: readonly number[] }): Opening | null {
  const time = parseTimeOfDay(schedule.timeOfDay);
  if (!time) return null;
  const p = zonedParts(now, timeZone);
  if (!schedule.weekdays.includes(p.weekday)) return null;
  const scheduledAt = zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: time.hour, minute: time.minute }, timeZone);
  if (now.getTime() < scheduledAt.getTime()) return null;
  return { day: dayKey(now, timeZone), scheduledAt, closesAt: nextZonedDayStart(now, timeZone) };
}

/** Does the round still take answers (until its closing instant, exclusive)? */
export function roundIsOpen(round: { closedAt: Date }, now: Date): boolean {
  return now.getTime() < round.closedAt.getTime();
}

/** Is the single nudge due: 3 hours after the round opened, while it is still open, and never twice. */
export function nudgeDue(round: { openedAt: Date; closedAt: Date; nudgedAt: Date | null }, now: Date): boolean {
  if (round.nudgedAt) return false;
  return now.getTime() >= round.openedAt.getTime() + NUDGE_DELAY_MS && roundIsOpen(round, now);
}

// ───────────────────────────────────────── what may be written ─────────────────────────────────────────

/** The questions of a configuration: 1 to 5, each trimmed and 1 to 200 characters; null when any rule breaks. */
export function cleanQuestions(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_QUESTIONS) return null;
  const out: string[] = [];
  for (const q of input) {
    if (typeof q !== "string") return null;
    const text = q.trim();
    if (text.length === 0 || text.length > MAX_QUESTION_LENGTH) return null;
    out.push(text);
  }
  return out;
}

/** The questions stored on a configuration or a round, as strings only (a broken column reads as none). */
export function questionsOf(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((q): q is string => typeof q === "string") : [];
}

export type AnswerProblem = "count" | "long" | "empty";

/**
 * A person's texts for a round of `questionCount` questions: one string per question (fewer are padded with blanks, more are
 * refused), each trimmed and at most 1000 characters, and at least one of them not blank.
 */
export function cleanAnswers(input: unknown, questionCount: number): { ok: true; answers: string[] } | { ok: false; problem: AnswerProblem } {
  if (!Array.isArray(input) || input.length > questionCount || input.some((a) => typeof a !== "string")) return { ok: false, problem: "count" };
  const answers = (input as string[]).map((a) => a.trim());
  if (answers.some((a) => a.length > MAX_ANSWER_LENGTH)) return { ok: false, problem: "long" };
  while (answers.length < questionCount) answers.push("");
  if (answers.every((a) => a === "")) return { ok: false, problem: "empty" };
  return { ok: true, answers };
}

/** A list of ids from a stored JSON column or a request: strings only, no repeats. */
export function idsOf(stored: unknown, max = Number.POSITIVE_INFINITY): string[] {
  if (!Array.isArray(stored)) return [];
  const out: string[] = [];
  for (const v of stored) if (typeof v === "string" && v !== "" && !out.includes(v) && out.length < max) out.push(v);
  return out;
}

// ───────────────────────────────────────── the counts ─────────────────────────────────────────

/** One round and what it holds, as the counts need it. */
export interface StatsRound {
  day: string;
  closedAt: Date;
  /** The people the round was opened for (a snapshot of that morning). */
  participantIds: readonly string[];
  answers: readonly { userId: string; excused: boolean }[];
}

export interface PersonDayCount {
  userId: string;
  day: string;
  answered: 0 | 1;
  /** A closed round the person did not answer and was not excused for. */
  missed: 0 | 1;
  excused: 0 | 1;
  /** A round still open that the person has not answered yet: not missed (yet). */
  pending: 0 | 1;
}

export interface PersonTotals {
  userId: string;
  answered: number;
  missed: number;
  excused: number;
  pending: number;
}

/**
 * The arithmetic of the counts, per person per day and per person. «Missed» is a participant of a CLOSED round with neither an
 * answer nor an excuse; a round that is still open counts «pending», never missed. An excused day is never missed. Somebody
 * who answered without being in the snapshot (the list changed that day) still counts as answered.
 */
export function statsOfRounds(rounds: readonly StatsRound[], now: Date): { days: PersonDayCount[]; people: PersonTotals[] } {
  const days: PersonDayCount[] = [];
  const totals = new Map<string, PersonTotals>();
  const bump = (userId: string, key: "answered" | "missed" | "excused" | "pending") => {
    const row = totals.get(userId) ?? { userId, answered: 0, missed: 0, excused: 0, pending: 0 };
    row[key] += 1;
    totals.set(userId, row);
  };
  const ordered = [...rounds].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const round of ordered) {
    const closed = !roundIsOpen(round, now);
    const byUser = new Map(round.answers.map((a) => [a.userId, a] as const));
    const people = [...new Set([...round.participantIds, ...round.answers.map((a) => a.userId)])];
    for (const userId of people) {
      const row = byUser.get(userId);
      const count: PersonDayCount = { userId, day: round.day, answered: 0, missed: 0, excused: 0, pending: 0 };
      if (row?.excused) count.excused = 1;
      else if (row) count.answered = 1;
      else if (closed) count.missed = 1;
      else count.pending = 1;
      days.push(count);
      bump(userId, count.excused ? "excused" : count.answered ? "answered" : count.missed ? "missed" : "pending");
    }
  }
  return { days, people: [...totals.values()].sort((a, b) => (a.userId < b.userId ? -1 : 1)) };
}

// ───────────────────────────────────────── a person's answered days, across spaces ─────────────────────────────────────────

/** What a person's file shows of the check-in: how many days they answered, and the run of answered days that is still alive. */
export interface PersonCheckinSummary {
  answered: number;
  missed: number;
  excused: number;
  /** Answered round days in a row, counted back from the latest one. An excused day is skipped, a missed day ends the run. */
  streak: number;
}

const DAY_RANK = { answered: 4, missed: 3, pending: 2, excused: 1 } as const;
const stateOf = (d: PersonDayCount): keyof typeof DAY_RANK => (d.answered ? "answered" : d.missed ? "missed" : d.pending ? "pending" : "excused");

/**
 * The per-person summary of the per-day counts of ANY number of spaces (`statsOfRounds` is per space). A day on which the person
 * answered in at least one space counts as answered; else a missed one; else still-open; else excused. It carries numbers only:
 * the texts of an answer never reach this function. A pending day (today's round, still open) neither counts nor breaks the run.
 */
export function summarizeDays(days: readonly PersonDayCount[]): Map<string, PersonCheckinSummary> {
  const byPerson = new Map<string, Map<string, keyof typeof DAY_RANK>>();
  for (const d of days) {
    const mine = byPerson.get(d.userId) ?? new Map<string, keyof typeof DAY_RANK>();
    const state = stateOf(d);
    const before = mine.get(d.day);
    if (before === undefined || DAY_RANK[state] > DAY_RANK[before]) mine.set(d.day, state);
    byPerson.set(d.userId, mine);
  }
  const out = new Map<string, PersonCheckinSummary>();
  for (const [userId, perDay] of byPerson) {
    const ordered = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)); // newest first
    const summary: PersonCheckinSummary = { answered: 0, missed: 0, excused: 0, streak: 0 };
    let alive = true;
    for (const [, state] of ordered) {
      if (state === "answered") {
        summary.answered += 1;
        if (alive) summary.streak += 1;
      } else if (state === "missed") {
        summary.missed += 1;
        alive = false;
      } else if (state === "excused") summary.excused += 1;
    }
    out.set(userId, summary);
  }
  return out;
}
