import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { boardAccess, type BoardAccess } from "@/server/policy/board";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { landingOf, workTabsOf, type Landing } from "@/server/policy/org-settings";
import { devAccess } from "@/server/policy/team-development";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { hasOrder, readCompanyMenuOrder, type NavOrder } from "@/lib/nav/order";
import { perRequest } from "@/server/env";
import { PANEL_REDIRECTS, panelRedirectHref } from "@/lib/legacy-routes";
import { resolveTimeZone } from "@/lib/zoned-time";
import { orgTimeZone } from "@/server/services/org-day";
import { loadCompanyToday, loadPeopleActivity, type TodayRow } from "@/server/services/owner-board";
import { loadAnalytics } from "@/server/services/analytics";
import { ideaPlaceWhere } from "@/server/services/ideas";
import { spaceFigures } from "@/server/services/space-figures";
import { addDays, dayKeyOf, resolveWindow } from "@/lib/owner-board";
import { zonedDayStart } from "@/lib/zoned-time";
import {
  FORECAST_DAYS,
  IDEA_WAIT_DAYS,
  STALE_DAYS,
  FIRST_SECTION,
  buildInsights,
  changePercent,
  checkCompanySettings,
  fillSeries,
  isPanelSection,
  panelSectionsFor,
  rateOf,
  type Insight,
  type IntegrationPart,
  type PanelFacts,
  type PanelScope,
  type PanelSectionKey,
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
  // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
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
  /** The space with the most ideas waiting for a first look, counted exactly as the page its link opens lists them; null when none waits. */
  ideasWaiting: { id: string; name: string; n: number } | null;
  overdueBySpace: { id: string; name: string; n: number }[];
}

/**
 * B4 — where the ideas that waited past the line are: per space, counted with `ideaPlaceWhere`, the very filter the «الأفكار» page of that space uses (inside
 * «الشركة» it also reads the company's own and the shared ones), so the number in the sentence is what its link opens. The space with the most, ties by name.
 */
async function ideasWaitingTop(orgId: string, spaces: readonly { id: string; name: string; kind: string }[], before: Date): Promise<Figures["ideasWaiting"]> {
  const counted = await Promise.all(
    spaces.map(async (s) => ({
      id: s.id,
      name: s.name,
      n: await db.idea.count({ where: { orgId, status: "NEW", createdAt: { lt: before }, AND: [ideaPlaceWhere({ spaceId: s.id, isHq: s.kind === "HQ" })] } }),
    })),
  );
  return counted.filter((c) => c.n > 0).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ar"))[0] ?? null;
}

/** The company's open work right now, and the facts the insights are made of. */
async function loadFigures(orgId: string, todayStart: Date, now: Date): Promise<Figures> {
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const windowStart = new Date(todayStart.getTime() - (FORECAST_DAYS - 1) * DAY_MS);
  const ideasBefore = new Date(now.getTime() - IDEA_WAIT_DAYS * DAY_MS);
  const spaces = await db.workspace.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { id: true, name: true, kind: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const [open, perSpace, forecast, ideas] = await Promise.all([
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.$queryRaw<{ open: number; overdue: number; unassigned: number; stale: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "open",
        (count(*) FILTER (WHERE t."dueDate" < ${ts(todayStart)}))::int AS "overdue",
        (count(*) FILTER (WHERE t."assigneeId" IS NULL AND NOT EXISTS (SELECT 1 FROM "TaskCoAssignee" co WHERE co."taskId" = t."id")))::int AS "unassigned",
        (count(*) FILTER (WHERE t."updatedAt" < ${ts(staleBefore)}))::int AS "stale"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."completedAt" IS NULL AND NOT t."archived"`),
    // B4: the per-space late numbers are `spaceFigures` (an owner-level aggregate: no viewer scope; its audience is narrowed in A1.3, policy/board.ts)
    spaceFigures({ orgId, spaceIds: spaces.map((s) => s.id), todayStart }),
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "n" FROM "Task" t WHERE t."orgId" = ${orgId} AND t."completedAt" >= ${ts(windowStart)} AND t."completedAt" < ${ts(now)}`),
    ideasWaitingTop(orgId, spaces, ideasBefore),
  ]);
  const overdueBySpace = spaces
    .map((s) => ({ id: s.id, name: s.name, n: perSpace.get(s.id)?.overdue ?? 0 }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ar"))
    .slice(0, 5);
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
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.$queryRaw<{ ago: number; n: number }[]>(Prisma.sql`
      SELECT floor(extract(epoch FROM (${ts(tomorrow)} - t."createdAt")) / 604800)::int AS "ago", count(*)::int AS "n"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."workspaceId" = ANY(${arr(wsIds)}) AND t."createdAt" >= ${ts(seriesFrom)} AND t."createdAt" < ${ts(tomorrow)} GROUP BY 1`),
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    db.$queryRaw<{ ago: number; n: number }[]>(Prisma.sql`
      SELECT floor(extract(epoch FROM (${ts(tomorrow)} - t."completedAt")) / 604800)::int AS "ago", count(*)::int AS "n"
      FROM "Task" t WHERE t."orgId" = ${orgId} AND t."workspaceId" = ANY(${arr(wsIds)}) AND t."completedAt" >= ${ts(seriesFrom)} AND t."completedAt" < ${ts(tomorrow)} GROUP BY 1`),
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    // B4: ONE source for the per-space numbers (`spaceFigures`, shared with «كل المساحات» and the overview's insight)
    spaceFigures({ orgId, spaceIds: wsIds, todayStart, since: since30 }),
  ]);

  const points = new Map<number, WeekPoint>();
  for (const r of created) if (r.ago >= 0 && r.ago < SERIES_WEEKS) points.set(r.ago, { ago: r.ago, created: r.n, completed: points.get(r.ago)?.completed ?? 0 });
  for (const r of finished) if (r.ago >= 0 && r.ago < SERIES_WEEKS) points.set(r.ago, { ago: r.ago, created: points.get(r.ago)?.created ?? 0, completed: r.n });

  const nameOfSpace = new Map(spaces.map((s) => [s.id, s.name] as const));
  const bySpace = [...rowsBySpace]
    .filter(([id]) => nameOfSpace.has(id))
    .map(([id, r]) => ({ id, name: nameOfSpace.get(id) as string, open: r.open, overdue: r.overdue, done30: r.done }))
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

// ───────────────────────────────────────── A2.1: ONE control panel ─────────────────────────────────────────

/**
 * WHO MAY OPEN WHICH SECTION of the one panel (switch `controlPanelV2`). The page and the old addresses ask THIS and nothing else:
 *   - the switch off: «not found» (`features.off`), the old pages answer exactly as they did;
 *   - a guest, or a person who may open no section: «not found»;
 *   - a section that is not in `sections`: «not found» (`assertPanelSection`), never «forbidden».
 * Each section's own content is decided again by the service that fills it (board, accounts, archive, assistant…): this list is what is OFFERED, never what is
 * enough. Reading writes nothing.
 */
export interface PanelAccess {
  orgId: string;
  viewerId: string;
  sections: PanelSectionKey[];
  /** The board's reach for the overview and «الناس» (null for a person who has none: their own page is «لوحتي»). */
  board: BoardAccess | null;
}

const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
};

/**
 * What the server knows about this person, before the list is made. The board / assistant / development reads each answer «not found» for «no». Read ONCE per request (the
 * old page that redirects and the panel it redirects to are two requests, but one page asks for the facts several times).
 */
export const panelFactsOf: (actor: Actor) => Promise<{ facts: PanelFacts; board: BoardAccess | null }> = perRequest(readPanelFacts);

async function readPanelFacts(actor: Actor): Promise<{ facts: PanelFacts; board: BoardAccess | null }> {
  if (actor.isExternal) return { facts: { external: true, ownerRank: false, role: actor.role, caps: actor.caps, board: null, assistant: false, development: false }, board: null };
  const [board, assistant, dev] = await Promise.all([orNull(() => boardAccess(actor)), orNull(() => assistantAccess(actor)), orNull(() => devAccess(actor))]);
  const reach = board && board.mode !== "self" ? board : null;
  const reachMode: "owner" | "team" | null = board?.mode === "owner" ? "owner" : board?.mode === "team" ? "team" : null;
  return {
    board: reach,
    facts: {
      external: false,
      ownerRank: actor.isOwner,
      role: actor.role,
      caps: actor.caps,
      board: reachMode,
      assistant: assistant !== null,
      development: dev !== null && (dev.isOwner || dev.isSupervisor || dev.canManageLines),
    },
  };
}

export async function panelAccess(actor: Actor): Promise<PanelAccess> {
  await assertFeatureOn(actor.orgId, "controlPanelV2");
  const { facts, board } = await panelFactsOf(actor);
  const sections = panelSectionsFor(facts);
  if (sections.length === 0) throw new NotFoundError("cpv2.not_found");
  return { orgId: actor.orgId, viewerId: actor.userId, sections, board };
}

/** The section a person asked for: «not found» when it does not exist or they may not open it. Nothing tells the two apart. */
export function assertPanelSection(access: PanelAccess, key: string | null | undefined): PanelSectionKey {
  if (!key) return access.sections.includes(FIRST_SECTION) ? FIRST_SECTION : (access.sections[0] as PanelSectionKey);
  if (!isPanelSection(key) || !access.sections.includes(key)) throw new NotFoundError("cpv2.not_found");
  return key;
}

/**
 * Where an OLD address leads for this person: its section's address while the switch is on and they may open that section, otherwise null (the old page
 * is drawn as it always was, so no address becomes a dead end for somebody the panel does not serve).
 */
export async function panelRedirectFor(actor: Actor, address: string, extra?: Readonly<Record<string, string | undefined>>): Promise<string | null> {
  const target = PANEL_REDIRECTS[address];
  if (!target) return null;
  if (!(await isFeatureOn(actor.orgId, "controlPanelV2"))) return null;
  if (actor.isExternal) return null;
  const { facts } = await panelFactsOf(actor);
  if (!panelSectionsFor(facts).includes(target.section)) return null;
  // a part of «التكاملات» that is not offered to this person (the AI connection is the owner's) keeps the old page, which answers as it always did
  if (target.section === "integrations" && target.part && !(await integrationPartsOf(actor)).includes(target.part as IntegrationPart)) return null;
  return panelRedirectHref(address, extra, await panelOneDoorOn(actor));
}

/**
 * S3.2 — is «الإعدادات» ONE door for this company (`settingsOneDoor`) AND the one control panel it needs (`controlPanelV2`) on? Then the panel is its own place with ONE navigation,
 * «الناس» is one section, and the settings sections are «إعدادات الشركة». The same rule as `oneDoorOnFor` (src/components/settings-me/server-data.ts) and `settingsOneDoorOf` (src/lib/nav/shell-v2.ts).
 */
export async function panelOneDoorOn(actor: Pick<Actor, "orgId">): Promise<boolean> {
  const [door, panel] = await Promise.all([isFeatureOn(actor.orgId, "settingsOneDoor"), isFeatureOn(actor.orgId, "controlPanelV2")]);
  return door && panel;
}

/**
 * The parts of «التكاملات» this person may open: the cards of n8n / Drive / the door / backup / mail / the orders system and the Telegram bot for whoever holds
 * `integrations.manage`; the AI connection (ONE place: `AiSettings`) only for the OWNER rank while the owner's assistant or the first control panel is on
 * (the same people the two old screens served). Each card behind a part decides again on its own routes.
 */
export async function integrationPartsOf(actor: Actor): Promise<IntegrationPart[]> {
  if (actor.isExternal || !actor.caps.has("integrations.manage")) return [];
  const parts: IntegrationPart[] = ["automation", "telegram"];
  if (actor.isOwner) {
    const [zaki, assistant] = await Promise.all([companyPanelAccess(actor), orNull(() => assistantAccess(actor))]);
    if (zaki || assistant) parts.push("ai");
  }
  return parts;
}

/** The first control panel's access (the status of «زاكي أي أي» and the connect action), or null: the switch is off or the person is not the company-wide owner. */
export async function companyPanelAccess(actor: Actor): Promise<BoardAccess | null> {
  return orNull(() => controlPanelAccess(actor));
}

/**
 * «لوحتي» — a person's OWN page (D-A6): it does not depend on the owner's board switch, so it never goes through `boardAccess` (which asks for the switch). It needs
 * only the person's own box `board.self` (on for every staff rank; a partner can have it taken away) and that they are not an external partner. Everybody else: «not found».
 */
export function myBoardAccess(actor: Actor): BoardAccess {
  if (actor.isExternal || !actor.caps.has("board.self")) throw new NotFoundError("ownerboard.not_found");
  return { mode: "self", orgId: actor.orgId, viewerId: actor.userId, reach: new Set(), ownPage: true, companyWide: false, scope: { restricted: false, workspaceIds: [], teamIds: [] } };
}

/** What the numbers of this person are counted over (the seam A2.3 fills with «my team»): the company for the owner, the spaces and teams of a manager's reach. */
export async function panelScopeOf(access: BoardAccess): Promise<PanelScope> {
  if (!access.scope.restricted) return { kind: "company" };
  const [spaces, teams] = await Promise.all([
    access.scope.workspaceIds.length ? db.workspace.findMany({ where: { id: { in: access.scope.workspaceIds }, organizationId: access.orgId }, orderBy: { name: "asc" }, select: { name: true } }) : [],
    access.scope.teamIds.length ? db.team.findMany({ where: { id: { in: access.scope.teamIds }, workspace: { organizationId: access.orgId } }, orderBy: { name: "asc" }, select: { name: true } }) : [],
  ]);
  return { kind: "spaces", names: [...spaces.map((s) => s.name), ...teams.map((t) => t.name)] };
}

// ───────────────────────────────────────── «إعدادات الشركة» ─────────────────────────────────────────

export interface CompanySettingsView {
  name: string;
  timezone: string;
  landing: Landing;
  workTabs: string[];
  /** The company's own order of the menu (D-N5), null when the code's order is used. */
  menuOrder: NavOrder | null;
  /** How many people still hold an order of their own (it stays stored while the company's is set). */
  personalOrders: number;
}

/** The company's own settings. OWNER rank only: anybody else is «not found». */
export async function loadCompanySettings(actor: Actor): Promise<CompanySettingsView> {
  if (!actor.isOwner) throw new NotFoundError("cpv2.not_found");
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { name: true, timezone: true, settings: true } });
  if (!org) throw new NotFoundError("organization.not_found");
  const personalOrders = await db.user.count({ where: { navOrder: { not: Prisma.DbNull }, memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } } });
  return {
    name: org.name,
    timezone: resolveTimeZone(org.timezone),
    landing: landingOf(org.settings),
    workTabs: workTabsOf(org.settings),
    menuOrder: readCompanyMenuOrder(org.settings),
    personalOrders,
  };
}

const settingsObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * Writes the company's landing page, pinned work tabs, menu order and time zone — only the keys sent, every other key of the settings kept — under the
 * row lock of the company, audited (the key names, never a value). OWNER rank only. The person's own `navOrder` is never touched (D-N5): it stays stored
 * and is used again when the company's order is cleared (`menuOrder: null`).
 */
export async function saveCompanySettings(actor: Actor, raw: unknown): Promise<CompanySettingsView> {
  if (!actor.isOwner) throw new ForbiddenError("cpv2.company.owner_only");
  await assertFeatureOn(actor.orgId, "controlPanelV2");
  const checked = checkCompanySettings(raw);
  if (!checked.ok) throw new ValidationError([{ path: "settings", message: checked.key }]);
  const input = checked.value;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${actor.orgId} FOR UPDATE`;
    const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.orgId }, select: { settings: true } });
    const next = settingsObject(org.settings);
    if (input.landing !== undefined) next["landing"] = input.landing;
    if (input.workTabs !== undefined) next["workTabs"] = input.workTabs;
    if (input.menuOrder !== undefined) {
      if (input.menuOrder === null || !hasOrder(input.menuOrder)) delete next["menuOrder"];
      else next["menuOrder"] = input.menuOrder;
    }
    await tx.organization.update({
      where: { id: actor.orgId },
      data: { settings: next as Prisma.InputJsonValue, ...(input.timezone !== undefined ? { timezone: input.timezone } : {}) },
    });
  });
  await audit("org.company_settings_saved", { actorId: actor.userId, orgId: actor.orgId, meta: { keys: Object.keys(input) } });
  return loadCompanySettings(actor);
}
