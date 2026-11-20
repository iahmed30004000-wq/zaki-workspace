import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import { audit } from "@/server/auth";
import { log } from "@/server/log";
import { AR } from "@/lib/i18n/dict";
import { RequiredFieldsError } from "@/server/custom-fields-error";
import type { Actor } from "@/server/policy/actor";
import { isSpaceManager } from "@/server/workspace-role";
import { loadWorkScope, taskVisibleWhere, userSeesProject, type WorkScope } from "@/server/services/team-scope";
import { moveTask, updateTask } from "@/server/services/tasks";
import { assertActiveAssignee } from "@/server/services/active-people";
import { assertRewardEditable } from "@/server/services/reward-guard";
import { notifyAssignment } from "@/server/notify";
import { orgDayStart, orgTimeZone } from "@/server/services/org-day";
import { dayOfInstant, dueInstantForDay, parseDayText } from "@/lib/due-day";
import {
  STALE_EVENT,
  STALE_LIST_LIMIT,
  STALE_SWEEP_MAX,
  daysIdle,
  groupStale,
  isAutomated,
  staleCutoff,
  tallySweep,
  type OpenCounts,
  type StaleAction,
  type StaleOption,
  type StaleParams,
  type StaleTask,
  type StaleView,
  type SweepResult,
  type SweepRow,
} from "@/lib/work/stale";

/**
 * W1.9 «مهام قديمة» — the review list of open tasks nobody touched for N days, for the people who run a space, with bulk actions that go through the
 * services that already exist (`moveTask`, `updateTask`). Nothing here has a rule of its own about WHO may change a task:
 *
 *  - WHO sees the list: the OWNER, and anybody who manages a space (its ADMIN, an org ADMIN who is in it: `isSpaceManager`). A guest, and everybody who
 *    manages nothing, get a refusal; the list holds the tasks of the spaces the person manages only.
 *  - WHAT is listed: only what the person may open (`taskVisibleWhere`, P0.2): a hidden task is neither listed nor counted. The owner without silent
 *    oversight does not read a private task of a space either (P0.1).
 *  - A bulk action is judged PER TASK, never all or nothing: each task is read again through the same visibility rule, must be in a space the person
 *    manages and still be open, and then goes through the service (so the rank rule on who may be given work, the reward lock, the required fields of a
 *    project and the team of a project all answer for themselves). A refused task is reported with its reason; the others still happen.
 *  - NOTHING is deleted: «أرشفيها» is the `Task.archived` flag, «سكّريها» is a move to the board's done column, «أجّليها» a new due day.
 *  - Every task that changed gets its own `TaskActivity` line (`task.stale_swept`), besides the line the service itself writes.
 *
 * «آلي» (D-W4, pending): `Task.apiTokenId` is set. The list marks it, counts it apart, and can hide it or show only it.
 */

/** The spaces this person manages in their company (the owner: all of them), archived spaces left out. Empty for a guest. */
export async function managedSpacesOf(actor: Pick<Actor, "userId" | "orgId" | "role">): Promise<StaleOption[]> {
  if (actor.role === "GUEST") return [];
  if (actor.role === "OWNER") {
    return db.workspace.findMany({ where: { organizationId: actor.orgId, archivedAt: null }, select: { id: true, name: true }, orderBy: [{ position: "asc" }, { name: "asc" }] });
  }
  const rows = await db.workspaceMember.findMany({
    where: { userId: actor.userId, workspace: { organizationId: actor.orgId, archivedAt: null } },
    select: { role: true, workspace: { select: { id: true, name: true, position: true } } },
  });
  return rows
    .filter((row) => isSpaceManager(actor.role, row.role))
    .sort((a, b) => a.workspace.position - b.workspace.position || a.workspace.name.localeCompare(b.workspace.name, "ar"))
    .map((row) => ({ id: row.workspace.id, name: row.workspace.name }));
}

/** The door of the list and of every action: 403 `guest.no_access` for a partner, 403 `stale.managers_only` for anybody who manages no space. */
export async function assertStaleManager(actor: Pick<Actor, "userId" | "orgId" | "role" | "isExternal">): Promise<StaleOption[]> {
  if (actor.isExternal) throw new ForbiddenError("guest.no_access");
  const spaces = await managedSpacesOf(actor);
  if (spaces.length === 0) throw new ForbiddenError("stale.managers_only");
  return spaces;
}

/** The tasks the question is about: open, in the managed spaces, the person may see them. The caller adds the age line and the automated filter. */
function baseWhere(actor: Actor, spaceIds: string[], scope: WorkScope): Prisma.TaskWhereInput[] {
  return [taskVisibleWhere(scope), { orgId: actor.orgId, workspaceId: { in: spaceIds }, completedAt: null, archived: false }];
}

const untouchedSince = (cutoff: Date): Prisma.TaskWhereInput => ({
  updatedAt: { lt: cutoff },
  activities: { none: { createdAt: { gte: cutoff } } },
  comments: { none: { createdAt: { gte: cutoff } } },
});

const autoWhere = (auto: StaleParams["auto"]): Prisma.TaskWhereInput =>
  auto === "hide" ? { apiTokenId: null } : auto === "only" ? { apiTokenId: { not: null } } : {};

/**
 * «كم مهمة مفتوحة عند كل شخص»: the open tasks per person across the spaces the viewer manages, the person's OWN work apart from «آلي» (D-W4). Only what the
 * viewer may see is counted. The key is the person's id, or `none` for the tasks nobody holds.
 */
export async function openTasksPerPerson(actor: Actor, spaceIds?: string[]): Promise<OpenCounts> {
  const spaces = await assertStaleManager(actor);
  const ids = spaceIds?.length ? spaces.filter((s) => spaceIds.includes(s.id)).map((s) => s.id) : spaces.map((s) => s.id);
  return openCounts(actor, ids, await loadWorkScope(actor.userId));
}

async function openCounts(actor: Actor, ids: string[], scope: WorkScope): Promise<OpenCounts> {
  const base = baseWhere(actor, ids, scope);
  // task-visibility: baseWhere() is taskVisibleWhere(scope) AND the managed spaces; a number per person, no task is shown
  const rows = await db.task.groupBy({ by: ["assigneeId", "apiTokenId"], where: { AND: base }, _count: { _all: true } });
  const out: OpenCounts = {};
  for (const row of rows) {
    const key = row.assigneeId ?? "none";
    const cell = (out[key] ??= { people: 0, auto: 0 });
    if (row.apiTokenId != null) cell.auto += row._count._all;
    else cell.people += row._count._all;
  }
  return out;
}

/** The people a task of the managed spaces may be given to: ACTIVE members of those spaces who are not partners, plus the viewer. */
async function assignableIn(actor: Actor, spaceIds: string[]): Promise<StaleOption[]> {
  const rows = await db.organizationMember.findMany({
    where: {
      organizationId: actor.orgId,
      status: "ACTIVE",
      role: { not: "GUEST" },
      OR: [{ userId: actor.userId }, { user: { workspaceLinks: { some: { workspaceId: { in: spaceIds } } } } }],
    },
    select: { user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => r.user).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** The review list: the old tasks grouped by person and project, the numbers beside them, and the choices the bulk bar needs. */
export async function staleListFor(actor: Actor, params: StaleParams, now: Date = new Date()): Promise<StaleView> {
  const spaces = await assertStaleManager(actor);
  const space = params.space && spaces.some((s) => s.id === params.space) ? params.space : null;
  const spaceIds = space ? [space] : spaces.map((s) => s.id);
  const cutoff = staleCutoff(now, params.days);
  const scope = await loadWorkScope(actor.userId);
  const base = baseWhere(actor, spaceIds, scope);
  const old = untouchedSince(cutoff);
  // task-visibility: base is taskVisibleWhere(scope) AND the managed spaces (see baseWhere)
  const [rows, total, autoTotal, org, open, assignable] = await Promise.all([
    db.task.findMany({
      where: { AND: [...base, old, autoWhere(params.auto)] },
      select: {
        id: true,
        number: true,
        title: true,
        priority: true,
        assigneeId: true,
        apiTokenId: true,
        dueDate: true,
        updatedAt: true,
        visibility: true,
        workspaceId: true,
        assignee: { select: { name: true } },
        project: { select: { id: true, name: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        comments: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
      // the longest-untouched first; the id breaks a tie so the same list comes back every time
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: STALE_LIST_LIMIT,
    }),
    // task-visibility: the same base as above (taskVisibleWhere AND the managed spaces); a number, no task is shown
    db.task.count({ where: { AND: [...base, old, autoWhere(params.auto)] } }),
    // task-visibility: the same base as above; how many of the old tasks the person could see are «آلي»
    db.task.count({ where: { AND: [...base, old, { apiTokenId: { not: null } }] } }),
    db.organization.findUnique({ where: { id: actor.orgId }, select: { keyPrefix: true } }),
    openCounts(actor, spaceIds, scope),
    assignableIn(actor, spaceIds),
  ]);
  const prefix = org?.keyPrefix ?? "ZW";
  const spaceNames = new Map(spaces.map((s) => [s.id, s.name] as const));
  const tasks: StaleTask[] = rows.map((row) => {
    const touches = [row.updatedAt, row.activities[0]?.createdAt, row.comments[0]?.createdAt].filter((d): d is Date => !!d);
    const last = new Date(Math.max(...touches.map((d) => d.getTime())));
    return {
      id: row.id,
      key: `${prefix}-${row.number}`,
      title: row.title,
      priority: row.priority,
      assigneeId: row.assigneeId,
      assigneeName: row.assignee?.name ?? null,
      projectId: row.project.id,
      projectName: row.project.name,
      workspaceId: row.workspaceId,
      spaceName: spaceNames.get(row.workspaceId) ?? "",
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
      lastTouchedAt: last.toISOString(),
      idleDays: daysIdle(last, now),
      automated: isAutomated(row),
      private: row.visibility === "PARTICIPANTS",
    };
  });
  return {
    days: params.days,
    auto: params.auto,
    space,
    builtAt: now.getTime(),
    viewerId: actor.userId,
    today: dayOfInstant(now, await orgTimeZone(actor.orgId)),
    spaces,
    total,
    shown: tasks.length,
    truncated: total > tasks.length,
    autoTotal,
    people: groupStale(tasks, open),
    assignable,
  };
}

// ───────────────────────────────── the bulk actions ─────────────────────────────────

export interface SweepInput {
  action: StaleAction;
  taskIds: string[];
  /** `assign`: who gets the tasks. */
  assigneeId?: string | null;
  /** `postpone`: the new due day, `YYYY-MM-DD` in the company's calendar (never before today). */
  day?: string | null;
}

/** The machine key a refusal travels as; a key the dictionary does not know becomes the plain «ما قدرنا». */
export function refusalKey(err: unknown): string {
  let key = "stale.refused.failed";
  if (err instanceof RequiredFieldsError) key = "fields.required";
  else if (err instanceof ValidationError) key = err.issues[0]?.message ?? "validation.failed";
  else if (err instanceof ForbiddenError || err instanceof NotFoundError) key = err.message;
  else log.error("stale.sweep.failed", { name: err instanceof Error ? err.name : String(err), message: err instanceof Error ? err.message : String(err) });
  return AR[key] ? key : "stale.refused.failed";
}

interface Target {
  id: string;
  number: number;
  title: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  assigneeId: string | null;
  completedAt: Date | null;
  archived: boolean;
  rewardStatus: string | null;
  project: { teamId: string | null };
}

/**
 * Applies ONE action to many tasks, judged per task. The input's own mistakes (no tasks, a day in the past, nobody to give the tasks to) are refused
 * as a whole BEFORE anything happens; everything else is per task and reported.
 */
export async function sweepStale(actor: Actor, input: SweepInput, now: Date = new Date()): Promise<SweepResult> {
  const spaces = await assertStaleManager(actor);
  const managed = new Set(spaces.map((s) => s.id));
  const ids = [...new Set(input.taskIds)];
  if (ids.length === 0) throw new ValidationError([{ path: "taskIds", message: "stale.pick_tasks" }]);
  if (ids.length > STALE_SWEEP_MAX) throw new ValidationError([{ path: "taskIds", message: "stale.too_many" }]);

  let dueDate: Date | null = null;
  if (input.action === "postpone") {
    if (!input.day || !parseDayText(input.day)) throw new ValidationError([{ path: "day", message: "stale.day_required" }]);
    dueDate = dueInstantForDay(input.day, await orgTimeZone(actor.orgId));
    if (!dueDate || dueDate.getTime() < (await orgDayStart(actor.orgId, now)).getTime()) throw new ValidationError([{ path: "day", message: "stale.day_past" }]);
  }
  if (input.action === "assign" && !input.assigneeId) throw new ValidationError([{ path: "assigneeId", message: "stale.pick_person" }]);

  const scope = await loadWorkScope(actor.userId);
  const results: SweepRow[] = [];
  for (const taskId of ids) {
    try {
      // the task as THIS person may see it: a hidden or foreign task answers «not found», exactly like the task's own door
      const target: Target | null = await db.task.findFirst({
        where: { AND: [taskVisibleWhere(scope), { id: taskId, orgId: actor.orgId }] },
        select: {
          id: true,
          number: true,
          title: true,
          workspaceId: true,
          projectId: true,
          boardId: true,
          assigneeId: true,
          completedAt: true,
          archived: true,
          rewardStatus: true,
          project: { select: { teamId: true } },
        },
      });
      if (!target) throw new ForbiddenError("task.not_found");
      if (!managed.has(target.workspaceId)) throw new ForbiddenError("stale.not_manager");
      if (target.completedAt != null || target.archived) throw new ForbiddenError("stale.not_open");
      const outcome = await applyOne(actor, target, input, dueDate);
      await writeLine(actor, target, input, outcome);
      results.push({ taskId, outcome });
    } catch (err) {
      results.push({ taskId, outcome: "refused", error: refusalKey(err) });
    }
  }
  const tally = tallySweep(input.action, results);
  await audit("task.stale_sweep", {
    actorId: actor.userId,
    orgId: actor.orgId,
    meta: { action: input.action, asked: ids.length, done: tally.done, requested: tally.requested, refused: tally.refused },
  });
  return tally;
}

/** One task through the service that owns the change. Returns `requested` when the person asked for is of a higher rank (a request was made instead). */
async function applyOne(actor: Actor, task: Target, input: SweepInput, dueDate: Date | null): Promise<"done" | "requested"> {
  switch (input.action) {
    case "close": {
      // moving a task is not locked for a reward task by `moveTask`; finishing one is the owner's call, so the sweep does not
      await assertRewardEditable(actor, task);
      const done = await db.boardColumn.findFirst({ where: { boardId: task.boardId, done: true }, orderBy: { position: "asc" }, select: { id: true } });
      if (!done) throw new ForbiddenError("board.no_done_column");
      await moveTask(actor, task.id, { columnId: done.id });
      return "done";
    }
    case "assign": {
      const assigneeId = input.assigneeId!;
      // the same two checks the task's own PATCH makes before it hands work to somebody new
      if (assigneeId !== task.assigneeId) {
        await assertActiveAssignee(actor.orgId, assigneeId);
        if (task.project.teamId && !(await userSeesProject(assigneeId, { workspaceId: task.workspaceId, teamId: task.project.teamId }))) throw new ForbiddenError("assignee.not_in_team");
      }
      const saved = await updateTask(actor, task.id, { assigneeId });
      // a person of a HIGHER rank is asked, not given the work: `updateTask` made the request and told them; the task keeps its holder
      if (saved.assignRequest) return "requested";
      if (assigneeId !== task.assigneeId && assigneeId !== actor.userId) {
        try {
          const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { keyPrefix: true } });
          await notifyAssignment({ assigneeId, taskNumber: task.number, orgPrefix: org?.keyPrefix ?? "ZW", taskId: task.id, title: task.title, workspaceId: task.workspaceId });
        } catch (err) {
          // the task IS assigned: a lost bell is reported in the log, never turned into a refusal of work that happened
          log.error("stale.sweep.bell_failed", { task: task.id, message: err instanceof Error ? err.message : String(err) });
        }
      }
      return "done";
    }
    case "postpone":
      await updateTask(actor, task.id, { dueDate });
      return "done";
    case "archive":
      // the flag, never a delete: the task stays where it was and can be brought back
      await updateTask(actor, task.id, { archived: true });
      return "done";
  }
}

/** The task's own line for what the sweep did (`updateTask` writes none for an archive, and its lines never say the change came from the sweep). */
async function writeLine(actor: Actor, task: Target, input: SweepInput, outcome: "done" | "requested"): Promise<void> {
  const meta: Prisma.InputJsonObject = {
    action: input.action,
    outcome,
    ...(input.action === "assign" ? { to: input.assigneeId ?? null, from: task.assigneeId } : {}),
    ...(input.action === "postpone" ? { day: input.day ?? null } : {}),
  };
  try {
    await db.taskActivity.create({ data: { taskId: task.id, actorId: actor.userId, event: STALE_EVENT, meta } });
  } catch (err) {
    // the change is committed: a lost log line is reported in the log, not turned into a refusal of work that happened
    log.error("stale.sweep.line_failed", { task: task.id, message: err instanceof Error ? err.message : String(err) });
  }
}
