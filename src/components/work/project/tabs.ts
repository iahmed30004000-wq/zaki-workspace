/**
 * W1.5 — the tabs of a project page (rides on `navV2`): «اللوحة» (default; a picker when the project has several boards) · «القائمة» · «التقويم» ·
 * «الجدول الزمني» · «الحقول والقواعد» · «الإعدادات». Pure (no React, no server imports): the page, the tab strip, the embedded views and the tests read the
 * same words and the same addresses.
 *
 * Every tab is an ADDRESS (a link, the back button and a pasted link all land on the same tab): the board is `/projects/<id>` (with `?board=<id>` for the
 * second board), the timeline stays its own page `/projects/<id>/timeline` (old links keep working), the rest are `?tab=`.
 */
import { MY_TASK_VIEWS, myTasksSearch, parseMyTasksParams, type MyTasksParams, type RawParams } from "@/lib/work/my-tasks";

export const PROJECT_TABS = ["board", "list", "calendar", "timeline", "fields", "settings"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export const DEFAULT_PROJECT_TAB: ProjectTab = "board";

/** The string key of each tab's name (`ar.work-v2.json`). */
export const projectTabLabelKey = (tab: ProjectTab): string => `projpage.tab.${tab}`;

/** The tab an address says; anything unknown is the board (an old or hand-typed link still opens the page, never an error). */
export function parseProjectTab(raw: string | string[] | null | undefined): ProjectTab {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return (PROJECT_TABS as readonly string[]).includes(value) && value !== "board" ? (value as ProjectTab) : DEFAULT_PROJECT_TAB;
}

/** The board an address names (`?board=<id>`), or null (the first board). */
export function parseBoardParam(raw: string | string[] | null | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return value === "" ? null : value;
}

/** The address of a tab. The timeline is its own page; the board tab only names a board when it is not the first. */
export function projectTabHref(projectId: string, tab: ProjectTab, extra: { boardId?: string | null } = {}): string {
  const base = `/projects/${projectId}`;
  if (tab === "timeline") return `${base}/timeline`;
  if (tab === "board") return extra.boardId ? `${base}?board=${encodeURIComponent(extra.boardId)}` : base;
  return `${base}?tab=${tab}`;
}

export interface TabOffer {
  tab: ProjectTab;
  href: string;
  labelKey: string;
}

/**
 * The tabs a person is offered. «القائمة» and «التقويم» are W1.1's views with the scope «مشروع» while the company's switch `workMyTasks` is on (the data
 * door is that switch's); with it off they are the old pages for this project (`/list?project=`, `/calendar?project=`), so the tab is never a dead end.
 * «الحقول والقواعد» is offered only when at least one of its three cards (fields, rules, milestones) is on for this person: an honest tab.
 */
export function projectTabsFor(opts: { projectId: string; embeddedViews: boolean; fieldsTab: boolean; boardId?: string | null }): TabOffer[] {
  const { projectId, embeddedViews, fieldsTab } = opts;
  const offer = (tab: ProjectTab, href?: string): TabOffer => ({ tab, href: href ?? projectTabHref(projectId, tab, { boardId: opts.boardId ?? null }), labelKey: projectTabLabelKey(tab) });
  return PROJECT_TABS.filter((tab) => tab !== "fields" || fieldsTab).map((tab) => {
    if (!embeddedViews && tab === "list") return offer(tab, `/list?project=${encodeURIComponent(projectId)}`);
    if (!embeddedViews && tab === "calendar") return offer(tab, `/calendar?project=${encodeURIComponent(projectId)}`);
    return offer(tab);
  });
}

// ───────────────────────────────── the embedded task views (list, calendar) ─────────────────────────────────

/** The view each embedded tab draws. */
export const TAB_VIEW = { list: "list", calendar: "calendar" } as const satisfies Record<string, (typeof MY_TASK_VIEWS)[number]>;

/**
 * The state of an embedded tab, read from the address: W1.1's parameters, with the scope forced to this project and the view forced by the tab
 * (whatever `scope=`, `project=` or `view=` the address carries is ignored: a person cannot widen the project page into other work).
 */
export function projectTasksParams(raw: RawParams, projectId: string, tab: keyof typeof TAB_VIEW): MyTasksParams {
  return { ...parseMyTasksParams(raw), scope: "project", projectId, view: TAB_VIEW[tab] };
}

/** The address of an embedded tab for a state: W1.1's query minus what the tab fixes, plus `tab=`. */
export function projectTasksHref(projectId: string, tab: keyof typeof TAB_VIEW, params: MyTasksParams): string {
  const sp = new URLSearchParams(myTasksSearch({ ...params, scope: "project", projectId, view: TAB_VIEW[tab] }));
  for (const key of ["scope", "project", "view"]) sp.delete(key);
  const rest = sp.toString();
  return `/projects/${projectId}?tab=${tab}${rest ? `&${rest}` : ""}`;
}

/** The part of the address that identifies the DATA (the open task is only the panel): what `GET /api/work/tasks` is asked. */
export const projectTasksQuery = (params: MyTasksParams): string => myTasksSearch({ ...params, taskId: null });
