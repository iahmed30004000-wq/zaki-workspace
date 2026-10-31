import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { notifyAssignment } from "@/server/notify";
import { dispatchEvent } from "@/server/services/n8n";
import { resolveTimeZone } from "@/lib/zoned-time";
import { ruleOccurrenceAfter } from "@/lib/reminders/recurrence";
import { parseStoredRule, type RecurrenceRule, type StopReason } from "@/lib/task-recurrence";
import { createTaskInTx, notifyCreatedRequests, type Tx } from "./tasks";
import { afterTaskEvents } from "./task-rules-hook";

/**
 * «مهمة متكررة» — how ONE occurrence of a series is born, shared by the job runner (mode «حسب الجدول») and by the
 * completion path (mode «عند الإنجاز»), so there is exactly one way a repeating task makes its next copy.
 *
 * Every occurrence is a REAL task made by `createTaskInTx` — the same function a hand-made task goes through — on behalf
 * of the series' `createdById`: the rank judge decides each assignee exactly as for a hand-made task (an assignee above
 * the creator becomes a REQUEST, never a bypass). The occurrence copies the template's title, description, priority,
 * type, labels, people, and the TITLES of its steps (all unticked); it lands in the first column of the same board; its
 * due date is the one the rule gives; `recurrenceId` points back to the series.
 *
 * It is written on the CALLER's transaction: the claim, the task and the next date are one commit. What must happen
 * after that commit (the bell for the assignee, the n8n event) is handed back as `after`.
 */

/** The columns of a series every caller works with. `mode` is the enum as text. */
export interface SeriesRow {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  templateTaskId: string;
  createdById: string;
  rule: unknown;
  mode: "ON_COMPLETE" | "SCHEDULE";
  nextDueAt: Date | null;
  endsAt: Date | null;
}

export const SERIES_COLUMNS = Prisma.sql`r."id", r."orgId", r."workspaceId", r."projectId", r."boardId", r."templateTaskId", r."createdById", r."rule", r."mode"::text AS "mode", r."nextDueAt", r."endsAt"`;

/** Why a series can no longer go on (its home is archived or gone, its maker is not an active member), or null. */
export async function seriesObstacle(tx: Tx, rec: SeriesRow): Promise<StopReason | null> {
  if (!parseStoredRule(rec.rule)) return "FAILED";
  const maker = await tx.organizationMember.findFirst({
    where: { organizationId: rec.orgId, userId: rec.createdById, status: "ACTIVE" },
    select: { userId: true },
  });
  if (!maker) return "CREATOR_INACTIVE";
  const home = await tx.workspace.findUnique({
    where: { id: rec.workspaceId },
    select: { archivedAt: true, projects: { where: { id: rec.projectId }, select: { status: true, boards: { where: { id: rec.boardId }, select: { archived: true } } } } },
  });
  const project = home?.projects[0];
  const board = project?.boards[0];
  if (!home || home.archivedAt || !project || project.status === "ARCHIVED" || !board || board.archived) return "ARCHIVED";
  const template = await tx.task.findUnique({ where: { id: rec.templateTaskId }, select: { id: true } });
  if (!template) return "ARCHIVED";
  return null;
}

/** Stops the series on its own, with the reason the screen will show (⚠️ and its fix). */
export async function stopSeries(tx: Tx, seriesId: string, reason: StopReason): Promise<void> {
  await tx.taskRecurrence.update({ where: { id: seriesId }, data: { active: false, stoppedReason: reason } });
}

export interface Spawned {
  taskId: string;
  /** After the commit: the assignee's bell, the people asked, the n8n event. Never throws. */
  after: () => Promise<void>;
}

/**
 * Makes the occurrence due at `dueDate` (null: the template has no due date, so neither has the copy).
 * Throws what `createTaskInTx` throws (a `ForbiddenError` / `NotFoundError` is a reason the series cannot go on).
 */
export async function spawnOccurrence(tx: Tx, rec: SeriesRow, dueDate: Date | null): Promise<Spawned> {
  const actor = { userId: rec.createdById, orgId: rec.orgId };
  // the same door a hand-made task passes: the tasks row of the maker's section grid
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });

  const template = await tx.task.findUnique({
    where: { id: rec.templateTaskId },
    include: {
      labels: { select: { labelId: true } },
      coAssignees: { select: { userId: true }, orderBy: { createdAt: "asc" } },
      steps: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true, position: true } },
    },
  });
  if (!template) throw new NotFoundError("task.not_found");

  // the people of the template who are still ACTIVE: somebody who left is dropped quietly, never a reason to stop the series
  const wanted = [...new Set([...(template.assigneeId ? [template.assigneeId] : []), ...template.coAssignees.map((r) => r.userId)])];
  const active = new Set(
    (await tx.organizationMember.findMany({ where: { organizationId: rec.orgId, userId: { in: wanted }, status: "ACTIVE" }, select: { userId: true } })).map((m) => m.userId),
  );
  const people = wanted.filter((id) => active.has(id));

  // the start keeps its distance from the due date
  const startDate =
    template.startDate && template.dueDate && dueDate ? new Date(dueDate.getTime() - (template.dueDate.getTime() - template.startDate.getTime())) : null;

  const made = await createTaskInTx(tx, actor, {
    workspaceId: rec.workspaceId,
    projectId: rec.projectId,
    boardId: rec.boardId,
    title: template.title,
    description: template.description,
    priority: template.priority,
    type: template.type,
    assigneeId: people[0] ?? null,
    coAssigneeIds: people.slice(1),
    dueDate,
    startDate,
    labelIds: template.labels.map((l) => l.labelId),
  });
  await tx.task.update({ where: { id: made.id }, data: { recurrenceId: rec.id } });
  if (template.steps.length) {
    await tx.taskStep.createMany({
      data: template.steps.map((s) => ({ orgId: rec.orgId, taskId: made.id, title: s.title, position: s.position, done: false })),
    });
  }

  return {
    taskId: made.id,
    after: async () => {
      try {
        await notifyCreatedRequests(made, actor);
        // «the usual new-task notification»: the people the task REALLY went to are told (a person above the maker was asked instead)
        const org = await db.organization.findUnique({ where: { id: rec.orgId }, select: { keyPrefix: true } });
        const told = [...new Set([...(made.assigneeId ? [made.assigneeId] : []), ...made.coAssignees.map((r) => r.userId)])].filter((id) => id !== actor.userId);
        for (const assigneeId of told) {
          await notifyAssignment({ assigneeId, taskNumber: made.number, orgPrefix: org?.keyPrefix ?? "", taskId: made.id, title: made.title, workspaceId: rec.workspaceId });
        }
        await dispatchEvent(rec.orgId, "task.created", { taskId: made.id, number: made.number, title: made.title });
        // «القواعد التلقائية»: an occurrence is a task born like any other («لما تنعمل مهمة»)
        await afterTaskEvents([{ trigger: "CREATED", taskId: made.id }]);
      } catch (err) {
        log.warn("recurrence.after_failed", { taskId: made.id, message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

/** A person's mistake of the series itself, not of the database: the runner stops the series instead of retrying for ever. */
export function isSeriesFailure(err: unknown): boolean {
  return err instanceof ForbiddenError || err instanceof NotFoundError;
}

/**
 * The completion hook (mode «عند الإنجاز»): called by `setTaskCompletion` / `moveTask` INSIDE their transaction, right after
 * the task became done. If the task belongs to an active series in that mode, the next occurrence is made in the same
 * commit — once:
 *
 *   - the series row is locked (`FOR UPDATE`), so two tasks of one series finishing together are taken one after the other;
 *   - while another occurrence of the series is still OPEN, nothing is made (finishing, reopening and finishing again
 *     never piles copies up);
 *   - the callers lock the TASK row before reading it, so two clicks on the same «تمّت» are one completion and one hook.
 *
 * It runs inside a SAVEPOINT: whatever goes wrong here is logged and rolled back to that point, and the person's own
 * completion is never lost. Returns what must happen after the commit.
 */
export async function onTaskCompleted(
  tx: Tx,
  task: { id: string; recurrenceId: string | null; dueDate: Date | null },
  now: Date = new Date(),
): Promise<(() => Promise<void>) | null> {
  if (!task.recurrenceId) return null;
  await tx.$executeRaw`SAVEPOINT recurrence_hook`;
  try {
    const rows = await tx.$queryRaw<SeriesRow[]>(Prisma.sql`
      SELECT ${SERIES_COLUMNS} FROM "TaskRecurrence" r JOIN "Organization" o ON o."id" = r."orgId"
      WHERE r."id" = ${task.recurrenceId} AND r."active" AND r."mode" = 'ON_COMPLETE'::"RecurrenceMode"
        AND COALESCE(o."settings" #>> '{features,recurringTasks}', 'true') <> 'false'
      FOR UPDATE OF r`);
    const rec = rows[0];
    if (!rec) {
      await tx.$executeRaw`RELEASE SAVEPOINT recurrence_hook`;
      return null;
    }
    const open = await tx.task.count({ where: { recurrenceId: rec.id, id: { not: task.id }, completedAt: null, archived: false } });
    if (open > 0) {
      await tx.$executeRaw`RELEASE SAVEPOINT recurrence_hook`;
      return null;
    }
    const obstacle = await seriesObstacle(tx, rec);
    if (obstacle) {
      await stopSeries(tx, rec.id, obstacle);
      await tx.$executeRaw`RELEASE SAVEPOINT recurrence_hook`;
      return null;
    }
    const rule = parseStoredRule(rec.rule) as RecurrenceRule;
    const org = await tx.organization.findUnique({ where: { id: rec.orgId }, select: { timezone: true } });
    const zone = resolveTimeZone(org?.timezone);
    const template = await tx.task.findUnique({ where: { id: rec.templateTaskId }, select: { dueDate: true } });
    // the next one is the first occurrence after BOTH the day this one was due and now: finishing a daily task early
    // does not make today's again, finishing it late does not replay the days that passed
    const after = new Date(Math.max((task.dueDate ?? now).getTime(), now.getTime()));
    const next = ruleOccurrenceAfter(rule, zone, after);
    if (!next || (rec.endsAt && next.getTime() > rec.endsAt.getTime())) {
      await stopSeries(tx, rec.id, "ENDED");
      await tx.$executeRaw`RELEASE SAVEPOINT recurrence_hook`;
      return null;
    }
    const spawned = await spawnOccurrence(tx, rec, template?.dueDate || task.dueDate ? next : null);
    await tx.taskRecurrence.update({ where: { id: rec.id }, data: { lastCreatedAt: now } });
    await tx.$executeRaw`RELEASE SAVEPOINT recurrence_hook`;
    return spawned.after;
  } catch (err) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT recurrence_hook`;
    log.error("recurrence.hook_failed", { seriesId: task.recurrenceId, message: err instanceof Error ? err.message : String(err) });
    // a refusal of the series' own (its maker may no longer create tasks, the project is not theirs any more) ends it
    // with the reason on screen, instead of failing again at every completion
    if (isSeriesFailure(err)) await stopSeries(tx, task.recurrenceId, "FAILED").catch(() => undefined);
    return null;
  }
}
