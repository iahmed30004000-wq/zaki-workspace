import type { TaskDependencyKind } from "@prisma/client";
import { assertMemberCan } from "@/server/policy/actor";
import { db } from "@/server/db";
import { taskParticipantFilter } from "@/server/services/team-scope";
import { ForbiddenError, NotFoundError, requireTaskAccess } from "@/server/auth";
import { activity } from "@/server/activity";

/**
 * «التبعيات» — the links between two tasks (the owner, 2026-10-30: the table existed and nothing
 * wrote it).
 *
 * A row `(taskId, dependsOnId, kind)` reads as ONE sentence: «taskId <kind> dependsOnId». `kind` is
 * the word the row carries, and both directions are shown on the task page:
 *
 *   BLOCKS      هذا يعطّل ذاك
 *   BLOCKED_BY  هذا معطّل بسبب ذاك
 *   DUPLICATES  هذا مكرّر لذاك
 *
 * The row is information, never a lock: a blocked task still moves, still closes, still counts. A
 * dependency that silently refused a move would turn one person's note into another person's
 * blockage, and the board would stop answering «why can't I move this». Whoever wants the block to
 * mean something sees it on the task and decides.
 *
 * The two tasks must both be visible to the actor (the same space guard the task itself uses), so a
 * link can never name a task of another company or of a team the person does not see.
 */

export const DEPENDENCY_KINDS: readonly TaskDependencyKind[] = ["BLOCKS", "BLOCKED_BY", "DUPLICATES"];

export interface TaskLinkDto {
  id: string;
  kind: TaskDependencyKind;
  /** The other end of the link. */
  task: { id: string; number: number; title: string; key: string };
}

export interface TaskLinksDto {
  /** This task → the other (the row as stored). */
  out: TaskLinkDto[];
  /** The other → this task (the same table read the other way). */
  in: TaskLinkDto[];
}

const OTHER = {
  id: true,
  number: true,
  title: true,
  organization: { select: { keyPrefix: true } },
} as const;

function toDto(row: {
  id: string;
  kind: TaskDependencyKind;
  other: { id: string; number: number; title: string; organization: { keyPrefix: string } };
}): TaskLinkDto {
  return {
    id: row.id,
    kind: row.kind,
    task: {
      id: row.other.id,
      number: row.other.number,
      title: row.other.title,
      key: `${row.other.organization.keyPrefix}-${row.other.number}`,
    },
  };
}

/** Every link of one task, both directions. The caller has already passed the task's own guard. */
export async function listTaskLinks(taskId: string, viewerId: string): Promise<TaskLinksDto> {
  // the other end of a link is a task like any other: a private one the person may not open is not named (P0 review)
  const rule = await taskParticipantFilter(viewerId);
  const [out, incoming] = await Promise.all([
    db.taskDependency.findMany({
      where: { taskId, dependsOn: rule },
      orderBy: { id: "asc" },
      select: { id: true, kind: true, dependsOn: { select: OTHER } },
    }),
    db.taskDependency.findMany({
      where: { dependsOnId: taskId, task: rule },
      orderBy: { id: "asc" },
      select: { id: true, kind: true, task: { select: OTHER } },
    }),
  ]);
  return {
    out: out.map((r) => toDto({ id: r.id, kind: r.kind, other: r.dependsOn })),
    in: incoming.map((r) => toDto({ id: r.id, kind: r.kind, other: r.task })),
  };
}

/**
 * Adds one link. Both ends are checked with the same guard the task page uses (`requireTaskAccess`:
 * the space, and the project's team), so a link can never point at something the person cannot open.
 *
 * Three refusals, each its own key so the screen can say which one:
 *  - `link.self` — a task cannot depend on itself;
 *  - `link.exists` — the same pair and kind is already stored;
 *  - `link.cycle` — the two would each block the other, which is a state no reader can act on.
 */
export async function addTaskLink(
  taskId: string,
  input: { dependsOnId: string; kind: TaskDependencyKind },
): Promise<TaskLinkDto> {
  if (taskId === input.dependsOnId) throw new ForbiddenError("link.self");
  const access = await requireTaskAccess(taskId);
  await assertMemberCan(access, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  // the other end, by the same rule: another company's task, or another team's, is «not found».
  // The company is compared first, so the answer never says whether a task of another company exists.
  const other = await db.task.findUnique({
    where: { id: input.dependsOnId },
    select: { orgId: true },
  });
  if (!other || other.orgId !== access.orgId) throw new NotFoundError("task.not_found");
  await requireTaskAccess(input.dependsOnId);

  const exists = await db.taskDependency.findFirst({
    where: { taskId, dependsOnId: input.dependsOnId, kind: input.kind },
    select: { id: true },
  });
  if (exists) throw new ForbiddenError("link.exists");

  // BLOCKS and BLOCKED_BY are two ways of writing the same wall: refuse the pair that closes a loop.
  if (input.kind === "BLOCKS" || input.kind === "BLOCKED_BY") {
    const back = await db.taskDependency.findFirst({
      where: {
        taskId: input.dependsOnId,
        dependsOnId: taskId,
        kind: input.kind === "BLOCKS" ? "BLOCKED_BY" : "BLOCKS",
      },
      select: { id: true },
    });
    if (back) throw new ForbiddenError("link.cycle");
  }

  const row = await db.taskDependency.create({
    data: { taskId, dependsOnId: input.dependsOnId, kind: input.kind },
    select: { id: true, kind: true, dependsOn: { select: OTHER } },
  });
  // the link is part of the task's story, like a move or a comment
  await activity(db, {
    taskId,
    actorId: access.userId,
    event: "task.linked",
    meta: { linkId: row.id, kind: input.kind, dependsOnId: input.dependsOnId },
  });
  return toDto({ id: row.id, kind: row.kind, other: row.dependsOn });
}

/**
 * Removes one link. The link is named by its own id, and the route only removes one that touches the
 * task in the path: a link of two other tasks is not this task's to delete.
 */
export async function removeTaskLink(taskId: string, linkId: string): Promise<void> {
  const access = await requireTaskAccess(taskId);
  await assertMemberCan(access, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  const row = await db.taskDependency.findFirst({
    where: { id: linkId, OR: [{ taskId }, { dependsOnId: taskId }] },
    select: { id: true, kind: true, taskId: true, dependsOnId: true },
  });
  if (!row) throw new NotFoundError("link.not_found");
  await db.taskDependency.delete({ where: { id: row.id } });
  await activity(db, {
    taskId,
    actorId: access.userId,
    event: "task.unlinked",
    meta: { linkId: row.id, kind: row.kind, otherId: row.taskId === taskId ? row.dependsOnId : row.taskId },
  });
}

/** The kind as it is stored, for a value that arrived as text. */
export function isDependencyKind(value: string): value is TaskDependencyKind {
  return (DEPENDENCY_KINDS as readonly string[]).includes(value);
}
