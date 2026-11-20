import { Prisma, type TaskPriority } from "@prisma/client";
import { db } from "@/server/db";
import { TASK_INCLUDE } from "@/server/services/tasks";
import { loadWorkScope, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { canWriteInWorkspace, workspaceRoleOf } from "@/server/workspace-role";
import { orgDayStart } from "@/server/services/org-day";
import { arabicSearch } from "@/lib/search/arabic";
import { rankedSearch, sqlIn } from "@/server/search/ranked";
import { listBadgeStatus } from "@/lib/rewards";
import { stageOrDefault, type WorkStage } from "@/lib/work/stage";

// ---------- workspace access resolution for RSC pages ----------

import { pageUser } from "@/server/auth";
import { log } from "@/server/log";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  nextZonedDayStart,
  resolveTimeZone,
  zonedDayStart,
  zonedParts,
  zonedWallTime,
} from "@/lib/zoned-time";

/** Zones already warned about, per organization, so a bad stored zone is logged once and not on every request. */
const warnedZones = new Set<string>();
/** For tests: forget the warnings already logged (the set is module state that outlives one test). */
export function resetInvalidZoneWarningsForTests(): void {
  warnedZones.clear();
}

export interface WorkspaceViewCtx {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  orgId: string;
  /** The company's zone (Organization.timezone, resolved): every day boundary of the page is cut there. */
  timeZone: string;
  /** The user's role in that org (not the workspace role): what decides guest-only limits. */
  orgRole: string;
  /** Effective role (workspace member role wins over org role; an org GUEST is a GUEST everywhere). */
  role: string;
  /** Can this person change things here? Same verdict as the write routes (see workspace-role.ts). */
  editable: boolean;
  /**
   * Kept for the pages that still read it. Always false now: a workspace the
   * user cannot open is never offered or chosen (see `workspaces`).
   */
  denied: boolean;
  /** The workspaces the user can open (for selectors) — never an inaccessible one. */
  workspaces: { id: string; name: string }[];
  /** The tasks this person may see (spaces AND teams): pass it as `visible` to `queryTasksForView`. */
  visible: Prisma.TaskWhereInput;
}

/**
 * Resolves the workspace a page (List, Calendar) should show.
 *
 * Access is the one rule used everywhere (`accessibleWorkspaceIds`): the org
 * OWNER sees every workspace of their org, everyone else — ADMINs and GUESTs
 * included — only the workspaces they were put in, and only while they are
 * ACTIVE members. The selector list and the chosen/fallback workspace come from
 * that list only; a requested workspace outside it silently falls back to the
 * first accessible one, and a user with none gets `{ none: true }`.
 */
export async function resolveWorkspaceView(
  wantedId?: string,
): Promise<{ ctx: WorkspaceViewCtx } | { none: true } | { pageRedirect: true }> {
  const user = await pageUser();
  if (!user) return { pageRedirect: true };

  const scope = await loadWorkScope(user.id);
  const accessibleIds = scopeSpaceIds(scope);
  if (accessibleIds.length === 0) return { none: true };

  const rows = await db.workspace.findMany({
    where: { id: { in: accessibleIds } },
    select: { id: true, name: true, organizationId: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const fallback = rows[0];
  if (!fallback) return { none: true };
  const chosen = (wantedId ? rows.find((w) => w.id === wantedId) : undefined) ?? fallback;
  const workspaces = rows.map((w) => ({ id: w.id, name: w.name }));

  const [orgMember, wsMember] = await Promise.all([
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: chosen.organizationId, userId: user.id } },
      select: { role: true, status: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: chosen.id, userId: user.id } },
      select: { role: true },
    }),
  ]);
  // accessible ⇒ ACTIVE member of the workspace's org; if that does not hold, there is no space for them
  if (!orgMember || orgMember.status !== "ACTIVE") return { none: true };
  const orgRole: string = orgMember.role;
  // an org GUEST is a guest in every workspace, whatever their workspace row says
  const role: string = wsMember ? workspaceRoleOf(orgMember.role, wsMember?.role) : orgRole;
  // the company's clock: resolve the stored zone (a wrong name falls back to the default) and say so once per org+zone
  const stored = (
    await db.organization.findUnique({ where: { id: chosen.organizationId }, select: { timezone: true } })
  )?.timezone;
  const invalid = typeof stored === "string" && stored.trim() !== "" && stored !== DEFAULT_TIME_ZONE && !isValidTimeZone(stored);
  if (invalid) {
    const onceKey = `${chosen.organizationId}:${stored}`;
    if (!warnedZones.has(onceKey)) {
      warnedZones.add(onceKey);
      log.warn("org.timezone.invalid", { orgId: chosen.organizationId, timezone: stored, using: DEFAULT_TIME_ZONE });
    }
  }
  const timeZone = resolveTimeZone(stored);
  return {
    ctx: {
      userId: user.id,
      workspaceId: chosen.id,
      workspaceName: chosen.name,
      orgId: chosen.organizationId,
      timeZone,
      orgRole,
      role,
      editable: canWriteInWorkspace(orgMember.role, wsMember?.role),
      denied: false,
      workspaces,
      visible: taskVisibleWhere(scope),
    },
  };
}

/**
 * People offered in the List page's assignee filter for the chosen workspace
 * (names only, never an email). Org members get the organization's people; an
 * org GUEST (an external partner) only gets the people who share the workspace
 * with them, never the wider staff. Only ACTIVE people are offered: a suspended
 * or offboarded person is not somebody work can be filtered to or handed to.
 */
export async function listWorkspacePeople(
  ctx: Pick<WorkspaceViewCtx, "orgId" | "workspaceId" | "orgRole">,
): Promise<{ id: string; name: string }[]> {
  const rows = await db.organizationMember.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ACTIVE",
      ...(ctx.orgRole === "GUEST"
        ? { user: { workspaceLinks: { some: { workspaceId: ctx.workspaceId } } } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => r.user);
}

export function redirectIfUnauthenticated(): Promise<string | null> {
  return pageUser().then((u) => (u ? u.id : null));
}

// ---------- pure date windows (unit-tested) ----------

export interface DateWindow {
  from: Date;
  to: Date;
}

/**
 * The day [00:00:00.000, 23:59:59.999] that contains `d`. With a `timeZone` (an organization's
 * `timezone`) it is the COMPANY's day, so "today" means the same on a server that runs on UTC; without
 * one it is the server's local day (the calendar page still uses that).
 */
export function dayWindow(d: Date = new Date(), timeZone?: string): DateWindow {
  if (timeZone) {
    // a mistyped zone must never throw: resolve it to the company default (resolveTimeZone never throws)
    const zone = resolveTimeZone(timeZone);
    const from = zonedDayStart(d, zone);
    return { from, to: new Date(nextZonedDayStart(d, zone).getTime() - 1) };
  }
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(d);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** Calendar month window. With a `timeZone` (an organization's `timezone`) the month starts and ends at the COMPANY's midnight; without one it is the UTC month. Invalid `ym` → the month containing `d` (or now). */
export function monthWindow(ym?: string, timeZone?: string, d: Date = new Date()): DateWindow {
  const match = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    // the month containing `d`: in the company's zone when one was given, otherwise the machine's month
    const ymFallback = timeZone
      ? (() => {
          const p = zonedParts(d, resolveTimeZone(timeZone));
          return p.year.toString().padStart(4, "0") + "-" + p.month.toString().padStart(2, "0");
        })()
      : d.toISOString().slice(0, 7);
    return monthWindow(ymFallback, timeZone, d);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (timeZone) {
    const zone = resolveTimeZone(timeZone);
    const from = zonedWallTime({ year, month, day: 1 }, zone);
    const to = new Date(zonedWallTime({ year, month: month + 1, day: 1 }, zone).getTime() - 1);
    return { from, to };
  }
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

/** "YYYY-MM" shifted by delta months. Invalid input → current month. */
export function shiftMonth(ym: string | undefined, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!match) return new Date().toISOString().slice(0, 7);
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

// ---------- view-side ordering (pure) ----------

function dueMs(t: ViewTask): number | null {
  return t.dueDate ? t.dueDate.getTime() : null;
}

/** Sort by due date asc; tasks without a due date sink to the end. */
export function sortByDue(rows: ViewTask[]): ViewTask[] {
  return [...rows].sort((a, b) => {
    const da = dueMs(a);
    const db = dueMs(b);
    if (da === null && db === null) return b.updatedAt.getTime() - a.updatedAt.getTime();
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/** Sort by most recently completed first (for the Completed tab). */
export function sortByCompleted(rows: ViewTask[]): ViewTask[] {
  return [...rows].sort(
    (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
  );
}

// ---------- shared task query (one source for List/Calendar/My Work) ----------

export interface ViewQuery {
  orgId: string;
  assigneeId?: string;
  creatorId?: string;
  projectId?: string;
  workspaceId?: string;
  /**
   * Allow-list of workspaces the caller may see (from `accessibleWorkspaceIds`).
   * When present it ALWAYS applies: an empty list matches nothing, and a
   * `workspaceId` outside the list matches nothing. Absent = no workspace limit.
   */
  workspaceIds?: string[];
  /** The teams rule (`taskVisibleWhere`): when present it ALWAYS applies, on top of everything else. */
  visible?: Prisma.TaskWhereInput;
  priority?: TaskPriority;
  dueFrom?: Date;
  dueTo?: Date;
  overdueOnly?: boolean;
  /**
   * With `overdueOnly`: the line before which an open task is overdue. My Work gives the START of the company's
   * today, the same line as the Today page and the reports (a task due today at 09:00 is "today" at 15:00, never
   * "overdue"). Without it this service reads the company's own line itself — never "this very moment", which
   * would make the same task late here and not on the next screen.
   */
  overdueBefore?: Date;
  /** The moment the caller is asking as (tests pin it; the routes and pages pass nothing and get now). */
  now?: Date;
  openOnly?: boolean;
  completedOnly?: boolean;
  search?: string;
  limit?: number;
  /** «تثبيت»: pinned tasks first (the newest pin first), and `pinnedAt` filled in. Off: the view keeps its own order. */
  pinnedFirst?: boolean;
  /**
   * «مهمة بمكافأة»: fill `reward` (status, amount, currency). Only a caller that has checked the viewer is not a partner and
   * the company's switch is on passes it (`rewardLensFor`): without it a row carries no reward field at all.
   */
  rewards?: boolean;
  /**
   * «حقول مخصصة»: keep only the tasks whose custom field `fieldId` holds this answer. Only a caller that has checked the viewer is
   * not a partner, the company's switch is on and the field is one of the project's passes it (`resolveFieldQuery`). It narrows
   * on top of every other rule and the field is looked up with the company's id too: another company's field matches nothing.
   */
  fieldFilter?: FieldFilter;
  /** «حقول مخصصة»: order by a NUMBER or DATE field (tasks with no value last). The same trust as `fieldFilter`. */
  fieldSort?: FieldSort;
  /**
   * W1.1 «مهامي»: ONE word for who and where — see `ViewScope`. It is only a shorthand for the plain filters above (`normalizeViewScope`) and it can
   * only NARROW: `visible` and `workspaceIds` still apply on top of it. Absent: the query is exactly what it was.
   */
  scope?: ViewScope;
  /** W1.1: keep only the tasks whose board COLUMN has one of these normalized stages (`BoardColumn.stage`, W1.3). An empty list matches nothing. */
  stage?: WorkStage | readonly WorkStage[];
  /** W1.1 «بدون موعد»: only tasks with no due date (wins over `dueFrom` / `dueTo`). */
  undated?: boolean;
  /** W1.1 «لوحة»: the open tasks AND the ones finished on or after this moment (a board shows a done column, not every task ever finished). */
  openOrCompletedSince?: Date;
}

/**
 * W1.1: the three scopes of «مهامي».
 *   me      the tasks assigned to `userId` or shared with them (co-assigned), in every space of the allow-list or just `spaceId`
 *   space   everything the caller may see in ONE space
 *   project everything the caller may see in ONE project
 */
export type ViewScope =
  | { kind: "me"; userId: string; spaceId?: string }
  | { kind: "space"; spaceId: string }
  | { kind: "project"; projectId: string };

/** `scope` spelled out as the plain filters (pure). A scope that contradicts a plain filter already given (another space, another project) matches nothing. */
export function normalizeViewScope(q: ViewQuery): ViewQuery {
  const { scope, ...rest } = q;
  if (!scope) return q;
  const nothing = { ...rest, workspaceIds: [] as string[] };
  switch (scope.kind) {
    case "me":
      if (scope.spaceId && rest.workspaceId && rest.workspaceId !== scope.spaceId) return nothing;
      return { ...rest, assigneeId: scope.userId, ...(scope.spaceId ? { workspaceId: scope.spaceId } : {}) };
    case "space":
      if (rest.workspaceId && rest.workspaceId !== scope.spaceId) return nothing;
      return { ...rest, workspaceId: scope.spaceId };
    case "project":
      if (rest.projectId && rest.projectId !== scope.projectId) return nothing;
      return { ...rest, projectId: scope.projectId };
  }
}

export type FieldFilter = { fieldId: string } & ({ kind: "text"; value: string } | { kind: "boolean"; value: boolean });
export interface FieldSort {
  fieldId: string;
  projectId: string;
  column: "valueNumber" | "valueDate";
  dir: "asc" | "desc";
}

/** What a list row shows of a reward: the badge's three facts. Absent from every row a partner (or an off switch) is handed. */
export interface ViewReward {
  status: string;
  amountMinor: number;
  currency: string;
}

export interface ViewTask {
  id: string;
  key: string;
  title: string;
  priority: TaskPriority;
  dueDate: Date | null;
  completedAt: Date | null;
  columnId: string;
  columnName: string;
  columnDone: boolean;
  /** W1.1: the column's normalized stage (`BoardColumn.stage`, W1.3): what the cross-project lists group by. */
  columnStage: WorkStage;
  workspaceId: string;
  projectId: string;
  projectName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Every person the task is for («لمين» with more than one): the primary first, then the others. */
  assigneeIds: string[];
  assigneeNames: string[];
  creatorId: string;
  /** «مين بيشوفها؟»: SPACE or PARTICIPANTS (a lock is drawn on the second). */
  visibility: string;
  labelIds: string[];
  updatedAt: Date;
  /** «تثبيت»: when it was pinned (only when the query asked for pins). */
  pinnedAt?: Date | null;
  /** «مهمة بمكافأة»: only when the query asked for rewards and the task has a real one. */
  reward?: ViewReward | null;
}

/** «تثبيت»: the pinned rows first (the newest pin first), every other row in the order it already had. Stable. */
export function sortPinnedFirst<T extends { pinnedAt?: Date | null }>(rows: T[]): T[] {
  const pinned = rows.filter((r) => r.pinnedAt).sort((a, b) => b.pinnedAt!.getTime() - a.pinnedAt!.getTime());
  return [...pinned, ...rows.filter((r) => !r.pinnedAt)];
}

/** The relation filter of «حقول مخصصة»: a parameterised join on `TaskFieldValue`, always with the company's id. */
function fieldFilterWhere(orgId: string, f: FieldFilter): Prisma.TaskWhereInput {
  if (f.kind === "text") return { fieldValues: { some: { fieldId: f.fieldId, orgId, valueText: f.value } } };
  const yes: Prisma.TaskWhereInput = { fieldValues: { some: { fieldId: f.fieldId, orgId, valueNumber: new Prisma.Decimal(1) } } };
  // «لا» is a task answered «no» AND a task nobody answered: everything that is not «نعم»
  return f.value ? yes : { NOT: yes };
}

/**
 * «حقول مخصصة»: the ids of a project's tasks in the order of one NUMBER or DATE field, tasks with no value last (a LEFT JOIN on
 * `TaskFieldValue`, every value a parameter; the column and the direction come from a closed list, never from the request).
 * The pool is only an ORDER: the rows are then read through the caller's own `where`, so every access rule still applies.
 */
async function sortedPool(q: ViewQuery, s: FieldSort): Promise<string[]> {
  const col = s.column === "valueDate" ? Prisma.raw('v."valueDate"') : Prisma.raw('v."valueNumber"');
  const dir = s.dir === "desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");
  // task-visibility: read through the caller's own `where` (ctx.visible = taskVisibleWhere)
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t."id" FROM "Task" t
    LEFT JOIN "TaskFieldValue" v ON v."taskId" = t."id" AND v."fieldId" = ${s.fieldId} AND v."orgId" = ${q.orgId}
    WHERE t."orgId" = ${q.orgId} AND t."projectId" = ${s.projectId} AND t."archived" = FALSE
    ORDER BY ${col} ${dir} NULLS LAST, t."id" ASC
    LIMIT 2000`);
  return rows.map((r) => r.id);
}

async function loadByFieldSort<I extends Prisma.TaskInclude>(
  q: ViewQuery,
  where: Prisma.TaskWhereInput,
  include: I,
  orderBy: Prisma.TaskOrderByWithRelationInput[],
) {
  const pool = await sortedPool(q, q.fieldSort as FieldSort);
  // task-visibility: read through the caller's own `where` (ctx.visible = taskVisibleWhere)
  const found = await db.task.findMany({ where: { ...where, id: { in: pool } }, orderBy, include });
  const at = new Map(pool.map((id, i) => [id, i]));
  const sorted = [...found].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  // pinned tasks keep the lead the view gave them (a stable sort over the field's order)
  return (q.pinnedFirst ? sortPinnedFirst(sorted) : sorted).slice(0, Math.min(q.limit ?? 200, 500));
}

/**
 * The `where` of a query, from its plain filters (the scope already spelled out): org-scoped, never archived, and always with the caller's own
 * `visible` rule when one is given. One builder for the rows and for the counts, so a chip's number is the length of its list.
 */
async function viewWhere(q: ViewQuery): Promise<Prisma.TaskWhereInput> {
  const where: Prisma.TaskWhereInput = {
    orgId: q.orgId,
    archived: false,
  };
  const and: Prisma.TaskWhereInput[] = q.visible ? [q.visible] : [];
  if (q.assigneeId) and.push({ OR: [ { assigneeId: q.assigneeId }, { coAssignees: { some: { userId: q.assigneeId } } } ] });
  if (q.creatorId) where.creatorId = q.creatorId;
  if (q.projectId) where.projectId = q.projectId;
  if (q.workspaceIds !== undefined) {
    // the allow-list wins: a single workspaceId can only narrow it, never widen it
    where.workspaceId = {
      in: q.workspaceId ? q.workspaceIds.filter((id) => id === q.workspaceId) : q.workspaceIds,
    };
  } else if (q.workspaceId) {
    where.workspaceId = q.workspaceId;
  }
  if (q.fieldFilter) and.push(fieldFilterWhere(q.orgId, q.fieldFilter));
  if (q.stage !== undefined) {
    const stages = typeof q.stage === "string" ? [q.stage] : [...q.stage];
    where.column = { stage: { in: stages } };
  }
  if (q.priority) where.priority = q.priority;
  if (q.dueFrom || q.dueTo) {
    where.dueDate = {
      ...(q.dueFrom ? { gte: q.dueFrom } : {}),
      ...(q.dueTo ? { lte: q.dueTo } : {}),
    };
  }
  if (q.undated) where.dueDate = null;
  if (q.overdueOnly) {
    where.dueDate = { lt: q.overdueBefore ?? (await orgDayStart(q.orgId, q.now)) };
    where.completedAt = null;
  }
  if (q.openOrCompletedSince) and.push({ OR: [{ completedAt: null }, { completedAt: { gte: q.openOrCompletedSince } }] });
  if (q.openOnly) where.completedAt = null;
  if (q.completedOnly) where.completedAt = { not: null };
  if (and.length) where.AND = and;
  return where;
}

/**
 * How many tasks a query matches (the chips of «مهامي»): the same `where` as `queryTasksForView`, with no limit and no text search.
 * A caller passes `visible` (`taskVisibleWhere`) exactly as for the rows: a hidden task is not counted.
 */
export async function countTasksForView(query: ViewQuery): Promise<number> {
  const q = normalizeViewScope(query);
  // task-visibility: read through the caller's own `where` (q.visible = taskVisibleWhere)
  return db.task.count({ where: await viewWhere(q) });
}

/** Single query core for every task view; always org-scoped. */
export async function queryTasksForView(query: ViewQuery): Promise<ViewTask[]> {
  const q = normalizeViewScope(query);
  const where = await viewWhere(q);
  const take = Math.min(q.limit ?? 200, 500);
  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
    ...(q.pinnedFirst ? [{ pinnedAt: { sort: "desc" as const, nulls: "last" as const } }] : []),
    { dueDate: { sort: "asc", nulls: "last" } },
    { updatedAt: "desc" },
  ];
  const include = {
    ...TASK_INCLUDE,
    project: { select: { id: true, name: true } },
    column: { select: { id: true, name: true, done: true, stage: true } },
    organization: { select: { keyPrefix: true } },
  } satisfies Prisma.TaskInclude;

  // a text filter is spelling-tolerant (src/lib/search/arabic.ts): the pool of ids by spelling, narrowed by the
  // plain filters, then THIS `where` — every access rule of the caller — on those ids. The view's own order stays.
  const search = q.search ? arabicSearch(q.search) : null;
  const rows = search
    ? await rankedSearch({
        query: {
          table: "Task",
          search,
          rank: false,
          where: [
            Prisma.sql`"orgId" = ${q.orgId}`,
            Prisma.sql`"archived" = FALSE`,
            ...(q.workspaceIds !== undefined ? [sqlIn("workspaceId", q.workspaceId ? q.workspaceIds.filter((id) => id === q.workspaceId) : q.workspaceIds)] : []),
            ...(q.workspaceIds === undefined && q.workspaceId ? [Prisma.sql`"workspaceId" = ${q.workspaceId}`] : []),
            ...(q.projectId ? [Prisma.sql`"projectId" = ${q.projectId}`] : []),
            ...(q.creatorId ? [Prisma.sql`"creatorId" = ${q.creatorId}`] : []),
            // the same precedence as `where` above: «completedOnly» is the last word on `completedAt`
            ...(q.completedOnly ? [Prisma.sql`"completedAt" IS NOT NULL`] : q.openOnly || q.overdueOnly ? [Prisma.sql`"completedAt" IS NULL`] : []),
          ],
          order: Prisma.sql`"dueDate" ASC NULLS LAST, "updatedAt" DESC`,
        },
        take,
        // task-visibility: read through the caller's own `where` (ctx.visible = taskVisibleWhere)
        load: (ids) => db.task.findMany({ where: { ...where, id: { in: ids } }, orderBy, include }),
      })
    : q.fieldSort
      ? await loadByFieldSort(q, where, include, orderBy)
      // task-visibility: read through the caller's own `where` (ctx.visible = taskVisibleWhere)
      : await db.task.findMany({ where, orderBy, take, include });

  return rows.map((t): ViewTask => {
    // «لمين» with more than one person: the primary first, then the people beside them
    const co = t.coAssignees.map((r) => r.user);
    return {
      id: t.id,
      key: `${t.organization.keyPrefix}-${t.number}`,
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      columnId: t.column.id,
      columnName: t.column.name,
      columnDone: t.column.done,
      columnStage: stageOrDefault(t.column.stage),
      workspaceId: t.workspaceId,
      projectId: t.project.id,
      projectName: t.project.name,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee?.name ?? null,
      assigneeIds: [...(t.assignee ? [t.assignee.id] : []), ...co.map((u) => u.id)],
      assigneeNames: [...(t.assignee ? [t.assignee.name] : []), ...co.map((u) => u.name)],
      creatorId: t.creatorId,
      visibility: t.visibility,
      labelIds: t.labels.map((l) => l.label.id),
      updatedAt: t.updatedAt,
      ...(q.pinnedFirst ? { pinnedAt: t.pinnedAt } : {}),
      ...(q.rewards
        ? {
            reward:
              listBadgeStatus(t.rewardStatus) && t.rewardAmountMinor != null && t.rewardCurrency
                ? { status: t.rewardStatus as string, amountMinor: t.rewardAmountMinor, currency: t.rewardCurrency }
                : null,
          }
        : {}),
    };
  });
}
