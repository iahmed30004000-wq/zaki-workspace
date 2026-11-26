import { monthWindow, queryTasksForView, workspaceViewFor, type DateWindow } from "@/server/services/views";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";
import { actorCanWork, type Actor } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";

/**
 * The calendar's data logic, taken out of the page so it can be tested with an injected `now`.
 *
 * The month, its window and "today" are the COMPANY's: `timeZone` is the organization's
 * `timezone` resolved with `resolveTimeZone` (a workspace view ctx carries it already). Without a
 * zone the page keeps its old behaviour (the machine's month, on a server UTC).
 */

/** "YYYY-MM" shifted by delta months (the string is validated before this runs). */
export function shiftMonth(ym: string, delta: number): string {
  const parts = ym.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export interface CalendarViewInput {
  /** The moment the page is opened at (injectable, so a test pins the day). */
  now: Date;
  /** The company's zone; absent = the machine's month, as the page behaved before. */
  timeZone?: string;
  /** A requested "YYYY-MM" (maybe invalid). */
  month?: string;
}

export interface CalendarViewData {
  /** The month the grid draws, "YYYY-MM". */
  month: string;
  /** The month's window (in the company's zone when one is given). */
  win: DateWindow;
  /** The company's today, "YYYY-MM-DD" (the machine's without a zone). */
  todayIso: string;
}

export function calendarView(input: CalendarViewInput): CalendarViewData {
  const valid = /^(\d{4})-(\d{2})$/.test(input.month ?? "");
  if (input.timeZone) {
    const zone = resolveTimeZone(input.timeZone);
    const p = zonedParts(input.now, zone);
    const month = valid
      ? input.month!
      : p.year.toString().padStart(4, "0") + "-" + p.month.toString().padStart(2, "0");
    return {
      month,
      win: monthWindow(month, zone, input.now),
      // the company's today as "YYYY-MM-DD": the zone's calendar date, not a slice of the instant
      todayIso: p.year.toString().padStart(4, "0") + "-" + p.month.toString().padStart(2, "0") + "-" + p.day.toString().padStart(2, "0"),
    };
  }
  const month = valid ? input.month! : input.now.toISOString().slice(0, 7);
  return {
    month,
    win: monthWindow(month),
    todayIso: input.now.toISOString().slice(0, 10),
  };
}

/** One task in a day of the month: what the grid draws (`CalendarGrid`'s `CalTask`). */
export interface CalendarTask {
  id: string;
  key: string;
  title: string;
  /** ISO instant; the day is cut in the company's zone (`timeZone`). */
  dueDate: string;
}

export interface CalendarScreen {
  /** The space the person is in; null when they work in none (the page's `list.noWorkspace`). */
  space: { id: string; name: string } | null;
  month: string;
  todayIso: string;
  timeZone: string;
  /** May this person move a task to another day here (the write routes' own verdict). */
  editable: boolean;
  mine: boolean;
  tasks: CalendarTask[];
}

/**
 * «التقويم» of the space the person is in (src/app/(app)/calendar/page.tsx): the open tasks due in the month, inside the person's work scope and
 * teams, «مهامي فقط» when `mine`. ONE function for the page and the phone's door (`GET /api/calendar`, M2 N6), so the rules are the page's own.
 * `off`: the tasks row of the grid is off for this person (the page's `SectionOffNotice`).
 */
export async function calendarScreenFor(
  actor: Actor,
  opts: { month?: string; mine?: boolean; projectId?: string; now?: Date } = {},
): Promise<{ kind: "ok"; data: CalendarScreen } | { kind: "off" }> {
  if (!actorCanWork(actor, "tasks.view")) return { kind: "off" };
  const now = opts.now ?? new Date();
  const mine = opts.mine === true;
  const space = await currentSpace(actor);
  const view = await workspaceViewFor(actor.userId, space?.id ?? "");
  if ("none" in view) {
    const cal = calendarView({ now, month: opts.month });
    return { kind: "ok", data: { space: null, month: cal.month, todayIso: cal.todayIso, timeZone: resolveTimeZone(undefined), editable: false, mine, tasks: [] } };
  }
  const ctx = view.ctx;
  const cal = calendarView({ now, timeZone: ctx.timeZone, month: opts.month });
  const rows = await queryTasksForView({
    orgId: ctx.orgId,
    workspaceId: ctx.workspaceId,
    visible: ctx.visible,
    projectId: opts.projectId || undefined,
    assigneeId: mine ? actor.userId : undefined,
    dueFrom: cal.win.from,
    dueTo: cal.win.to,
    openOnly: true,
    limit: 300,
  });
  const tasks = rows
    .filter((task) => task.dueDate != null)
    .map((task) => ({ id: task.id, key: task.key, title: task.title, dueDate: task.dueDate!.toISOString() }));
  return {
    kind: "ok",
    data: { space: { id: ctx.workspaceId, name: ctx.workspaceName }, month: cal.month, todayIso: cal.todayIso, timeZone: ctx.timeZone, editable: ctx.editable, mine, tasks },
  };
}
