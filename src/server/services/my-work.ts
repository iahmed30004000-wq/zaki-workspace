import { db } from "@/server/db";
import { loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import {
  countTasksForView,
  dayWindow,
  queryTasksForView,
  sortByCompleted,
  sortByDue,
  sortPinnedFirst,
  type ViewQuery,
  type ViewTask,
} from "@/server/services/views";
import { calendarView } from "@/server/services/calendar";
import { resolveTimeZone } from "@/lib/zoned-time";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { featureOn } from "@/lib/features";
import { dayOfInstant } from "@/lib/due-day";
import { actorCanWork, type Actor } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { stepProgressFor } from "@/server/services/task-steps";
import { recurringTaskIds } from "@/server/services/task-recurrence";
import { myRunningTaskId } from "@/server/services/time-tracking";
import { stageOrDefault } from "@/lib/work/stage";
import {
  ALL_SPACES,
  MY_TASK_CHIPS,
  MY_TASKS_LIMIT,
  sortWorkTasks,
  type WorkTaskPanel,
  type MyTaskChip,
  type MyTasksParams,
  type WorkProjectOption,
  type WorkSpaceOption,
  type WorkTaskDetail,
  type WorkTaskDto,
  type WorkTasksResult,
} from "@/lib/work/my-tasks";

/**
 * The company's zone as the person's My Work page reads it: the first company they are an ACTIVE member
 * of. The page needs it to show and send a due day in the company's calendar (review B5); the tabs
 * themselves are cut per organization, each in its own zone.
 */
export async function myWorkTimeZone(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { timezone: true } } },
  });
  return resolveTimeZone(member?.organization.timezone);
}

/**
 * "My Work": the signed-in user's own tasks, in the workspaces they can open.
 *
 * Rules (the page only renders what this returns):
 *  - today / upcoming / overdue / completed / mine → tasks ASSIGNED to the user
 *  - created                                       → tasks CREATED by the user
 *  - always limited to `accessibleWorkspaceIds` — work in a workspace the user
 *    cannot open never shows, even if it is assigned to / created by them
 *  - `editable` is judged per task's workspace with the same rule as the write routes and the
 *    List/Calendar pages (workspace-role.ts): an org GUEST is read-only everywhere, whatever
 *    their workspace row says, and a workspace GUEST row is read-only too
 */
/** The row as a partner is handed it: without the `reward` key (not even a null). */
function withoutViewReward(task: ViewTask): ViewTask {
  const { reward: _reward, ...rest } = task;
  void _reward;
  return rest;
}

export const MY_WORK_TABS = ["today", "upcoming", "overdue", "completed", "mine", "created"] as const;
export type MyWorkTab = (typeof MY_WORK_TABS)[number];

export interface MyWorkRow {
  task: ViewTask;
  editable: boolean;
}

export type MyWorkData = Record<MyWorkTab, MyWorkRow[]>;

/** Per-tab filters, before the org and the workspace allow-list are applied. */
function tabFilters(userId: string, timeZone: string, now: Date): Record<MyWorkTab, Omit<ViewQuery, "orgId" | "workspaceIds">> {
  // "today" is the company's day (Organization.timezone), not the server's
  const day = dayWindow(now, timeZone);
  const dayAfter = new Date(day.to.getTime() + 1);
  return {
    today: { assigneeId: userId, dueFrom: day.from, dueTo: day.to, openOnly: true },
    upcoming: { assigneeId: userId, dueFrom: dayAfter, openOnly: true },
    // overdue = due before the START of the company's today: a task due earlier today is in "today" only
    overdue: { assigneeId: userId, overdueOnly: true, overdueBefore: day.from },
    completed: { assigneeId: userId, completedOnly: true, limit: 100 },
    mine: { assigneeId: userId, openOnly: true },
    created: { creatorId: userId, openOnly: true },
  };
}

/** Same ordering the page always used: due date (undated last), or latest completion first. */
function sortRows(rows: MyWorkRow[], by: "due" | "completed"): MyWorkRow[] {
  const editableById = new Map(rows.map((r) => [r.task.id, r.editable] as const));
  const tasks = rows.map((r) => r.task);
  // «تثبيت»: a pinned task is first in its tab (only rows the query filled `pinnedAt` for: the switch is on)
  const sorted = sortPinnedFirst(by === "completed" ? sortByCompleted(tasks) : sortByDue(tasks));
  return sorted.map((task) => ({ task, editable: editableById.get(task.id) ?? false }));
}

export async function getMyWork(userId: string, now: Date = new Date(), opts: { spaceId?: string | null } = {}): Promise<MyWorkData> {
  const results = {} as MyWorkData;
  for (const tab of MY_WORK_TABS) results[tab] = [];

  const [memberships, accessible] = await Promise.all([
    // (the organizations' clocks are read after the memberships, below)
    // only organizations where the person is ACTIVE: a suspended or offboarded membership shows nothing
    db.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { organizationId: true, role: true },
    }),
    // inside the space the person is in (the page passes it): that space's tasks only
    loadWorkScope(userId).then((scope) => (opts.spaceId === undefined ? scope : narrowScope(scope, opts.spaceId))),
  ]);
  if (memberships.length === 0 || scopeSpaceIds(accessible).length === 0) return results;
  const visible = taskVisibleWhere(accessible);

  // group the accessible workspaces by organization (every query stays org-scoped)
  const [workspaces, wsRows] = await Promise.all([
    db.workspace.findMany({
      where: { id: { in: scopeSpaceIds(accessible) } },
      select: { id: true, organizationId: true },
    }),
    // the user's own row in each of them (none for a space the org OWNER sees without being put in it)
    db.workspaceMember.findMany({
      where: { userId, workspaceId: { in: scopeSpaceIds(accessible) } },
      select: { workspaceId: true, role: true },
    }),
  ]);
  const wsRoleById = new Map(wsRows.map((r) => [r.workspaceId, r.role] as const));
  const idsByOrg = new Map<string, string[]>();
  for (const ws of workspaces) {
    const list = idsByOrg.get(ws.organizationId) ?? [];
    list.push(ws.id);
    idsByOrg.set(ws.organizationId, list);
  }

  const clocks = await db.organization.findMany({
    where: { id: { in: memberships.map((m) => m.organizationId) } },
    select: { id: true, timezone: true, settings: true },
  });
  const settingsByOrg = new Map(clocks.map((o) => [o.id, o.settings] as const));
  const zoneByOrg = new Map(clocks.map((o) => [o.id, resolveTimeZone(o.timezone)] as const));
  // one batch of tab queries per org, run in parallel but merged in membership order
  const perOrg = await Promise.all(
    memberships.map(async (m) => {
      const workspaceIds = idsByOrg.get(m.organizationId);
      if (!workspaceIds || workspaceIds.length === 0) return [];
      const filters = tabFilters(userId, zoneByOrg.get(m.organizationId) ?? resolveTimeZone(null), now);
      // «مهمة بمكافأة» / «تثبيت»: while the company's switch is on; a partner is never given a reward
      const lensOn = featureOn(settingsByOrg.get(m.organizationId), "taskRewards") && m.role !== "GUEST";
      return Promise.all(
        MY_WORK_TABS.map(async (tab) => {
          const found = await queryTasksForView({
            ...filters[tab],
            orgId: m.organizationId,
            workspaceIds,
            visible,
            pinnedFirst: lensOn,
            rewards: lensOn,
          });
          return {
            tab,
            rows: found.map(
              (task): MyWorkRow => ({
                // a row of a space where their own row says GUEST is a partner's row there: no reward field on it at all
                task: wsRoleById.get(task.workspaceId) === "GUEST" ? withoutViewReward(task) : task,
                editable: canWriteInWorkspace(m.role, wsRoleById.get(task.workspaceId)),
              }),
            ),
          };
        }),
      );
    }),
  );
  for (const batch of perOrg) {
    for (const { tab, rows } of batch) results[tab].push(...rows);
  }

  for (const tab of MY_WORK_TABS) {
    results[tab] = sortRows(results[tab], tab === "completed" ? "completed" : "due");
  }
  return results;
}

// ───────────────────────────────────────── W1.1: the unified «مهامي» ─────────────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;
/** The board's done column shows what was finished in this many days, not every task ever finished. */
const BOARD_DONE_DAYS = 14;

/** What a chip (or no chip) asks of the query, cut on the company's day. `view` decides the open/done shape of «no chip». */
function chipQuery(chip: MyTaskChip | null, view: MyTasksParams["view"], userId: string, day: { from: Date; to: Date }, now: Date): Partial<ViewQuery> {
  switch (chip) {
    case "today":
      return { dueFrom: day.from, dueTo: day.to, openOnly: true };
    case "overdue":
      return { overdueOnly: true, overdueBefore: day.from };
    case "week":
      return { dueFrom: day.from, dueTo: new Date(day.to.getTime() + 6 * DAY_MS), openOnly: true };
    case "nodate":
      return { undated: true, openOnly: true };
    case "done":
      return { completedOnly: true };
    case "created":
      return { creatorId: userId, openOnly: true };
    default:
      // a board keeps its «منجزة» column alive with what was finished lately; a list is open work
      return view === "board" ? { openOrCompletedSince: new Date(now.getTime() - BOARD_DONE_DAYS * DAY_MS) } : { openOnly: true };
  }
}

const withoutReward = (task: ViewTask): ViewTask => {
  const { reward: _reward, ...rest } = task;
  void _reward;
  return rest;
};

export interface WorkTasksOptions {
  /** The moment the person asks at (tests pin it). */
  now?: Date;
  /** The space the person is in (the cookie, already checked): scope «المساحة» is this one. Null: none. */
  current?: { id: string; kind: string } | null;
}

const emptyCounts = (): Record<MyTaskChip, number> => Object.fromEntries(MY_TASK_CHIPS.map((c) => [c, 0])) as Record<MyTaskChip, number>;

/**
 * W1.1 — everything the unified «مهامي» screen draws: the person's tasks (scope «أنا»: assigned to them or shared with them) in the space they are in —
 * B4, each space is its own account: inside «الشركة» in all of their ACTIVE spaces, and «كل مساحاتي» (`space=all`) is an explicit choice, as is any
 * other space of theirs — or the current space (scope «المساحة»), or one project (scope «مشروع»), narrowed by a chip, a stage and a text, ordered, plus the
 * chip counts and the pickers. EVERY read goes through `taskVisibleWhere`: a private task the person is no part of is not listed, not counted,
 * not found by the search.
 *
 * Scope «المساحة» inside «الشركة» (it holds no projects, D-N3) is not a thing: the screen shows «أنا» there (`scopeFellBack`).
 */
export async function getWorkTasks(userId: string, params: MyTasksParams, opts: WorkTasksOptions = {}): Promise<WorkTasksResult> {
  const now = opts.now ?? new Date();
  const hq = opts.current?.kind === "HQ";
  const result = (over: Partial<WorkTasksResult>): WorkTasksResult => ({
    params,
    tasks: [],
    truncated: false,
    counts: emptyCounts(),
    spaces: [],
    projects: [],
    current: { id: opts.current?.id ?? null, hq },
    space: { id: null, name: null },
    scopeFellBack: false,
    timeZone: resolveTimeZone(null),
    todayIso: dayOfInstant(now, resolveTimeZone(null)),
    month: null,
    canAdd: false,
    ...over,
  });

  const [memberships, scope] = await Promise.all([
    db.organizationMember.findMany({ where: { userId, status: "ACTIVE" }, select: { organizationId: true, role: true } }),
    loadWorkScope(userId),
  ]);
  const accessible = scopeSpaceIds(scope);
  if (memberships.length === 0 || accessible.length === 0) return result({});
  const visible = taskVisibleWhere(scope);

  const [workspaces, wsRows, orgs] = await Promise.all([
    // the person's ACTIVE spaces: an archived space is off every list
    db.workspace.findMany({
      where: { id: { in: accessible }, archivedAt: null },
      select: { id: true, name: true, kind: true, organizationId: true },
      orderBy: [{ position: "asc" }, { name: "asc" }, { id: "asc" }],
    }),
    db.workspaceMember.findMany({ where: { userId, workspaceId: { in: accessible } }, select: { workspaceId: true, role: true } }),
    db.organization.findMany({ where: { id: { in: memberships.map((m) => m.organizationId) } }, select: { id: true, timezone: true, settings: true } }),
  ]);
  const wsById = new Map(workspaces.map((w) => [w.id, w] as const));
  const wsRoleById = new Map(wsRows.map((r) => [r.workspaceId, r.role] as const));
  const orgById = new Map(orgs.map((o) => [o.id, o] as const));
  const roleOfOrg = new Map(memberships.map((m) => [m.organizationId, m.role] as const));
  const workSpaces = workspaces.filter((w) => w.kind !== "HQ");
  const spaces: WorkSpaceOption[] = workSpaces.map((w) => ({ id: w.id, name: w.name, kind: w.kind }));
  const cur = opts.current && wsById.has(opts.current.id) ? opts.current : null;
  // B4 — each space is its own account: the space the person is in, when it is a work space («الشركة» is the view over all of them)
  const curWork = cur && wsById.get(cur.id)!.kind !== "HQ" ? cur.id : null;

  // the project picker: the projects the person may see (the team rule) in the space they are in (in «الشركة»: in all of their spaces)
  const visibleProjects = { AND: [projectVisibleWhere(scope), { workspaceId: { in: workSpaces.map((w) => w.id) } }] };
  const projectRows = await db.project.findMany({
    where: { AND: [visibleProjects, { workspaceId: { in: curWork ? [curWork] : workSpaces.map((w) => w.id) } }] },
    select: { id: true, name: true, workspaceId: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
  const projects: WorkProjectOption[] = projectRows.map((p) => ({ id: p.id, name: p.name, workspaceId: p.workspaceId, spaceName: wsById.get(p.workspaceId)?.name ?? "" }));

  // the scope after the fallbacks
  let scopeKind = params.scope;
  let scopeFellBack = false;
  if (scopeKind === "space" && (!cur || cur.kind === "HQ")) {
    scopeKind = "me";
    scopeFellBack = true;
  }
  const effective: MyTasksParams = { ...params, scope: scopeKind };
  // scope «أنا»: «كل مساحاتي» when asked for; a space of the person's when named; else the space they are in (inside «الشركة»: all of them)
  const named = params.spaceId && params.spaceId !== ALL_SPACES && wsById.has(params.spaceId) && wsById.get(params.spaceId)!.kind !== "HQ" ? params.spaceId : null;
  const pickedSpace = params.spaceId === ALL_SPACES ? null : (named ?? curWork);
  // a project asked for by its own address (the project's page, whose banner offers «انتقل لها» when it is another space's) still opens; only the picker is the space's
  const project =
    scopeKind === "project" && params.projectId
      ? (projectRows.find((p) => p.id === params.projectId) ??
        (await db.project.findFirst({ where: { AND: [visibleProjects, { id: params.projectId }] }, select: { id: true, name: true, workspaceId: true } })))
      : null;

  // which (company, spaces, scope) batches to read
  type Batch = { orgId: string; workspaceIds: string[]; scope: NonNullable<ViewQuery["scope"]> };
  const batches: Batch[] = [];
  const idsByOrg = new Map<string, string[]>();
  for (const w of workspaces) idsByOrg.set(w.organizationId, [...(idsByOrg.get(w.organizationId) ?? []), w.id]);
  if (scopeKind === "space" && cur) {
    batches.push({ orgId: wsById.get(cur.id)!.organizationId, workspaceIds: [cur.id], scope: { kind: "space", spaceId: cur.id } });
  } else if (scopeKind === "project") {
    if (project) batches.push({ orgId: wsById.get(project.workspaceId)!.organizationId, workspaceIds: [project.workspaceId], scope: { kind: "project", projectId: project.id } });
  } else {
    for (const [orgId, ids] of idsByOrg) {
      const inThis = pickedSpace ? ids.filter((id) => id === pickedSpace) : ids;
      if (inThis.length) batches.push({ orgId, workspaceIds: inThis, scope: { kind: "me", userId, ...(pickedSpace ? { spaceId: pickedSpace } : {}) } });
    }
  }

  const calendar = params.view === "calendar";
  // the calendar has no chips: whatever chip the address carries is not applied there (a person could not turn it off)
  const chip = calendar ? null : params.chip;
  const zoneOf = (orgId: string) => resolveTimeZone(orgById.get(orgId)?.timezone);
  const firstOrg = batches[0]?.orgId ?? memberships[0]!.organizationId;
  const timeZone = zoneOf(firstOrg);
  const cal = calendarView({ now, timeZone, month: params.month ?? undefined });
  // «أنشأتها» is about who MADE the task: the «أنا» assignee filter gives way to it
  const scopedBy = (b: Batch, chip: MyTaskChip | null): Partial<ViewQuery> => (chip === "created" && b.scope.kind === "me" ? { creatorId: userId } : { scope: b.scope });

  const found = await Promise.all(
    batches.map(async (b) => {
      const zone = zoneOf(b.orgId);
      const day = dayWindow(now, zone);
      const lensOn = featureOn(orgById.get(b.orgId)?.settings, "taskRewards") && roleOfOrg.get(b.orgId) !== "GUEST";
      const shape: Partial<ViewQuery> = calendar
        ? { dueFrom: cal.win.from, dueTo: cal.win.to, openOnly: true }
        : chipQuery(chip, params.view, userId, day, now);
      const rows = await queryTasksForView({
        orgId: b.orgId,
        workspaceIds: b.workspaceIds,
        visible,
        ...scopedBy(b, chip),
        ...shape,
        ...(params.stage ? { stage: params.stage } : {}),
        ...(params.q ? { search: params.q } : {}),
        limit: MY_TASKS_LIMIT,
        pinnedFirst: lensOn,
        rewards: lensOn,
      });
      return { b, zone, rows };
    }),
  );

  const tasks: WorkTaskDto[] = [];
  let truncated = false;
  for (const { b, zone, rows } of found) {
    if (rows.length >= MY_TASKS_LIMIT) truncated = true;
    for (const raw of rows) {
      const task = wsRoleById.get(raw.workspaceId) === "GUEST" ? withoutReward(raw) : raw;
      tasks.push({
        id: task.id,
        key: task.key,
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate?.toISOString() ?? null,
        dueDay: task.dueDate ? dayOfInstant(task.dueDate, zone) : null,
        completedAt: task.completedAt?.toISOString() ?? null,
        columnId: task.columnId,
        columnName: task.columnName,
        columnStage: task.columnStage,
        columnDone: task.columnDone,
        workspaceId: task.workspaceId,
        spaceName: wsById.get(task.workspaceId)?.name ?? "",
        projectId: task.projectId,
        projectName: task.projectName,
        assigneeId: task.assigneeId,
        assigneeName: task.assigneeName,
        assigneeIds: task.assigneeIds,
        assigneeNames: task.assigneeNames,
        creatorId: task.creatorId,
        visibility: task.visibility,
        updatedAt: task.updatedAt.toISOString(),
        editable: canWriteInWorkspace(roleOfOrg.get(b.orgId), wsRoleById.get(task.workspaceId)),
        ...(task.pinnedAt !== undefined ? { pinnedAt: task.pinnedAt?.toISOString() ?? null } : {}),
        ...(task.reward !== undefined ? { reward: task.reward } : {}),
      });
    }
  }

  // «تثبيت»: a pinned task leads its list (the newest pin first), then the chosen order
  const ordered = sortWorkTasks(tasks, params.sort, chip);
  const pinned = ordered.filter((t) => t.pinnedAt).sort((a, b) => Date.parse(b.pinnedAt!) - Date.parse(a.pinnedAt!));
  const listed = pinned.length ? [...pinned, ...ordered.filter((t) => !t.pinnedAt)] : ordered;

  // the chips' numbers: the same query as each chip's list, counted (never a number a person cannot reach by pressing the chip)
  const counts = emptyCounts();
  if (!calendar) {
    await Promise.all(
      batches.flatMap((b) =>
        MY_TASK_CHIPS.map(async (chip) => {
          const day = dayWindow(now, zoneOf(b.orgId));
          counts[chip] += await countTasksForView({
            orgId: b.orgId,
            workspaceIds: b.workspaceIds,
            visible,
            ...scopedBy(b, chip),
            ...chipQuery(chip, "list", userId, day, now),
            ...(params.stage ? { stage: params.stage } : {}),
          });
        }),
      ),
    );
  }

  // the space this list is cut for (for the heading and the select): «المساحة» is the current one, «مشروع» that project's, «أنا» the picked one or all
  const cutSpaceId = scopeKind === "space" ? (cur?.id ?? null) : scopeKind === "project" ? (project?.workspaceId ?? null) : pickedSpace;

  return result({
    params: effective,
    tasks: listed,
    truncated,
    counts,
    spaces,
    projects,
    space: { id: cutSpaceId, name: cutSpaceId ? (wsById.get(cutSpaceId)?.name ?? null) : null },
    current: { id: cur?.id ?? null, hq, name: cur ? (wsById.get(cur.id)?.name ?? null) : null },
    scopeFellBack,
    timeZone,
    todayIso: cal.todayIso,
    month: calendar ? cal.month : null,
    canAdd: memberships.some((m) => m.role !== "GUEST"),
  });
}

/**
 * What the screen (the page and `GET /api/work/tasks`) is given: `getWorkTasks` for the space the person is in, plus what a row shows beside the
 * task — «٣ من ٥» (only while the company's «الخطوات» switch is on), «متكررة», «الوقت شغّال» — and whether the person may add a task here at all.
 */
export async function workScreenFor(actor: Actor, params: MyTasksParams, now: Date = new Date()): Promise<WorkTasksResult> {
  const space = await currentSpace(actor);
  const base = await getWorkTasks(actor.userId, params, { now, current: space ? { id: space.id, kind: space.kind } : null });
  const ids = base.tasks.map((t) => t.id);
  const [stepsOn, recurringOn, runningId] = await Promise.all([actorFeatureOn(actor, "taskSteps"), actorFeatureOn(actor, "recurringTasks"), myRunningTaskId(actor)]);
  const [steps, recurring] = await Promise.all([stepsOn ? stepProgressFor(ids) : Promise.resolve(new Map<string, { done: number; total: number }>()), recurringOn ? recurringTaskIds(ids) : Promise.resolve(new Set<string>())]);
  return {
    ...base,
    tasks: base.tasks.map((t) => ({
      ...t,
      ...(steps.get(t.id) ? { steps: steps.get(t.id)! } : {}),
      ...(recurring.has(t.id) ? { recurring: true } : {}),
      ...(runningId === t.id ? { running: true } : {}),
    })),
    canAdd: base.canAdd && !actor.isExternal && actorCanWork(actor, "tasks.edit"),
  };
}

/** One task for the side panel. A task the person may not see is `null` (the route answers 404: its existence is private too). */
export async function getWorkTaskDetail(userId: string, taskId: string): Promise<WorkTaskDetail | null> {
  const scope = await loadWorkScope(userId);
  // the rule of every door: the space, the team and the participants rule
  const row = await db.task.findFirst({
    where: { id: taskId, archived: false, AND: [taskVisibleWhere(scope)] },
    include: {
      organization: { select: { keyPrefix: true, timezone: true } },
      project: { select: { id: true, name: true } },
      column: { select: { id: true, name: true, done: true, stage: true, board: { select: { name: true } } } },
      assignee: { select: { id: true, name: true } },
      coAssignees: { select: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      creator: { select: { name: true } },
      _count: { select: { comments: true } },
    },
  });
  if (!row) return null;
  const [member, spaceRow, space] = await Promise.all([
    db.organizationMember.findFirst({ where: { userId, organizationId: row.orgId, status: "ACTIVE" }, select: { role: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: row.workspaceId, userId } }, select: { role: true } }),
    db.workspace.findUnique({ where: { id: row.workspaceId }, select: { name: true } }),
  ]);
  const zone = resolveTimeZone(row.organization.timezone);
  const co = row.coAssignees.map((r) => r.user);
  return {
    task: {
      id: row.id,
      key: `${row.organization.keyPrefix}-${row.number}`,
      title: row.title,
      priority: row.priority,
      dueDate: row.dueDate?.toISOString() ?? null,
      dueDay: row.dueDate ? dayOfInstant(row.dueDate, zone) : null,
      completedAt: row.completedAt?.toISOString() ?? null,
      columnId: row.column.id,
      columnName: row.column.name,
      columnStage: stageOrDefault(row.column.stage),
      columnDone: row.column.done,
      workspaceId: row.workspaceId,
      spaceName: space?.name ?? "",
      projectId: row.project.id,
      projectName: row.project.name,
      assigneeId: row.assigneeId,
      assigneeName: row.assignee?.name ?? null,
      assigneeIds: [...(row.assignee ? [row.assignee.id] : []), ...co.map((u) => u.id)],
      assigneeNames: [...(row.assignee ? [row.assignee.name] : []), ...co.map((u) => u.name)],
      creatorId: row.creatorId,
      visibility: row.visibility,
      updatedAt: row.updatedAt.toISOString(),
      editable: member ? canWriteInWorkspace(member.role, spaceRow?.role) : false,
    },
    description: row.description,
    creatorName: row.creator.name,
    boardName: row.column.board.name,
    createdAt: row.createdAt.toISOString(),
    commentCount: row._count.comments,
  };
}

/**
 * B4 — what the side panel opens for a task: the task itself when it lives in the space the person is in (inside «الشركة», the view over all of them,
 * every task of theirs opens), and for a task of ANOTHER space only where it lives (`foreign`, no title, no people), so the panel says «هاد من مساحة «X»»
 * with «انتقل لها» — each space is its own account, nothing opens silently across them. A task the person may not see is `null` (404), as before.
 */
export async function workTaskPanelFor(userId: string, taskId: string, current: { id: string; kind: string } | null): Promise<WorkTaskPanel | null> {
  const detail = await getWorkTaskDetail(userId, taskId);
  if (!detail) return null;
  if (current && current.kind !== "HQ" && detail.task.workspaceId !== current.id) {
    return { foreign: { taskId, spaceId: detail.task.workspaceId, spaceName: detail.task.spaceName } };
  }
  return detail;
}
