/**
 * «مهامي» — the ONE screen of a person's tasks (W1.1, switch `workMyTasks`): three views (قائمة · لوحة · تقويم), three scopes (أنا · المساحة · مشروع),
 * the quick chips, a sort and a grouping. Everything the screen remembers lives in the ADDRESS, so a link, the back button and the old addresses
 * (`/list`, `/calendar`, `/my-work?tab=today`) all land on the same state.
 *
 * Pure (no React, no server imports): the page, the route and the client read the same words and the same rules. The server decides WHICH tasks a
 * person may see (`taskVisibleWhere`, src/server/services/team-scope.ts); nothing here widens that.
 */
import { dayOfInstant } from "@/lib/due-day";
import { WORK_STAGES, isWorkStage, type WorkStage } from "@/lib/work/stage";

export const MY_TASK_VIEWS = ["list", "board", "calendar"] as const;
export type MyTaskView = (typeof MY_TASK_VIEWS)[number];

/** أنا · المساحة · مشروع */
export const MY_TASK_SCOPES = ["me", "space", "project"] as const;
export type MyTaskScope = (typeof MY_TASK_SCOPES)[number];

/** اليوم · متأخرة · هالأسبوع · بدون موعد · مكتملة · أنشأتها */
export const MY_TASK_CHIPS = ["today", "overdue", "week", "nodate", "done", "created"] as const;
export type MyTaskChip = (typeof MY_TASK_CHIPS)[number];

/** `?space=all`: «كل مساحاتي», never the default (the default is the space the person is in). */
export const ALL_SPACES = "all";

export const MY_TASK_SORTS = ["due", "priority", "updated", "title"] as const;
export type MyTaskSort = (typeof MY_TASK_SORTS)[number];

export const MY_TASK_GROUPS = ["none", "stage", "project", "person", "due"] as const;
export type MyTaskGroup = (typeof MY_TASK_GROUPS)[number];

/** The six inner tabs of the old «مهامي» and the chip each one became (`?tab=today` still opens «اليوم»; «مسندة إليّ» is simply no chip: all my open work). */
export const LEGACY_TAB_CHIP: Readonly<Record<string, MyTaskChip | null>> = {
  today: "today",
  upcoming: "week",
  overdue: "overdue",
  completed: "done",
  mine: null,
  created: "created",
};

export interface MyTasksParams {
  view: MyTaskView;
  scope: MyTaskScope;
  chip: MyTaskChip | null;
  sort: MyTaskSort;
  group: MyTaskGroup;
  /**
   * Scope «أنا»: which of my spaces. `null` = the DEFAULT: the space I am in (each space is its own account, owner's decision of 2026-11-21), and inside
   * «الشركة» all of them; `ALL_SPACES` = «كل مساحاتي», an explicit choice; any other value = that space.
   */
  spaceId: string | null;
  /** Scope «مشروع»: the picked project. */
  projectId: string | null;
  /** A normalized stage filter. */
  stage: WorkStage | null;
  q: string;
  /** The calendar's month (`YYYY-MM`), null = the company's current month. */
  month: string | null;
  /** The task open in the side panel (`?task=<id>`). */
  taskId: string | null;
}

export const DEFAULT_MY_TASKS_PARAMS: MyTasksParams = {
  view: "list",
  scope: "me",
  chip: null,
  sort: "due",
  group: "none",
  spaceId: null,
  projectId: null,
  stage: null,
  q: "",
  month: null,
  taskId: null,
};

export type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

const first = (raw: RawParams, key: string): string => {
  if (raw instanceof URLSearchParams) return (raw.get(key) ?? "").trim();
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};
const oneOf = <T extends string>(list: readonly T[], value: string): T | null => ((list as readonly string[]).includes(value) ? (value as T) : null);

/** The state the address says. Anything unknown falls back to the default (never an error): an old or hand-typed link still opens the screen. */
export function parseMyTasksParams(raw: RawParams): MyTasksParams {
  const view = oneOf(MY_TASK_VIEWS, first(raw, "view")) ?? DEFAULT_MY_TASKS_PARAMS.view;
  const scope = oneOf(MY_TASK_SCOPES, first(raw, "scope")) ?? DEFAULT_MY_TASKS_PARAMS.scope;
  const legacyTab = first(raw, "tab");
  const chip = oneOf(MY_TASK_CHIPS, first(raw, "chip")) ?? (Object.prototype.hasOwnProperty.call(LEGACY_TAB_CHIP, legacyTab) ? (LEGACY_TAB_CHIP[legacyTab] ?? null) : null);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(first(raw, "month")) ? first(raw, "month") : null;
  const stage = first(raw, "stage");
  return {
    view,
    scope,
    chip,
    sort: oneOf(MY_TASK_SORTS, first(raw, "sort")) ?? DEFAULT_MY_TASKS_PARAMS.sort,
    group: oneOf(MY_TASK_GROUPS, first(raw, "group")) ?? DEFAULT_MY_TASKS_PARAMS.group,
    spaceId: first(raw, "space") || null,
    projectId: first(raw, "project") || null,
    stage: isWorkStage(stage) ? stage : null,
    q: first(raw, "q").slice(0, 120),
    month,
    taskId: first(raw, "task") || null,
  };
}

/** The address for a state: only what differs from the default is written, so the plain screen is just `/my-work`. */
export function myTasksSearch(params: MyTasksParams): string {
  const sp = new URLSearchParams();
  const d = DEFAULT_MY_TASKS_PARAMS;
  if (params.view !== d.view) sp.set("view", params.view);
  if (params.scope !== d.scope) sp.set("scope", params.scope);
  if (params.chip) sp.set("chip", params.chip);
  if (params.sort !== d.sort) sp.set("sort", params.sort);
  if (params.group !== d.group) sp.set("group", params.group);
  if (params.spaceId && params.scope === "me") sp.set("space", params.spaceId);
  if (params.projectId && params.scope === "project") sp.set("project", params.projectId);
  if (params.stage) sp.set("stage", params.stage);
  if (params.q) sp.set("q", params.q);
  if (params.month && params.view === "calendar") sp.set("month", params.month);
  if (params.taskId) sp.set("task", params.taskId);
  const text = sp.toString();
  return text ? `?${text}` : "";
}

export const myTasksHref = (params: MyTasksParams): string => `/my-work${myTasksSearch(params)}`;

/** The address that holds the data (everything but the open task, which is only the panel). */
export const myTasksApiQuery = (params: MyTasksParams): string => myTasksSearch({ ...params, taskId: null });

/**
 * Where an old address goes (W1.1, behind the switch): `/list` and `/calendar` become views of «مهامي» in the scope «المساحة» (what they always were:
 * the current space's tasks). The old parameters that still mean something are carried over: the calendar's month and «مهامي فقط» (scope «أنا»), a
 * project, the text search, and the list's grouping.
 */
export function legacyViewHref(view: "list" | "calendar", old: RawParams = {}): string {
  const sp = new URLSearchParams();
  sp.set("view", view);
  const project = first(old, "project");
  if (first(old, "mine") === "1") sp.set("scope", "me");
  else if (project) {
    sp.set("scope", "project");
    sp.set("project", project);
  } else sp.set("scope", "space");
  const month = first(old, "month");
  if (view === "calendar" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) sp.set("month", month);
  const q = first(old, "q");
  if (q) sp.set("q", q);
  const group = ({ status: "stage", project: "project", assignee: "person" } as Record<string, MyTaskGroup | undefined>)[first(old, "group")];
  if (view === "list" && group) sp.set("group", group);
  return `/my-work?${sp.toString()}`;
}

// ───────────────────────────────────────── the rows ─────────────────────────────────────────

/** A task as the screen holds it: plain JSON (dates are ISO text) so it crosses from the server to the browser and into the cache. */
export interface WorkTaskDto {
  id: string;
  key: string;
  title: string;
  priority: string;
  dueDate: string | null;
  /** The due day as the company reads it (`YYYY-MM-DD`). */
  dueDay: string | null;
  completedAt: string | null;
  columnId: string;
  columnName: string;
  columnStage: WorkStage;
  columnDone: boolean;
  workspaceId: string;
  spaceName: string;
  projectId: string;
  projectName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeIds: string[];
  assigneeNames: string[];
  creatorId: string;
  visibility: string;
  updatedAt: string;
  /** This person may change it (the same verdict as the write routes). */
  editable: boolean;
  steps?: { done: number; total: number };
  running?: boolean;
  recurring?: boolean;
  pinnedAt?: string | null;
  reward?: { status: string; amountMinor: number; currency: string } | null;
  /** «آلي» (W1.9, D-W4): the task came in through the door (`Task.apiTokenId` is set). The row draws the mark when it is true; absent or false draws nothing. */
  automated?: boolean;
}

export interface WorkSpaceOption {
  id: string;
  name: string;
  kind: string;
}

export interface WorkProjectOption {
  id: string;
  name: string;
  workspaceId: string;
  spaceName: string;
}

export interface WorkTasksResult {
  /** The state the answer was made for: the scope AFTER the fallbacks (a request for «المساحة» inside «الشركة» comes back as «أنا»). */
  params: MyTasksParams;
  tasks: WorkTaskDto[];
  /** The list hit its limit: there are more than shown (the screen says so). */
  truncated: boolean;
  counts: Record<MyTaskChip, number>;
  spaces: WorkSpaceOption[];
  projects: WorkProjectOption[];
  /** The space the person is in, and whether it is «الشركة» (no projects there, D-N3). */
  current: { id: string | null; hq: boolean; name?: string | null };
  /** The space the list is cut for: its id and name; `id: null` = all of the person's spaces («كل مساحاتي», or the default inside «الشركة»). */
  space: { id: string | null; name: string | null };
  /** «المساحة» was asked for and not possible here (the person is in «الشركة»): the screen shows «أنا» and says why. */
  scopeFellBack: boolean;
  timeZone: string;
  /** The company's today, `YYYY-MM-DD`. */
  todayIso: string;
  /** The calendar's month the answer is cut for (only for the calendar view). */
  month: string | null;
  /** A quick task can be made from here (the person may write somewhere). */
  canAdd: boolean;
}

/** What the side panel shows of one task (`GET /api/work/tasks/[id]`). */
export interface WorkTaskDetail {
  task: WorkTaskDto;
  description: string | null;
  creatorName: string;
  boardName: string;
  createdAt: string;
  commentCount: number;
}

/**
 * What the side panel is given for a task that lives in ANOTHER space than the one the person is in: only where it lives (never its title or anything
 * else), so the panel can say «هاد من مساحة «X»» and offer «انتقل لها» instead of opening it silently.
 */
export interface WorkTaskForeign {
  foreign: { taskId: string; spaceId: string; spaceName: string };
}

export type WorkTaskPanel = WorkTaskDetail | WorkTaskForeign;

export const isForeignTask = (panel: WorkTaskPanel): panel is WorkTaskForeign => "foreign" in panel;

export const MY_TASKS_LIMIT = 300;

// ───────────────────────────────────────── ordering and grouping ─────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3, NONE: 4 };

/** The order of a list (a new array). Tasks with no due date sink in «الموعد»; «مكتملة» is newest-finished first. */
export function sortWorkTasks(tasks: readonly WorkTaskDto[], sort: MyTaskSort, chip: MyTaskChip | null): WorkTaskDto[] {
  const time = (iso: string | null) => (iso ? Date.parse(iso) : null);
  const byDue = (a: WorkTaskDto, b: WorkTaskDto) => {
    const x = time(a.dueDate);
    const y = time(b.dueDate);
    if (x === null && y === null) return (time(b.updatedAt) ?? 0) - (time(a.updatedAt) ?? 0);
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  };
  const rows = [...tasks];
  if (chip === "done") return rows.sort((a, b) => (time(b.completedAt) ?? 0) - (time(a.completedAt) ?? 0));
  switch (sort) {
    case "priority":
      return rows.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || byDue(a, b));
    case "updated":
      return rows.sort((a, b) => (time(b.updatedAt) ?? 0) - (time(a.updatedAt) ?? 0));
    case "title":
      return rows.sort((a, b) => a.title.localeCompare(b.title, "ar"));
    default:
      return rows.sort(byDue);
  }
}

/** `YYYY-MM-DD` plus `n` days (calendar arithmetic, no zone: both sides are already the company's days). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

export const DUE_BUCKETS = ["overdue", "today", "tomorrow", "week", "later", "none"] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

/** Where a task falls on the company's calendar today. A finished task is never «متأخرة». */
export function dueBucketOf(task: Pick<WorkTaskDto, "dueDate" | "completedAt">, todayIso: string, timeZone: string): DueBucket {
  if (!task.dueDate) return "none";
  const day = dayOfInstant(task.dueDate, timeZone);
  if (day < todayIso) return task.completedAt ? "later" : "overdue";
  if (day === todayIso) return "today";
  if (day === addDays(todayIso, 1)) return "tomorrow";
  if (day <= addDays(todayIso, 6)) return "week";
  return "later";
}

export interface WorkGroup {
  /** A stable id (`stage:TODO`, `project:<id>`, `person:<id>`, `due:today`, `all`). */
  key: string;
  /** What the heading says (already a word, never an id). */
  label: string;
  tasks: WorkTaskDto[];
}

export interface GroupWords {
  stage: (stage: WorkStage) => string;
  due: (bucket: DueBucket) => string;
  nobody: string;
  all: string;
}

/**
 * The groups of a list, in a fixed order: stages in the order work travels (and ALL four, so a board always has its four columns), due buckets
 * from the latest to the furthest, projects and people by name. Empty groups are dropped except for the stages of a board.
 */
export function groupWorkTasks(
  tasks: readonly WorkTaskDto[],
  group: MyTaskGroup,
  words: GroupWords,
  ctx: { todayIso: string; timeZone: string; keepEmptyStages?: boolean },
): WorkGroup[] {
  if (group === "none") return tasks.length ? [{ key: "all", label: words.all, tasks: [...tasks] }] : [];
  if (group === "stage") {
    const out = WORK_STAGES.map((stage): WorkGroup => ({ key: `stage:${stage}`, label: words.stage(stage), tasks: tasks.filter((t) => t.columnStage === stage) }));
    return ctx.keepEmptyStages ? out : out.filter((g) => g.tasks.length > 0);
  }
  if (group === "due") {
    return DUE_BUCKETS.map((bucket): WorkGroup => ({ key: `due:${bucket}`, label: words.due(bucket), tasks: tasks.filter((t) => dueBucketOf(t, ctx.todayIso, ctx.timeZone) === bucket) })).filter(
      (g) => g.tasks.length > 0,
    );
  }
  const buckets = new Map<string, WorkGroup>();
  const put = (key: string, label: string, task: WorkTaskDto) => {
    const found = buckets.get(key);
    if (found) found.tasks.push(task);
    else buckets.set(key, { key, label, tasks: [task] });
  };
  for (const task of tasks) {
    if (group === "project") put(`project:${task.projectId}`, task.projectName, task);
    else put(`person:${task.assigneeId ?? "none"}`, task.assigneeName ?? words.nobody, task);
  }
  return [...buckets.values()].sort((a, b) => (a.key.endsWith(":none") ? 1 : b.key.endsWith(":none") ? -1 : a.label.localeCompare(b.label, "ar")));
}

// ───────────────────────────────────────── optimistic changes (pure) ─────────────────────────────────────────
// The client applies one of these to the cached list the moment a person acts, calls the door, and puts the old list back when the door refuses.
// Each returns a NEW array and leaves every other task untouched.

const patch = (tasks: readonly WorkTaskDto[], id: string, change: (t: WorkTaskDto) => WorkTaskDto): WorkTaskDto[] => tasks.map((t) => (t.id === id ? change(t) : t));

/** Tick or untick: a ticked task is done now; an unticked one is open again. */
export function withCompletion(tasks: readonly WorkTaskDto[], id: string, done: boolean, at: Date = new Date()): WorkTaskDto[] {
  return patch(tasks, id, (t) => ({ ...t, completedAt: done ? (t.completedAt ?? at.toISOString()) : null }));
}

/** Moved to a stage (the board): the stage changes, and the task is finished only in the DONE stage. The server answer replaces this guess. */
export function withStage(tasks: readonly WorkTaskDto[], id: string, stage: WorkStage, at: Date = new Date()): WorkTaskDto[] {
  return patch(tasks, id, (t) => ({ ...t, columnStage: stage, completedAt: stage === "DONE" ? (t.completedAt ?? at.toISOString()) : null }));
}

/** A new due day (`YYYY-MM-DD`, or null to clear it): the day the person picked, shown at once. */
export function withDueDay(tasks: readonly WorkTaskDto[], id: string, day: string | null, noonOf: (day: string) => string | null): WorkTaskDto[] {
  return patch(tasks, id, (t) => ({ ...t, dueDay: day, dueDate: day ? noonOf(day) : null }));
}

/** A task is on the open screen (a list chip other than «مكتملة» shows open work only; ticking one takes it off the list). */
export function stillListed(task: Pick<WorkTaskDto, "completedAt">, chip: MyTaskChip | null, view: MyTaskView): boolean {
  if (view === "board") return true;
  if (chip === "done") return task.completedAt !== null;
  return task.completedAt === null;
}

/** The query key of one state of the screen in the browser's cache: every optimistic change and every refetch agree on it. */
export const workTasksKey = (params: MyTasksParams): readonly unknown[] => ["work", "tasks", myTasksApiQuery(params)];
export const WORK_TASKS_ROOT: readonly unknown[] = ["work", "tasks"];
