import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { taskVisibleWhere, type WorkScope } from "@/server/services/team-scope";

/**
 * THE per-space task numbers — ONE function (B4): «كل المساحات» (`/spaces`), the control panel's report «حسب المساحة», the overview's insight about late work,
 * the number beside every space on the drawer and «اليوم» inside «الشركة» all ask it, so a space can never show one number here and another there.
 *
 *  - `open`: not finished, not archived. `overdue`: of those, due before `todayStart` (the START of the company's day: the caller knows the zone).
 *  - `done`: finished since `since` (0 when `since` is not given).
 *  - `scope`: the viewer's own visibility (`taskVisibleWhere`): a task they may not open is in no number. Left out, it is the owner-level aggregate the control
 *    panel has always been (its audience is narrowed by `policy/board.ts`, not here).
 *  - `assigneeId`: only the tasks that person holds (assigned to them, or beside somebody else): «my» numbers of a space.
 * A space with nothing has a row of zeros, so the caller never has to guess.
 */
export interface SpaceFigure {
  open: number;
  overdue: number;
  done: number;
}

export interface SpaceFiguresInput {
  orgId: string;
  spaceIds: readonly string[];
  todayStart: Date;
  since?: Date;
  scope?: WorkScope;
  assigneeId?: string;
}

export async function spaceFigures(input: SpaceFiguresInput): Promise<Map<string, SpaceFigure>> {
  const out = new Map<string, SpaceFigure>(input.spaceIds.map((id) => [id, { open: 0, overdue: 0, done: 0 }] as const));
  if (input.spaceIds.length === 0) return out;
  const AND: Prisma.TaskWhereInput[] = [];
  if (input.scope) AND.push(taskVisibleWhere(input.scope));
  if (input.assigneeId) AND.push({ OR: [{ assigneeId: input.assigneeId }, { coAssignees: { some: { userId: input.assigneeId } } }] });
  const base = { orgId: input.orgId, workspaceId: { in: [...input.spaceIds] }, ...(AND.length ? { AND } : {}) } satisfies Prisma.TaskWhereInput;
  const live = { ...base, archived: false, completedAt: null } satisfies Prisma.TaskWhereInput;
  const count = (where: Prisma.TaskWhereInput) => db.task.groupBy({ by: ["workspaceId"], where, _count: { _all: true } });
  const [open, overdue, done] = await Promise.all([
    count(live),
    count({ ...live, dueDate: { lt: input.todayStart } }),
    input.since ? count({ ...base, completedAt: { gte: input.since } }) : Promise.resolve([] as { workspaceId: string; _count: { _all: number } }[]),
  ]);
  for (const row of open) (out.get(row.workspaceId) as SpaceFigure).open = row._count._all;
  for (const row of overdue) (out.get(row.workspaceId) as SpaceFigure).overdue = row._count._all;
  for (const row of done) (out.get(row.workspaceId) as SpaceFigure).done = row._count._all;
  return out;
}
