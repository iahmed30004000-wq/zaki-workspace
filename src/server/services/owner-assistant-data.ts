import { db } from "@/server/db";
import { dayKeyOf } from "@/lib/owner-board";
import { dayOfInstant } from "@/lib/due-day";
import { zonedDayStart } from "@/lib/zoned-time";
import type { BoardAccess } from "@/server/policy/board";
import { loadOverview, type BoardQuery } from "@/server/services/owner-board";
import type { RawPerson, RawScope, RawSpace, RawTask } from "@/server/ai/redact";

/**
 * «مساعد المالك» — WHAT THE MODEL MAY LEARN FROM, as raw material for `buildContext` (src/server/ai/redact.ts).
 *
 * It is the owner board's own numbers (`loadOverview`: the same definitions, the same window of at most 92 days, the same
 * space filter) plus ONE small list of open tasks. Nothing here reads a message body, a file name, a comment, a CRM row, an
 * e-mail or a phone number: the board counts messages in SQL and this file never asks for more.
 *
 * Tasks that carry a reward (money) are left out entirely: the assistant never sees them and can never propose anything on them.
 * Reading writes nothing (no audit row, no notification, no «seen»), like all owner reading.
 */

const DAY_MS = 86_400_000;
/** Open tasks read before the cut to the 50 that are sent (the list is sorted by urgency in `buildContext`). */
const TASK_READ_LIMIT = 400;
const SPACES_LIMIT = 30;
const PROJECTS_PER_SPACE = 8;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

export async function loadScope(access: BoardAccess, query: BoardQuery, now: Date = new Date()): Promise<RawScope> {
  const overview = await loadOverview(access, query, { now });
  const tz = overview.window.timeZone;
  const today = overview.window.today;
  const todayStart = zonedDayStart(now, tz);
  const spaceId = overview.filters.space;
  const orgId = access.orgId;

  const people: RawPerson[] = overview.people.map((p) => ({
    userId: p.userId,
    name: p.name,
    role: p.role,
    status: p.status,
    completed: p.completed,
    openTasks: p.openTasks,
    overdue: p.overdue,
    withDue: p.withDue,
    onTime: p.onTime,
    late: p.late,
    onTimeRate: p.onTimeRate,
    avgDays: p.avgDays,
    steps: p.steps,
    messages: p.messages,
    lastActiveDay: p.lastActivity ? dayKeyOf(new Date(p.lastActivity), tz) : null,
    perDay: p.spark,
  }));

  // the tasks that may be shown: open, not archived, no reward
  const taskWhere = {
    orgId,
    completedAt: null,
    archived: false,
    OR: [{ rewardStatus: null }, { rewardStatus: { notIn: ["OPEN", "AWARDED"] } }],
    ...(spaceId ? { workspaceId: spaceId } : {}),
  };
  const spaceRows = overview.spaces.filter((s) => !spaceId || s.id === spaceId).slice(0, SPACES_LIMIT);
  const spaceIds = spaceRows.map((s) => s.id);
  const [taskRows, openTotal, perSpace, perSpaceOverdue, projectRows] = await Promise.all([
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.task.findMany({
      where: taskWhere,
      select: { id: true, title: true, assigneeId: true, workspaceId: true, projectId: true, priority: true, dueDate: true, coAssignees: { select: { userId: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: TASK_READ_LIMIT,
    }),
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.task.count({ where: taskWhere }),
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.task.groupBy({ by: ["workspaceId"], where: { ...taskWhere, workspaceId: { in: spaceIds } }, _count: { _all: true } }),
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.task.groupBy({ by: ["workspaceId"], where: { ...taskWhere, workspaceId: { in: spaceIds }, dueDate: { lt: todayStart } }, _count: { _all: true } }),
    spaceIds.length
      ? db.project.findMany({
          where: { workspaceId: { in: spaceIds }, systemKey: null, boards: { some: { archived: false } } },
          select: { id: true, name: true, workspaceId: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string; workspaceId: string }[]),
  ]);

  const tasks: RawTask[] = taskRows.map((t) => {
    const due = t.dueDate ? dayOfInstant(t.dueDate, tz) : null;
    return {
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId,
      coAssigneeIds: t.coAssignees.map((c) => c.userId),
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      priority: t.priority,
      due,
      overdueDays: due && due < today ? dayDiff(today, due) : null,
    };
  });

  const openBy = new Map(perSpace.map((r) => [r.workspaceId, r._count._all]));
  const lateBy = new Map(perSpaceOverdue.map((r) => [r.workspaceId, r._count._all]));
  const spaces: RawSpace[] = spaceRows.map((s) => ({
    id: s.id,
    name: s.name,
    open: openBy.get(s.id) ?? 0,
    overdue: lateBy.get(s.id) ?? 0,
    projects: projectRows.filter((p) => p.workspaceId === s.id).slice(0, PROJECTS_PER_SPACE).map((p) => ({ id: p.id, name: p.name })),
  }));

  const c = overview.cards;
  return {
    window: { from: overview.window.from, to: overview.window.to, today },
    spaceId,
    company: c ? { completed: c.completed, open: c.open, overdue: c.overdue, late: c.late, avgDays: c.avgDays, messages: c.messages, activePeople: c.activePeople, idlePeople: c.idlePeople } : null,
    people,
    spaces,
    tasks,
    openTasksTotal: openTotal,
  };
}
