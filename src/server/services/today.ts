import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { actorCan, actorCanWork, type Actor } from "@/server/policy/actor";
import { loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, taskParticipantWhere, taskVisibleWhere } from "@/server/services/team-scope";
import { assignedTo } from "@/server/services/tasks";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { fmtLongDate, fmtRelative } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import {
  TODAY_LIMITS,
  firstNameOf,
  greetingPeriod,
  type PulseTask,
  type QuickAddTarget,
  type TodayData,
  type TodayProject,
  type TodayPulse,
  type TodayQuickAddData,
  type TodayTask,
  type TodayTasks,
} from "@/lib/today";
import {
  nextZonedDayStart,
  resolveTimeZone,
  zonedDayStart,
  zonedParts,
  zonedStandIn,
  zonedWallTime,
} from "@/lib/zoned-time";

/**
 * «اليوم» — everything the Today page shows, in one call (`getToday(actor)`), so the page decides nothing.
 *
 * The rules, each of them proved in tests/db/today-service.test.ts with real rows:
 *
 *  - SCOPE. Only the spaces the person can open (`accessibleWorkspaceIds`: the OWNER every space of the company,
 *    everybody else - an ADMIN included - only the spaces they were put in), only inside the organization they
 *    work in now (a person in two companies gets one, never a mix), only tasks that are theirs, open and not
 *    archived. A task in a space they cannot open does not appear, even when it is assigned to them.
 *  - THE COMPANY'S DAY. "Today" starts and ends at the company's midnight (`Organization.timezone`, default
 *    Asia/Damascus), not the server's: overdue is "due before today", today is "due within today", later is
 *    everything after and everything with no date. Every due day is said in that zone too («أمس» «بكرا» ...).
 *  - AN EXTERNAL PARTNER gets their own tasks (to read: they may not finish anything) and the projects they have
 *    work in, with their own open tasks counted. No company numbers, no pulse, no quick add.
 *  - THE PULSE («نبض الفريق») is for the OWNER and whoever holds users.manage, once they can open a space: the
 *    company-wide open and overdue counts over the spaces they can open, and the most overdue tasks with who
 *    holds them. Like the reports, the
 *    counts keep the work of people who are no longer active (the work is still there); the LIST never shows
 *    them, nor any task nobody holds: a suspended or offboarded person is not named on the page.
 *  - ONE SPACE. The page passes the space the person is in (src/server/services/current-space.ts): everything
 *    above is then counted inside that space only, like a separate site (the owner's decision, 2026-10-25).
 *  - The result is plain data (strings, numbers, booleans, lists): see src/lib/today.ts.
 */

/** Projects that are still going: not on hold, not finished, not archived. */
const LIVE_PROJECT_STATUSES = ["ACTIVE", "PLANNING", "AT_RISK"] as const;
/** Projects a task can no longer be added to. */
const CLOSED_PROJECT_STATUSES = ["COMPLETED", "ARCHIVED"] as const;

const TASK_SELECT = {
  id: true,
  title: true,
  priority: true,
  dueDate: true,
  workspaceId: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

/** Earliest due first (the ones without a date last), then the most urgent, then a stable order. */
const BY_DUE = [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "asc" }, { id: "asc" }] satisfies Prisma.TaskOrderByWithRelationInput[];

type TaskRow = {
  id: string;
  title: string;
  priority: TodayTask["priority"];
  dueDate: Date | null;
  workspaceId: string;
  project: { id: string; name: string };
};

export async function getToday(actor: Actor, opts: { now?: Date; spaceId?: string | null } = {}): Promise<TodayData> {
  const now = opts.now ?? new Date();

  const [org, me, accessible] = await Promise.all([
    db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }),
    db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
    loadWorkScope(actor.userId),
  ]);
  // the space the person is in (the page passes it): its «اليوم» only, like a separate site
  const scope = opts.spaceId === undefined ? accessible : narrowScope(accessible, opts.spaceId);

  // the company's clock
  const timeZone = resolveTimeZone(org?.timezone);
  const clock = zonedParts(now, timeZone);
  const todayStart = zonedDayStart(now, timeZone);
  const tomorrowStart = nextZonedDayStart(now, timeZone);
  const standInNow = zonedStandIn(now, timeZone);
  const dueLabel = (due: Date | null): string => (due ? fmtRelative(zonedStandIn(due, timeZone), standInNow) : "");

  // the spaces of THIS company that the person can open, and the ones where they may change things
  // (their own row in a space says what they are there; the owner has none and may change everything)
  const [spaces, rows] = scopeSpaceIds(scope).length
    ? await Promise.all([
        db.workspace.findMany({
          where: { id: { in: scopeSpaceIds(scope) }, organizationId: actor.orgId },
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        db.workspaceMember.findMany({
          where: { userId: actor.userId, workspaceId: { in: scopeSpaceIds(scope) } },
          select: { workspaceId: true, role: true },
        }),
      ])
    : [[], []];
  const spaceIds = spaces.map((s) => s.id);
  const rowRole = new Map(rows.map((r) => [r.workspaceId, r.role] as const));
  const writable = spaces.filter((s) => canWriteInWorkspace(actor.role, rowRole.get(s.id)));
  const writableIds = new Set(writable.map((s) => s.id));

  const toTask = (row: TaskRow): TodayTask => ({
    id: row.id,
    title: row.title,
    projectId: row.project.id,
    projectName: row.project.name,
    priority: row.priority,
    priorityLabel: enumLabel("TaskPriority", row.priority),
    dueLabel: dueLabel(row.dueDate),
    editable: writableIds.has(row.workspaceId),
  });

  // every query below carries the company and the allow-list of spaces; an empty list matches nothing
  // and inside a space with teams, only the space's own work and the person's teams' (a manager sees all)
  // the section grid: without the tasks / projects «يشوف» box nothing of them is listed here (an empty list matches nothing)
  const taskSpaces = actorCanWork(actor, "tasks.view") ? spaceIds : [];
  const projectSpaces = actorCanWork(actor, "projects.view") ? spaceIds : [];
  const open = {
    orgId: actor.orgId,
    workspaceId: { in: taskSpaces },
    archived: false,
    completedAt: null,
    AND: [taskVisibleWhere(scope)],
  } satisfies Prisma.TaskWhereInput;
  // «لمين» with more than one person: a task handed to a second person is theirs too, so `assignedTo` is the
  // whole rule (the primary column and the extra names), never a bare `assigneeId` comparison.
  const mine = {
    ...open,
    AND: [taskVisibleWhere(scope), assignedTo(actor.userId)],
  } satisfies Prisma.TaskWhereInput;
  const overdueWhere = { ...mine, dueDate: { lt: todayStart } } satisfies Prisma.TaskWhereInput;
  const todayWhere = { ...mine, dueDate: { gte: todayStart, lt: tomorrowStart } } satisfies Prisma.TaskWhereInput;
  const laterWhere = { ...mine, OR: [{ dueDate: null }, { dueDate: { gte: tomorrowStart } }] } satisfies Prisma.TaskWhereInput;

  // ---------- the person's own tasks, in three groups ----------

  async function loadTasks(): Promise<TodayTasks> {
    const [overdue, today, later, nOverdue, nToday, nLater, nDoneToday] = await Promise.all([
      db.task.findMany({ where: overdueWhere, orderBy: BY_DUE, take: TODAY_LIMITS.overdue, select: TASK_SELECT }),
      db.task.findMany({ where: todayWhere, orderBy: BY_DUE, take: TODAY_LIMITS.today, select: TASK_SELECT }),
      db.task.findMany({ where: laterWhere, orderBy: BY_DUE, take: TODAY_LIMITS.later, select: TASK_SELECT }),
      db.task.count({ where: overdueWhere }),
      db.task.count({ where: todayWhere }),
      db.task.count({ where: laterWhere }),
      // finished today, by the clock of the company (not the server's)
      db.task.count({ where: { ...mine, completedAt: { gte: todayStart, lt: tomorrowStart } } }),
    ]);
    return {
      overdue: overdue.map(toTask),
      today: today.map(toTask),
      later: later.map(toTask),
      counts: { open: nOverdue + nToday + nLater, overdue: nOverdue, today: nToday, later: nLater, doneToday: nDoneToday },
    };
  }

  // ---------- the active projects ----------

  async function loadProjects(): Promise<TodayProject[]> {
    // a partner's own tasks are the only thing of a project that is theirs to see counted (the primary
    // person and the ones beside them, the same rule as `mine`)
    // and never a private task of somebody else (P0 review)
    const counted = actor.isExternal
      ? { archived: false, completedAt: null, ...assignedTo(actor.userId), AND: [taskParticipantWhere(scope)] }
      : { archived: false, completedAt: null, AND: [taskParticipantWhere(scope)] };
    const found = await db.project.findMany({
      where: {
        workspaceId: { in: projectSpaces },
        AND: [projectVisibleWhere(scope)],
        status: { in: [...LIVE_PROJECT_STATUSES] },
        ...(actor.isExternal ? { tasks: { some: counted } } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: TODAY_LIMITS.projects,
      select: { id: true, name: true, status: true, _count: { select: { tasks: { where: counted } } } },
    });
    return found.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      statusLabel: enumLabel("ProjectStatus", p.status),
      openTasks: p._count.tasks,
    }));
  }

  // ---------- «نبض الفريق» ----------

  async function loadPulse(): Promise<TodayPulse> {
    const [openCount, overdueCount, worst] = await Promise.all([
      db.task.count({ where: open }),
      db.task.count({ where: { ...open, dueDate: { lt: todayStart } } }),
      db.task.findMany({
        where: {
          ...open,
          dueDate: { lt: todayStart },
          // somebody who still works here: a suspended or offboarded person is not named, and neither is a task nobody holds
          assignee: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } },
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: TODAY_LIMITS.pulse,
        select: { id: true, title: true, dueDate: true, project: { select: { name: true } }, assignee: { select: { name: true } } },
      }),
    ]);
    return {
      open: openCount,
      overdue: overdueCount,
      worst: worst.map(
        (row): PulseTask => ({
          id: row.id,
          title: row.title,
          projectName: row.project.name,
          assigneeName: row.assignee?.name ?? "",
          dueLabel: dueLabel(row.dueDate),
        }),
      ),
    };
  }

  // ---------- «إضافة سريعة» ----------

  async function loadQuickAdd(): Promise<TodayQuickAddData> {
    const spaceName = new Map(writable.map((s) => [s.id, s.name] as const));
    // a task needs a board with a column to land in: a project without one cannot take it from here
    const usableBoard = { archived: false, columns: { some: {} } } satisfies Prisma.BoardWhereInput;
    const found = await db.project.findMany({
      where: {
        // the quick add makes a task: it takes the tasks «يضيف ويعدّل» box
        workspaceId: { in: actorCanWork(actor, "tasks.edit") ? writable.map((s) => s.id) : [] },
        AND: [projectVisibleWhere(scope)],
        status: { notIn: [...CLOSED_PROJECT_STATUSES] },
        boards: { some: usableBoard },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: TODAY_LIMITS.quickTargets,
      select: {
        id: true,
        name: true,
        workspaceId: true,
        boards: { where: usableBoard, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { id: true } },
      },
    });
    const targets: QuickAddTarget[] = [];
    for (const p of found) {
      const board = p.boards[0];
      if (board) {
        targets.push({ projectId: p.id, projectName: p.name, workspaceId: p.workspaceId, workspaceName: spaceName.get(p.workspaceId) ?? "", boardId: board.id });
      }
    }
    // "today" and "tomorrow" for the form, as noon of the company's day: no clock maths in the browser
    const noon = (dayOffset: number): string => zonedWallTime({ year: clock.year, month: clock.month, day: clock.day + dayOffset, hour: 12 }, timeZone).toISOString();
    return { assigneeId: actor.userId, targets, dueToday: noon(0), dueTomorrow: noon(1) };
  }

  // ---------- put together ----------

  const hasSpaces = spaceIds.length > 0;
  const showPulse = !actor.isExternal && (actor.isOwner || actorCan(actor, "users.manage"));
  const showQuickAdd = !actor.isExternal && writable.length > 0;
  const noTasks: TodayTasks = { overdue: [], today: [], later: [], counts: { open: 0, overdue: 0, today: 0, later: 0, doneToday: 0 } };

  // nothing is read for a person who can open no space, and a pulse of no space is no pulse
  const [tasks, projects, pulse, quickAdd] = await Promise.all([
    hasSpaces ? loadTasks() : Promise.resolve(noTasks),
    hasSpaces ? loadProjects() : Promise.resolve<TodayProject[]>([]),
    showPulse && hasSpaces ? loadPulse() : Promise.resolve(null),
    showQuickAdd ? loadQuickAdd() : Promise.resolve(null),
  ]);

  return {
    timeZone,
    greeting: { period: greetingPeriod(clock.hour), firstName: firstNameOf(me?.name ?? ""), hour: clock.hour },
    dateLabel: fmtLongDate(standInNow),
    hasSpaces,
    canCreateSpaces: !actor.isExternal && actorCan(actor, "spaces.create"),
    isExternal: actor.isExternal,
    tasks,
    projects,
    pulse,
    quickAdd,
  };
}
