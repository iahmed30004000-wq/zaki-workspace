import type { BoardSection } from "@/server/services/owner-board-sections";
import { checkinsSection } from "@/server/services/checkins-section";
import { timeTrackedSection } from "@/server/services/time-section";

export { checkinsSection, timeTrackedSection };

/**
 * «السكور» — THE EXTENSION POINT.  ⚠️ Marked on purpose, like `BOARD_SECTIONS`: this is where another feature adds a number that is
 * SHOWN BESIDE a person's score (never part of the composite: a count is not a judgement of quality). It uses the very same shape
 * as the owner board's sections (`BoardSection`), so a section written for one can be registered in the other.
 *
 * Today: «الوقت المسجّل» (the time tracked on tasks, from `TimeEntry`; `time-section.ts`, also on the owner board) and «التسجيل اليومي»
 * (the days a person answered the daily check-in and the run of them; `checkins-section.ts`, numbers only, never the answers).
 *
 * A section must read ONLY the people it is asked for (`ctx.userIds`) and ONLY what falls in `ctx.window`, and return numbers.
 */

/** ⚠️ Registered here: the time tracked and the check-ins answered. Both are shown BESIDE the score, never in the composite. */
export const SCORE_SECTIONS: readonly BoardSection[] = [timeTrackedSection, checkinsSection];
