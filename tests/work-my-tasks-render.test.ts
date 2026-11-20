import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/my-work",
}));

import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { WorkRow } from "@/components/work/my-tasks/work-row";
import { TaskList } from "@/components/work/my-tasks/task-list";
import { TaskBoard } from "@/components/work/my-tasks/task-board";
import { Toolbar } from "@/components/work/my-tasks/toolbar";
import { MyTasksView } from "@/components/work/my-tasks/my-tasks-view";
import { QuickAdd } from "@/components/work/my-tasks/quick-add";
import { TaskCalendar, shiftYearMonth } from "@/components/work/my-tasks/task-calendar";
import MyWorkLoading from "@/app/(app)/my-work/loading";
import { DEFAULT_MY_TASKS_PARAMS, MY_TASK_CHIPS, myTasksApiQuery, type MyTasksParams, type WorkTaskDto, type WorkTasksResult } from "@/lib/work/my-tasks";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))));

const task = (over: Partial<WorkTaskDto> & { id: string }): WorkTaskDto => ({
  key: `ZK-${over.id}`,
  title: `مهمة ${over.id}`,
  priority: "NORMAL",
  dueDate: null,
  dueDay: null,
  completedAt: null,
  columnId: "c1",
  columnName: "todo",
  columnStage: "TODO",
  columnDone: false,
  workspaceId: "w1",
  spaceName: "ألفا",
  projectId: "p1",
  projectName: "مشروع أ",
  assigneeId: "u1",
  assigneeName: "سارة",
  assigneeIds: ["u1"],
  assigneeNames: ["سارة"],
  creatorId: "u1",
  visibility: "SPACE",
  updatedAt: "2026-11-01T00:00:00.000Z",
  editable: true,
  ...over,
});

const noop = () => {};
const actions = { onOpen: noop, onToggle: noop, onDue: noop };

const result = (over: Partial<WorkTasksResult> = {}): WorkTasksResult => ({
  params: DEFAULT_MY_TASKS_PARAMS,
  tasks: [
    task({ id: "1", dueDate: "2026-11-20T09:00:00.000Z", dueDay: "2026-11-20", columnStage: "TODO" }),
    task({ id: "2", spaceName: "بيتا", projectId: "p2", projectName: "مشروع ب", columnStage: "DOING", visibility: "PARTICIPANTS", assigneeNames: ["سارة", "عمر"] }),
    task({ id: "3", completedAt: "2026-11-19T09:00:00.000Z", columnStage: "DONE", editable: false }),
  ],
  truncated: false,
  counts: { today: 1, overdue: 0, week: 2, nodate: 1, done: 1, created: 0 },
  spaces: [
    { id: "w1", name: "ألفا", kind: "STANDARD" },
    { id: "w2", name: "بيتا", kind: "STANDARD" },
  ],
  projects: [{ id: "p1", name: "مشروع أ", workspaceId: "w1", spaceName: "ألفا" }],
  current: { id: "w1", hq: false },
  scopeFellBack: false,
  timeZone: "Asia/Damascus",
  todayIso: "2026-11-20",
  month: null,
  canAdd: true,
  ...over,
});

describe("a row (D1's list row)", () => {
  const row = (t: WorkTaskDto, extra: Partial<React.ComponentProps<typeof WorkRow>> = {}) => render(createElement(WorkRow, { task: t, showSpace: true, ...actions, ...extra }));

  it("draws the tick, the title as a link to the full page, where it lives, its stage, the due day and the people", () => {
    const markup = row(task({ id: "1", dueDay: "2026-11-20", dueDate: "2026-11-20T09:00:00.000Z" }));
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('data-task-row="1"');
    expect(markup).toContain('href="/tasks/1"');
    expect(markup).toContain("ZK-1 · ألفا · مشروع أ · للتنفيذ");
    expect(markup).toContain('value="2026-11-20"');
    expect(markup).toContain("إكمال");
    expect(markup).toContain("سارة");
    // the D1 row (min height, divider), not a card
    expect(markup).toMatch(/class="[^"]*\bmin-h-14\b[^"]*\bborder-b\b/);
  });

  it("a finished task is struck through and offers «إعادة فتح»; a private one shows its lock; a read-only row has no date box and a disabled tick", () => {
    expect(row(task({ id: "1", completedAt: "2026-11-19T09:00:00.000Z" }))).toContain("إعادة فتح");
    expect(row(task({ id: "1", completedAt: "2026-11-19T09:00:00.000Z" }))).toContain("line-through");
    expect(row(task({ id: "1", visibility: "PARTICIPANTS" }))).toContain("مهمة خاصة");
    const readOnly = row(task({ id: "1", editable: false, dueDate: "2026-11-20T09:00:00.000Z" }));
    expect(readOnly).not.toContain('type="date"');
    expect(readOnly).toMatch(/<button[^>]*disabled/);
  });

  it("leaves out the space when there is only one, and the project/stage when a group already says it; shows «+1» for a second person", () => {
    expect(row(task({ id: "1" }), { showSpace: false })).not.toContain("ألفا");
    expect(row(task({ id: "1" }), { showSpace: false, showProject: false, showStage: false })).toContain(">ZK-1<");
    expect(row(task({ id: "2", assigneeNames: ["سارة", "عمر"] }))).toContain("+1");
  });

  it("the selected row (the open panel) says aria-current", () => {
    expect(row(task({ id: "1" }), { selected: true })).toContain('aria-current="true"');
  });
});

describe("the list, grouped", () => {
  const list = (group: MyTasksParams["group"]) => render(createElement(TaskList, { tasks: result().tasks, group, todayIso: "2026-11-20", timeZone: "Asia/Damascus", showSpace: true, openId: null, actions }));

  it("«none» is one flat list without headings; stage groups have headings with counts, in the order work travels", () => {
    expect(list("none")).not.toContain("<h2");
    const stage = list("stage");
    expect(stage).toContain("<h2");
    expect(stage.indexOf("للتنفيذ")).toBeLessThan(stage.indexOf("قيد الشغل"));
    expect(stage.indexOf("قيد الشغل")).toBeLessThan(stage.indexOf("منجزة"));
    // the group says the stage, so the row does not repeat it
    expect(stage).not.toContain("· للتنفيذ");
  });

  it("groups by project, by person (nobody last) and by due day with the plan's words", () => {
    expect(list("project")).toContain("مشروع ب");
    expect(list("person")).toContain("سارة");
    const due = list("due");
    expect(due).toContain("اليوم");
    expect(due).toContain("بدون موعد");
  });
});

describe("the board groups by STAGE across projects", () => {
  const board = (tasks: WorkTaskDto[]) => render(createElement(TaskBoard, { tasks, todayIso: "2026-11-20", timeZone: "Asia/Damascus", showSpace: true, openId: null, actions, onMove: noop }));

  it("always draws the four stage columns (an empty one says so), with each card in its column and cards from different projects side by side", () => {
    const markup = board(result().tasks);
    for (const stage of ["TODO", "DOING", "REVIEW", "DONE"]) expect(markup).toContain(`data-stage="${stage}"`);
    expect(markup).toContain("ما في مهام بهالمرحلة");
    expect(markup).toContain('data-task-card="1"');
    expect(markup).toContain("مشروع أ");
    expect(markup).toContain("مشروع ب");
    // a card has a «انقل لمرحلة» menu with the four stages (the keyboard and a phone move a card with it)
    expect(markup).toContain("انقل لمرحلة");
    expect(markup).toContain('draggable="true"');
  });

  it("a read-only card cannot be dragged or moved", () => {
    const markup = board([task({ id: "9", editable: false })]);
    expect(markup).toContain('draggable="false"');
    expect(markup).not.toContain("انقل لمرحلة");
  });
});

describe("the bar: views, scopes, chips", () => {
  const bar = (params: MyTasksParams, data: WorkTasksResult) => render(createElement(Toolbar, { params, data, onChange: noop }));

  it("shows the three views and the three scopes, and the six chips with their numbers", () => {
    const markup = bar(DEFAULT_MY_TASKS_PARAMS, result());
    for (const word of ["قائمة", "لوحة", "تقويم", "أنا", "المساحة", "مشروع"]) expect(markup).toContain(`>${word}<`);
    for (const word of ["اليوم", "متأخرة", "هالأسبوع", "بدون موعد", "مكتملة", "أنشأتها"]) expect(markup).toContain(word);
    expect(markup).toMatch(/اليوم<span[^>]*>1<\/span>/);
    expect(markup).toMatch(/هالأسبوع<span[^>]*>2<\/span>/);
    expect(MY_TASK_CHIPS.length).toBe(6);
  });

  it("the chosen chip is pressed; «الكل» is pressed with none", () => {
    expect(bar(DEFAULT_MY_TASKS_PARAMS, result())).toMatch(/aria-pressed="true"[^>]*>الكل</);
    expect(bar({ ...DEFAULT_MY_TASKS_PARAMS, chip: "overdue" }, result())).toMatch(/aria-pressed="true"[^>]*>متأخرة</);
  });

  it("scope «أنا» with several spaces offers the space chips; with one it does not", () => {
    expect(bar(DEFAULT_MY_TASKS_PARAMS, result())).toContain("كل مساحاتي");
    expect(bar(DEFAULT_MY_TASKS_PARAMS, result({ spaces: [{ id: "w1", name: "ألفا", kind: "STANDARD" }] }))).not.toContain("كل مساحاتي");
  });

  it("scope «مشروع» offers the picker of projects", () => {
    const markup = bar({ ...DEFAULT_MY_TASKS_PARAMS, scope: "project" }, result({ spaces: [{ id: "w1", name: "ألفا", kind: "STANDARD" }] }));
    expect(markup).toContain("اختر مشروع");
    expect(markup).toContain("مشروع أ");
  });

  it("in «الشركة» «المساحة» is not offered and the note says why", () => {
    const markup = bar({ ...DEFAULT_MY_TASKS_PARAMS, scope: "space" }, result({ current: { id: "hq", hq: true }, scopeFellBack: true }));
    expect(markup).not.toContain(">المساحة<");
    expect(markup).toContain("«الشركة» ما فيها مشاريع");
  });

  it("the calendar view has no chips, no sort and no grouping", () => {
    const markup = bar({ ...DEFAULT_MY_TASKS_PARAMS, view: "calendar" }, result());
    expect(markup).not.toContain("فلاتر سريعة");
    expect(markup).not.toContain("تجميع حسب");
  });
});

describe("the whole screen", () => {
  const view = (data: WorkTasksResult, requested: MyTasksParams = DEFAULT_MY_TASKS_PARAMS) =>
    render(createElement(MyTasksView, { requested, initial: data, initialQuery: myTasksApiQuery(requested), initialAt: Date.now() }));

  it("draws the title, the quick add, the chips and the rows from the first answer, with no fetch", () => {
    const markup = view(result());
    expect(markup).toContain("مهامي");
    expect(markup).toContain("مهمة جديدة: اكتب العنوان واضغط إدخال");
    expect(markup).toContain("data-task-row=\"1\"");
    expect(textOf(markup)).toContain("3 مهمة");
  });

  it("an empty answer says so and offers a quick task; a person who cannot add sees no quick add", () => {
    expect(view(result({ tasks: [] }))).toContain("ما في مهام هون");
    expect(view(result({ canAdd: false }))).not.toContain("مهمة سريعة");
  });

  it("the board view draws the stage columns; the project scope with no project asks to pick one; the calendar draws its month", () => {
    expect(view(result({ params: { ...DEFAULT_MY_TASKS_PARAMS, view: "board" } }), { ...DEFAULT_MY_TASKS_PARAMS, view: "board" })).toContain('data-stage="REVIEW"');
    const pick = { ...DEFAULT_MY_TASKS_PARAMS, scope: "project" as const };
    expect(view(result({ params: pick, tasks: [] }), pick)).toContain("اختر مشروع لتشوف مهامه");
    const cal = { ...DEFAULT_MY_TASKS_PARAMS, view: "calendar" as const, month: "2026-11" };
    const markup = view(result({ params: cal, month: "2026-11" }), cal);
    expect(markup).toContain("تقويم المهام");
    expect(markup).toContain("الشهر السابق");
  });

  it("says when the list was cut short", () => {
    expect(view(result({ truncated: true }))).toContain("في مهام أكتر من اللي ظاهر");
  });
});

describe("the small parts", () => {
  it("quick add: a title and a button, nothing else", () => {
    const markup = render(createElement(QuickAdd, { onAdd: async () => undefined, pending: false }));
    expect(markup.match(/<input/g)?.length).toBe(1);
    expect(markup).toContain("أضف");
  });

  it("the calendar's month arrows shift the month, across a year end", () => {
    expect(shiftYearMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
    const markup = render(createElement(TaskCalendar, { tasks: [task({ id: "1", dueDate: "2026-11-20T09:00:00.000Z" })], month: "2026-11", todayIso: "2026-11-20", timeZone: "Asia/Damascus", editable: true, onMonth: noop, onReschedule: noop, onOpen: noop }));
    expect(markup).toContain("ZK-1");
    expect(markup).toContain("تشرين");
  });
});

describe("the loading file is shaped like the page and keeps the shared rules of a skeleton", () => {
  const markup = renderToStaticMarkup(createElement(MyWorkLoading as () => ReactElement));
  it("is a busy status with one line for a screen reader, last in the frame; the drawing is hidden from it", () => {
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('<span class="sr-only">جارٍ التحميل…</span></div>');
    expect(textOf(markup)).toBe("جارٍ التحميل…");
    expect((markup.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("wears the page's own outer frame, and every pulsing block stops under reduced motion and in economy mode", () => {
    const page = readFileSync(path.resolve(__dirname, "../src/components/work/my-tasks/my-tasks-view.tsx"), "utf8");
    expect(page).toContain('"flex h-full min-w-0 flex-col overflow-y-auto"');
    expect(markup).toContain('class="flex h-full min-w-0 flex-col overflow-y-auto"');
    for (const block of [...markup.matchAll(/<div[^>]*\banimate-pulse\b[^>]*>/g)].map((m) => m[0])) {
      const tokens = (/\bclass="([^"]*)"/.exec(block)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/);
      expect(tokens).toContain("motion-reduce:animate-none");
      expect(tokens).toContain("[[data-decor-economy]_&]:animate-none");
    }
    expect(textOf(markup)).not.toMatch(/[A-Za-z0-9]/);
  });
});

describe("the screen follows the design rules", () => {
  const dir = path.resolve(__dirname, "../src/components/work/my-tasks");
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
  const markup = [
    render(createElement(TaskList, { tasks: result().tasks, group: "stage", todayIso: "2026-11-20", timeZone: "Asia/Damascus", showSpace: true, openId: null, actions })),
    render(createElement(TaskBoard, { tasks: result().tasks, todayIso: "2026-11-20", timeZone: "Asia/Damascus", showSpace: true, openId: null, actions, onMove: noop })),
    render(createElement(Toolbar, { params: DEFAULT_MY_TASKS_PARAMS, data: result(), onChange: noop })),
  ].join("\n");

  it("uses theme tokens and logical properties only", () => {
    const tokens = classTokens(markup);
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t) || /\b(?:bg|text)-(?:black|white)\b/.test(t))).toEqual([]);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t.replace(/^(?:(?:\[[^\]]*\]|[a-z-]+):)+/, "")))).toEqual([]);
  });

  it("has no hex colour and no tiny text in its sources, and no Latin word on screen", () => {
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/text-\[(?:10|11)px\]/);
      expect(source, file).not.toMatch(/\b(?:bg|text)-(?:black|white)\b/);
      expect(source, file).not.toMatch(/location\s*\.\s*reload\s*\(/);
    }
    expect(textOf(markup).replace(/ZK-\d+/g, "")).not.toMatch(/[A-Za-z]/);
  });
});
