import { fireOverdueRules, type TaskRulesRun } from "@/server/services/task-rules-run";

/**
 * «القواعد التلقائية»: the only rule trigger that is not a click. `fireOverdueRules` runs every active «لما تتأخر» rule on the open
 * tasks that fell due after the rule was armed, once per rule and task (the unique row of the log is the guard, so two overlapping
 * runs and a runner that was down for a day both do the right thing). The company's `taskRules` switch is read inside.
 */
export type { TaskRulesRun };

export async function runTaskRules(now: Date): Promise<TaskRulesRun> {
  return fireOverdueRules(now);
}
