import { Prisma, type ReminderRepeat } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { AR } from "@/lib/i18n/dict";
import { nextOccurrence } from "@/lib/reminders/recurrence";
import { pushNotificationInTx } from "@/server/notify";
import { hqSpaceId } from "@/server/chat/hq";
import { resolveTimeZone } from "@/lib/zoned-time";
import { reminderHref, userCanReadMessage, userCanReadTask } from "@/server/services/reminders";

/**
 * THE REMINDER JOB: every reminder that is due is fired ONCE.
 *
 * Exactly once, however many processes or overlapping runs there are: a due row is CLAIMED by
 * `UPDATE ... WHERE status = 'PENDING' AND dueAt <= now RETURNING ...` inside one transaction. A second run that reaches
 * the same row waits for the first to commit, re-reads it, finds it no longer PENDING (or its `dueAt` moved to the next
 * occurrence) and claims nothing. The bell notice and the re-arming of a repeating reminder are written in that same
 * transaction, so a reminder that fired always has its notice and never has two.
 *
 *  - a person who is no longer ACTIVE: the reminder is dismissed, silently (nothing is sent);
 *  - a task or message the person can no longer read: dismissed too (the notice would lead to something they cannot
 *    open, and its link would say it exists);
 *  - a company that switched «ذكّرني» off: its reminders are not even selected; they wait and are due when it is back;
 *  - a repeating reminder: `dueAt` moves to the first occurrence after `now` in the company's zone and it is PENDING again.
 */

const BATCH = 200;
/** A few batches per run, so a long outage drains over a run or two without one run holding the lock for minutes. */
const ROUNDS = 5;

export interface RemindersRun {
  fired: number;
  dismissed: number;
}

interface Claimed {
  id: string;
  orgId: string;
  userId: string;
  title: string;
  dueAt: Date;
  repeat: ReminderRepeat;
  taskId: string | null;
  messageId: string | null;
}

/** Fires one due reminder. null: somebody else claimed it first (or it is not due after all). */
async function fireOne(id: string, now: Date): Promise<keyof RemindersRun | null> {
  const afterCommit: Array<() => void> = [];
  const outcome = await db.$transaction(async (tx): Promise<keyof RemindersRun | null> => {
    const claimed = await tx.$queryRaw<Claimed[]>(Prisma.sql`
      UPDATE "Reminder" SET "status" = 'FIRED'::"ReminderStatus", "firedAt" = ${now}
      WHERE "id" = ${id} AND "status" = 'PENDING'::"ReminderStatus" AND "dueAt" <= ${now}
      RETURNING "id", "orgId", "userId", "title", "dueAt", "repeat"::text AS "repeat", "taskId", "messageId"`);
    const r = claimed[0];
    if (!r) return null;

    const dismiss = async (): Promise<"dismissed"> => {
      await tx.reminder.update({ where: { id: r.id }, data: { status: "DISMISSED" } });
      return "dismissed";
    };

    const member = await tx.organizationMember.findFirst({
      where: { userId: r.userId, organizationId: r.orgId, status: "ACTIVE" },
      select: { userId: true },
    });
    if (!member) return dismiss();

    let workspaceId: string | null = null;
    if (r.taskId) {
      if (!(await userCanReadTask(r.userId, r.orgId, r.taskId))) return dismiss();
      // task-visibility: a system job: it works on the tasks of its own series or rules and shows no row to anybody
      workspaceId = (await tx.task.findUnique({ where: { id: r.taskId }, select: { workspaceId: true } }))?.workspaceId ?? null;
    }
    let conversationId: string | null = null;
    if (r.messageId) {
      if (!(await userCanReadMessage(r.userId, r.orgId, r.messageId))) return dismiss();
      const msg = await tx.chatMessage.findUnique({ where: { id: r.messageId }, select: { conversation: { select: { id: true, spaceId: true } } } });
      conversationId = msg?.conversation.id ?? null;
      workspaceId = msg?.conversation.spaceId ?? (await hqSpaceId(r.orgId));
    }

    afterCommit.push(
      await pushNotificationInTx(tx, {
        userId: r.userId,
        type: "reminder",
        title: AR["notif.type.reminder"] ?? "تذكير",
        body: r.title,
        taskId: r.taskId,
        linkUrl: reminderHref({ taskId: r.taskId, messageId: r.messageId, message: conversationId ? { conversationId } : null }),
        workspaceId,
        organizationId: r.orgId,
      }),
    );

    if (r.repeat !== "NONE") {
      const org = await tx.organization.findUnique({ where: { id: r.orgId }, select: { timezone: true } });
      const next = nextOccurrence(r.dueAt, r.repeat, resolveTimeZone(org?.timezone), now);
      if (next) await tx.reminder.update({ where: { id: r.id }, data: { status: "PENDING", dueAt: next, snoozedUntil: null } });
    }
    return "fired";
  });
  // the Web Push (when the company's «إشعارات على التلفون واللابتوب» is on) goes out only once the row is committed
  for (const push of afterCommit) push();
  return outcome;
}

export async function fireDueReminders(now: Date): Promise<RemindersRun> {
  const run: RemindersRun = { fired: 0, dismissed: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    // the company's switch is read here: a company that turned «ذكّرني» off keeps its rows PENDING and untouched
    const due = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r."id" FROM "Reminder" r JOIN "Organization" o ON o."id" = r."orgId"
      WHERE r."status" = 'PENDING'::"ReminderStatus" AND r."dueAt" <= ${now}
        AND COALESCE(o."settings" #>> '{features,reminders}', 'true') <> 'false'
      ORDER BY r."dueAt" ASC, r."id" ASC LIMIT ${BATCH}`);
    let moved = 0;
    for (const { id } of due) {
      try {
        const result = await fireOne(id, now);
        if (result) {
          run[result]++;
          moved++;
        }
      } catch (err) {
        // one broken reminder is logged and left; it never stops the others or the loop
        log.error("jobs.reminder_failed", { id, message: err instanceof Error ? err.message : String(err) });
      }
    }
    if (due.length < BATCH || moved === 0) break;
  }
  return run;
}
