import { notLateWhere, overdueDueFilter } from "@/lib/due-day";
import type { Prisma } from "@prisma/client";
import { projectVisibleWhere, taskVisibleWhere, type WorkScope } from "@/server/services/team-scope";
import { db } from "@/server/db";
import { resolveTimeZone, zonedDayStart } from "@/lib/zoned-time";

/**
 * Numbers behind the analytics page.
 *
 * Everything is bound to ONE organization (`orgId`) and to the workspaces the
 * caller can open (`wsIds`, from `accessibleWorkspaceIds`):
 *  - tasks / projects / workspace count → `wsIds` ∩ the org's own workspaces
 *    (an empty list counts nothing — it is never "no filter")
 *  - ideas → the org's ideas. They belong to the organization itself, not to a
 *    workspace, and every member can read them, so no workspace limit applies.
 *  - the per-person workload counts ACTIVE people only: the open tasks of somebody who is suspended
 *    or offboarded stay in every total, but they are not a bar of their own.
 *  - "overdue" is due before the START of the company's today (Organization.timezone), the same line as My Work
 *    and the Today page: a task due today at 09:00 is not overdue at 15:00, it is due within the coming week.
 * Nothing is ever counted across organizations.
 */
export async function loadAnalytics(orgId: string, wsIds: string[], now: Date = new Date(), teams?: WorkScope, ideasWhere: Prisma.IdeaWhereInput = {}) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const zone = resolveTimeZone(org?.timezone);
  const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const in7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  // `teams`: inside a space with teams, only the space's own work and the caller's teams' are counted
  const scope: Prisma.TaskWhereInput = { archived: false, orgId, workspaceId: { in: wsIds }, ...(teams ? { AND: [taskVisibleWhere(teams)] } : {}) };
  const [total, open, completed, overdue, created30, completed30, upcoming7, byPriority, byStatus30, assignees, ideas, workspaces, projects] =
    await Promise.all([
      db.task.count({ where: scope }),
      db.task.count({ where: { ...scope, completedAt: null } }),
      db.task.count({ where: { ...scope, completedAt: { not: null } } }),
      db.task.count({ where: { ...scope, completedAt: null, dueDate: overdueDueFilter(now, zone) } }),
      db.task.count({ where: { ...scope, createdAt: { gte: since30 } } }),
      db.task.count({ where: { ...scope, completedAt: { gte: since30 } } }),
      db.task.count({ where: { AND: [scope, notLateWhere(now, zone), { completedAt: null, dueDate: { lte: in7 } }] } }),
      db.task.groupBy({ by: ["priority"], where: { ...scope, completedAt: null }, _count: { _all: true } }),
      db.idea.groupBy({ by: ["status"], where: { orgId, ...ideasWhere }, _count: { _all: true } }),
      db.task.groupBy({
        by: ["assigneeId"],
        where: {
          ...scope,
          completedAt: null,
          assigneeId: { not: null },
          assignee: { memberships: { some: { organizationId: orgId, status: "ACTIVE" } } },
        },
        _count: { _all: true },
        orderBy: { _count: { assigneeId: "desc" } },
        take: 8,
      }),
      db.idea.count({ where: { orgId, ...ideasWhere } }),
      db.workspace.count({ where: { organizationId: orgId, id: { in: wsIds } } }),
      db.project.count({ where: { workspaceId: { in: wsIds }, workspace: { organizationId: orgId }, ...(teams ? { AND: [projectVisibleWhere(teams)] } : {}) } }),
    ]);
  const nameOf = new Map(
    assignees.length
      ? (await db.user.findMany({ where: { id: { in: assignees.map((a) => a.assigneeId!) } }, select: { id: true, name: true } })).map(
          (u) => [u.id, u.name] as const,
        )
      : [],
  );
  return { total, open, completed, overdue, created30, completed30, upcoming7, byPriority, byStatus30, assignees, ideas, workspaces, projects, nameOf };
}

export type Analytics = Awaited<ReturnType<typeof loadAnalytics>>;
