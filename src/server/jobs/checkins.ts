import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { featureOnSql } from "@/server/features-sql";
import { AR } from "@/lib/i18n/dict";
import { resolveTimeZone } from "@/lib/zoned-time";
import { NUDGE_DELAY_MS, idsOf, isParticipantsMode, openingFor, questionsOf, weekdaysOf } from "@/lib/checkins";
import { pushNotificationInTx } from "@/server/notify";
import { eligiblePeople, participantsOf } from "@/server/services/checkins";

/**
 * «التسجيل اليومي»: the job runner's one step for the check-ins. Two phases, each with the same exactly-once discipline as
 * the reminders and the recurrences (src/server/jobs/reminders.ts):
 *
 *  1. OPEN. Every space whose check-in is on, whose company's day is one of its weekdays and whose time of day has come
 *     (in the COMPANY's zone) gets today's round: ONE row per space per day, made by
 *     `INSERT ... ON CONFLICT ("workspaceId", "day") DO NOTHING RETURNING "id"`. Two runners that reach the same space at the
 *     same moment make one round: the second waits for the first to commit, finds the row and gets nothing back. The bell
 *     notices of the people of the round are written in that same transaction by the runner that won, so a round that opened
 *     always has its notices and never has two. A runner that was down in the morning still opens the round, any time up to
 *     the end of the company's day; the round holds the questions and the people as they were at that moment.
 *  2. NUDGE. Three hours after a round opened, while it is still open, ONE more notice goes to the people who have not
 *     answered and are not excused. The step is claimed by `UPDATE "CheckinRound" SET "nudgedAt" = now WHERE "nudgedAt" IS NULL
 *     RETURNING ...` inside one transaction, so it happens once per round and therefore once per person.
 *
 *  - a company that switched «التسجيل اليومي» off, an archived space, a check-in that is off: not even selected;
 *  - a person who is no longer ACTIVE (suspended, offboarded), a guest, or somebody who left the space: skipped, no notice;
 *  - the bell and the Web Push carry generic words, never an answer or a question;
 *  - one space that fails is logged and left; it never blocks the others.
 */

export interface CheckinsRun {
  opened: number;
  /** Bell notices written when rounds opened. */
  notified: number;
  nudged: number;
  /** Bell notices written by the nudges. */
  nudges: number;
}

const FEATURE_ON = Prisma.sql`COALESCE(o."settings" #>> '{features,checkins}', 'true') <> 'false'`;

interface DueConfig {
  workspaceId: string;
  orgId: string;
  timezone: string;
  questions: unknown;
  timeOfDay: string;
  weekdays: number[] | null;
  participantsMode: string;
  participantIds: unknown;
}

function notice(orgId: string, workspaceId: string, userId: string, kind: "open" | "nudge") {
  return {
    userId,
    type: kind === "open" ? "checkin_open" : "checkin_nudge",
    title: AR[kind === "open" ? "notif.type.checkin_open" : "notif.type.checkin_nudge"] ?? "التسجيل اليومي",
    body: AR[kind === "open" ? "checkins.notify.open_body" : "checkins.notify.nudge_body"] ?? null,
    linkUrl: "/checkins",
    workspaceId,
    organizationId: orgId,
  };
}

async function openOne(cfg: DueConfig, now: Date): Promise<{ opened: boolean; notified: number }> {
  const zone = resolveTimeZone(cfg.timezone);
  const opening = openingFor(now, zone, { timeOfDay: cfg.timeOfDay, weekdays: weekdaysOf(cfg.weekdays) });
  if (!opening) return { opened: false, notified: 0 };
  // today's round is already there: nothing to do (the common answer, one cheap read)
  const there = await db.checkinRound.findUnique({ where: { workspaceId_day: { workspaceId: cfg.workspaceId, day: new Date(`${opening.day}T00:00:00.000Z`) } }, select: { id: true } });
  if (there) return { opened: false, notified: 0 };

  const mode = isParticipantsMode(cfg.participantsMode) ? cfg.participantsMode : "ALL";
  const people = participantsOf(mode, idsOf(cfg.participantIds), await eligiblePeople(cfg.workspaceId, cfg.orgId));
  const afterCommit: Array<() => void> = [];
  const result = await db.$transaction(async (tx) => {
    const won = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "CheckinRound" ("id", "workspaceId", "day", "openedAt", "closedAt", "questions", "participantIds")
      VALUES (${randomUUID()}, ${cfg.workspaceId}, ${opening.day}::date, ${now}, ${opening.closesAt},
              ${JSON.stringify(questionsOf(cfg.questions))}::jsonb, ${JSON.stringify(people.map((p) => p.id))}::jsonb)
      ON CONFLICT ("workspaceId", "day") DO NOTHING
      RETURNING "id"`);
    if (won.length === 0) return { opened: false, notified: 0 };
    for (const person of people) afterCommit.push(await pushNotificationInTx(tx, notice(cfg.orgId, cfg.workspaceId, person.id, "open")));
    return { opened: true, notified: people.length };
  });
  // the Web Push goes out only once the round is committed
  for (const push of afterCommit) push();
  return result;
}

/** Opens today's round of every space whose time has come. */
export async function openDueRounds(now: Date): Promise<Pick<CheckinsRun, "opened" | "notified">> {
  const run = { opened: 0, notified: 0 };
  const configs = await db.$queryRaw<DueConfig[]>(Prisma.sql`
    SELECT c."workspaceId", w."organizationId" AS "orgId", o."timezone", c."questions", c."timeOfDay", c."weekdays", c."participantsMode", c."participantIds"
    FROM "CheckinConfig" c
    JOIN "Workspace" w ON w."id" = c."workspaceId"
    JOIN "Organization" o ON o."id" = w."organizationId"
    WHERE c."active" AND w."archivedAt" IS NULL AND ${FEATURE_ON}
    ORDER BY c."workspaceId" ASC`);
  for (const cfg of configs) {
    try {
      const r = await openOne(cfg, now);
      if (r.opened) run.opened++;
      run.notified += r.notified;
    } catch (err) {
      log.error("jobs.checkin_open_failed", { workspaceId: cfg.workspaceId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return run;
}

/** A round opened at or before this instant is due its nudge (it opened three hours ago or more). */
const nudgeCutoff = (now: Date): Date => new Date(now.getTime() - NUDGE_DELAY_MS);

interface ClaimedRound {
  id: string;
  workspaceId: string;
  orgId: string;
  participantIds: unknown;
}

async function nudgeOne(id: string, now: Date): Promise<number | null> {
  const afterCommit: Array<() => void> = [];
  const sent = await db.$transaction(async (tx): Promise<number | null> => {
    const claimed = await tx.$queryRaw<ClaimedRound[]>(Prisma.sql`
      UPDATE "CheckinRound" r SET "nudgedAt" = ${now}
      FROM "Workspace" w, "Organization" o, "CheckinConfig" c
      WHERE r."id" = ${id} AND r."nudgedAt" IS NULL AND w."id" = r."workspaceId" AND o."id" = w."organizationId" AND c."workspaceId" = r."workspaceId"
        AND r."openedAt" <= ${nudgeCutoff(now)} AND r."closedAt" > ${now}
        AND c."active" AND w."archivedAt" IS NULL AND ${FEATURE_ON} AND ${featureOnSql("backgroundNudges")}
      RETURNING r."id", r."workspaceId", w."organizationId" AS "orgId", r."participantIds"`);
    const round = claimed[0];
    if (!round) return null;
    // still of the round's people, still in the space and ACTIVE, and with nothing written yet (no answer, no excuse)
    const eligible = await eligiblePeople(round.workspaceId, round.orgId);
    const asked = new Set(idsOf(round.participantIds));
    const done = new Set((await tx.checkinAnswer.findMany({ where: { roundId: round.id }, select: { userId: true } })).map((a) => a.userId));
    const recipients = eligible.filter((p) => asked.has(p.id) && !done.has(p.id));
    for (const person of recipients) afterCommit.push(await pushNotificationInTx(tx, notice(round.orgId, round.workspaceId, person.id, "nudge")));
    return recipients.length;
  });
  for (const push of afterCommit) push();
  return sent;
}

/**
 * The one extra nudge, three hours after a round opened, to those who have not answered and are not excused. A company whose
 * «تنبيهات الخلفية» switch is off (or in «وضع التوفير») is not even selected: its round keeps `nudgedAt` empty, so the nudge still goes
 * out while the round is open once the switch is back on.
 */
export async function nudgeDueRounds(now: Date): Promise<Pick<CheckinsRun, "nudged" | "nudges">> {
  const run = { nudged: 0, nudges: 0 };
  const due = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r."id" FROM "CheckinRound" r
    JOIN "Workspace" w ON w."id" = r."workspaceId"
    JOIN "Organization" o ON o."id" = w."organizationId"
    WHERE r."nudgedAt" IS NULL AND r."closedAt" > ${now} AND w."archivedAt" IS NULL AND ${FEATURE_ON}
      AND ${featureOnSql("backgroundNudges")}
      AND r."openedAt" <= ${nudgeCutoff(now)}
    ORDER BY r."openedAt" ASC, r."id" ASC LIMIT 500`);
  for (const { id } of due) {
    try {
      const sent = await nudgeOne(id, now);
      if (sent !== null) {
        run.nudged++;
        run.nudges += sent;
      }
    } catch (err) {
      log.error("jobs.checkin_nudge_failed", { id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return run;
}

export async function runCheckins(now: Date): Promise<CheckinsRun> {
  const run: CheckinsRun = { opened: 0, notified: 0, nudged: 0, nudges: 0 };
  let failure: unknown = null;
  try {
    Object.assign(run, await openDueRounds(now));
  } catch (err) {
    failure = err;
  }
  // the nudges run even when opening failed: they belong to rounds opened earlier
  try {
    Object.assign(run, await nudgeDueRounds(now));
  } catch (err) {
    failure = failure ?? err;
  }
  // the runner logs it and lists the job among the ones that threw
  if (failure) throw failure;
  return run;
}
