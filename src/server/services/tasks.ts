import { Prisma, type Task } from "@prisma/client";
import { assertMemberCan } from "@/server/policy/actor";
import { userSeesProject } from "./team-scope";
import { orgDayStart } from "./org-day";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import { AR } from "@/lib/i18n/dict";
import { prepareReward, REWARD_EVENTS, type RewardRequest } from "./rewards";
import { assertRewardEditable } from "./reward-guard";
import {
  assertNoPendingRequest,
  judgeAssignment,
  judgeCoAssignees,
  notifyAssignRequest,
  storeAssignRequest,
  storeCoRequests,
  type AssignRequestInfo,
} from "./task-assign";
import { onTaskCompleted } from "./recurrence-spawn";
import { assertRequiredFilled } from "./custom-fields";

export interface ActorContext {
  userId: string;
  orgId: string;
}

export interface CreateTaskInput {
  workspaceId: string;
  projectId: string;
  boardId: string;
  columnId?: string;
  title: string;
  description?: string | null;
  priority?: Task["priority"];
  type?: Task["type"];
  assigneeId?: string | null;
  /** «لمين» with more than one person: the people beside `assigneeId` (which stays the first of them). */
  coAssigneeIds?: string[];
  dueDate?: Date | null;
  startDate?: Date | null;
  labelIds?: string[];
  /**
   * «مهمة بمكافأة»: the OWNER's alone (403 `reward.owner_only` for anybody else, 404 while the switch is off); needs a due
   * date and an amount (src/server/services/rewards.ts `prepareReward`). Every way a task is born comes through here.
   */
  reward?: RewardRequest;
  /** «الباب»: a task sent in through /api/v1: the token that made it and the sender's own opaque reference (src/server/services/api-door.ts). */
  door?: { apiTokenId: string; externalRef: string | null };
}

export interface MoveTaskInput {
  columnId: string;
  /** 0-based index within the destination column; default = append to end. */
  index?: number;
}

export const TASK_INCLUDE = {
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  assignee: { select: { id: true, name: true } },
  // «لمين» with more than one person: the rows beside the primary, oldest first (the order they were picked)
  coAssignees: {
    select: { userId: true, user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

export type TaskDTO = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/**
 * What `createTask` / `updateTask` hand back: the task, plus the request that was made when the person asked for was of a
 * HIGHER rank (the task then has NO such assignee: see task-assign.ts). `null` when nothing was asked.
 */
export type TaskWithRequest = TaskDTO & {
  assignRequest: AssignRequestInfo | null;
  /** «لمين» with more than one person: the requests made for the people BESIDE the first who are of a higher rank. */
  coRequests: AssignRequestInfo[];
};

export type Tx = Prisma.TransactionClient;

/**
 * «مهمة لأكثر من شخص»: the tasks whose people include this one — the primary column (`assigneeId`)
 * plus the extra names (`TaskCoAssignee`). Every read that means «الشغل المطلوب من هذا الشخص» uses it,
 * so a second assignee sees the task in «مهامي» and «اليوم» exactly like the first one.
 */
export function assignedTo(userId: string): Prisma.TaskWhereInput {
  return { OR: [{ assigneeId: userId }, { coAssignees: { some: { userId } } }] };
}

export interface DefaultBoardColumn {
  name: string;
  color: string;
  done: boolean;
}

/**
 * The workflow a new board starts with. The names are Arabic (no English reaches a screen): the same
 * words `columnLabel` shows for the English defaults boards were given before, so an old board and a
 * new one read alike. Boards that already exist keep their names; only what is shown is translated.
 * (A column's colour is user data, stored as a hex value.)
 */
export const DEFAULT_BOARD_COLUMNS: readonly DefaultBoardColumn[] = [
  { name: AR["column.backlog"]!, color: "#6b7280", done: false },
  { name: AR["column.todo"]!, color: "#3b82f6", done: false },
  { name: AR["column.in_progress"]!, color: "#f59e0b", done: false },
  { name: AR["column.review"]!, color: "#a855f7", done: false },
  { name: AR["column.done"]!, color: "#10b981", done: true },
];

/**
 * Per-org sequential number (task key = `${prefix}-${number}`).
 * Counter is upserted inside the caller's transaction; unique(orgId, number)
 * protects against two concurrent creates claiming the same number.
 */
export async function nextTaskNumber(orgId: string, tx: Tx): Promise<number> {
  const counter = await tx.taskCounter.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return counter.lastNumber;
}

interface PositionRow {
  position: string;
}

/**
 * Fractional-rank positioning: inserts touch at most 2 previous rows and write
 * one row, so bulk moves never renumber a column. Concurrent identical inserts
 * resolve by the deterministic `(position, id)` tiebreaker.
 */
async function positionAt(
  columnId: string,
  index: number | undefined,
  tx: Tx,
): Promise<Prisma.Decimal | number> {
  const rows = await tx.$queryRaw<PositionRow[]>`
    SELECT "position"::text FROM "Task"
    WHERE "columnId" = ${columnId} AND archived = false
    ORDER BY "position" ASC, id ASC`;
  const n = rows.length;
  if (n === 0) return 1000;
  const idx = index === undefined ? n : Math.max(0, Math.min(n, index));
  if (idx === 0) return Number(rows[0]!.position) / 2;
  if (idx === n) return Number(rows[n - 1]!.position) + 1000;
  return (Number(rows[idx - 1]!.position) + Number(rows[idx]!.position)) / 2;
}

interface ScopedTask {
  id: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Task["priority"];
  type: Task["type"];
  assigneeId: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  archived: boolean;
  /** «مهمة بمكافأة»: null/NONE = a plain task; OPEN, AWARDED or CANCELLED = a reward task (locked for everybody but the owner). */
  rewardStatus: string | null;
}

/** Takes the task's row for the rest of the transaction (`FOR UPDATE`): what is read after this is what the last writer left. */
async function lockTask(tx: Tx, taskId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
}

async function assertTaskScope(taskId: string, orgId: string, tx: Tx): Promise<ScopedTask> {
  const task = await tx.task.findFirst({
    where: { id: taskId, orgId },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      boardId: true,
      columnId: true,
      title: true,
      description: true,
      priority: true,
      type: true,
      assigneeId: true,
      dueDate: true,
      completedAt: true,
      archived: true,
      rewardStatus: true,
    },
  });
  if (!task) throw new NotFoundError("task.not_found");
  return task;
}

export async function createTask(actor: ActorContext, input: CreateTaskInput): Promise<TaskWithRequest> {
  // the tasks row of the person's grid (every way a task is born comes here: the board, a message, an idea)
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  const made = await db.$transaction((tx) => createTaskInTx(tx, actor, input));
  await notifyCreatedRequests(made, actor);
  return made;
}

/** After the commit: the higher people hear about it (a failed bell never undoes the task). */
export async function notifyCreatedRequests(made: TaskWithRequest, actor: ActorContext): Promise<void> {
  if (made.assignRequest) await notifyAssignRequest(made.id, actor.userId, made.assignRequest.toUserId);
  for (const r of made.coRequests) await notifyAssignRequest(made.id, actor.userId, r.toUserId);
}

/**
 * The body of `createTask` on a transaction the CALLER holds, so a task can be born in the same commit as something
 * else (a repeating task's next occurrence: src/server/services/recurrence-spawn.ts). The caller has already passed
 * the section grid's `tasks.edit` door and sends the bell for a request AFTER its commit (`notifyCreatedRequests`).
 * Every rule (the project chain, the team, the labels, the rank judge) is here, once.
 */
export async function createTaskInTx(tx: Tx, actor: ActorContext, input: CreateTaskInput): Promise<TaskWithRequest> {
  // «مهمة بمكافأة»: the owner only, with a due date and an amount: refused BEFORE anything is written
  const rewardData = input.reward ? await prepareReward(actor, input.reward, input.dueDate ?? null, tx) : null;
  // integrity: ids must chain to the actor's organization
  const chain = await tx.project.findFirst({
    where: {
      id: input.projectId,
      workspace: { id: input.workspaceId, organizationId: actor.orgId },
    },
    select: { id: true, workspaceId: true, teamId: true },
  });
  if (!chain) throw new NotFoundError("project.not_found");
  // a project of a team takes tasks only from that team and the space's managers (the route, an idea
  // converted to a task, a quick add: every caller comes through here)
  if (chain.teamId && !(await userSeesProject(actor.userId, chain))) throw new NotFoundError("project.not_found");

  const board = await tx.board.findFirst({
    where: { id: input.boardId, projectId: input.projectId },
    include: { columns: { orderBy: { position: "asc" } } },
  });
  if (!board) throw new NotFoundError("board.not_found");
  const column = board.columns.find((c) => c.id === input.columnId) ?? board.columns[0];
  if (!column) throw new NotFoundError("board.no_columns");

  if (input.labelIds?.length) {
    const uniqueIds = [...new Set(input.labelIds)];
    const count = await tx.label.count({
      where: { orgId: actor.orgId, id: { in: uniqueIds } },
    });
    if (count !== uniqueIds.length) throw new ForbiddenError("label.invalid");
  }

  // P1: never allow assigning a task to a user outside the actor's org, nor to one who is no
  // longer active in it (suspended or offboarded keep their row, but they do not count). By RANK: a person
  // of a higher rank is asked, not assigned (task-assign.ts): the task is born without them and a request waits.
  // «لمين» with more than one person: the first named is the task's own assignee, and every other person goes
  // through the SAME judge on their own (`judgeCoAssignees`): a higher one is asked, the rest are added.
  const extras = [...new Set(input.coAssigneeIds ?? [])];
  let assigneeId = input.assigneeId ?? extras.shift() ?? null;
  let requestTo: string | null = null;
  // a team's task goes to somebody who sees that team's work (its members and the space's managers)
  const assertInTeam = async (userId: string): Promise<void> => {
    if (chain.teamId && !(await userSeesProject(userId, chain))) throw new ForbiddenError("assignee.not_in_team");
  };
  if (assigneeId) {
    const verdict = await judgeAssignment(tx, actor, assigneeId, input.workspaceId);
    await assertInTeam(assigneeId);
    if (verdict === "request") {
      requestTo = assigneeId;
      assigneeId = null;
    }
  }
  const first = requestTo ?? assigneeId;
  const others = await judgeCoAssignees(
    tx,
    actor,
    extras.filter((id) => id !== first),
    input.workspaceId,
  );
  for (const userId of [...others.direct, ...others.request]) await assertInTeam(userId);
  const coIds = others.direct;

  const number = await nextTaskNumber(actor.orgId, tx);
  const task = await tx.task.create({
    data: {
      number,
      orgId: actor.orgId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      boardId: input.boardId,
      columnId: column.id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "NORMAL",
      type: input.type ?? "TASK",
      assigneeId,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      creatorId: actor.userId,
      position: await positionAt(column.id, undefined, tx),
      // born in a done column is finished: the same rule as `moveTask`, or no counter would see it
      completedAt: column.done ? new Date() : null,
      ...(rewardData ?? {}),
      ...(input.door ? { apiTokenId: input.door.apiTokenId, externalRef: input.door.externalRef } : {}),
      coAssignees: coIds.length
        ? { create: coIds.map((userId) => ({ userId })) }
        : undefined,
      labels: input.labelIds?.length
        ? { create: [...new Set(input.labelIds)].map((labelId) => ({ labelId })) }
        : undefined,
    },
    include: TASK_INCLUDE,
  });
  await tx.taskActivity.create({
    data: {
      taskId: task.id,
      actorId: actor.userId,
      event: "task.created",
      meta: { columnId: column.id },
    },
  });
  if (rewardData) {
    await tx.auditLog.create({
      data: {
        action: REWARD_EVENTS.set,
        actorId: actor.userId,
        orgId: actor.orgId,
        target: task.id,
        workspaceId: input.workspaceId,
        meta: { after: { status: "OPEN", amountMinor: rewardData.rewardAmountMinor, currency: rewardData.rewardCurrency } },
      },
    });
  }
  const assignRequest = requestTo
    ? await storeAssignRequest(tx, { orgId: actor.orgId, taskId: task.id, fromUserId: actor.userId, toUserId: requestTo })
    : null;
  const coRequests = await storeCoRequests(tx, { orgId: actor.orgId, taskId: task.id, fromUserId: actor.userId, toUserIds: others.request });
  return { ...task, assignRequest, coRequests };
}

export async function moveTask(
  actor: ActorContext,
  taskId: string,
  input: MoveTaskInput,
): Promise<TaskDTO> {
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  let afterCommit: (() => Promise<void>) | null = null;
  const moved = await db.$transaction(async (tx) => {
    // one completion at a time per task: a second move into the done column waits here, then finds it already done
    await lockTask(tx, taskId);
    const task = await assertTaskScope(taskId, actor.orgId, tx);
    const column = await tx.boardColumn.findFirst({
      where: { id: input.columnId, boardId: task.boardId },
    });
    if (!column) throw new ForbiddenError("column.invalid");
    // «حقول مخصصة»: finishing a task (open -> done) asks for the project's required fields, here and in `setTaskCompletion`
    if (column.done && task.completedAt == null) await assertRequiredFilled(tx, { id: taskId, projectId: task.projectId, orgId: actor.orgId });

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: column.id,
        position: await positionAt(column.id, input.index, tx),
        /* `completedAt` is the day the work was FINISHED, and every counter reads it (Today's «أُنجز
           اليوم», analytics, the open count). So it moves on the transition only: a task dragged
           around inside the done column keeps the day it was finished, and one dragged out of it is
           open again. (`setTaskCompletion` writes the same rule for the tick box.) */
        completedAt: column.done ? (task.completedAt ?? new Date()) : null,
      },
      include: TASK_INCLUDE,
    });
    if (task.columnId !== column.id) {
      await tx.taskActivity.create({
        data: {
          taskId,
          actorId: actor.userId,
          event: "task.moved",
          meta: { from: task.columnId, to: column.id },
        },
      });
    }
    // «مهمة متكررة» (عند الإنجاز): finishing an occurrence makes the next one, in this same commit (only on the transition)
    if (column.done && task.completedAt == null) afterCommit = await onTaskCompleted(tx, { id: taskId, recurrenceId: updated.recurrenceId, dueDate: updated.dueDate });
    return updated;
  });
  await (afterCommit as (() => Promise<void>) | null)?.();
  return moved;
}

export interface TaskUpdateData {
  title?: string;
  description?: string | null;
  priority?: Task["priority"];
  type?: Task["type"];
  assigneeId?: string | null;
  /** Replaces the people beside the primary (`assigneeId`) when provided. */
  coAssigneeIds?: string[];
  dueDate?: Date | null;
  startDate?: Date | null;
  milestoneId?: string | null;
  archived?: boolean;
  /** Replaces the full label set when provided. */
  labelIds?: string[];
}

export async function updateTask(
  actor: ActorContext,
  taskId: string,
  data: TaskUpdateData,
): Promise<TaskWithRequest> {
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  const saved = await db.$transaction(async (tx) => {
    const before = await assertTaskScope(taskId, actor.orgId, tx);
    // «مهمة بمكافأة»: on a reward task the owner alone changes anything but who holds it (assigning keeps its own rank rule,
    // status moves are `moveTask` / `setTaskCompletion`); a day can never be taken off a reward that is still open
    const touchesLocked =
      data.title !== undefined || data.description !== undefined || data.priority !== undefined || data.type !== undefined ||
      data.dueDate !== undefined || data.startDate !== undefined || data.milestoneId !== undefined || data.archived !== undefined ||
      data.labelIds !== undefined;
    if (touchesLocked) await assertRewardEditable(actor, before);
    if (data.dueDate === null && before.rewardStatus === "OPEN") {
      throw new ValidationError([{ path: "dueDate", message: "reward.due_required" }]);
    }
    let requestTo: string | null = null;
    const updateData: Prisma.TaskUpdateInput = {};
    let coSetChanged = false;
    let coRequestTo: string[] = [];
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.assigneeId !== undefined) {
      // never assign to a user outside the actor's org, or to one who is not active in it (the same
      // rule as on create); re-sending the current assignee changes nothing, so it is not re-checked:
      // work somebody already holds stays editable around them until it is moved
      // (somebody already BESIDE the first, made the first by re-ordering the list, holds the task as well: not re-judged)
      const alreadyBeside =
        data.assigneeId !== null && !!(await tx.taskCoAssignee.findUnique({ where: { taskId_userId: { taskId, userId: data.assigneeId } }, select: { userId: true } }));
      if (data.assigneeId !== null && data.assigneeId !== before.assigneeId && !alreadyBeside) {
        // by RANK (task-assign.ts): a higher person is asked, and the task keeps the assignee it has
        if ((await judgeAssignment(tx, actor, data.assigneeId, before.workspaceId)) === "request") {
          await assertNoPendingRequest(tx, taskId);
          requestTo = data.assigneeId;
        }
      }
      if (!requestTo) {
        updateData.assignee =
          data.assigneeId === null
            ? { disconnect: true }
            : { connect: { id: data.assigneeId } };
      }
    }
    if (data.coAssigneeIds !== undefined) {
      // «لمين» with more than one person: the full new set of the people BESIDE the first. Somebody already on the task
      // (first or beside) is not re-judged (the same rule as the first above); a NEW person goes through the same judge
      // as the first: a lower or equal rank is added, a higher one is asked (a request of their own) and left out.
      const first = requestTo ? before.assigneeId : data.assigneeId === undefined ? before.assigneeId : data.assigneeId;
      const wanted = [...new Set(data.coAssigneeIds)].filter((id) => id !== first && id !== requestTo);
      const held = await tx.taskCoAssignee.findMany({ where: { taskId }, select: { userId: true } });
      const heldIds = new Set(held.map((r) => r.userId));
      const onTask = new Set([...heldIds, ...(before.assigneeId ? [before.assigneeId] : [])]);
      const fresh = await judgeCoAssignees(tx, actor, wanted.filter((id) => !onTask.has(id)), before.workspaceId);
      coRequestTo = fresh.request;
      const finalIds = wanted.filter((id) => onTask.has(id) || fresh.direct.includes(id));
      updateData.coAssignees = {
        deleteMany: {},
        create: finalIds.map((userId) => ({ userId })),
      };
      coSetChanged = finalIds.length !== heldIds.size || finalIds.some((id) => !heldIds.has(id));
    }
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.milestoneId !== undefined) {
      if (data.milestoneId === null) {
        updateData.milestone = { disconnect: true };
      } else {
        // P2: milestone must belong to this task's project (and thus the actor's org)
        const milestone = await tx.milestone.findFirst({
          where: { id: data.milestoneId, projectId: before.projectId },
          select: { id: true },
        });
        if (!milestone) throw new ForbiddenError("milestone.invalid");
        updateData.milestone = { connect: { id: data.milestoneId } };
      }
    }
    if (data.archived !== undefined) updateData.archived = data.archived;
    if (data.labelIds) {
      const uniqueIds = [...new Set(data.labelIds)];
      const count = await tx.label.count({
        where: { orgId: actor.orgId, id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) throw new ForbiddenError("label.invalid");
      updateData.labels = {
        deleteMany: {},
        create: uniqueIds.map((labelId) => ({ labelId })),
      };
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: updateData,
      include: TASK_INCLUDE,
    });
    const changed: string[] = [];
    if (data.title !== undefined && data.title !== before.title) changed.push("title");
    if (data.description !== undefined && data.description !== before.description) changed.push("description");
    if (data.priority !== undefined && data.priority !== before.priority) changed.push("priority");
    if (data.type !== undefined && data.type !== before.type) changed.push("type");
    if (data.assigneeId !== undefined && data.assigneeId !== before.assigneeId && !requestTo) changed.push("assignee");
    if (coSetChanged) changed.push("assignees");
    if (data.labelIds) changed.push("labels");
    const dueBefore = before.dueDate?.getTime() ?? null;
    const dueAfter = data.dueDate === undefined ? dueBefore : (data.dueDate?.getTime() ?? null);
    if (dueBefore !== dueAfter) changed.push("dueDate");
    if (changed.length) {
      await tx.taskActivity.create({
        data: {
          taskId,
          actorId: actor.userId,
          event: "task.updated",
          meta: { fields: changed },
        },
      });
    }
    const assignRequest = requestTo
      ? await storeAssignRequest(tx, { orgId: actor.orgId, taskId, fromUserId: actor.userId, toUserId: requestTo })
      : null;
    const coRequests = coRequestTo.length
      ? await storeCoRequests(tx, { orgId: actor.orgId, taskId, fromUserId: actor.userId, toUserIds: coRequestTo })
      : [];
    return { ...updated, assignRequest, coRequests };
  });
  if (saved.assignRequest) await notifyAssignRequest(taskId, actor.userId, saved.assignRequest.toUserId);
  for (const r of saved.coRequests) await notifyAssignRequest(taskId, actor.userId, r.toUserId);
  return saved;
}

export async function deleteTask(actor: ActorContext, taskId: string): Promise<void> {
  await assertMemberCan(actor, "tasks.delete", "section.delete_denied", { spaceGuestsPass: true });
  const task = await assertTaskScope(taskId, actor.orgId, db);
  // «مهمة بمكافأة»: only the owner deletes it
  await assertRewardEditable(actor, task);
  await db.task.delete({ where: { id: taskId } });
}

/**
 * Complete/uncomplete via the board's done column (or first open column).
 * Uses the same move path rules; stamps/clears completedAt accordingly.
 */
export async function setTaskCompletion(
  actor: ActorContext,
  taskId: string,
  complete: boolean,
): Promise<TaskDTO> {
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  let afterCommit: (() => Promise<void>) | null = null;
  const result = await db.$transaction(async (tx) => {
    // one completion at a time per task: a second click waits here, then finds the task already done and does nothing
    await lockTask(tx, taskId);
    const task = await assertTaskScope(taskId, actor.orgId, tx);
    const target = await tx.boardColumn.findFirst({
      where: { boardId: task.boardId, done: complete },
      orderBy: { position: "asc" },
    });
    if (!target) {
      throw new ForbiddenError(complete ? "board.no_done_column" : "board.no_open_column");
    }
    const alreadyDone = task.completedAt != null;
    if (alreadyDone === complete) return tx.task.findFirstOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
    // «حقول مخصصة»: the same door as `moveTask`: finishing asks for the project's required fields
    if (complete) await assertRequiredFilled(tx, { id: taskId, projectId: task.projectId, orgId: actor.orgId });
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: target.id,
        position: await positionAt(target.id, undefined, tx),
        completedAt: complete ? new Date() : null,
      },
      include: TASK_INCLUDE,
    });
    await tx.taskActivity.create({
      data: {
        taskId,
        actorId: actor.userId,
        event: complete ? "task.completed" : "task.reopened",
        meta: { columnId: target.id },
      },
    });
    // «مهمة متكررة» (عند الإنجاز): finishing an occurrence makes the next one, in this same commit
    if (complete) afterCommit = await onTaskCompleted(tx, { id: taskId, recurrenceId: updated.recurrenceId, dueDate: updated.dueDate });
    return updated;
  });
  await (afterCommit as (() => Promise<void>) | null)?.();
  return result;
}

// ---------- reads ----------

export interface ListFilters {
  /** The space the caller passed the guard for: nothing outside it is listed. */
  workspaceId: string;
  /** Which of its projects (the teams the caller sees: `teamFilterInSpace`). */
  project?: Prisma.ProjectWhereInput;
  projectId?: string;
  boardId?: string;
  assigneeId?: string;
  overdue?: boolean;
  limit: number;
  cursor?: string;
  /** The moment the caller is asking as (tests pin it; the route passes nothing and gets now). */
  now?: Date;
}

export async function listTasks(actor: ActorContext, filters: ListFilters): Promise<TaskDTO[]> {
  await assertMemberCan(actor, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
  const where: Prisma.TaskWhereInput = {
    orgId: actor.orgId,
    // before teams this listed the whole company's tasks for anyone in ANY one space: now only that space
    workspaceId: filters.workspaceId,
    ...(filters.project && Object.keys(filters.project).length ? { project: filters.project } : {}),
    archived: false,
    projectId: filters.projectId,
    boardId: filters.boardId,
    // «assigned to»: the primary column and the extra people, or a second assignee would not find their work
    ...(filters.assigneeId ? assignedTo(filters.assigneeId) : {}),
  };
  if (filters.overdue) {
    // the same line as My Work, Today and the reports: due strictly before the START of the company's today,
    // never before "this very moment" (a task due today at 09:00 is not late at 15:00)
    where.dueDate = { lt: await orgDayStart(actor.orgId, filters.now) };
    where.completedAt = null;
  }
  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }
  return db.task.findMany({
    where,
    orderBy: [{ id: "desc" }],
    take: filters.limit,
    include: TASK_INCLUDE,
  });
}
