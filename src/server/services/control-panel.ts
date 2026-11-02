import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { boardAccess, type BoardAccess } from "@/server/policy/board";
import { assertFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { loadCompanyToday, loadPeopleActivity, type TodayRow } from "@/server/services/owner-board";
import { loadAnalytics } from "@/server/services/analytics";
import { addDays, dayKeyOf, resolveWindow } from "@/lib/owner-board";
import { zonedDayStart } from "@/lib/zoned-time";
import {
  FORECAST_DAYS,
  IDEA_WAIT_DAYS,
  STALE_DAYS,
  buildInsights,
  changePercent,
  fillSeries,
  rateOf,
  type Insight,
  type PersonWeek,
  type WeekPoint,
  type WeekTotals,
} from "@/lib/control-panel";

/**
 * «لوحة التحكم» — THE NUMBERS, for the OWNER alone. It sits on top of «لوحة المالك» (every per-person figure is the board's own, from
 * `loadPeopleActivity`, so the two can never disagree) and of the old «التقارير» (`loadAnalytics`, which this file merges and extends with
 * a weekly series and a table per space). It computes in SQL over the company's own rows in the company's day, stores nothing, and
 * writes nothing: reading leaves no trace (no audit row, no notification, no «seen»).
 *
 *   ACCESS   `controlPanelAccess`: the switch «لوحة التحكم» is on, «لوحة المالك» is on, and the person is an OWNER-rank member. Anybody else
 *            gets «not found», never «forbidden»: the panel does not say it exists. A team lead's and an employee's board is untouched.
 *   TASKS    a task counts ONCE, whoever holds it (nobody, one person or several): the company's totals are over tasks. The per-person
 *            figures (who finished how many) are the board's and credit every holder.
 *   A DAY    always the company's day (`Organization.timezone`). «٧ أيام» are the last seven company days, today included.
 *
 * ⚠️ The insights name people (late, idle, loaded): it is the owner's, and each sentence carries its formula (src/lib/control-panel.ts).
 * 🔧 Only counts, dates and the names of the company's own staff are read: never a customer, a price or the text of a message.
 */

export async function controlPanelAccess(actor: Actor): Promise<BoardAccess> {
  await assertFeatureOn(actor.orgId, "controlPanel");
  const access = await boardAccess(actor);
  if (access.mode !== "owner" || !access.companyWide) throw new NotFoundError("cp.not_found");
  return access;
}

// ───────────────────────────────────────── SQL pieces ─────────────────────────────────────────

const raw = (text: string) => Prisma.raw(text);
/** An instant as a `timestamp` (the columns are `timestamp(3)` holding UTC): sent as text, so the session zone never matters. */
const ts = (d: Date) => Prisma.sql`${d.toISOString().replace("Z", "")}::text::timestamp`;
/** The company's wall clock of a UTC `timestamp` column. */
const local = (col: string, tz: string) => Prisma.sql`((${raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`;
const arr = (ids: readonly string[]) => Prisma.sql`${[...ids]}::text[]`;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
export const SERIES_WEEKS = 8;

interface Stats {
  completed: number;
  withDue: number;
  onTime: number;
}

/** What was finished in [start, end): how many (a task once), how many had a day, how many were on or before it. */
async function completedStats(orgId: string, tz: string, start: Date, end: Date, spaces: readonly string[] | null): Promise<Stats & { avgDays: number | null }> {
  const rows = await db.$queryRaw<{ completed: number; withDue: number; onTime: number; avgDays: number | null }[]>(Prisma.sql`
    SELECT count(*)::int AS "completed",
      (count(*) FILTER (WHERE t."dueDate" IS NOT NULL))::int AS "withDue",
      (count(*) FILTER (WHERE t."dueDate" IS NOT NULL AND ${local('t."completedAt"', tz)}::date <= ${local('t."dueDate"', tz)}::date))::int AS "onTime",
      avg(GREATEST(extract(epoch FROM (t."completedAt" - t."createdAt")) / 86400.0, 0))::float8 AS "avgDays"
    FROM "Task" t
    WHERE t."orgId" = ${orgId} AND t."completedAt" >= ${ts(start)} AND t."completedAt" < ${ts(end)}
      ${spaces ? Prisma.sql`AND t."workspaceId" = ANY(${arr(spaces)})` : Prisma.empty}`);
  const r = rows[0];
  return { completed: r?.completed ?? 0, withDue: r?.withDue ?? 0, onTime: r?.onTime ?? 0, avgDays: r?.avgDays ?? null };
}

interface Figures {
  open: number;
  overdue: number;
  unassigned: number;
  stale: number;
  completedForecastWindow: number;
  ideasWaiting: number;
  overdueBySpace: { name: string; n: number }[];
}

/** The company's open work right now, and the facts the insights are made of. */
async function loadFigures(orgId: string, todayStart: Date, now: Date): Promise<Figures> {
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const windowStart = new Date(todayStart.getTime() - (FORECAST_DAYS - 1) * DAY_MS);
  const ideasBefore = new Date(now.getTime() - IDEA_WAIT_DAYS * DAY_MS);
  const [open, overdueBySpace, forecast, ideas] = await Promise.all([
    db.$queryRaw<{ open: number; overdue: number; unassigned: number; stale: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "open",
        (count(*) FILTER (WHERE t."dueDate" < ${ts(todayStart)}))::int AS "overdue",
        (count(*) FILTER (WHERE t."assigneeId" IS NULL AND NOT EXISTS (SELECT 1 FROM "TaskCoAssignee" co WHERE co."taskId" = t."id")))::int AS "unassigned",
        (count(*) FILTER (WHERE t."updatedAt" < ${ts(staleBefore)}))::int AS "stale"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."completedAt" IS NULL AND NOT t."archived"`),
    db.$queryRaw<{ name: string; n: number }[]>(Prisma.sql`
      SELECT w."name" AS "name", count(*)::int AS "n"
      FROM "Task" t JOIN "Workspace" w ON w."id" = t."workspaceId"
      WHERE t."orgId" = ${orgId} AND t."completedAt" IS NULL AND NOT t."archived" AND t."dueDate" < ${ts(todayStart)} AND w."archivedAt" IS NULL
      GROUP BY w."name" ORDER BY 2 DESC, 1 LIMIT 5`),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "n" FROM "Task" t WHERE t."orgId" = ${orgId} AND t."completedAt" >= ${ts(windowStart)} AND t."completedAt" < ${ts(now)}`),
    db.idea.count({ where: { orgId, status: "NEW", createdAt: { lt: ideasBefore } } }),
  ]);
  return {
    open: open[0]?.open ?? 0,
    overdue: open[0]?.overdue ?? 0,
    unassigned: open[0]?.unassigned ?? 0,
    stale: open[0]?.stale ?? 0,
    completedForecastWindow: forecast[0]?.n ?? 0,
    ideasWaiting: ideas,
    overdueBySpace,
  };
}

// ───────────────────────────────────────── the home panel ─────────────────────────────────────────

export interface PanelKpis {
  doneToday: number;
  overdue: number;
  open: number;
  completedWeek: number;
  completedPrev: number;
  /** The week against the one before, a whole percent; null with nothing to compare with. */
  completedChange: number | null;
  onTimeRate: number | null;
  onTimePrev: number | null;
  /** People with at least one recorded action today, of the staff (ACTIVE, not guests). */
  activeToday: number;
  staff: number;
}

export interface PanelHome {
  asOf: string;
  timeZone: string;
  today: string;
  kpis: PanelKpis;
  insights: Insight[];
  todayStrip: { done: TodayRow[]; idle: { userId: string; name: string }[] };
}

/** The ACTIVE staff (never a guest, never a suspended or offboarded person). */
async function staffIds(orgId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({ where: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** What the owner sees on the home screen: the cards, the sentences worth his eye, and who did what today. */
export async function loadPanelHome(access: BoardAccess, now: Date = new Date()): Promise<PanelHome> {
  const { orgId } = access;
  const tz = await orgTimeZone(orgId);
  const today = dayKeyOf(now, tz);
  const todayStart = zonedDayStart(now, tz);
  const win = resolveWindow({ preset: "7" }, now, tz);
  const prevWin = resolveWindow({ from: addDays(win.from, -7), to: addDays(win.from, -1) }, now, tz);
  const ids = await staffIds(orgId);

  const [week, strip, thisStats, prevStats, todayStats, figures] = await Promise.all([
    loadPeopleActivity(orgId, ids, win, tz, now),
    loadCompanyToday(access, now),
    completedStats(orgId, tz, win.start, win.end, null),
    completedStats(orgId, tz, prevWin.start, prevWin.end, null),
    completedStats(orgId, tz, todayStart, new Date(now.getTime() + 1000), null),
    loadFigures(orgId, todayStart, now),
  ]);

  const people: PersonWeek[] = week
    .filter((r) => r.status === "ACTIVE")
    .map((r) => ({ userId: r.userId, name: r.name, completed: r.completed, openTasks: r.openTasks, overdue: r.overdue, lastActiveDay: r.lastActivity ? dayKeyOf(new Date(r.lastActivity), tz) : null }));
  const thisWeek: WeekTotals = { completed: thisStats.completed, onTime: thisStats.onTime, withDue: thisStats.withDue };
  const prevWeek: WeekTotals = { completed: prevStats.completed, onTime: prevStats.onTime, withDue: prevStats.withDue };

  const insights = buildInsights({ today, week: people, thisWeek, prevWeek, ...figures });
  const kpis: PanelKpis = {
    doneToday: todayStats.completed,
    overdue: figures.overdue,
    open: figures.open,
    completedWeek: thisWeek.completed,
    completedPrev: prevWeek.completed,
    completedChange: changePercent(thisWeek.completed, prevWeek.completed),
    onTimeRate: rateOf(thisWeek.onTime, thisWeek.withDue),
    onTimePrev: rateOf(prevWeek.onTime, prevWeek.withDue),
    activeToday: strip.done.length,
    staff: strip.staff,
  };
  return { asOf: now.toISOString(), timeZone: tz, today, kpis, insights, todayStrip: { done: strip.done, idle: strip.idle } };
}

// ───────────────────────────────────────── the reports ─────────────────────────────────────────

export interface PanelReports {
  timeZone: string;
  spaceId: string | null;
  spaces: { id: string; name: string }[];
  totals: { total: number; open: number; completed: number; overdue: number; created30: number; completed30: number; upcoming7: number; rate: number | null; avgDays: number | null };
  /** Created and finished per 7 days, oldest first (`SERIES_WEEKS` points). */
  series: WeekPoint[];
  byPriority: { priority: string; n: number }[];
  workload: { userId: string; name: string; n: number }[];
  ideas: { total: number; byStatus: { status: string; n: number }[] };
  bySpace: { id: string; name: string; open: number; overdue: number; done30: number }[];
}

/**
 * «التقارير», merged into the panel: the old report's numbers (the same `loadAnalytics`, so the two never disagree), the weekly series and one
 * row per space. `space` narrows everything to that space (a space of another company is «not found»).
 */
export async function loadPanelReports(access: BoardAccess, query: { space?: string | null } = {}, now: Date = new Date()): Promise<PanelReports> {
  const { orgId } = access;
  const tz = await orgTimeZone(orgId);
  const spaces = await db.workspace.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const spaceId = query.space || null;
  if (spaceId && !spaces.some((s) => s.id === spaceId)) throw new NotFoundError("cp.not_found");
  const wsIds = spaceId ? [spaceId] : spaces.map((s) => s.id);

  const todayStart = zonedDayStart(now, tz);
  // the start of the company's next day (36 hours after this one began is inside it whatever the zone does with the clock)
  const tomorrow = zonedDayStart(new Date(todayStart.getTime() + 36 * 3_600_000), tz);
  const seriesFrom = new Date(tomorrow.getTime() - SERIES_WEEKS * WEEK_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);

  const [data, avg30, created, finished, rowsBySpace] = await Promise.all([
    loadAnalytics(orgId, wsIds, now, undefined, spaceId ? { workspaceId: spaceId } : {}),
    completedStats(orgId, tz, since30, now, wsIds),
    db.$queryRaw<{ ago: number; n: number }[]>(Prisma.sql`
      SELECT floor(extract(epoch FROM (${ts(tomorrow)} - t."createdAt")) / 604800)::int AS "ago", count(*)::int AS "n"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."workspaceId" = ANY(${arr(wsIds)}) AND t."createdAt" >= ${ts(seriesFrom)} AND t."createdAt" < ${ts(tomorrow)} GROUP BY 1`),
    db.$queryRaw<{ ago: number; n: number }[]>(Prisma.sql`
      SELECT floor(extract(epoch FROM (${ts(tomorrow)} - t."completedAt")) / 604800)::int AS "ago", count(*)::int AS "n"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."workspaceId" = ANY(${arr(wsIds)}) AND t."completedAt" >= ${ts(seriesFrom)} AND t."completedAt" < ${ts(tomorrow)} GROUP BY 1`),
    db.$queryRaw<{ id: string; open: number; overdue: number; done30: number }[]>(Prisma.sql`
      SELECT t."workspaceId" AS "id",
        (count(*) FILTER (WHERE t."completedAt" IS NULL AND NOT t."archived"))::int AS "open",
        (count(*) FILTER (WHERE t."completedAt" IS NULL AND NOT t."archived" AND t."dueDate" < ${ts(todayStart)}))::int AS "overdue",
        (count(*) FILTER (WHERE t."completedAt" >= ${ts(since30)}))::int AS "done30"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."workspaceId" = ANY(${arr(wsIds)}) GROUP BY 1`),
  ]);

  const points = new Map<number, WeekPoint>();
  for (const r of created) if (r.ago >= 0 && r.ago < SERIES_WEEKS) points.set(r.ago, { ago: r.ago, created: r.n, completed: points.get(r.ago)?.completed ?? 0 });
  for (const r of finished) if (r.ago >= 0 && r.ago < SERIES_WEEKS) points.set(r.ago, { ago: r.ago, created: points.get(r.ago)?.created ?? 0, completed: r.n });

  const nameOfSpace = new Map(spaces.map((s) => [s.id, s.name] as const));
  const bySpace = rowsBySpace
    .filter((r) => nameOfSpace.has(r.id))
    .map((r) => ({ id: r.id, name: nameOfSpace.get(r.id) as string, open: r.open, overdue: r.overdue, done30: r.done30 }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, "ar"));

  return {
    timeZone: tz,
    spaceId,
    spaces,
    totals: {
      total: data.total,
      open: data.open,
      completed: data.completed,
      overdue: data.overdue,
      created30: data.created30,
      completed30: data.completed30,
      upcoming7: data.upcoming7,
      rate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : null,
      avgDays: avg30.avgDays,
    },
    series: fillSeries([...points.values()], SERIES_WEEKS),
    byPriority: data.byPriority.map((r) => ({ priority: r.priority, n: r._count._all })),
    workload: data.assignees.map((a) => ({ userId: a.assigneeId as string, name: data.nameOf.get(a.assigneeId as string) ?? "—", n: a._count._all })),
    ideas: { total: data.ideas, byStatus: data.byStatus30.map((r) => ({ status: r.status, n: r._count._all })) },
    bySpace,
  };
}
