import { z } from "zod";
import { WORK_STAGES } from "@/lib/work/stage";
import { MY_TASK_CHIPS, MY_TASK_SORTS, parseMyTasksParams, type MyTasksParams, type RawParams } from "@/lib/work/my-tasks";

/**
 * Each person's filters on «مهامي», kept for them (`User.taskFilters`): what narrows the list, and its order. Not the view, the scope or the search: those are
 * where the person is looking, not how they like it cut.
 */
export const savedFiltersSchema = z
  .object({
    chip: z.enum(MY_TASK_CHIPS).nullable(),
    stage: z.enum(WORK_STAGES).nullable(),
    inProject: z.string().min(1).max(64).nullable(),
    urgent: z.boolean(),
    who: z.string().min(1).max(64).nullable(),
    sort: z.enum(MY_TASK_SORTS),
  })
  .partial()
  .strict();
export type SavedFilters = z.infer<typeof savedFiltersSchema>;

/** The words of an address that mean «show me exactly this»: with any of them the kept filters stay out of the way. */
const ASKED = ["chip", "tab", "stage", "in", "urgent", "who", "sort", "q", "task"] as const;

export function savedFiltersOf(params: MyTasksParams): Required<SavedFilters> {
  return { chip: params.chip, stage: params.stage, inProject: params.inProject, urgent: params.urgent, who: params.who, sort: params.sort };
}

/** How many filters narrow the list now (the order is not one). */
export function activeFilterCount(params: MyTasksParams): number {
  return [params.chip, params.stage, params.inProject, params.urgent || null, params.who].filter(Boolean).length;
}

/** What one tap on «امسح الفلاتر» changes. */
export const CLEARED_FILTERS: Partial<MyTasksParams> = { chip: null, stage: null, inProject: null, urgent: false, who: null };

export const touchesFilters = (change: Partial<MyTasksParams>): boolean => (["chip", "stage", "inProject", "urgent", "who", "sort"] as const).some((key) => key in change);

/**
 * The state a plain visit opens with: what the person kept, laid over the address. Null: nothing to lay over (the address asks for something itself, or
 * nothing was kept, or what was kept changes nothing). A kept value that no longer parses is ignored whole.
 */
export function withSavedFilters(raw: RawParams, stored: unknown): MyTasksParams | null {
  const has = (key: string) => (raw instanceof URLSearchParams ? raw.has(key) : raw[key] !== undefined);
  if (ASKED.some(has)) return null;
  const kept = savedFiltersSchema.safeParse(stored ?? {});
  if (!kept.success) return null;
  const asked = parseMyTasksParams(raw);
  const merged: MyTasksParams = { ...asked, ...kept.data };
  return JSON.stringify(savedFiltersOf(merged)) === JSON.stringify(savedFiltersOf(asked)) ? null : merged;
}
