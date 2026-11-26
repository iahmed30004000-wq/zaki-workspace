import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { resolveTimeZone } from "@/lib/zoned-time";
import { dayOfInstant } from "@/lib/due-day";
import { ruleOccurrenceAfter, ruleOccurrenceAtOrBefore } from "@/lib/reminders/recurrence";
import { ruleOfRoutine } from "@/lib/daily-routine";
import { makeCardOfDay, routineObstacle, stopRoutine, type RoutineRow } from "@/server/services/daily-routine-spawn";
import { isSeriesFailure } from "@/server/services/recurrence-spawn";

/**
 * THE DAILY ROUTINES JOB («روتين يومي»): every routine whose time has come makes the card of TODAY, once.
 *
 *  - a due routine is CLAIMED by `UPDATE ... WHERE active AND nextRunAt <= now RETURNING ...` inside one transaction, so
 *    two overlapping runs take it one after the other; and the day's own unique row (`makeCardOfDay`) keeps «one card a
 *    day» true even if the claim's time were ever wrong;
 *  - a runner that was away for days makes today's card only (once today's time has passed): a routine of a day that is
 *    gone is not work anybody can still do;
 *  - yesterday's card still open does not hold today's back;
 *  - a routine that cannot go on (its person or maker left, its project is archived) stops with that reason on screen;
 *  - a company that switched «مهمة متكررة» off: its routines are not selected; they go on when it is back;
 *  - one routine that fails is logged and left; it never blocks the others.
 */

const BATCH = 100;
const ROUNDS = 5;

export interface DailyRoutinesRun {
  created: number;
  /** Stopped on its own (archived, its person or maker left). */
  stopped: number;
}

const COLUMNS = Prisma.sql`r."id", r."orgId", r."workspaceId", r."projectId", r."boardId", r."title", r."description", r."assigneeId", r."createdById", r."days", r."time", r."dueTime", r."nextRunAt"`;
const SWITCH_ON = Prisma.sql`COALESCE(o."settings" #>> '{features,recurringTasks}', 'true') <> 'false'`;

async function fireOne(id: string, now: Date): Promise<"created" | "stopped" | "moved" | null> {
  let afterCommit: (() => Promise<void>) | null = null;
  const outcome = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<RoutineRow[]>(Prisma.sql`
      UPDATE "DailyRoutine" r SET "nextRunAt" = r."nextRunAt"
      FROM "Organization" o
      WHERE r."id" = ${id} AND o."id" = r."orgId" AND r."active" AND r."nextRunAt" <= ${now} AND ${SWITCH_ON}
      RETURNING ${COLUMNS}`);
    const routine = claimed[0];
    if (!routine) return null;

    const obstacle = await routineObstacle(tx, routine);
    if (obstacle) {
      await stopRoutine(tx, routine.id, obstacle);
      return "stopped" as const;
    }

    const org = await tx.organization.findUnique({ where: { id: routine.orgId }, select: { timezone: true } });
    const zone = resolveTimeZone(org?.timezone);
    const rule = ruleOfRoutine(routine.days, routine.time);
    const today = dayOfInstant(now, zone);
    const latest = ruleOccurrenceAtOrBefore(rule, zone, now);
    let made: (() => Promise<void>) | null = null;
    if (latest && dayOfInstant(latest, zone) === today) made = await makeCardOfDay(tx, routine, today, now, zone);
    afterCommit = made;
    await tx.dailyRoutine.update({ where: { id: routine.id }, data: { nextRunAt: ruleOccurrenceAfter(rule, zone, now) } });
    return made ? ("created" as const) : ("moved" as const);
  });
  // the bell and the n8n event go out only once the row is committed
  await (afterCommit as (() => Promise<void>) | null)?.();
  return outcome;
}

export async function fireDueRoutines(now: Date): Promise<DailyRoutinesRun> {
  const run: DailyRoutinesRun = { created: 0, stopped: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    const due = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r."id" FROM "DailyRoutine" r JOIN "Organization" o ON o."id" = r."orgId"
      WHERE r."active" AND r."nextRunAt" <= ${now} AND ${SWITCH_ON}
      ORDER BY r."nextRunAt" ASC, r."id" ASC LIMIT ${BATCH}`);
    let moved = 0;
    for (const { id } of due) {
      try {
        const result = await fireOne(id, now);
        if (result) {
          moved++;
          if (result !== "moved") run[result]++;
        }
      } catch (err) {
        log.error("jobs.daily_routine_failed", { id, message: err instanceof Error ? err.message : String(err) });
        // a refusal of the routine's own ends it with its reason on screen; anything else waits for the next run
        if (isSeriesFailure(err)) {
          await stopRoutine(db, id, "FAILED").catch(() => undefined);
          run.stopped++;
          moved++;
        }
      }
    }
    if (due.length < BATCH || moved === 0) break;
  }
  return run;
}
