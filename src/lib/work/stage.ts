/**
 * «المرحلة» — the ONE normalized stage of a board column (W1.3, `BoardColumn.stage`).
 *
 * Every board names its columns as it likes («مراجعة العميل», «بانتظار الرد»...), so a list across projects cannot
 * group or filter by a column's name. The stage is the shared vocabulary on top of them: four values, in the order a
 * piece of work travels. A column keeps its OWN name on screen (`columnLabel`); the stage is only what the cross-project
 * lists group and filter by (the screens are W1.1's). The `done` flag of a column keeps its meaning («منتهي»): the stage
 * is a separate, independent choice that a space manager makes.
 *
 * Pure (no React, no server imports): the routes validate with `workStageSchema`, the screens list `WORK_STAGES`.
 */
import { z } from "zod";

/** The stages in their natural order (the order of a select, of the groups of a list). */
export const WORK_STAGES = ["TODO", "DOING", "REVIEW", "DONE"] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

/** What the database gives a column nobody chose a stage for (`DEFAULT 'DOING'`). */
export const DEFAULT_WORK_STAGE: WorkStage = "DOING";

/** The zod enum a route validates a posted stage with. */
export const workStageSchema = z.enum(WORK_STAGES);

export function isWorkStage(value: unknown): value is WorkStage {
  return typeof value === "string" && (WORK_STAGES as readonly string[]).includes(value);
}

/** A stage read from the database as a plain string: a value this code does not know (an older or newer row) reads as the default. */
export function stageOrDefault(value: string | null | undefined): WorkStage {
  return isWorkStage(value) ? value : DEFAULT_WORK_STAGE;
}
