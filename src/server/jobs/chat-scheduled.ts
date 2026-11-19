import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { deliverScheduled, KEEP_FINISHED_MS } from "@/server/chat/scheduled";

/**
 * C3c.3 — THE SCHEDULED-MESSAGES JOB: every row whose time has come is sent once, as its author, through the normal send (src/server/chat/scheduled.ts `deliverScheduled`).
 *
 * It runs in the 30-second tick of the scheduler (src/server/jobs/scheduler.ts), so it runs in the app process by default and in the compose `worker` when `JOBS_IN_WORKER=1`,
 * under the same advisory lock. Idempotent by construction: a row is claimed with `FOR UPDATE SKIP LOCKED` and its message has the clientId `sch:<id>`, so two overlapping
 * runs (or a run and «ابعت هلّق») send it once; a run that crashed between the send and the mark finds the message and only marks the row.
 *
 * A company that switched `chatScheduled` off is not even selected: its rows wait untouched (a row more than a day late when it is finally reached is not sent: FAILED, and its author
 * is told). A row that could not be sent because its author's send quota is used up this minute stays PENDING for the next tick.
 */

const BATCH = 100;
/** A few batches per run, so a long outage drains over a run or two without one run holding the lock for minutes. */
const ROUNDS = 5;

export interface ChatScheduledRun {
  sent: number;
  failed: number;
  /** rows another run holds or already sent */
  skipped: number;
  /** rows left for the next tick (the author's quota) */
  later: number;
  /** old finished rows removed */
  purged: number;
}

export async function runChatScheduled(now: Date = new Date()): Promise<ChatScheduledRun> {
  const run: ChatScheduledRun = { sent: 0, failed: 0, skipped: 0, later: 0, purged: 0 };
  // authors whose quota ran out in this run (their other rows are left for the next tick) and rows that threw: both are left OUT of the next read, so a head of rows that cannot move
  // never hides the due rows behind it
  const waiting = new Set<string>();
  const broken = new Set<string>();
  for (let round = 0; round < ROUNDS; round++) {
    const notAuthors = waiting.size > 0 ? Prisma.sql`AND s."authorId" NOT IN (${Prisma.join([...waiting])})` : Prisma.empty;
    const notIds = broken.size > 0 ? Prisma.sql`AND s."id" NOT IN (${Prisma.join([...broken])})` : Prisma.empty;
    const due = await db.$queryRaw<{ id: string; authorId: string }[]>(Prisma.sql`
      SELECT s."id", s."authorId" FROM "ScheduledChatMessage" s JOIN "Organization" o ON o."id" = s."orgId"
      WHERE s."status" = 'PENDING'::"ScheduledChatStatus" AND s."sendAt" <= ${now}
        AND COALESCE(o."settings" #>> '{features,chatScheduled}', 'true') <> 'false'
        ${notAuthors} ${notIds}
      ORDER BY s."sendAt" ASC, s."id" ASC LIMIT ${BATCH}`);
    let moved = 0;
    for (const { id, authorId } of due) {
      if (waiting.has(authorId)) {
        moved++; // left out of the next read: that is progress
        continue;
      }
      try {
        const result = await deliverScheduled(id, now, "job");
        if (result.kind === "sent") run.sent++;
        else if (result.kind === "failed") run.failed++;
        else if (result.kind === "gone") run.skipped++;
        else {
          run.later++;
          waiting.add(authorId);
        }
        // a row that is sent, failed, held by another run or left for the quota is out of this run's way (a later row of the same author is skipped above)
        moved++;
      } catch (err) {
        // one broken row is logged and left (out of the next read of this run); it never stops the others or the loop
        log.error("jobs.chat_scheduled_failed", { id, name: err instanceof Error ? err.name : "unknown" });
        broken.add(id);
        moved++;
      }
    }
    if (due.length < BATCH || moved === 0) break;
  }
  // the rows that are finished (sent, cancelled, failed) go after a month; a waiting row is never touched
  const cutoff = new Date(now.getTime() - KEEP_FINISHED_MS);
  run.purged = (await db.scheduledChatMessage.deleteMany({ where: { status: { in: ["SENT", "CANCELLED", "FAILED"] }, sendAt: { lt: cutoff } } })).count;
  return run;
}
