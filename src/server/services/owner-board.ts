import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/auth";
import { onlineUserIds } from "@/server/realtime/presence";
import { assertMayOpenPerson, type BoardAccess, type BoardScope } from "@/server/policy/board";
import { orgTimeZone } from "@/server/services/org-day";
import { loadSections, type BoardSection, type LoadedSections } from "@/server/services/owner-board-sections";
import { dayKeyOf, onTimeRate, resolveWindow, WindowError, type BoardWindow, type WindowInput } from "@/lib/owner-board";
import { zonedDayStart } from "@/lib/zoned-time";

/**
 * «لوحة المالك» — THE NUMBERS. Every figure on the board is computed here, in SQL, with GROUP BY over the company's own rows
 * and a bounded window of days; nothing is stored and nothing is written (reading leaves no trace: no audit row, no
 * notification, no «seen»).
 *
 * THE DEFINITIONS (each is also written on the screen, next to its number, in `ar.owner-board.json`):
 *
 *  - «إنجاز» (a completion credited to a person): a task whose `completedAt` falls in the day (the company's day) AND the
 *    person is its assignee or one of its co-assignees. ⚠️ The schema has NO «completed by» column, so the people are the
 *    assignees AT THE TIME OF THE QUERY (a task re-assigned after it was finished is credited to its new people). Only a
 *    task nobody holds is credited to whoever the task's activity log says finished it (`task.completed`, or the move into a
 *    done column), when that is recorded. Each person is credited once per task, however many ways they hold it.
 *    A task with `completedAt` counts even if archived; a reopened task (`completedAt` null) does not count.
 *  - open: `completedAt` is null and the task is not archived. Overdue: open, with a due day before the company's today.
 *  - late: finished AFTER its due day (the company's day of `completedAt` after the day of `dueDate`).
 *  - on-time rate: finished on or before the due day ÷ finished that had a due day («—» when none had).
 *  - steps ticked: `TaskStep` rows ticked (`done`) by the person with `doneAt` in the window.
 *  - messages: chat messages the person wrote in the window, not deleted, not system lines. COUNTS only: the body of a
 *    message is never read by this file.
 *  - active person: at least one completion, one step or one message in the window.
 */

const MAX_ROWS = 2000;

type Ids = readonly string[] | null;

export class OwnerBoardError extends ValidationError {
  constructor(key: string) {
    super([{ path: "range", message: key }]);
  }
}

export interface BoardQuery extends WindowInput {
  space?: string | null;
  person?: string | null;
  sort?: string | null;
  dir?: string | null;
}

/** The columns the people table can be sorted by. */
export const SORT_KEYS = ["name", "completed", "openTasks", "overdue", "onTime", "steps", "messages", "lastActivity"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

// ───────────────────────────────────────── SQL pieces ─────────────────────────────────────────

const raw = (text: string) => Prisma.raw(text);
/** An instant as a `timestamp` (the columns are `timestamp(3)` holding UTC): sent as text, so the session zone never matters. */
const ts = (d: Date) => Prisma.sql`${d.toISOString().replace("Z", "")}::text::timestamp`;
/** The company's wall clock of a UTC `timestamp` column. */
const local = (col: string, tz: string) => Prisma.sql`((${raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`;
const dayOf = (col: string, tz: string) => Prisma.sql`to_char(${local(col, tz)}, 'YYYY-MM-DD')`;
const arr = (ids: readonly string[]) => Prisma.sql`${[...ids]}::text[]`;

/** `AND <col> = ANY(ids)` (nothing when the question is not limited to people). */
function onlyIds(col: string, ids: Ids): Prisma.Sql {
  return ids ? Prisma.sql`AND ${raw(col)} = ANY(${arr(ids)})` : Prisma.empty;
}

/** The task rows a scope covers: its spaces, or the projects of the teams it covers. Empty when the whole company. */
function taskScope(alias: string, scope: BoardScope): Prisma.Sql {
  if (!scope.restricted) return Prisma.empty;
  const parts: Prisma.Sql[] = [];
  if (scope.workspaceIds.length) parts.push(Prisma.sql`${raw(`${alias}."workspaceId"`)} = ANY(${arr(scope.workspaceIds)})`);
  if (scope.teamIds.length) parts.push(Prisma.sql`${raw(`${alias}."projectId"`)} IN (SELECT p."id" FROM "Project" p WHERE p."teamId" = ANY(${arr(scope.teamIds)}))`);
  return parts.length ? Prisma.sql`AND (${Prisma.join(parts, " OR ")})` : Prisma.sql`AND FALSE`;
}

/** The conversations a scope covers (a space's topics, a team's topics). Empty when the whole company. */
function conversationScope(alias: string, scope: BoardScope): Prisma.Sql {
  if (!scope.restricted) return Prisma.empty;
  const parts: Prisma.Sql[] = [];
  if (scope.workspaceIds.length) parts.push(Prisma.sql`${raw(`${alias}."spaceId"`)} = ANY(${arr(scope.workspaceIds)})`);
  if (scope.teamIds.length) parts.push(Prisma.sql`${raw(`${alias}."teamId"`)} = ANY(${arr(scope.teamIds)})`);
  return parts.length ? Prisma.sql`AND (${Prisma.join(parts, " OR ")})` : Prisma.sql`AND FALSE`;
}

interface Ctx {
  orgId: string;
  tz: string;
  win: BoardWindow;
  scope: BoardScope;
}

/** The finished tasks of the window, and the people credited with each (see the definitions above). */
function doneAndCredit(c: Ctx, win: BoardWindow = c.win): Prisma.Sql {
  return Prisma.sql`
    done AS (
      SELECT t."id", t."number", t."title", t."completedAt", t."dueDate", t."createdAt", t."assigneeId"
      FROM "Task" t
      WHERE t."orgId" = ${c.orgId} AND t."completedAt" >= ${ts(win.start)} AND t."completedAt" < ${ts(win.end)}
      ${taskScope("t", c.scope)}
    ),
    credit AS (
      SELECT d."id" AS "taskId", d."assigneeId" AS "userId" FROM done d WHERE d."assigneeId" IS NOT NULL
      UNION
      SELECT co."taskId", co."userId" FROM "TaskCoAssignee" co JOIN done d ON d."id" = co."taskId"
      UNION
      SELECT d."id", (
        SELECT a."actorId" FROM "TaskActivity" a
        WHERE a."taskId" = d."id"
          AND (a."event" = 'task.completed'
               OR (a."event" = 'task.moved' AND EXISTS (SELECT 1 FROM "BoardColumn" bc WHERE bc."id" = a."meta"->>'to' AND bc."done")))
        ORDER BY a."createdAt" DESC LIMIT 1
      )
      FROM done d
      WHERE d."assigneeId" IS NULL AND NOT EXISTS (SELECT 1 FROM "TaskCoAssignee" c2 WHERE c2."taskId" = d."id")
    )`;
}

// ───────────────────────────────────────── the facts ─────────────────────────────────────────

export type FactKind = "task" | "step" | "msg";

interface FactRow {
  userId: string;
  day: string;
  kind: FactKind;
  n: number;
  first: Date;
  last: Date;
}

/** Per person, per company day and per kind: how many, and the first and last moment. */
async function loadFacts(c: Ctx, ids: Ids, win: BoardWindow = c.win): Promise<FactRow[]> {
  const rows = await db.$queryRaw<{ userId: string; day: string; kind: FactKind; n: number; first: Date; last: Date }[]>(Prisma.sql`
    WITH ${doneAndCredit(c, win)},
    ev AS (
      SELECT cr."userId" AS "userId", d."completedAt" AS "at", 'task' AS "kind"
        FROM credit cr JOIN done d ON d."id" = cr."taskId"
        WHERE cr."userId" IS NOT NULL ${onlyIds('cr."userId"', ids)}
      UNION ALL
      SELECT s."doneById", s."doneAt", 'step'
        FROM "TaskStep" s JOIN "Task" t ON t."id" = s."taskId"
        WHERE s."orgId" = ${c.orgId} AND s."done" AND s."doneById" IS NOT NULL
          AND s."doneAt" >= ${ts(win.start)} AND s."doneAt" < ${ts(win.end)}
          ${onlyIds('s."doneById"', ids)} ${taskScope("t", c.scope)}
      UNION ALL
      SELECT m."authorId", m."createdAt", 'msg'
        FROM "ChatMessage" m
        ${c.scope.restricted ? Prisma.sql`JOIN "Conversation" cv ON cv."id" = m."conversationId"` : Prisma.empty}
        WHERE m."orgId" = ${c.orgId} AND m."createdAt" >= ${ts(win.start)} AND m."createdAt" < ${ts(win.end)}
          AND m."deletedAt" IS NULL AND m."kind" <> 'SYSTEM'
          ${onlyIds('m."authorId"', ids)} ${conversationScope("cv", c.scope)}
    )
    SELECT "userId", ${dayOf('"at"', c.tz)} AS "day", "kind", count(*)::int AS "n", min("at") AS "first", max("at") AS "last"
    FROM ev GROUP BY 1, 2, 3`);
  return rows;
}

interface DoneStat {
  userId: string;
  completed: number;
  withDue: number;
  onTime: number;
  late: number;
  avgDays: number | null;
}

async function loadDoneStats(c: Ctx, ids: Ids): Promise<DoneStat[]> {
  return db.$queryRaw<DoneStat[]>(Prisma.sql`
    WITH ${doneAndCredit(c)}
    SELECT cr."userId" AS "userId",
      count(*)::int AS "completed",
      (count(*) FILTER (WHERE d."dueDate" IS NOT NULL))::int AS "withDue",
      (count(*) FILTER (WHERE d."dueDate" IS NOT NULL AND ${local('d."completedAt"', c.tz)}::date <= ${local('d."dueDate"', c.tz)}::date))::int AS "onTime",
      (count(*) FILTER (WHERE d."dueDate" IS NOT NULL AND ${local('d."completedAt"', c.tz)}::date > ${local('d."dueDate"', c.tz)}::date))::int AS "late",
      avg(GREATEST(extract(epoch FROM (d."completedAt" - d."createdAt")) / 86400.0, 0))::float8 AS "avgDays"
    FROM credit cr JOIN done d ON d."id" = cr."taskId"
    WHERE cr."userId" IS NOT NULL ${onlyIds('cr."userId"', ids)}
    GROUP BY 1`);
}

interface OpenStat {
  userId: string;
  open: number;
  overdue: number;
}

async function loadOpenStats(c: Ctx, ids: Ids, todayStart: Date): Promise<OpenStat[]> {
  return db.$queryRaw<OpenStat[]>(Prisma.sql`
    WITH open AS (
      SELECT t."id", t."assigneeId", t."dueDate" FROM "Task" t
      WHERE t."orgId" = ${c.orgId} AND t."completedAt" IS NULL AND NOT t."archived" ${taskScope("t", c.scope)}
    ),
    held AS (
      SELECT o."id", o."assigneeId" AS "userId", o."dueDate" FROM open o WHERE o."assigneeId" IS NOT NULL
      UNION
      SELECT o."id", co."userId", o."dueDate" FROM open o JOIN "TaskCoAssignee" co ON co."taskId" = o."id"
    )
    SELECT "userId", count(*)::int AS "open", (count(*) FILTER (WHERE "dueDate" < ${ts(todayStart)}))::int AS "overdue"
    FROM held WHERE TRUE ${onlyIds('"userId"', ids)} GROUP BY 1`);
}

interface CompanyTotals {
  completed: number;
  late: number;
  avgDays: number | null;
  open: number;
  overdue: number;
  messages: number;
}

/** The company-wide cards: over TASKS (a task counts once, whoever holds it, even nobody) and over every message. */
async function loadCompanyTotals(c: Ctx, todayStart: Date): Promise<CompanyTotals> {
  const [done, open, msgs] = await Promise.all([
    db.$queryRaw<{ completed: number; late: number; avgDays: number | null }[]>(Prisma.sql`
      SELECT count(*)::int AS "completed",
        (count(*) FILTER (WHERE t."dueDate" IS NOT NULL AND ${local('t."completedAt"', c.tz)}::date > ${local('t."dueDate"', c.tz)}::date))::int AS "late",
        avg(GREATEST(extract(epoch FROM (t."completedAt" - t."createdAt")) / 86400.0, 0))::float8 AS "avgDays"
      FROM "Task" t
      WHERE t."orgId" = ${c.orgId} AND t."completedAt" >= ${ts(c.win.start)} AND t."completedAt" < ${ts(c.win.end)} ${taskScope("t", c.scope)}`),
    db.$queryRaw<{ open: number; overdue: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "open", (count(*) FILTER (WHERE t."dueDate" < ${ts(todayStart)}))::int AS "overdue"
      FROM "Task" t WHERE t."orgId" = ${c.orgId} AND t."completedAt" IS NULL AND NOT t."archived" ${taskScope("t", c.scope)}`),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "n" FROM "ChatMessage" m
      ${c.scope.restricted ? Prisma.sql`JOIN "Conversation" cv ON cv."id" = m."conversationId"` : Prisma.empty}
      WHERE m."orgId" = ${c.orgId} AND m."createdAt" >= ${ts(c.win.start)} AND m."createdAt" < ${ts(c.win.end)}
        AND m."deletedAt" IS NULL AND m."kind" <> 'SYSTEM' ${conversationScope("cv", c.scope)}`),
  ]);
  return {
    completed: done[0]?.completed ?? 0,
    late: done[0]?.late ?? 0,
    avgDays: done[0]?.avgDays ?? null,
    open: open[0]?.open ?? 0,
    overdue: open[0]?.overdue ?? 0,
    messages: msgs[0]?.n ?? 0,
  };
}

// ───────────────────────────────────────── the view models ─────────────────────────────────────────

export interface PersonRow {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  /** `ACTIVE`, or `SUSPENDED` / `OFFBOARDED`: marked «موقوف/منتهي» on the screen. */
  status: string;
  online: boolean;
  completed: number;
  openTasks: number;
  overdue: number;
  withDue: number;
  onTime: number;
  late: number;
  /** null: nothing to divide by («—»). */
  onTimeRate: number | null;
  avgDays: number | null;
  steps: number;
  messages: number;
  /** The last moment of any action inside the window (ISO). */
  lastActivity: string | null;
  /** Completions per day of the window, oldest first (the sparkline). */
  spark: number[];
}

export interface Cards {
  completed: number;
  open: number;
  overdue: number;
  late: number;
  avgDays: number | null;
  messages: number;
  activePeople: number;
  idlePeople: number;
}

export interface TodayRow {
  userId: string;
  name: string;
  tasks: number;
  steps: number;
  messages: number;
  first: string | null;
  last: string | null;
}

export interface WindowInfo {
  from: string;
  to: string;
  days: string[];
  today: string;
  preset: string;
  timeZone: string;
}

export interface SpaceOption {
  id: string;
  name: string;
}

export interface Overview {
  mode: BoardAccess["mode"];
  window: WindowInfo;
  filters: { space: string | null; person: string | null; sort: SortKey; dir: "asc" | "desc" };
  spaces: SpaceOption[];
  /** The company-wide cards: the owner's view without a person filter only. */
  cards: Cards | null;
  people: PersonRow[];
  today: { done: TodayRow[]; idle: { userId: string; name: string }[] } | null;
  sections: LoadedSections["columns"];
  sectionValues: Record<string, Record<string, number | string | null>>;
}

const windowInfo = (win: BoardWindow, tz: string): WindowInfo => ({ from: win.from, to: win.to, days: win.days, today: win.today, preset: win.preset, timeZone: tz });

function windowFor(input: WindowInput, now: Date, tz: string): BoardWindow {
  try {
    return resolveWindow(input, now, tz);
  } catch (e) {
    if (e instanceof WindowError) throw new OwnerBoardError(e.key);
    throw e;
  }
}

/** The spaces the viewer may filter by. */
async function spaceOptions(access: BoardAccess): Promise<SpaceOption[]> {
  if (access.mode === "self") return [];
  if (access.mode === "owner") {
    const rows = await db.workspace.findMany({ where: { organizationId: access.orgId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    return rows;
  }
  const teamSpaces = access.scope.teamIds.length
    ? await db.team.findMany({ where: { id: { in: access.scope.teamIds } }, select: { workspaceId: true } })
    : [];
  const ids = [...new Set([...access.scope.workspaceIds, ...teamSpaces.map((t) => t.workspaceId)])];
  if (!ids.length) return [];
  return db.workspace.findMany({ where: { id: { in: ids }, organizationId: access.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/**
 * The scope after the space filter. A space the viewer may not read answers 404 (never says it exists): for the owner
 * that is a space of another company; for a team lead, a space outside the ones they manage or lead a team in.
 */
async function narrowScope(access: BoardAccess, space: string | null | undefined): Promise<BoardScope> {
  if (!space || access.mode === "self") return access.scope;
  if (access.mode === "owner") {
    const found = await db.workspace.findFirst({ where: { id: space, organizationId: access.orgId }, select: { id: true } });
    if (!found) throw new NotFoundError("ownerboard.not_found");
    return { restricted: true, workspaceIds: [space], teamIds: [] };
  }
  if (access.scope.workspaceIds.includes(space)) return { restricted: true, workspaceIds: [space], teamIds: [] };
  const teams = access.scope.teamIds.length
    ? await db.team.findMany({ where: { id: { in: access.scope.teamIds }, workspaceId: space }, select: { id: true } })
    : [];
  if (!teams.length) throw new NotFoundError("ownerboard.not_found");
  return { restricted: true, workspaceIds: [], teamIds: teams.map((t) => t.id) };
}

function sortKeyOf(value: string | null | undefined): SortKey {
  return (SORT_KEYS as readonly string[]).includes(value ?? "") ? (value as SortKey) : "completed";
}

/** Sorts the people table by a column; ties are broken by name so the order is stable. */
export function sortPeople(rows: PersonRow[], key: SortKey, dir: "asc" | "desc"): PersonRow[] {
  const value = (r: PersonRow): number | string => {
    switch (key) {
      case "name":
        return r.name;
      case "completed":
        return r.completed;
      case "openTasks":
        return r.openTasks;
      case "overdue":
        return r.overdue;
      case "onTime":
        return r.onTimeRate ?? -1;
      case "steps":
        return r.steps;
      case "messages":
        return r.messages;
      case "lastActivity":
        return r.lastActivity ?? "";
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const cmp = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "ar") : (x as number) - (y as number);
    return cmp !== 0 ? sign * cmp : a.name.localeCompare(b.name, "ar");
  });
}

interface MemberInfo {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  status: string;
}

async function membersByIds(orgId: string, ids: readonly string[]): Promise<MemberInfo[]> {
  if (!ids.length) return [];
  const rows = await db.organizationMember.findMany({
    // all-statuses: a person who was suspended or offboarded keeps the work they finished, so their row is read and marked
    where: { organizationId: orgId, userId: { in: [...ids] }, role: { not: "GUEST" } },
    select: { userId: true, role: true, status: true, user: { select: { name: true, jobTitle: true } } },
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.name, jobTitle: r.user.jobTitle ?? null, role: r.role, status: r.status }));
}

/** The people who are on the table before any data is known: ACTIVE, not guests, of the scope. */
async function baseMembers(access: BoardAccess, scope: BoardScope, space: string | null | undefined): Promise<MemberInfo[]> {
  const select = { userId: true, role: true, status: true, user: { select: { name: true, jobTitle: true } } } as const;
  const toInfo = (r: { userId: string; role: string; status: string; user: { name: string; jobTitle: string | null } }): MemberInfo => ({
    userId: r.userId,
    name: r.user.name,
    jobTitle: r.user.jobTitle ?? null,
    role: r.role,
    status: r.status,
  });
  if (access.mode === "team") {
    const ids = [...(access.reach ?? [])];
    if (!ids.length) return [];
    let allowed = ids;
    if (space) {
      const [ws, tm] = await Promise.all([
        scope.workspaceIds.length ? db.workspaceMember.findMany({ where: { workspaceId: { in: scope.workspaceIds }, userId: { in: ids } }, select: { userId: true } }) : [],
        scope.teamIds.length ? db.teamMember.findMany({ where: { teamId: { in: scope.teamIds }, userId: { in: ids } }, select: { userId: true } }) : [],
      ]);
      allowed = [...new Set([...ws.map((r) => r.userId), ...tm.map((r) => r.userId)])];
    }
    if (!allowed.length) return [];
    return (await db.organizationMember.findMany({ where: { organizationId: access.orgId, status: "ACTIVE", role: { not: "GUEST" }, userId: { in: allowed } }, select })).map(toInfo);
  }
  const spaceFilter: Prisma.OrganizationMemberWhereInput = space ? { user: { workspaceLinks: { some: { workspaceId: space } } } } : {};
  return (await db.organizationMember.findMany({ where: { organizationId: access.orgId, status: "ACTIVE", role: { not: "GUEST" }, ...spaceFilter }, select })).map(toInfo);
}

/** The columns of one day for the sparkline of a person: completions per window day. */
function sparkOf(days: readonly string[], byDay: Map<string, number> | undefined): number[] {
  return days.map((d) => byDay?.get(d) ?? 0);
}

interface Assembled {
  rows: PersonRow[];
  facts: FactRow[];
}

/** Builds the people rows from the four grouped reads. `candidates` are the people to list; people with data in scope are added. */
async function assemble(access: BoardAccess, c: Ctx, ids: Ids, candidates: MemberInfo[], now: Date, onlyCandidates: boolean): Promise<Assembled> {
  const todayStart = zonedDayStart(now, c.tz);
  const [facts, doneStats, openStats, online] = await Promise.all([loadFacts(c, ids), loadDoneStats(c, ids), loadOpenStats(c, ids, todayStart), onlineUserIds(c.orgId)]);

  const known = new Map(candidates.map((m) => [m.userId, m]));
  if (!onlyCandidates) {
    const dataIds = new Set([...facts.map((f) => f.userId), ...doneStats.map((s) => s.userId), ...openStats.map((s) => s.userId)]);
    const extra = [...dataIds].filter((id) => !known.has(id));
    for (const m of await membersByIds(c.orgId, extra)) known.set(m.userId, m);
  }
  const onlineSet = new Set(online);
  const doneBy = new Map(doneStats.map((s) => [s.userId, s]));
  const openBy = new Map(openStats.map((s) => [s.userId, s]));
  const factsBy = new Map<string, FactRow[]>();
  for (const f of facts) {
    const list = factsBy.get(f.userId) ?? [];
    list.push(f);
    factsBy.set(f.userId, list);
  }

  const rows: PersonRow[] = [];
  for (const m of known.values()) {
    if (ids && !ids.includes(m.userId)) continue;
    const mine = factsBy.get(m.userId) ?? [];
    const done = doneBy.get(m.userId);
    const open = openBy.get(m.userId);
    const perDay = new Map<string, number>();
    let steps = 0;
    let messages = 0;
    let last: Date | null = null;
    for (const f of mine) {
      if (f.kind === "task") perDay.set(f.day, (perDay.get(f.day) ?? 0) + f.n);
      if (f.kind === "step") steps += f.n;
      if (f.kind === "msg") messages += f.n;
      if (!last || f.last > last) last = f.last;
    }
    rows.push({
      userId: m.userId,
      name: m.name,
      jobTitle: m.jobTitle,
      role: m.role,
      status: m.status,
      online: onlineSet.has(m.userId),
      completed: done?.completed ?? 0,
      openTasks: open?.open ?? 0,
      overdue: open?.overdue ?? 0,
      withDue: done?.withDue ?? 0,
      onTime: done?.onTime ?? 0,
      late: done?.late ?? 0,
      onTimeRate: onTimeRate(done?.onTime ?? 0, done?.withDue ?? 0),
      avgDays: done?.avgDays ?? null,
      steps,
      messages,
      lastActivity: last ? last.toISOString() : null,
      spark: sparkOf(c.win.days, perDay),
    });
  }
  return { rows, facts };
}

/** The sections' values, for the people on the page. */
async function sectionsFor(c: Ctx, userIds: string[], sections?: readonly BoardSection[]): Promise<LoadedSections> {
  return loadSections({ orgId: c.orgId, timeZone: c.tz, window: c.win, scope: c.scope, userIds }, sections);
}

const valuesOf = (loaded: LoadedSections) => Object.fromEntries(loaded.values);

// ───────────────────────────────────────── the overview ─────────────────────────────────────────

export interface LoadOptions {
  now?: Date;
  /** The registered sections (tests pass their own; the page passes none and gets the registry). */
  sections?: readonly BoardSection[];
}

/**
 * The people table, the cards and the «اليوم» strip. The owner reads everybody and the company's totals; a team lead reads
 * the people in reach and what they did in the spaces covered (no totals); `self` has no overview (the caller sends them to
 * their own page, and this refuses with 404).
 */
export async function loadOverview(access: BoardAccess, query: BoardQuery, opts: LoadOptions = {}): Promise<Overview> {
  if (access.mode === "self") throw new NotFoundError("ownerboard.not_found");
  const now = opts.now ?? new Date();
  const tz = await orgTimeZone(access.orgId);
  const win = windowFor(query, now, tz);
  const space = query.space || null;
  const scope = await narrowScope(access, space);
  const person = query.person || null;
  if (person) {
    assertMayOpenPerson(access, person);
    // somebody who is not a (non-guest) member of this company does not exist here
    if (!(await membersByIds(access.orgId, [person])).length) throw new NotFoundError("ownerboard.not_found");
  }
  const ids: Ids = person ? [person] : access.reach ? [...access.reach] : null;
  if (access.reach && ids && ids.length === 0) {
    // a lead with nobody in reach: an empty table, not an error
    return emptyOverview(access, query, win, tz, space);
  }

  const c: Ctx = { orgId: access.orgId, tz, win, scope };
  const candidates = await baseMembers(access, scope, space);
  const { rows } = await assemble(access, c, ids, person ? await membersByIds(access.orgId, [person]) : candidates, now, access.mode === "team" || Boolean(person));
  const sectionLoad = await sectionsFor(c, rows.map((r) => r.userId), opts.sections);

  const sort = sortKeyOf(query.sort);
  const dir = query.dir === "asc" ? "asc" : "desc";
  const people = sortPeople(rows, sort, sort === "name" && !query.dir ? "asc" : dir);

  // the cards: the company's totals (owner, no person filter), or one person's own numbers
  let cards: Cards | null = null;
  const activeOf = (r: PersonRow) => r.completed + r.steps + r.messages > 0;
  const live = people.filter((r) => r.status === "ACTIVE");
  if (access.companyWide && !person) {
    const totals = await loadCompanyTotals(c, zonedDayStart(now, tz));
    cards = { ...totals, activePeople: live.filter(activeOf).length, idlePeople: live.filter((r) => !activeOf(r)).length };
  } else if (access.companyWide && person && people[0]) {
    const r = people[0];
    cards = { completed: r.completed, open: r.openTasks, overdue: r.overdue, late: r.late, avgDays: r.avgDays, messages: r.messages, activePeople: activeOf(r) ? 1 : 0, idlePeople: activeOf(r) ? 0 : 1 };
  }

  const today = await loadToday(c, now, ids, people.filter((r) => r.status === "ACTIVE"));
  return {
    mode: access.mode,
    window: windowInfo(win, tz),
    filters: { space, person, sort, dir: sort === "name" && !query.dir ? "asc" : dir },
    spaces: await spaceOptions(access),
    cards,
    people,
    today,
    sections: sectionLoad.columns,
    sectionValues: valuesOf(sectionLoad),
  };
}

function emptyOverview(access: BoardAccess, query: BoardQuery, win: BoardWindow, tz: string, space: string | null): Overview {
  return {
    mode: access.mode,
    window: windowInfo(win, tz),
    filters: { space, person: query.person || null, sort: sortKeyOf(query.sort), dir: query.dir === "asc" ? "asc" : "desc" },
    spaces: [],
    cards: null,
    people: [],
    today: { done: [], idle: [] },
    sections: [],
    sectionValues: {},
  };
}

/** «اليوم»: who did what since the company's day began, and who has done nothing yet (only the people listed). */
async function loadToday(c: Ctx, now: Date, ids: Ids, listed: readonly { userId: string; name: string }[]): Promise<{ done: TodayRow[]; idle: { userId: string; name: string }[] }> {
  const todayKey = dayKeyOf(now, c.tz);
  const win = resolveWindow({ from: todayKey, to: todayKey }, now, c.tz);
  const people = new Map(listed.map((r) => [r.userId, r.name]));
  const wanted: Ids = ids ?? null;
  const facts = await loadFacts(c, wanted ?? [...people.keys()], win);
  const byUser = new Map<string, TodayRow>();
  for (const f of facts) {
    const name = people.get(f.userId);
    if (name === undefined) continue;
    const row = byUser.get(f.userId) ?? { userId: f.userId, name, tasks: 0, steps: 0, messages: 0, first: null, last: null };
    if (f.kind === "task") row.tasks += f.n;
    if (f.kind === "step") row.steps += f.n;
    if (f.kind === "msg") row.messages += f.n;
    if (!row.first || f.first.toISOString() < row.first) row.first = f.first.toISOString();
    if (!row.last || f.last.toISOString() > row.last) row.last = f.last.toISOString();
    byUser.set(f.userId, row);
  }
  const done = [...byUser.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));
  const idle = [...people].filter(([id]) => !byUser.has(id)).map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { done, idle };
}

/**
 * «اليوم» of the whole company, without the rest of the overview (no people table, no sections): the owner's control panel on the home screen
 * asks for this. The owner's access only (the caller checked `boardAccess`); it reads, and writes nothing.
 */
export async function loadCompanyToday(access: BoardAccess, now: Date = new Date()): Promise<{ done: TodayRow[]; idle: { userId: string; name: string }[]; staff: number; timeZone: string }> {
  if (!access.companyWide) throw new NotFoundError("ownerboard.not_found");
  const tz = await orgTimeZone(access.orgId);
  const win = windowFor({ preset: "today" }, now, tz);
  const c: Ctx = { orgId: access.orgId, tz, win, scope: access.scope };
  const members = (await baseMembers(access, access.scope, null)).filter((m) => m.status === "ACTIVE");
  const today = await loadToday(c, now, null, members);
  return { ...today, staff: members.length, timeZone: tz };
}

// ───────────────────────────────────────── a person ─────────────────────────────────────────

export interface DayTask {
  id: string;
  number: number;
  title: string;
}

export interface DayRow {
  day: string;
  tasks: DayTask[];
  steps: number;
  messages: number;
  first: string | null;
  last: string | null;
}

export interface OpenTask {
  id: string;
  number: number;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  space: string;
}

export interface PersonView {
  mode: BoardAccess["mode"];
  window: WindowInfo;
  person: PersonRow;
  /** Newest day first; a day with nothing is a row of zeros (every zero is shown as zero). */
  days: DayRow[];
  open: OpenTask[];
  openTotal: number;
  spaces: SpaceOption[];
  sections: LoadedSections["columns"];
  sectionValues: Record<string, number | string | null>;
  /** The viewer reads their own page. */
  own: boolean;
}

/**
 * One person's page: their days, the tasks they finished (titles only), their open and overdue tasks, the spaces they work
 * in. 404 for anybody outside the viewer's reach. Message BODIES are never read; only their count per day.
 */
export async function loadPerson(access: BoardAccess, userId: string, query: BoardQuery, opts: LoadOptions = {}): Promise<PersonView> {
  assertMayOpenPerson(access, userId);
  const now = opts.now ?? new Date();
  const tz = await orgTimeZone(access.orgId);
  const win = windowFor(query, now, tz);
  // a person's page reads their work inside the viewer's reach: the owner reads all of it (or one space), a team lead only the
  // spaces and teams they cover, and a person reading THEIR OWN page reads all of their own work
  const own = userId === access.viewerId;
  const everything: BoardScope = { restricted: false, workspaceIds: [], teamIds: [] };
  const space = query.space || null;
  const scope = space && access.mode !== "self" ? await narrowScope(access, space) : own ? everything : access.scope;
  const c: Ctx = { orgId: access.orgId, tz, win, scope };

  const infos = await membersByIds(access.orgId, [userId]);
  const info = infos[0];
  if (!info) throw new NotFoundError("ownerboard.not_found");
  const { rows } = await assemble(access, c, [userId], infos, now, true);
  const person = rows[0];
  if (!person) throw new NotFoundError("ownerboard.not_found");

  const todayStart = zonedDayStart(now, tz);
  const [facts, finished, openRows, openCount, spaceRows, sectionLoad] = await Promise.all([
    loadFacts(c, [userId]),
    db.$queryRaw<{ id: string; number: number; title: string; day: string; at: Date }[]>(Prisma.sql`
      WITH ${doneAndCredit(c)}
      SELECT d."id", d."number", d."title", ${dayOf('d."completedAt"', tz)} AS "day", d."completedAt" AS "at"
      FROM credit cr JOIN done d ON d."id" = cr."taskId"
      WHERE cr."userId" = ${userId}
      ORDER BY d."completedAt" ASC LIMIT ${MAX_ROWS}`),
    db.$queryRaw<{ id: string; number: number; title: string; dueDate: Date | null; space: string }[]>(Prisma.sql`
      WITH open AS (
        SELECT t."id", t."number", t."title", t."dueDate", t."assigneeId", t."workspaceId" FROM "Task" t
        WHERE t."orgId" = ${c.orgId} AND t."completedAt" IS NULL AND NOT t."archived" ${taskScope("t", scope)}
      ),
      held AS (
        SELECT o.* FROM open o WHERE o."assigneeId" = ${userId}
        UNION
        SELECT o.* FROM open o JOIN "TaskCoAssignee" co ON co."taskId" = o."id" WHERE co."userId" = ${userId}
      )
      SELECT h."id", h."number", h."title", h."dueDate", w."name" AS "space"
      FROM held h JOIN "Workspace" w ON w."id" = h."workspaceId"
      ORDER BY (h."dueDate" IS NULL), h."dueDate" ASC, h."number" ASC LIMIT 200`),
    Promise.resolve(person.openTasks),
    spacesOfPerson(access, userId, scope),
    sectionsFor(c, [userId], opts.sections),
  ]);

  const byDay = new Map<string, DayRow>();
  const dayRow = (day: string): DayRow => {
    let r = byDay.get(day);
    if (!r) {
      r = { day, tasks: [], steps: 0, messages: 0, first: null, last: null };
      byDay.set(day, r);
    }
    return r;
  };
  for (const f of facts) {
    const r = dayRow(f.day);
    if (f.kind === "step") r.steps += f.n;
    if (f.kind === "msg") r.messages += f.n;
    const first = f.first.toISOString();
    const last = f.last.toISOString();
    if (!r.first || first < r.first) r.first = first;
    if (!r.last || last > r.last) r.last = last;
  }
  for (const t of finished) dayRow(t.day).tasks.push({ id: t.id, number: t.number, title: t.title });
  const days = [...win.days].reverse().map((d) => byDay.get(d) ?? { day: d, tasks: [], steps: 0, messages: 0, first: null, last: null });

  return {
    mode: access.mode,
    window: windowInfo(win, tz),
    person,
    days,
    open: openRows.map((o) => ({ id: o.id, number: o.number, title: o.title, dueDate: o.dueDate ? o.dueDate.toISOString() : null, overdue: o.dueDate !== null && o.dueDate < todayStart, space: o.space })),
    openTotal: openCount,
    spaces: spaceRows,
    sections: sectionLoad.columns,
    sectionValues: sectionLoad.values.get(userId) ?? {},
    own,
  };
}

/** The spaces a person works in (their membership rows), limited for a team lead to the spaces the board covers. */
async function spacesOfPerson(access: BoardAccess, userId: string, scope: BoardScope): Promise<SpaceOption[]> {
  const where: Prisma.WorkspaceMemberWhereInput = { userId, workspace: { organizationId: access.orgId, archivedAt: null } };
  if (scope.restricted) {
    const teamSpaces = scope.teamIds.length ? await db.team.findMany({ where: { id: { in: scope.teamIds } }, select: { workspaceId: true } }) : [];
    const ids = [...new Set([...scope.workspaceIds, ...teamSpaces.map((t) => t.workspaceId)])];
    where.workspaceId = { in: ids };
  }
  const rows = await db.workspaceMember.findMany({ where, select: { workspace: { select: { id: true, name: true } } } });
  return rows.map((r) => r.workspace).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}


// ───────────────────────────────────────── the same numbers, for another feature ─────────────────────────────────────────

/**
 * The board's own per-person numbers (completed, on time, late, steps, messages, open, overdue) for these people over one window, the
 * whole company's data (no space or team limit). «الأداء والتطوير» builds its automatic indicators from THIS function, so the score and
 * the board can never disagree. The caller decides who may read whom: nothing here checks access, and nothing here writes.
 * People who are not (non-guest) members of the company are left out.
 */
export async function loadPeopleActivity(orgId: string, userIds: readonly string[], win: BoardWindow, tz: string, now: Date = new Date()): Promise<PersonRow[]> {
  if (userIds.length === 0) return [];
  const members = await membersByIds(orgId, userIds);
  const c: Ctx = { orgId, tz, win, scope: { restricted: false, workspaceIds: [], teamIds: [] } };
  const access: BoardAccess = { mode: "owner", orgId, viewerId: "", reach: null, ownPage: false, companyWide: true, scope: c.scope };
  const { rows } = await assemble(access, c, userIds, members, now, true);
  return rows;
}
