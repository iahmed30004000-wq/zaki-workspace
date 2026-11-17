import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { resolveTimeZone } from "@/lib/zoned-time";
import { ruleOccurrenceAfter, ruleOccurrenceAtOrBefore } from "@/lib/reminders/recurrence";
import { parseStoredRule, type RecurrenceRule, type StopReason } from "@/lib/task-recurrence";
import { SERIES_COLUMNS, isSeriesFailure, seriesObstacle, spawnOccurrence, stopSeries, type SeriesRow } from "@/server/services/recurrence-spawn";

/**
 * THE RECURRENCE JOB («مهمة متكررة», mode «حسب الجدول»): every series whose day has come makes its next task ONCE.
 *
 * Exactly once, however many processes or overlapping runs there are — the same discipline as the reminders: a due series
 * is CLAIMED by `UPDATE ... WHERE active AND nextDueAt <= now RETURNING ...` inside one transaction. A second run that
 * reaches the same row waits for the first to commit, re-reads it, finds `nextDueAt` already moved to the future and
 * claims nothing. The task, the copied steps and the new `nextDueAt` are written in that same transaction.
 *
 *  - a runner that was down for days makes ONE task (the latest occurrence that has passed), never one per missed day,
 *    and `nextDueAt` jumps to the first occurrence after now;
 *  - the task is made even when the previous occurrence is still open (the series is on a schedule, not waiting for the
 *    last one), unless an open occurrence of the series is not yet due — then there is already one to do and none is added;
 *  - past the end date the series stops (`ENDED`), after making the last task that falls on or before it;
 *  - a series whose space, project or board is archived or gone, or whose maker is no longer ACTIVE, is stopped with that reason;
 *  - a company that switched «المهام المتكررة» off: its series are not even selected; they wait and are due when it is back;
 *  - one series that fails is logged and left; it never blocks the others.
 */

const BATCH = 100;
const ROUNDS = 5;

export interface RecurrencesRun {
  created: number;
  /** Due, but an open occurrence not yet due already exists: none added, the date moved on. */
  skipped: number;
  /** Stopped on its own (ended, archived, its maker left). */
  stopped: number;
}

async function fireOne(id: string, now: Date): Promise<keyof RecurrencesRun | null> {
  const afterCommit: Array<() => Promise<void>> = [];
  const outcome = await db.$transaction(async (tx): Promise<keyof RecurrencesRun | null> => {
    // the claim: the company's switch is part of it (a switch pressed between the selection and here still wins)
    const claimed = await tx.$queryRaw<SeriesRow[]>(Prisma.sql`
      UPDATE "TaskRecurrence" r SET "nextDueAt" = r."nextDueAt"
      FROM "Organization" o
      WHERE r."id" = ${id} AND o."id" = r."orgId" AND r."active" AND r."mode" = 'SCHEDULE'::"RecurrenceMode"
        AND r."nextDueAt" <= ${now} AND COALESCE(o."settings" #>> '{features,recurringTasks}', 'true') <> 'false'
      RETURNING ${SERIES_COLUMNS}`);
    const rec = claimed[0];
    if (!rec || !rec.nextDueAt) return null;

    const stop = async (reason: StopReason): Promise<"stopped"> => {
      await stopSeries(tx, rec.id, reason);
      return "stopped";
    };

    const rule = parseStoredRule(rec.rule) as RecurrenceRule | null;
    if (!rule) return stop("FAILED");
    const obstacle = await seriesObstacle(tx, rec);
    if (obstacle) return stop(obstacle);
    // the first occurrence is already past the end date: nothing more is made
    if (rec.endsAt && rec.nextDueAt.getTime() > rec.endsAt.getTime()) return stop("ENDED");

    const org = await tx.organization.findUnique({ where: { id: rec.orgId }, select: { timezone: true } });
    const zone = resolveTimeZone(org?.timezone);
    // task-visibility: a system job: it works on the tasks of its own series or rules and shows no row to anybody
    const template = await tx.task.findUnique({ where: { id: rec.templateTaskId }, select: { dueDate: true } });

    // the latest occurrence that has passed (and falls on or before the end date): one task, not one per missed day
    const cap = rec.endsAt && rec.endsAt.getTime() < now.getTime() ? rec.endsAt : now;
    const latest = ruleOccurrenceAtOrBefore(rule, zone, cap);
    const due = latest && latest.getTime() > rec.nextDueAt.getTime() ? latest : rec.nextDueAt;
    const next = ruleOccurrenceAfter(rule, zone, now);
    const ended = !next || (rec.endsAt != null && next.getTime() > rec.endsAt.getTime());

    // an open occurrence that is not yet due is already the one to do: no second one on top (no due dates at all: any open
    // occurrence other than the template counts)
    const open = template?.dueDate
      // task-visibility: a system job: it works on the tasks of its own series or rules and shows no row to anybody
      ? await tx.task.count({ where: { recurrenceId: rec.id, completedAt: null, archived: false, dueDate: { gt: now } } })
      // task-visibility: a system job: it works on the tasks of its own series or rules and shows no row to anybody
      : await tx.task.count({ where: { recurrenceId: rec.id, id: { not: rec.templateTaskId }, completedAt: null, archived: false } });

    let result: keyof RecurrencesRun = "skipped";
    if (open === 0) {
      const spawned = await spawnOccurrence(tx, rec, template?.dueDate ? due : null);
      afterCommit.push(spawned.after);
      result = "created";
    }
    await tx.taskRecurrence.update({
      where: { id: rec.id },
      data: {
        nextDueAt: next ?? null,
        ...(result === "created" ? { lastCreatedAt: now } : {}),
        ...(ended ? { active: false, stoppedReason: "ENDED" } : {}),
      },
    });
    return ended && result === "skipped" ? "stopped" : result;
  });
  // the bell and the n8n event go out only once the row is committed
  for (const after of afterCommit) await after();
  return outcome;
}

export async function fireDueRecurrences(now: Date): Promise<RecurrencesRun> {
  const run: RecurrencesRun = { created: 0, skipped: 0, stopped: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    const due = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r."id" FROM "TaskRecurrence" r JOIN "Organization" o ON o."id" = r."orgId"
      WHERE r."active" AND r."mode" = 'SCHEDULE'::"RecurrenceMode" AND r."nextDueAt" <= ${now}
        AND COALESCE(o."settings" #>> '{features,recurringTasks}', 'true') <> 'false'
      ORDER BY r."nextDueAt" ASC, r."id" ASC LIMIT ${BATCH}`);
    let moved = 0;
    for (const { id } of due) {
      try {
        const result = await fireOne(id, now);
        if (result) {
          run[result]++;
          moved++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("jobs.recurrence_failed", { id, message });
        // a refusal of the series' own (the maker may no longer create tasks there) ends it with its reason on screen;
        // anything else (the database, a timeout) is left to the next run
        if (isSeriesFailure(err)) {
          await db.taskRecurrence.update({ where: { id }, data: { active: false, stoppedReason: "FAILED" } }).catch(() => undefined);
          run.stopped++;
          moved++;
        }
      }
    }
    if (due.length < BATCH || moved === 0) break;
  }
  return run;
}
