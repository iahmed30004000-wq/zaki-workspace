import { log } from "@/server/log";
import { fireDueReminders, type RemindersRun } from "./reminders";
import { fireDueRecurrences, type RecurrencesRun } from "./recurrence";
import { autoStopTimers, type TimeEntriesRun } from "./time-entries";
import { expireAiProposals, type AiProposalsRun } from "./ai-proposals";
import { runCheckins, type CheckinsRun } from "./checkins";
import { runTaskRules, type TaskRulesRun } from "./task-rules";
import { runDueBackups, type BackupsRun } from "./db-backup";

/**
 * Every background job of the app, in one place: `runDueJobs(now)` runs whatever is due at `now`.
 *
 * It takes the clock as a parameter so a database test can call it directly, with no timer. It never takes a lock
 * (the scheduler does, src/server/jobs/scheduler.ts) and every job is idempotent, so two overlapping calls are safe.
 * A job that throws is logged and the next one still runs.
 */
export interface JobsRun {
  reminders: RemindersRun | null;
  /** «مهمة متكررة» (حسب الجدول): the tasks made for the series whose day has come. */
  recurrences: RecurrencesRun | null;
  /** «حساب وقت الشغل»: the timers left running more than 12 hours, closed at the 12th hour. */
  timeEntries: TimeEntriesRun | null;
  /** «مساعد المالك»: the proposals nobody decided in 48 hours, marked EXPIRED. */
  aiProposals: AiProposalsRun | null;
  /** «التسجيل اليومي»: the rounds opened for the spaces whose time has come, and the one nudge three hours later. */
  checkins: CheckinsRun | null;
  /** «القواعد التلقائية»: the «لما تتأخر» rules that acted on the tasks that fell due. */
  taskRules: TaskRulesRun | null;
  /** «نسخ احتياطي لقاعدة البيانات»: the daily encrypted copy to the owner's Drive, started when its hour has come (it finishes in the background). */
  backups: BackupsRun | null;
  /** The names of the jobs that threw. */
  failed: string[];
}

export async function runDueJobs(now: Date = new Date()): Promise<JobsRun> {
  const result: JobsRun = { reminders: null, recurrences: null, timeEntries: null, aiProposals: null, checkins: null, taskRules: null, backups: null, failed: [] };
  try {
    result.reminders = await fireDueReminders(now);
  } catch (err) {
    result.failed.push("reminders");
    log.error("jobs.failed", { job: "reminders", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.recurrences = await fireDueRecurrences(now);
  } catch (err) {
    result.failed.push("recurrences");
    log.error("jobs.failed", { job: "recurrences", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.timeEntries = await autoStopTimers(now);
  } catch (err) {
    result.failed.push("timeEntries");
    log.error("jobs.failed", { job: "timeEntries", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.aiProposals = await expireAiProposals(now);
  } catch (err) {
    result.failed.push("aiProposals");
    log.error("jobs.failed", { job: "aiProposals", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.checkins = await runCheckins(now);
  } catch (err) {
    result.failed.push("checkins");
    log.error("jobs.failed", { job: "checkins", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.taskRules = await runTaskRules(now);
  } catch (err) {
    result.failed.push("taskRules");
    log.error("jobs.failed", { job: "taskRules", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.backups = await runDueBackups(now);
  } catch (err) {
    result.failed.push("backups");
    log.error("jobs.failed", { job: "backups", message: err instanceof Error ? err.message : String(err) });
  }
  return result;
}
