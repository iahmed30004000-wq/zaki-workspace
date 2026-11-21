import { log } from "@/server/log";
import { fireDueReminders, type RemindersRun } from "./reminders";
import { fireDueRecurrences, type RecurrencesRun } from "./recurrence";
import { autoStopTimers, type TimeEntriesRun } from "./time-entries";
import { expireAiProposals, type AiProposalsRun } from "./ai-proposals";
import { runCheckins, type CheckinsRun } from "./checkins";
import { runTaskRules, type TaskRulesRun } from "./task-rules";
import { runDueBackups, type BackupsRun } from "./db-backup";
import { runMailToTask, type MailTasksRun } from "./mail-to-task";
import { runSearchEmbed, type SearchEmbedRun } from "./search-embed";
import { runOmsSync, type OmsSyncRun } from "@/server/integrations/oms-sync";
import { wipeCustomerNumbers } from "@/server/services/problem-tickets";
import { runTicketEscalation } from "@/server/services/ticket-escalation";
import { runMustReadReminders } from "@/server/services/must-read";
import { runCallTranscripts, type CallTranscriptsRun } from "./call-transcripts";

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
  /** «بريد يصير مهمة»: the company mailbox read (every 5 minutes) while its switch is on: one task per new mail. */
  mailTasks: MailTasksRun | null;
  /** «بحث بالمعنى»: one small batch of vectors for each company that turned it on (null while no embeddings service is set up). */
  searchEmbed: SearchEmbedRun | null;
  /** «ربط نظام الطلبات»: the products read (every 5 minutes per company, while its switch is on) into the snapshot of each linked sheet. */
  omsSync: OmsSyncRun | null;
  /** Q1.5: customer numbers wiped from tickets resolved more than 30 days ago */
  customerWipe: { wiped: number } | null;
  /** Q1.5: reminders and escalations of the tickets made from problems */
  ticketEscalation: { reminded: number; escalated: number } | null;
  /** Q1.6: reminders of the messages that must be read */
  mustRead: { reminded: number; listed: number } | null;
  /** S6.2: the written lines of calls past their retention days deleted, and the minutes of the calls that ended with the text record on */
  callTranscripts: CallTranscriptsRun | null;
  /** The names of the jobs that threw. */
  failed: string[];
}

export async function runDueJobs(now: Date = new Date()): Promise<JobsRun> {
  const result: JobsRun = { reminders: null, recurrences: null, timeEntries: null, aiProposals: null, checkins: null, taskRules: null, backups: null, mailTasks: null, searchEmbed: null, omsSync: null, customerWipe: null, ticketEscalation: null, mustRead: null, callTranscripts: null, failed: [] };
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
  try {
    result.mustRead = await runMustReadReminders(now);
  } catch (err) {
    result.failed.push("mustRead");
    log.error("jobs.failed", { job: "mustRead", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.ticketEscalation = await runTicketEscalation(now);
  } catch (err) {
    result.failed.push("ticketEscalation");
    log.error("jobs.failed", { job: "ticketEscalation", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.customerWipe = await wipeCustomerNumbers(now);
  } catch (err) {
    result.failed.push("customerWipe");
    log.error("jobs.failed", { job: "customerWipe", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.omsSync = await runOmsSync(now);
  } catch (err) {
    result.failed.push("omsSync");
    log.error("jobs.failed", { job: "omsSync", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.searchEmbed = await runSearchEmbed(now);
  } catch (err) {
    result.failed.push("searchEmbed");
    log.error("jobs.failed", { job: "searchEmbed", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.mailTasks = await runMailToTask(now);
  } catch (err) {
    result.failed.push("mailTasks");
    log.error("jobs.failed", { job: "mailTasks", message: err instanceof Error ? err.name : "error" });
  }
  // S6.2: last on purpose: writing minutes asks a model and may take a while; nothing above waits for it
  try {
    result.callTranscripts = await runCallTranscripts(now);
  } catch (err) {
    result.failed.push("callTranscripts");
    log.error("jobs.failed", { job: "callTranscripts", message: err instanceof Error ? err.name : "error" });
  }
  return result;
}
