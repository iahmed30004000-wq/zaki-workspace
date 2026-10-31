import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "@/server/log";

/**
 * THE DOOR BETWEEN A TASK EVENT AND THE PROJECT'S RULES («القواعد التلقائية»).
 *
 * `createTask`, `moveTask` and `setTaskCompletion` (src/server/services/tasks.ts) call `afterTaskEvents` once their
 * transaction has committed. This file imports nothing heavy on purpose: the rules' engine (task-rules-run.ts) is loaded on
 * demand, so tasks.ts never imports the engine that itself imports tasks.ts.
 *
 * NO LOOPS, by construction: everything a rule does runs inside `withinRuleRun`, and `afterTaskEvents` does nothing while
 * that scope is open. So a rule's own move, assignment or priority never starts another rule (depth one), however the rules
 * are written. The engine adds a second wall: a rule acts at most once on a task (a unique row of its log).
 *
 * It never throws: a rule that fails is logged and the person's own action, already committed, is untouched.
 */

const scope = new AsyncLocalStorage<{ ruleId: string }>();

/** Is the code running right now an action of a rule? */
export function inRuleRun(): boolean {
  return scope.getStore() !== undefined;
}

export function withinRuleRun<T>(ruleId: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ ruleId }, fn);
}

export type TaskRuleEvent =
  | { trigger: "CREATED"; taskId: string }
  | { trigger: "COMPLETED"; taskId: string }
  | { trigger: "MOVED_TO_COLUMN"; taskId: string; columnId: string };

export async function afterTaskEvents(events: readonly TaskRuleEvent[]): Promise<void> {
  if (events.length === 0 || inRuleRun()) return;
  try {
    const { fireTaskRules } = await import("./task-rules-run");
    for (const event of events) await fireTaskRules(event);
  } catch (err) {
    log.warn("taskrules.hook_failed", { message: err instanceof Error ? err.message : String(err) });
  }
}
