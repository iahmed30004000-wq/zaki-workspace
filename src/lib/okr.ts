/**
 * «الأهداف والنتائج» — THE ARITHMETIC OF AN OBJECTIVE, in one place (no React, no server imports: the screen draws the formula box
 * from these very functions, the server answers with the same numbers, and the tests pin them).
 *
 * A key result's progress is where its value stands between its start and its target:
 *
 *     progress = (current − start) ÷ (target − start), cut to 0..100
 *
 * (it works downwards too: from 30 complaints to 10, at 20 it is 50%). An objective's progress is the plain average of its
 * key results. With no key result the objective keeps the number its owner moves by hand, as before.
 *
 * ⚠️ The status light («على المسار / متأخر / بخطر») is a PERSON's decision. `suggestLight` only offers a guess from the progress
 * against the time gone, and nothing ever writes it by itself.
 * 🔧 The screen shows the suggestion apart, labelled «اقتراح», next to the light the person set.
 */

/** At most this many key results under one objective. */
export const KR_MAX = 5;

export type GoalLightKey = "ON_TRACK" | "BEHIND" | "AT_RISK";
export const GOAL_LIGHTS: readonly GoalLightKey[] = ["ON_TRACK", "BEHIND", "AT_RISK"];

export function isGoalLight(value: unknown): value is GoalLightKey {
  return typeof value === "string" && (GOAL_LIGHTS as readonly string[]).includes(value);
}

export interface KeyResultNumbers {
  startValue: number;
  targetValue: number;
  currentValue: number;
}

/** 0..100, a whole number. A broken number counts as nothing done; a target equal to the start is done once reached. */
export function keyResultPercent(kr: KeyResultNumbers): number {
  const { startValue: start, targetValue: target, currentValue: current } = kr;
  if (![start, target, current].every(Number.isFinite)) return 0;
  if (target === start) return current >= target ? 100 : 0;
  const fraction = (current - start) / (target - start);
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/** The objective's progress: the average of its key results, rounded. `null`: it has none (its own hand-set number applies). */
export function objectivePercent(krs: readonly KeyResultNumbers[]): number | null {
  if (krs.length === 0) return null;
  const sum = krs.reduce((total, kr) => total + keyResultPercent(kr), 0);
  return Math.round(sum / krs.length);
}

/**
 * What the system would suggest, from the progress and the share of the period already gone: within 10 points of the pace is
 * on track, within 25 behind, further than that at risk; a period that has ended unfinished is at risk, a finished one on track.
 */
export function suggestLight(input: { percent: number; periodStart: Date; periodEnd: Date; now: Date }): GoalLightKey {
  const { percent, periodStart, periodEnd, now } = input;
  if (percent >= 100) return "ON_TRACK";
  if (now.getTime() > periodEnd.getTime()) return "AT_RISK";
  const span = periodEnd.getTime() - periodStart.getTime();
  const elapsed = span > 0 ? Math.min(1, Math.max(0, (now.getTime() - periodStart.getTime()) / span)) : 1;
  const gap = elapsed * 100 - percent;
  if (gap <= 10) return "ON_TRACK";
  if (gap <= 25) return "BEHIND";
  return "AT_RISK";
}

/** The value of a key result linked to tasks: how many of them are finished. */
export function linkedValue(done: number): number {
  return Number.isFinite(done) && done > 0 ? Math.floor(done) : 0;
}
