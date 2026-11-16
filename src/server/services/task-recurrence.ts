import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, requireTaskAccess, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { ruleOccurrenceAfter } from "@/lib/reminders/recurrence";
import {
  completeRule,
  endDayOf,
  endOfDayInstant,
  noonOfToday,
  parseStoredRule,
  type RecurrenceModeKey,
  type RecurrenceRule,
  type RuleInput,
  type StopReason,
} from "@/lib/task-recurrence";

/**
 * «مهمة متكررة» — a task marked as repeating, and the one series it belongs to.
 *
 * WHO: whoever may edit the task may set its recurrence (`requireTaskAccess` with the writing roles, then the tasks row of
 * the section grid). A GUEST never does, a person outside the task's space never does (the task is «not found» to them),
 * and the owner reading a space he is not in does not either (403, the same as steps: a series acts as the person who set
 * it, and silent reading leaves no trace). Reading it is reading the task. The company's `recurringTasks` switch closes
 * every door; nothing stored is lost.
 *
 * ONE series per template task; every occurrence points at it (`Task.recurrenceId`), so the controls on any occurrence
 * read and edit the same series. «إيقاف» only switches the series off: every task already made stays. Setting it again
 * starts it again. The series acts as the person who SET it last: its tasks are created on their behalf, so an assignee
 * above them is asked, never assigned.
 */

export interface RecurrenceDto {
  id: string;
  rule: RecurrenceRule;
  mode: RecurrenceModeKey;
  active: boolean;
  /** Why it stopped on its own (null while it runs, and when a person stopped it). */
  stoppedReason: StopReason | null;
  /** The next occurrence the runner will make («حسب الجدول» only). */
  nextDueAt: string | null;
  /** The last day of the series, `YYYY-MM-DD` in the company's zone. */
  endsOn: string | null;
  /** This task is the series' template (the one it copies). */
  isTemplate: boolean;
}

export interface RecurrenceState {
  recurrence: RecurrenceDto | null;
  timeZone: string;
}

type Row = {
  id: string;
  rule: unknown;
  mode: RecurrenceModeKey;
  active: boolean;
  stoppedReason: string | null;
  nextDueAt: Date | null;
  endsAt: Date | null;
  templateTaskId: string;
};

function dto(row: Row, taskId: string, timeZone: string): RecurrenceDto | null {
  const rule = parseStoredRule(row.rule);
  if (!rule) return null;
  return {
    id: row.id,
    rule,
    mode: row.mode,
    active: row.active,
    stoppedReason: (row.stoppedReason as StopReason | null) ?? null,
    nextDueAt: row.nextDueAt ? row.nextDueAt.toISOString() : null,
    endsOn: endDayOf(row.endsAt, timeZone),
    isTemplate: row.templateTaskId === taskId,
  };
}

const SELECT = { id: true, rule: true, mode: true, active: true, stoppedReason: true, nextDueAt: true, endsAt: true, templateTaskId: true } as const;

/** The task's series as the screens need it. The caller has already passed the task's own guard (the task page). */
export async function recurrenceOfTask(taskId: string, orgId: string): Promise<RecurrenceState> {
  const [task, timeZone] = await Promise.all([
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    db.task.findUnique({ where: { id: taskId }, select: { recurrence: { select: SELECT } } }),
    orgTimeZone(orgId),
  ]);
  return { recurrence: task?.recurrence ? dto(task.recurrence, taskId, timeZone) : null, timeZone };
}

/** Reading: the task's own guard, then the switch. A guest of the space reads. */
async function readAccess(taskId: string) {
  const access = await requireTaskAccess(taskId);
  await assertMemberCan(access, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, "recurringTasks");
  return access;
}

/** Writing: who may edit the task — never a guest, never the owner who is not in the space. */
async function writeAccess(taskId: string): Promise<OrgAccessContext & { task: { id: string; workspaceId: string } }> {
  const access = await requireTaskAccess(taskId, ["ADMIN", "MEMBER"]);
  await assertFeatureOn(access.orgId, "recurringTasks");
  await assertMemberCan(access, "tasks.edit", "section.edit_denied");
  if (access.orgRole === "OWNER") {
    const row = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: access.task.workspaceId, userId: access.userId } },
      select: { userId: true },
    });
    if (!row) throw new ForbiddenError("recurrence.oversight_readonly");
  }
  return access;
}

export async function getRecurrence(taskId: string): Promise<RecurrenceState> {
  const access = await readAccess(taskId);
  return recurrenceOfTask(taskId, access.orgId);
}

export interface SetRecurrenceInput {
  rule: RuleInput;
  mode: RecurrenceModeKey;
  /** `YYYY-MM-DD` in the company's zone, or null for a series with no end. */
  endsOn: string | null;
}

export async function setRecurrence(taskId: string, input: SetRecurrenceInput, now: Date = new Date()): Promise<RecurrenceState> {
  const access = await writeAccess(taskId);
  const timeZone = await orgTimeZone(access.orgId);

  let endsAt: Date | null = null;
  if (input.endsOn) {
    endsAt = endOfDayInstant(input.endsOn, timeZone);
    if (!endsAt) throw new ValidationError([{ path: "endsOn", message: "recurrence.end_invalid" }]);
    if (endsAt.getTime() < now.getTime()) throw new ValidationError([{ path: "endsOn", message: "recurrence.end_past" }]);
  }

  await db.$transaction(async (tx) => {
    // the task's row is held while its series is made or changed: two people pressing «حفظ» at once are taken one by one
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    await tx.$queryRaw`SELECT 1 FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    const task = await tx.task.findFirst({
      where: { id: taskId, orgId: access.orgId },
      select: { id: true, workspaceId: true, projectId: true, boardId: true, dueDate: true, recurrence: { select: { id: true, rule: true } } },
    });
    if (!task) throw new NotFoundError("task.not_found");

    const anchor = task.dueDate ?? noonOfToday(now, timeZone);
    let rule = completeRule(input.rule, anchor, timeZone);
    // editing a series keeps its own hour, and a yearly date keeps its own (a 29 February series seen on 28 February
    // must not turn into a 28 February one)
    const previous = task.recurrence ? parseStoredRule(task.recurrence.rule) : null;
    if (previous && previous.kind === rule.kind) {
      rule = { ...rule, time: previous.time } as RecurrenceRule;
      if (previous.kind === "YEARLY" && rule.kind === "YEARLY") rule = { ...rule, month: previous.month, day: previous.day };
    }

    // «حسب الجدول»: the first copy comes on the first occurrence after BOTH the task's own due day and now
    let nextDueAt: Date | null = null;
    if (input.mode === "SCHEDULE") {
      const after = new Date(Math.max(anchor.getTime(), now.getTime()));
      nextDueAt = ruleOccurrenceAfter(rule, timeZone, after);
      if (!nextDueAt) throw new ValidationError([{ path: "rule", message: "recurrence.rule_invalid" }]);
      if (endsAt && nextDueAt.getTime() > endsAt.getTime()) throw new ValidationError([{ path: "endsOn", message: "recurrence.end_before_first" }]);
    }

    const data = {
      rule: rule as unknown as object,
      mode: input.mode,
      nextDueAt,
      endsAt,
      active: true,
      stoppedReason: null,
      createdById: access.userId,
    };
    if (task.recurrence) {
      await tx.taskRecurrence.update({ where: { id: task.recurrence.id }, data });
    } else {
      const made = await tx.taskRecurrence.create({
        data: { ...data, orgId: access.orgId, workspaceId: task.workspaceId, projectId: task.projectId, boardId: task.boardId, templateTaskId: task.id },
        select: { id: true },
      });
      await tx.task.update({ where: { id: task.id }, data: { recurrenceId: made.id } });
    }
  });
  return recurrenceOfTask(taskId, access.orgId);
}

/** «إيقاف»: the series stops; every task already made stays. */
export async function stopRecurrence(taskId: string): Promise<RecurrenceState> {
  const access = await writeAccess(taskId);
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  const task = await db.task.findFirst({ where: { id: taskId, orgId: access.orgId }, select: { recurrenceId: true } });
  if (!task?.recurrenceId) throw new NotFoundError("recurrence.not_found");
  await db.taskRecurrence.update({ where: { id: task.recurrenceId }, data: { active: false, stoppedReason: null } });
  return recurrenceOfTask(taskId, access.orgId);
}

/**
 * The tasks of a page of cards and rows that belong to a RUNNING series («🔁 متكررة»). The caller has already read the
 * tasks and decides whether the switch is on.
 */
export async function recurringTaskIds(taskIds: readonly string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  const rows = await db.task.findMany({ where: { id: { in: [...taskIds] }, recurrence: { active: true } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
