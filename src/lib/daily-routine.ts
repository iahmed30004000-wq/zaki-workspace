import { z } from "zod";
import type { RecurrenceRule } from "@/lib/reminders/recurrence";

/**
 * «روتين يومي» — the shapes of a daily routine, pure (no React, no server imports). A routine says on which weekdays a
 * fresh card appears, at what time, and by what time of that same day it should be done; both times are the COMPANY's
 * wall clock. The math of «when is the next one» is the app's one recurrence clock (src/lib/reminders/recurrence.ts).
 */

/** Weekdays as the JavaScript Date counts them: 0 is Sunday. */
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
/** «أيام الدوام»: Sunday to Thursday. */
export const WORKING_DAYS = [0, 1, 2, 3, 4] as const;

export const DAY_PRESETS = ["EVERY", "WORKING", "CUSTOM"] as const;
export type DayPreset = (typeof DAY_PRESETS)[number];

/** Which of the three choices a stored list of days is. */
export function presetOfDays(days: readonly number[]): DayPreset {
  const same = (other: readonly number[]) => days.length === other.length && other.every((d) => days.includes(d));
  if (same(EVERY_DAY)) return "EVERY";
  return same(WORKING_DAYS) ? "WORKING" : "CUSTOM";
}

/** Why a routine stopped on its own (a person's own pause has no reason). Each has a line in the dictionary. */
export const ROUTINE_STOP_REASONS = ["ARCHIVED", "CREATOR_INACTIVE", "ASSIGNEE_INACTIVE", "FAILED"] as const;
export type RoutineStopReason = (typeof ROUTINE_STOP_REASONS)[number];

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "routine.time_invalid");
const id = z.string().min(1).max(64);

export const routineInputSchema = z
  .object({
    workspaceId: id,
    projectId: id,
    title: z.string().trim().min(1, "routine.title_required").max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    assigneeId: z.string().min(1, "routine.assignee_required").max(64),
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1, "routine.days_required")
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    time: clock,
    dueTime: clock,
  })
  // both are the same day's clock, so the text order is the time order
  .refine((v) => v.dueTime > v.time, { path: ["dueTime"], message: "routine.due_after_time" });
export type RoutineInput = z.infer<typeof routineInputSchema>;

/** The routine as a rule of the app's recurrence clock. */
export function ruleOfRoutine(days: readonly number[], time: string): RecurrenceRule {
  return { kind: "WEEKLY", days: [...days], time };
}
