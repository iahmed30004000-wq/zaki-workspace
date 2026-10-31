import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, requireTaskAccess, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { MAX_STEPS, MAX_STEP_TITLE, STEP_GAP, crowded, positionBetween, progressOf, reorder, type StepDto, type StepProgress } from "@/lib/task-steps";

/**
 * «خطوات» — the short checklist inside a task.
 *
 * WHO: whoever may edit the task may edit its steps (`requireTaskAccess` with the writing roles, then the tasks row
 * of the section grid). A GUEST never writes one and the owner reading a space he is not in does not tick anything:
 * a tick carries a name and a time (`doneById`, `doneAt`), and silent reading leaves no trace. Reading a task's steps
 * is reading the task. The company's `taskSteps` switch closes every door; nothing written is lost.
 *
 * A step dies with its task (a foreign key with cascade). Position is fractional like the board's tasks: moving a
 * step writes one row, and the whole list is only renumbered when two neighbours get too close.
 */

const SELECT = { id: true, title: true, done: true, doneAt: true } as const;

function dto(row: { id: string; title: string; done: boolean; doneAt: Date | null }): StepDto {
  return { id: row.id, title: row.title, done: row.done, doneAt: row.doneAt ? row.doneAt.toISOString() : null };
}

/** Reading: the task's own guard, then the switch. A guest of the space reads. */
async function readAccess(taskId: string) {
  const access = await requireTaskAccess(taskId);
  await assertMemberCan(access, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, "taskSteps");
  return access;
}

/** Writing: who may edit the task — never a guest, never the owner who is not in the space. */
async function writeAccess(taskId: string): Promise<OrgAccessContext & { task: { id: string; workspaceId: string } }> {
  const access = await requireTaskAccess(taskId, ["ADMIN", "MEMBER"]);
  await assertFeatureOn(access.orgId, "taskSteps");
  await assertMemberCan(access, "tasks.edit", "section.edit_denied");
  if (access.orgRole === "OWNER") {
    const row = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: access.task.workspaceId, userId: access.userId } },
      select: { userId: true },
    });
    if (!row) throw new ForbiddenError("step.oversight_readonly");
  }
  return access;
}

export function cleanTitle(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw new ValidationError([{ path: "title", message: "step.title_empty" }]);
  if (title.length > MAX_STEP_TITLE) throw new ValidationError([{ path: "title", message: "step.title_long" }]);
  return title;
}

async function stepOf(taskId: string, stepId: string) {
  const step = await db.taskStep.findFirst({ where: { id: stepId, taskId }, select: { id: true, done: true } });
  if (!step) throw new NotFoundError("step.not_found");
  return step;
}

/** The steps of a task in order. The caller has already passed the task's own guard (the task page, `listSteps`). */
export async function stepsOfTask(taskId: string): Promise<{ steps: StepDto[]; progress: StepProgress }> {
  const rows = await db.taskStep.findMany({ where: { taskId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: SELECT });
  return { steps: rows.map(dto), progress: progressOf(rows) };
}

export async function listSteps(taskId: string): Promise<{ steps: StepDto[]; progress: StepProgress }> {
  await readAccess(taskId);
  return stepsOfTask(taskId);
}

export async function addStep(taskId: string, rawTitle: string): Promise<StepDto> {
  const access = await writeAccess(taskId);
  return insertStep(access.orgId, taskId, rawTitle);
}

/**
 * The write of `addStep` for a caller that has already passed its own guard (a session in `addStep`; the task rules' run-time
 * re-check in src/server/services/task-rules-run.ts). It does not look at the session or the switch: the caller must.
 */
export async function insertStep(orgId: string, taskId: string, rawTitle: string): Promise<StepDto> {
  const title = cleanTitle(rawTitle);
  const [count, last] = await Promise.all([
    db.taskStep.count({ where: { taskId } }),
    db.taskStep.findFirst({ where: { taskId }, orderBy: [{ position: "desc" }, { id: "desc" }], select: { position: true } }),
  ]);
  if (count >= MAX_STEPS) throw new ForbiddenError("step.too_many");
  const row = await db.taskStep.create({
    data: { orgId, taskId, title, position: positionBetween(last ? Number(last.position.toString()) : null, null) },
    select: SELECT,
  });
  return dto(row);
}

export interface StepPatch {
  title?: string;
  done?: boolean;
  /** Move the step to sit right after this one (`null`: first). Absent: it stays where it is. */
  afterId?: string | null;
}

export async function updateStep(taskId: string, stepId: string, patch: StepPatch): Promise<StepDto> {
  const access = await writeAccess(taskId);
  const step = await stepOf(taskId, stepId);
  const data: { title?: string; done?: boolean; doneById?: string | null; doneAt?: Date | null } = {};
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  // ticking again a step already ticked keeps WHO ticked it first and when
  if (patch.done !== undefined && patch.done !== step.done) {
    data.done = patch.done;
    data.doneById = patch.done ? access.userId : null;
    data.doneAt = patch.done ? new Date() : null;
  }
  if (patch.afterId !== undefined) await moveStep(taskId, stepId, patch.afterId);
  const row = Object.keys(data).length
    ? await db.taskStep.update({ where: { id: stepId }, data, select: SELECT })
    : await db.taskStep.findUniqueOrThrow({ where: { id: stepId }, select: SELECT });
  return dto(row);
}

/** The step to sit right after `afterId` (`null`: first). One row is written, unless the neighbours are too close. */
async function moveStep(taskId: string, stepId: string, afterId: string | null): Promise<void> {
  const rows = await db.taskStep.findMany({ where: { taskId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
  const order = reorder(rows.map((r) => r.id), stepId, afterId);
  if (!order) throw new NotFoundError("step.not_found");
  const position = new Map(rows.map((r) => [r.id, Number(r.position.toString())]));
  const at = order.indexOf(stepId);
  const prev = at > 0 ? position.get(order[at - 1]!)! : null;
  const next = at < order.length - 1 ? position.get(order[at + 1]!)! : null;
  const candidate = positionBetween(prev, next);
  if (!crowded(candidate, prev, next)) {
    await db.taskStep.update({ where: { id: stepId }, data: { position: candidate } });
    return;
  }
  // too close: the whole list is renumbered once, in one transaction
  await db.$transaction(order.map((id, i) => db.taskStep.update({ where: { id }, data: { position: (i + 1) * STEP_GAP } })));
}

export async function deleteStep(taskId: string, stepId: string): Promise<void> {
  await writeAccess(taskId);
  await stepOf(taskId, stepId);
  await db.taskStep.delete({ where: { id: stepId } });
}

/**
 * «٣ من ٥» for a page of cards: one grouped read for every task of the page (a task without steps is absent).
 * The caller has already read the tasks, and decides whether the switch is on.
 */
export async function stepProgressFor(taskIds: readonly string[]): Promise<Map<string, StepProgress>> {
  const out = new Map<string, StepProgress>();
  if (taskIds.length === 0) return out;
  const rows = await db.taskStep.groupBy({ by: ["taskId", "done"], where: { taskId: { in: [...taskIds] } }, _count: { _all: true } });
  for (const r of rows) {
    const cur = out.get(r.taskId) ?? { done: 0, total: 0 };
    cur.total += r._count._all;
    if (r.done) cur.done += r._count._all;
    out.set(r.taskId, cur);
  }
  return out;
}
