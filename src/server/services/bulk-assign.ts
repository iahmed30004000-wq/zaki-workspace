import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit, ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { isSpaceManager } from "@/server/workspace-role";
import { holdersAfter } from "@/lib/tasks/holders-after";
import * as taskRoute from "@/app/api/tasks/[id]/route";

/**
 * «نقل أو فكّ المهام المفتوحة»: when a person leaves, their OPEN cards (not archived, not completed, not in a finished column) are listed and handed to somebody else, or
 * unassigned, in one action. NOTHING of the assignment rules is repeated here: every card goes through the very route that edits a task (`PATCH /api/tasks/:id`), so the rank
 * rule («مين يعطي مين»: a higher person is ASKED), the space rule, the team rule, the privacy of a private task and the bell are the ones that already exist. This file only
 * decides WHICH cards (the open ones of that person, in the spaces the caller manages) and reports what happened to each: moved, requested (a higher rank was asked), skipped.
 */

export const MAX_BULK_TASKS = 500;

export const bulkAssignSchema = z.object({
  /** the person whose open cards these are */
  from: z.string().min(1),
  /** the person who takes them, or null: nobody (unassigned) */
  to: z.string().min(1).nullable(),
  /** only the cards of one space */
  workspaceId: z.string().min(1).optional(),
  /** only these cards (the ones that are not the person's open cards are ignored) */
  taskIds: z.array(z.string().min(1)).max(MAX_BULK_TASKS).optional(),
});

export interface OpenTaskDto {
  id: string;
  number: number;
  title: string;
  workspaceId: string;
  workspaceName: string;
  columnName: string;
  dueDate: string | null;
  /** the person is the first holder (false: beside the first) */
  primary: boolean;
}

export interface BulkResult {
  moved: string[];
  /** a higher rank was asked: the card keeps its person until they answer */
  requested: string[];
  skipped: Array<{ id: string; reason: string }>;
}

const select = {
  id: true,
  number: true,
  title: true,
  workspaceId: true,
  dueDate: true,
  assigneeId: true,
  project: { select: { workspace: { select: { name: true } } } },
  column: { select: { name: true } },
  coAssignees: { select: { userId: true } },
} satisfies Prisma.TaskSelect;

type Row = Prisma.TaskGetPayload<{ select: typeof select }>;

/** The spaces whose cards the caller may arrange: the OWNER rank everywhere, anybody else where they are the ADMIN. */
async function manageable(ctx: OrgAccessContext): Promise<{ all: boolean; spaces: Set<string> }> {
  if (ctx.orgRole === "OWNER") return { all: true, spaces: new Set() };
  const rows = await db.workspaceMember.findMany({ where: { userId: ctx.userId, workspace: { organizationId: ctx.orgId } }, select: { workspaceId: true, role: true } });
  return { all: false, spaces: new Set(rows.filter((r) => isSpaceManager(ctx.orgRole, r.role)).map((r) => r.workspaceId)) };
}

async function personOf(ctx: OrgAccessContext, userId: string): Promise<void> {
  const row = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId } }, select: { userId: true } }); // all-statuses: the very person who was just removed or suspended is the usual case
  if (!row) throw new NotFoundError("bulk.person_not_found");
}

async function openRows(ctx: OrgAccessContext, from: string, opts: { workspaceId?: string | undefined; taskIds?: readonly string[] | undefined }): Promise<Row[]> {
  const scope = await manageable(ctx);
  if (!scope.all && scope.spaces.size === 0) throw new ForbiddenError("bulk.manager_only");
  // task-visibility: only the OWNER and the admins of the very spaces read here, and a space's managers read a private task by that same rule
  return db.task.findMany({
    where: {
      orgId: ctx.orgId,
      archived: false,
      completedAt: null,
      column: { done: false },
      OR: [{ assigneeId: from }, { coAssignees: { some: { userId: from } } }],
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      ...(opts.taskIds ? { id: { in: [...opts.taskIds] } } : {}),
      ...(scope.all ? {} : { workspaceId: { in: [...scope.spaces] } }),
    },
    select,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { number: "asc" }],
    take: MAX_BULK_TASKS,
  });
}

export async function listOpenTasks(ctx: OrgAccessContext, from: string, opts: { workspaceId?: string | undefined } = {}): Promise<OpenTaskDto[]> {
  await personOf(ctx, from);
  const rows = await openRows(ctx, from, opts);
  return rows.map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    workspaceId: t.workspaceId,
    workspaceName: t.project.workspace.name,
    columnName: t.column.name,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    primary: t.assigneeId === from,
  }));
}

async function patchTask(taskId: string, assigneeIds: string[]): Promise<{ ok: boolean; reason: string; requested: boolean }> {
  const req = new Request(`http://bulk.internal/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assigneeIds }),
  });
  const res = await taskRoute.PATCH(req, { params: { id: taskId } });
  const json = (await res.json().catch(() => null)) as { error?: string; message?: string; task?: { assignRequest?: unknown } } | null;
  if (!res.ok) return { ok: false, reason: json?.message ?? json?.error ?? `http_${res.status}`, requested: false };
  return { ok: true, reason: "", requested: json?.task?.assignRequest != null };
}

export async function bulkAssign(ctx: OrgAccessContext, input: z.infer<typeof bulkAssignSchema>): Promise<BulkResult> {
  if (input.to === input.from) throw new ValidationError([{ path: "to", message: "bulk.same_person" }]);
  await personOf(ctx, input.from);
  if (input.to) await personOf(ctx, input.to);
  const rows = await openRows(ctx, input.from, { workspaceId: input.workspaceId, taskIds: input.taskIds });
  const out: BulkResult = { moved: [], requested: [], skipped: [] };
  for (const row of rows) {
    const done = await patchTask(row.id, holdersAfter(row, input.from, input.to));
    if (!done.ok) out.skipped.push({ id: row.id, reason: done.reason });
    else if (done.requested) out.requested.push(row.id);
    else out.moved.push(row.id);
  }
  await audit("task.bulk_assign", {
    actorId: ctx.userId,
    orgId: ctx.orgId,
    target: input.from,
    meta: { to: input.to, moved: out.moved.length, requested: out.requested.length, skipped: out.skipped.length },
  });
  return out;
}
