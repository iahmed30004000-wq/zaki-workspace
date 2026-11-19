import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { chatList } from "@/server/chat/list";
import { unreadTotal } from "@/server/chat/unread";
import { actorCan, actorCanWork, type Actor } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { loadWorkScope, narrowScope, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { workRequestsOf } from "@/server/services/work-requests";
import { fmtRelative } from "@/lib/format";
import {
  type DashboardMine,
  type DashboardTeam,
  type TodayDashboard,
  type TodayFollowUp,
  type TodayMentions,
  type TodayWaiting,
  mentionRowsOf,
  topWaiting,
  weekProgress,
} from "@/lib/today";
import { nextZonedDayStart, resolveTimeZone, zonedDayStart, zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * The smart cards of «اليوم» — a few numbers, each over what the person may already see.
 *
 * The rules, each proved in tests/db/today-dashboard.test.ts with real rows:
 *
 *  - SCOPE. The same as the page's own list (src/server/services/today.ts): only the spaces the person can open
 *    (the OWNER every space of the company, everybody else only the spaces they were put in), inside the company
 *    they work in now, narrowed to the space they are in (`spaceId`), through the teams rule
 *    (`taskVisibleWhere`). A task, a message or a person of a space they cannot open adds nothing to any number.
 *  - A GUEST (an external partner) gets NO cards at all: no company number, not even their own (`null`).
 *  - THE COMPANY'S DAYS AND WEEK. «Today» and «this week» are counted by `Organization.timezone`, the week from
 *    الأحد (the region's first day), never by the server's clock.
 *  - MINE: open, overdue, due today, finished this week, and the week's progress. Only tasks assigned to the
 *    person, open (or finished this week) and not archived.
 *  - THE TEAM («الفريق هالأسبوع») is for the OWNER and whoever holds users.manage, counts only: finished this
 *    week, due today, and HOW MANY people hold something overdue. No name, no title, no customer, no price.
 *  - UNREAD CHAT is `unreadTotal` itself, the count behind the badge on «الدردشة»: it already leaves out every
 *    topic of a space the person is not in, and the owner's silent reading adds nothing.
 *  - The result is plain data (numbers and booleans): see `TodayDashboard` in src/lib/today.ts.
 *
 * ⚠️ A person who can open no space gets `null` too: nothing to count. 🔧 The page then draws no card.
 */
export interface DashboardOptions {
  now?: Date;
  /**
   * The space the person is in (id and kind, as `currentSpace` answers), or null for none. Leave it out for every
   * space the person can open. A space the person cannot open leaves nothing.
   */
  space?: { id: string; kind: string } | null;
}

export async function getTodayDashboard(actor: Actor, opts: DashboardOptions = {}): Promise<TodayDashboard | null> {
  // an external partner gets no company numbers, whatever the page asks
  if (actor.isExternal) return null;

  const now = opts.now ?? new Date();
  const spaceId = opts.space === undefined ? undefined : (opts.space?.id ?? null);

  const [org, accessible] = await Promise.all([
    db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }),
    loadWorkScope(actor.userId),
  ]);
  const scope = spaceId === undefined ? accessible : narrowScope(accessible, spaceId);

  // only spaces of THIS company, whatever the scope holds
  const ids = scopeSpaceIds(scope);
  const spaces = ids.length ? await db.workspace.findMany({ where: { id: { in: ids }, organizationId: actor.orgId }, select: { id: true } }) : [];
  if (spaces.length === 0) return null;
  const spaceIds = spaces.map((s) => s.id);

  // the company's clock: today, and the week from الأحد
  const timeZone = resolveTimeZone(org?.timezone);
  const clock = zonedParts(now, timeZone);
  const todayStart = zonedDayStart(now, timeZone);
  const tomorrowStart = nextZonedDayStart(now, timeZone);
  const weekStart = zonedWallTime({ year: clock.year, month: clock.month, day: clock.day - clock.weekday }, timeZone);
  const weekEnd = zonedWallTime({ year: clock.year, month: clock.month, day: clock.day - clock.weekday + 7 }, timeZone);

  const taskSpaces = actorCanWork(actor, "tasks.view") ? spaceIds : [];
  const visible = { orgId: actor.orgId, workspaceId: { in: taskSpaces }, archived: false, AND: [taskVisibleWhere(scope)] } satisfies Prisma.TaskWhereInput;
  const open = { ...visible, completedAt: null } satisfies Prisma.TaskWhereInput;
  const doneThisWeek = { ...visible, completedAt: { gte: weekStart, lt: weekEnd } } satisfies Prisma.TaskWhereInput;

  async function loadMine(): Promise<DashboardMine | null> {
    if (taskSpaces.length === 0) return null;
    const mine = { ...open, assigneeId: actor.userId } satisfies Prisma.TaskWhereInput;
    const [nOpen, nOverdue, nToday, nDone, nLeft] = await Promise.all([
      db.task.count({ where: mine }),
      db.task.count({ where: { ...mine, dueDate: { lt: todayStart } } }),
      db.task.count({ where: { ...mine, dueDate: { gte: todayStart, lt: tomorrowStart } } }),
      db.task.count({ where: { ...doneThisWeek, assigneeId: actor.userId } }),
      // what is still to do this week: late, today, or due before the week ends
      db.task.count({ where: { ...mine, dueDate: { lt: weekEnd } } }),
    ]);
    const { total, percent } = weekProgress(nDone, nLeft);
    return { open: nOpen, overdue: nOverdue, dueToday: nToday, doneWeek: nDone, weekTotal: total, percent };
  }

  async function loadTeam(): Promise<DashboardTeam | null> {
    if (taskSpaces.length === 0) return null;
    const [nDone, nToday, late] = await Promise.all([
      db.task.count({ where: doneThisWeek }),
      db.task.count({ where: { ...open, dueDate: { gte: todayStart, lt: tomorrowStart } } }),
      db.task.groupBy({
        by: ["assigneeId"],
        where: {
          ...open,
          dueDate: { lt: todayStart },
          // somebody who still works here: a suspended or offboarded person is not counted, and neither is a task nobody holds
          assignee: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } },
        },
      }),
    ]);
    return { doneWeek: nDone, dueToday: nToday, peopleLate: late.length };
  }

  const showTeam = actor.isOwner || actorCan(actor, "users.manage");
  const [mine, team, unreadChat] = await Promise.all([
    loadMine(),
    showTeam ? loadTeam() : Promise.resolve(null),
    unreadTotal({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, spaceId ?? null, opts.space?.kind === "HQ"),
  ]);
  return { mine, unreadChat, team };
}

// ───────────────────────────────────────── W1.7: the cards of the simplified «اليوم» ─────────────────────────────────────────

/**
 * «بانتظار قرارك»: W1.4's own count and its newest five rows. NOTHING is read here that the inbox does not already filter: every row and the
 * count come from `workRequestsOf(actor, "waiting")` (P0.2 `taskVisibleWhere` for a request on a task, the approver's turn, the departments,
 * the spaces the person moderates). `null` while `workRequests` is off, for a guest, and when nothing waits.
 */
export async function getTodayWaiting(actor: Actor): Promise<TodayWaiting | null> {
  if (actor.isExternal) return null;
  if (!(await actorFeatureOn(actor, "workRequests"))) return null;
  const view = await workRequestsOf(actor, "waiting");
  return topWaiting(view.sections);
}

/**
 * «ذكروك»: the unread messages that mention the person, from the chat list's own numbers (`chatList`: the same unread rule as the badge, only
 * conversations the person may read — `canRead` has the last word — and a conversation they have no row in counts nothing, so the owner's silent
 * oversight adds nothing and nothing is written). Inside a space: that space's topics and private chats (like the unread count of the same page);
 * with no space: every conversation, a space then shown as its forum. A guest gets none. `null` when nobody mentioned the person.
 */
export async function getTodayMentions(actor: Actor, opts: { space?: { id: string } | null } = {}): Promise<TodayMentions | null> {
  if (actor.isExternal) return null;
  const list = await chatList({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, opts.space ? { spaceId: opts.space.id } : {});
  return mentionRowsOf(list.rows);
}

/** How many follow-up tickets the card lists. */
const FOLLOW_UPS_TOP = 5;

/**
 * «مواعيد اليوم» (Q1.5): the person's OWN tickets (the ones they hold, not finished) whose follow-up day is today or has passed, by the company's
 * calendar. A ticket belongs to no space, so the space is not applied; the person needs the tickets «يشوف» box, a guest gets none, and only the
 * ticket's title is read (never the customer's number, which stays in `ticketDetail`).
 */
export async function getTodayFollowUps(actor: Actor, opts: { now?: Date } = {}): Promise<TodayFollowUp[]> {
  if (actor.isExternal || !actorCan(actor, "tickets.view")) return [];
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } });
  const clock = zonedParts(opts.now ?? new Date(), resolveTimeZone(org?.timezone));
  // the follow-up day is stored as a date (midnight UTC of that day): compare days, not instants
  const endOfToday = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + 1));
  const rows = await db.ticket.findMany({
    where: { orgId: actor.orgId, assigneeId: actor.userId, status: { in: ["OPEN", "IN_PROGRESS"] }, followUpAt: { not: null, lt: endOfToday } },
    orderBy: [{ followUpAt: "asc" }, { id: "asc" }],
    take: FOLLOW_UPS_TOP,
    select: { id: true, title: true, followUpAt: true },
  });
  const todayStandIn = new Date(clock.year, clock.month - 1, clock.day, 12);
  return rows.map((r): TodayFollowUp => {
    const day = r.followUpAt as Date;
    const late = day.getTime() < Date.UTC(clock.year, clock.month - 1, clock.day);
    return { id: r.id, title: r.title, late, dueLabel: fmtRelative(new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12), todayStandIn) };
  });
}
