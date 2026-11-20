import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MY_TASKS_PARAMS,
  DUE_BUCKETS,
  LEGACY_TAB_CHIP,
  MY_TASK_CHIPS,
  addDays,
  dueBucketOf,
  groupWorkTasks,
  legacyViewHref,
  myTasksHref,
  parseMyTasksParams,
  sortWorkTasks,
  stillListed,
  withCompletion,
  withDueDay,
  withStage,
  type GroupWords,
  type WorkTaskDto,
} from "@/lib/work/my-tasks";
import { normalizeViewScope } from "@/server/services/views";
import { WORK_STAGES } from "@/lib/work/stage";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";

/**
 * W1.1 — «مهامي»: the address is the state, the six old inner tabs are chips, the groups and the optimistic changes are pure. (The database
 * tests, with three spaces and a private task, are tests/db/my-work-scope.test.ts.)
 */

const ZONE = "Asia/Damascus";
const TODAY = "2026-11-20";

const task = (over: Partial<WorkTaskDto> & { id: string }): WorkTaskDto => ({
  key: `ZK-${over.id}`,
  title: `task ${over.id}`,
  priority: "NORMAL",
  dueDate: null,
  dueDay: null,
  completedAt: null,
  columnId: "c1",
  columnName: "To do",
  columnStage: "TODO",
  columnDone: false,
  workspaceId: "w1",
  spaceName: "Space",
  projectId: "p1",
  projectName: "Project",
  assigneeId: "u1",
  assigneeName: "Sara",
  assigneeIds: ["u1"],
  assigneeNames: ["Sara"],
  creatorId: "u1",
  visibility: "SPACE",
  updatedAt: "2026-11-01T00:00:00.000Z",
  editable: true,
  ...over,
});

const words: GroupWords = { stage: (s) => `stage-${s}`, due: (b) => `due-${b}`, nobody: "nobody", all: "all" };

describe("the address is the state", () => {
  it("a plain /my-work is the list, scope «أنا», every open task, ordered by the due date", () => {
    expect(parseMyTasksParams({})).toEqual(DEFAULT_MY_TASKS_PARAMS);
    expect(DEFAULT_MY_TASKS_PARAMS).toMatchObject({ view: "list", scope: "me", chip: null, sort: "due", group: "none" });
    expect(myTasksHref(DEFAULT_MY_TASKS_PARAMS)).toBe("/my-work");
  });

  it("reads every parameter, ignores what it does not know and never throws", () => {
    const p = parseMyTasksParams({ view: "board", scope: "project", project: "p9", chip: "overdue", sort: "priority", group: "stage", space: "s1", stage: "REVIEW", q: " ab ", month: "2026-11", task: "t1" });
    expect(p).toMatchObject({ view: "board", scope: "project", projectId: "p9", chip: "overdue", sort: "priority", group: "stage", spaceId: "s1", stage: "REVIEW", q: "ab", month: "2026-11", taskId: "t1" });
    expect(parseMyTasksParams({ view: "kanban", scope: "all", chip: "x", sort: "y", group: "z", stage: "OTHER", month: "2026-13" })).toEqual(DEFAULT_MY_TASKS_PARAMS);
    expect(parseMyTasksParams({ view: ["calendar", "list"] }).view).toBe("calendar");
    expect(parseMyTasksParams(new URLSearchParams("view=calendar&scope=space")).scope).toBe("space");
  });

  it("writes only what differs from the default, and reads it back", () => {
    const p = parseMyTasksParams({ view: "calendar", scope: "space", chip: "created", month: "2026-12", task: "t1" });
    expect(myTasksHref(p)).toBe("/my-work?view=calendar&scope=space&chip=created&month=2026-12&task=t1");
    expect(parseMyTasksParams(new URLSearchParams(myTasksHref(p).split("?")[1]))).toEqual(p);
    // a space is only written for «أنا», a project only for «مشروع», a month only for the calendar
    expect(myTasksHref({ ...DEFAULT_MY_TASKS_PARAMS, spaceId: "s1", projectId: "p1", month: "2026-12" })).toBe("/my-work?space=s1");
  });
});

describe("the six old inner tabs are chips, and ?tab=today still opens «اليوم»", () => {
  it("maps each old tab to a chip (مسندة إليّ is simply no chip)", () => {
    expect(LEGACY_TAB_CHIP).toEqual({ today: "today", upcoming: "week", overdue: "overdue", completed: "done", mine: null, created: "created" });
    for (const [tab, chip] of Object.entries(LEGACY_TAB_CHIP)) expect(parseMyTasksParams({ tab }).chip, tab).toBe(chip);
    expect(parseMyTasksParams({ tab: "nonsense" }).chip).toBeNull();
    // an explicit chip wins over an old tab
    expect(parseMyTasksParams({ tab: "today", chip: "done" }).chip).toBe("done");
  });

  it("has exactly the six chips of the plan", () => {
    expect([...MY_TASK_CHIPS]).toEqual(["today", "overdue", "week", "nodate", "done", "created"]);
  });
});

describe("/list and /calendar become views of «مهامي» in the scope «المساحة»", () => {
  it("the bare old addresses go to ?view=list|calendar&scope=space", () => {
    expect(legacyViewHref("list")).toBe("/my-work?view=list&scope=space");
    expect(legacyViewHref("calendar")).toBe("/my-work?view=calendar&scope=space");
  });

  it("carries the old parameters that still mean something", () => {
    expect(legacyViewHref("calendar", { month: "2026-12", mine: "1" })).toBe("/my-work?view=calendar&scope=me&month=2026-12");
    expect(legacyViewHref("list", { project: "p1", q: "x", group: "assignee" })).toBe("/my-work?view=list&scope=project&project=p1&q=x&group=person");
    expect(legacyViewHref("list", { group: "status" })).toContain("group=stage");
    // an unknown month is dropped; the list has no month
    expect(legacyViewHref("calendar", { month: "bad" })).toBe("/my-work?view=calendar&scope=space");
    expect(legacyViewHref("list", { month: "2026-12" })).toBe("/my-work?view=list&scope=space");
  });

  it("the address it writes is read back as the state it meant", () => {
    const p = parseMyTasksParams(new URLSearchParams(legacyViewHref("calendar", { mine: "1", month: "2026-12" }).split("?")[1]));
    expect(p).toMatchObject({ view: "calendar", scope: "me", month: "2026-12" });
  });
});

describe("order and groups", () => {
  const rows = [
    task({ id: "late", dueDate: "2026-11-25T09:00:00.000Z", priority: "LOW" }),
    task({ id: "soon", dueDate: "2026-11-21T09:00:00.000Z", priority: "URGENT" }),
    task({ id: "none", dueDate: null, priority: "HIGH", title: "ب" }),
  ];

  it("sorts by due date with undated last, by priority, by newest, by title; «مكتملة» is newest-finished first", () => {
    expect(sortWorkTasks(rows, "due", null).map((t) => t.id)).toEqual(["soon", "late", "none"]);
    expect(sortWorkTasks(rows, "priority", null).map((t) => t.id)).toEqual(["soon", "none", "late"]);
    expect(sortWorkTasks([task({ id: "a", updatedAt: "2026-01-01T00:00:00.000Z" }), task({ id: "b", updatedAt: "2026-02-01T00:00:00.000Z" })], "updated", null).map((t) => t.id)).toEqual(["b", "a"]);
    expect(sortWorkTasks([task({ id: "a", title: "ج" }), task({ id: "b", title: "أ" })], "title", null).map((t) => t.id)).toEqual(["b", "a"]);
    const done = [task({ id: "old", completedAt: "2026-11-01T00:00:00.000Z" }), task({ id: "new", completedAt: "2026-11-10T00:00:00.000Z" })];
    expect(sortWorkTasks(done, "due", "done").map((t) => t.id)).toEqual(["new", "old"]);
    // a new array: the input is never reordered
    expect(rows.map((t) => t.id)).toEqual(["late", "soon", "none"]);
  });

  it("buckets a due date on the company's calendar: late, today, tomorrow, this week, later, none; a finished task is never late", () => {
    const at = (day: string) => `${day}T09:00:00.000Z`;
    const bucket = (day: string | null, completedAt: string | null = null) => dueBucketOf({ dueDate: day ? at(day) : null, completedAt }, TODAY, ZONE);
    expect(bucket("2026-11-19")).toBe("overdue");
    expect(bucket("2026-11-19", "2026-11-19T10:00:00.000Z")).toBe("later");
    expect(bucket("2026-11-20")).toBe("today");
    expect(bucket("2026-11-21")).toBe("tomorrow");
    expect(bucket("2026-11-26")).toBe("week");
    expect(bucket("2026-11-27")).toBe("later");
    expect(bucket(null)).toBe("none");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect([...DUE_BUCKETS]).toEqual(["overdue", "today", "tomorrow", "week", "later", "none"]);
  });

  it("groups by stage in the order work travels, and a board keeps all four columns", () => {
    const stages = [task({ id: "a", columnStage: "DONE" }), task({ id: "b", columnStage: "TODO" }), task({ id: "c", columnStage: "TODO" })];
    const ctx = { todayIso: TODAY, timeZone: ZONE };
    expect(groupWorkTasks(stages, "stage", words, ctx).map((g) => [g.key, g.tasks.length])).toEqual([["stage:TODO", 2], ["stage:DONE", 1]]);
    const board = groupWorkTasks(stages, "stage", words, { ...ctx, keepEmptyStages: true });
    expect(board.map((g) => g.key)).toEqual(WORK_STAGES.map((s) => `stage:${s}`));
    expect(board.map((g) => g.label)).toEqual(WORK_STAGES.map((s) => `stage-${s}`));
  });

  it("groups by project, by person (nobody last) and by due bucket; «none» is one flat group; nothing at all is no group", () => {
    const rowsB = [
      task({ id: "a", projectId: "p2", projectName: "ب مشروع", assigneeId: null, assigneeName: null }),
      task({ id: "b", projectId: "p1", projectName: "أ مشروع", assigneeId: "u2", assigneeName: "Omar" }),
      task({ id: "c", projectId: "p1", projectName: "أ مشروع", assigneeId: "u2", assigneeName: "Omar", dueDate: "2026-11-20T09:00:00.000Z" }),
    ];
    const ctx = { todayIso: TODAY, timeZone: ZONE };
    expect(groupWorkTasks(rowsB, "project", words, ctx).map((g) => [g.label, g.tasks.length])).toEqual([["أ مشروع", 2], ["ب مشروع", 1]]);
    expect(groupWorkTasks(rowsB, "person", words, ctx).map((g) => g.label)).toEqual(["Omar", "nobody"]);
    expect(groupWorkTasks(rowsB, "due", words, ctx).map((g) => g.key)).toEqual(["due:today", "due:none"]);
    expect(groupWorkTasks(rowsB, "none", words, ctx)).toHaveLength(1);
    expect(groupWorkTasks([], "none", words, ctx)).toEqual([]);
    expect(groupWorkTasks([], "stage", words, ctx)).toEqual([]);
  });
});

describe("optimistic changes touch one task and leave the rest as they were", () => {
  const rows = [task({ id: "a" }), task({ id: "b", completedAt: "2026-11-01T00:00:00.000Z", columnStage: "DONE" })];

  it("ticks and unticks", () => {
    const at = new Date("2026-11-20T10:00:00.000Z");
    const ticked = withCompletion(rows, "a", true, at);
    expect(ticked[0]!.completedAt).toBe(at.toISOString());
    expect(ticked[1]).toBe(rows[1]);
    expect(withCompletion(rows, "b", false)[1]!.completedAt).toBeNull();
    // a task already finished keeps the day it was finished
    expect(withCompletion(rows, "b", true, at)[1]!.completedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(rows[0]!.completedAt).toBeNull();
  });

  it("moves to a stage: only the DONE stage finishes a task", () => {
    expect(withStage(rows, "a", "REVIEW")[0]).toMatchObject({ columnStage: "REVIEW", completedAt: null });
    expect(withStage(rows, "a", "DONE", new Date("2026-11-20T10:00:00.000Z"))[0]).toMatchObject({ columnStage: "DONE", completedAt: "2026-11-20T10:00:00.000Z" });
    expect(withStage(rows, "b", "DOING")[1]).toMatchObject({ columnStage: "DOING", completedAt: null });
  });

  it("changes the due day, or clears it", () => {
    const noon = (day: string) => `${day}T09:00:00.000Z`;
    expect(withDueDay(rows, "a", "2026-12-01", noon)[0]).toMatchObject({ dueDay: "2026-12-01", dueDate: "2026-12-01T09:00:00.000Z" });
    expect(withDueDay(withDueDay(rows, "a", "2026-12-01", noon), "a", null, noon)[0]).toMatchObject({ dueDay: null, dueDate: null });
  });

  it("a ticked task leaves an open list (and joins «مكتملة»); a board keeps every task", () => {
    expect(stillListed({ completedAt: null }, null, "list")).toBe(true);
    expect(stillListed({ completedAt: "x" }, null, "list")).toBe(false);
    expect(stillListed({ completedAt: "x" }, "done", "list")).toBe(true);
    expect(stillListed({ completedAt: null }, "done", "list")).toBe(false);
    expect(stillListed({ completedAt: "x" }, null, "board")).toBe(true);
  });
});

describe("queryTasksForView's scope is a shorthand for the plain filters, and can only narrow", () => {
  const base = { orgId: "o1" };
  it("«أنا» is the person's assignee filter (co-assigned too), optionally in one space", () => {
    expect(normalizeViewScope({ ...base, scope: { kind: "me", userId: "u1" } })).toEqual({ orgId: "o1", assigneeId: "u1" });
    expect(normalizeViewScope({ ...base, scope: { kind: "me", userId: "u1", spaceId: "s1" } })).toEqual({ orgId: "o1", assigneeId: "u1", workspaceId: "s1" });
  });
  it("«المساحة» and «مشروع» set the space or the project", () => {
    expect(normalizeViewScope({ ...base, scope: { kind: "space", spaceId: "s1" } })).toEqual({ orgId: "o1", workspaceId: "s1" });
    expect(normalizeViewScope({ ...base, scope: { kind: "project", projectId: "p1" } })).toEqual({ orgId: "o1", projectId: "p1" });
  });
  it("a scope that contradicts a filter already given matches nothing (it never widens)", () => {
    expect(normalizeViewScope({ ...base, workspaceId: "s2", scope: { kind: "space", spaceId: "s1" } }).workspaceIds).toEqual([]);
    expect(normalizeViewScope({ ...base, projectId: "p2", scope: { kind: "project", projectId: "p1" } }).workspaceIds).toEqual([]);
  });
  it("no scope: the query is returned untouched (the other callers, the CSV export, do not change)", () => {
    const q = { orgId: "o1", assigneeId: "u1", workspaceIds: ["s1"] };
    expect(normalizeViewScope(q)).toBe(q);
  });
});

describe("the switch and the words", () => {
  it("«workMyTasks» is a switch, OFF by default", () => {
    expect(FEATURES).toContain("workMyTasks");
    expect(FEATURE_DEFAULTS.workMyTasks).toBe(false);
    expect(featureOn({}, "workMyTasks")).toBe(false);
    expect(featureOn({ features: { workMyTasks: true } }, "workMyTasks")).toBe(true);
    expect(AR["features.workMyTasks.name"]).toBeTruthy();
    expect(AR["features.workMyTasks.hint"]).toContain("🔧");
  });

  it("every word of the screen exists in Arabic, with no Latin letter", () => {
    const source = ["src/components/work/my-tasks", "src/app/(app)/my-work"].flatMap((dir) => {
      const root = path.resolve(__dirname, "..", dir);
      const files: string[] = [];
      const walk = (d: string) => {
        for (const e of require("node:fs").readdirSync(d, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]) {
          if (e.isDirectory()) walk(path.join(d, e.name));
          else if (/\.tsx?$/.test(e.name)) files.push(path.join(d, e.name));
        }
      };
      walk(root);
      return files.map((f) => readFileSync(f, "utf8"));
    });
    const keys = new Set(source.flatMap((text) => [...text.matchAll(/\bt\(\s*["'`](mytasks\.[A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]!)));
    expect(keys.size).toBeGreaterThan(20);
    for (const key of keys) expect(AR[key], key).toBeTruthy();
    for (const [key, value] of Object.entries(AR)) if (key.startsWith("mytasks.")) expect(value.replace(/{[^}]*}/g, ""), key).not.toMatch(/[A-Za-z]/);
    for (const chip of MY_TASK_CHIPS) expect(AR[`mytasks.chip.${chip}`], chip).toBeTruthy();
  });
});
