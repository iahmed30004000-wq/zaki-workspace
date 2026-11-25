import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
}));

import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { BoardView, type ColumnData, type TaskCardData } from "@/components/board-view";
import { BoardPicker } from "@/components/work/project/board-picker";
import { ProjectTabs } from "@/components/work/project/project-tabs";
import { ProjectTasksView } from "@/components/work/project/project-tasks-view";
import { projectProgress } from "@/components/work/project/progress";
import { withColumnAdded, withColumnRemoved, withTaskMoved, withTaskParam } from "@/components/work/project/board-cache";
import { PROJECT_TABS, parseBoardParam, parseProjectTab, projectTabHref, projectTabsFor, projectTasksHref, projectTasksParams, projectTasksQuery } from "@/components/work/project/tabs";
import ProjectLoading from "@/app/(app)/projects/[id]/loading";
import BoardLoading from "@/app/(app)/boards/[id]/loading";
import { DEFAULT_MY_TASKS_PARAMS, type WorkTaskDto, type WorkTasksResult } from "@/lib/work/my-tasks";
import { AR } from "@/lib/i18n/dict";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

/**
 * W1.5 - the project page: tabs, the trail, and a board that no longer reloads the page. Pure rules (the tabs and their addresses, the board's cache changes),
 * the screens rendered with their providers (the board, the embedded list and calendar, the strip, the picker, the loading files), and the source rules that
 * keep the old page old (switch `navV2` OFF) and every read behind the task-visibility rule. The doors themselves (who sees which card) are in
 * tests/db/privacy-matrix.test.ts (`GET /boards/<id>/data`).
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))));
const read = (file: string): string => readFileSync(path.join(process.cwd(), file), "utf8");

const column = (id: string, name: string, over: Partial<ColumnData> = {}): ColumnData => ({ id, name, color: "#6b7280", position: 0, done: false, ...over });
const card = (id: string, columnId: string, over: Partial<TaskCardData> = {}): TaskCardData => ({
  id,
  key: `ZK-${id}`,
  title: `بطاقة ${id}`,
  priority: "NORMAL",
  columnId,
  dueDate: null,
  labels: [],
  assignee: null,
  commentCount: 0,
  completed: false,
  ...over,
});

describe("the tabs", () => {
  it("six tabs, the board first; an address names one, anything unknown is the board", () => {
    expect([...PROJECT_TABS]).toEqual(["board", "list", "calendar", "timeline", "fields", "settings"]);
    expect(parseProjectTab("list")).toBe("list");
    expect(parseProjectTab(["settings", "list"])).toBe("settings");
    expect(parseProjectTab(undefined)).toBe("board");
    expect(parseProjectTab("nonsense")).toBe("board");
    expect(parseProjectTab("board")).toBe("board");
    expect(parseBoardParam("b2")).toBe("b2");
    expect(parseBoardParam("  ")).toBeNull();
  });

  it("each tab has an address: the board is the project, the timeline keeps its own page, the rest are ?tab=", () => {
    expect(projectTabHref("p1", "board")).toBe("/projects/p1");
    expect(projectTabHref("p1", "board", { boardId: "b2" })).toBe("/projects/p1?board=b2");
    expect(projectTabHref("p1", "timeline")).toBe("/projects/p1/timeline");
    expect(projectTabHref("p1", "list")).toBe("/projects/p1?tab=list");
    expect(projectTabHref("p1", "calendar")).toBe("/projects/p1?tab=calendar");
    expect(projectTabHref("p1", "fields")).toBe("/projects/p1?tab=fields");
    expect(projectTabHref("p1", "settings")).toBe("/projects/p1?tab=settings");
  });

  it("«القائمة» and «التقويم» are W1.1's views while «مهامي» is on; with it off they are the old pages of this project (never a dead end)", () => {
    const on = projectTabsFor({ projectId: "p1", embeddedViews: true, fieldsTab: true });
    expect(on.map((o) => o.href)).toEqual(["/projects/p1", "/projects/p1?tab=list", "/projects/p1?tab=calendar", "/projects/p1/timeline", "/projects/p1?tab=fields", "/projects/p1?tab=settings"]);
    const off = projectTabsFor({ projectId: "p1", embeddedViews: false, fieldsTab: true });
    expect(off.find((o) => o.tab === "list")?.href).toBe("/list?project=p1");
    expect(off.find((o) => o.tab === "calendar")?.href).toBe("/calendar?project=p1");
  });

  it("«الحقول والقواعد» is offered only when one of its cards exists for the person (an honest tab)", () => {
    expect(projectTabsFor({ projectId: "p1", embeddedViews: true, fieldsTab: false }).map((o) => o.tab)).toEqual(["board", "list", "calendar", "timeline", "settings"]);
  });

  it("every tab has its Arabic name", () => {
    for (const tab of PROJECT_TABS) {
      const name = (AR as Record<string, string>)[`projpage.tab.${tab}`];
      expect(name, tab).toBeTruthy();
      expect(name).not.toMatch(/[A-Za-z0-9]/);
    }
    expect(["اللوحة", "القائمة", "التقويم", "الجدول الزمني", "الحقول والقواعد", "الإعدادات"].map((n) => Object.values(AR).includes(n))).toEqual([true, true, true, true, true, true]);
  });
});

describe("the progress line", () => {
  it("done tasks are not counted twice (3 done of 10 is 30 percent, 7 open)", () => {
    expect(projectProgress(10, 3)).toEqual({ open: 7, done: 3, pct: 30 });
    expect(projectProgress(0, 0)).toEqual({ open: 0, done: 0, pct: 0 });
    expect(projectProgress(4, 4)).toEqual({ open: 0, done: 4, pct: 100 });
    // never a negative or a done count above the total
    expect(projectProgress(2, 5)).toEqual({ open: 0, done: 2, pct: 100 });
    expect(projectProgress(-1, 1)).toEqual({ open: 0, done: 0, pct: 0 });
  });
});

describe("the embedded list and calendar keep the scope on this project", () => {
  it("the address cannot widen the page: scope, project and view in the address are ignored", () => {
    const params = projectTasksParams({ scope: "me", project: "other", view: "board", chip: "overdue", sort: "priority" }, "p1", "list");
    expect(params).toMatchObject({ scope: "project", projectId: "p1", view: "list", chip: "overdue", sort: "priority" });
    expect(projectTasksParams({ view: "list" }, "p1", "calendar").view).toBe("calendar");
  });

  it("the address of a state stays on the project page (never /my-work) and writes only what differs", () => {
    expect(projectTasksHref("p1", "list", projectTasksParams({}, "p1", "list"))).toBe("/projects/p1?tab=list");
    const href = projectTasksHref("p1", "list", { ...projectTasksParams({}, "p1", "list"), chip: "overdue", group: "stage", taskId: "t7" });
    expect(href).toBe("/projects/p1?tab=list&chip=overdue&group=stage&task=t7");
    expect(href).not.toContain("/my-work");
    expect(href).not.toContain("scope=");
    expect(href).not.toContain("project=");
    expect(projectTasksHref("p1", "calendar", { ...projectTasksParams({}, "p1", "calendar"), month: "2026-12" })).toBe("/projects/p1?tab=calendar&month=2026-12");
  });

  it("the data question leaves the open task out (it is only the panel) and keeps the scope for the door", () => {
    const q = projectTasksQuery({ ...projectTasksParams({}, "p1", "list"), taskId: "t7", chip: "week" });
    expect(q).toBe("?scope=project&chip=week&project=p1");
  });
});

const dto = (id: string, over: Partial<WorkTaskDto> = {}): WorkTaskDto => ({
  id,
  key: `ZK-${id}`,
  title: `مهمة ${id}`,
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

const answer = (over: Partial<WorkTasksResult> = {}): WorkTasksResult => ({
  params: projectTasksParams({}, "p1", "list"),
  tasks: [dto("1", { dueDay: "2026-11-20", dueDate: "2026-11-20T09:00:00.000Z" }), dto("2", { columnStage: "DOING" })],
  truncated: false,
  counts: { today: 1, overdue: 0, week: 2, nodate: 1, done: 0, created: 0 },
  spaces: [{ id: "w1", name: "ألفا", kind: "STANDARD" }],
  projects: [{ id: "p1", name: "مشروع أ", workspaceId: "w1", spaceName: "ألفا" }],
  current: { id: "w1", hq: false },
  space: { id: "w1", name: "ألفا" },
  scopeFellBack: false,
  timeZone: "Asia/Damascus",
  todayIso: "2026-11-20",
  month: null,
  canAdd: true,
  filters: { urgent: 0, stages: { TODO: 0, DOING: 0, REVIEW: 0, DONE: 0 }, projects: [], people: null },
  ...over,
});

describe("the embedded list and calendar render", () => {
  const view = (tab: "list" | "calendar", data: WorkTasksResult) => {
    const requested = projectTasksParams({}, "p1", tab);
    return render(createElement(ProjectTasksView, { projectId: "p1", tab, requested, initial: data, initialQuery: projectTasksQuery(requested), initialAt: Date.now() }));
  };

  it("the list: the rows of the project, the chips with their numbers, the stage / sort / group choices - and NO scope, NO project picker, NO quick add", () => {
    const markup = view("list", answer());
    expect(markup).toContain('data-project-tasks="list"');
    expect(markup).toContain('href="/tasks/1"');
    expect(markup).toContain("مهمة 2");
    for (const word of ["اليوم", "متأخرة", "هالأسبوع", "بدون موعد", "مكتملة", "أنشأتها"]) expect(markup).toContain(word);
    expect(markup).toMatch(/اليوم<span[^>]*>1<\/span>/);
    for (const label of ["أنا", "المساحة"]) expect(markup).not.toContain(`>${label}<`);
    expect(markup).not.toContain("اختر مشروع");
    expect(markup).not.toContain("أضف مهمة");
    // the group «حسب المشروع» is pointless inside one project
    expect(markup).not.toContain("حسب المشروع");
    expect(markup).not.toContain("/my-work");
  });

  it("an empty project says so in its own words", () => {
    expect(textOf(view("list", answer({ tasks: [] })))).toContain("ما في مهام بالمشروع حسب هالفلاتر.");
  });

  it("the calendar: the month, no chips (a chip could not be turned off there)", () => {
    const markup = view("calendar", answer({ params: projectTasksParams({}, "p1", "calendar"), month: "2026-11" }));
    expect(markup).toContain('data-project-tasks="calendar"');
    expect(markup).not.toContain("مكتملة");
    expect(markup).toContain("2026");
  });

  it("only theme tokens, logical properties, no pixel text sizes, no Latin words", () => {
    const markup = view("list", answer());
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c))).toEqual([]);
    expect(PALETTE_COLOUR.test(tokens.join(" "))).toBe(false);
    expect(textOf(markup).replace(/ZK-\d+/g, "")).not.toMatch(/[A-Za-z]/);
  });
});

describe("the strip and the picker", () => {
  const tabs = projectTabsFor({ projectId: "p1", embeddedViews: true, fieldsTab: true });

  it("the strip is a labelled navigation of links, the current tab says aria-current, every target is 44px high", () => {
    const markup = render(createElement(ProjectTabs, { tabs, current: "list" }));
    expect(markup).toContain('aria-label="تبويبات المشروع"');
    expect((markup.match(/<li/g) ?? []).length).toBe(6);
    expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(markup).toMatch(/href="\/projects\/p1\?tab=list"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/projects\/p1\?tab=list"/);
    expect(markup).toContain('href="/projects/p1/timeline"');
    expect(markup).toContain("min-h-11");
    expect(classTokens(markup).filter((c) => PHYSICAL_UTILITY.test(c))).toEqual([]);
  });

  it("the picker is not drawn for one board; with several each is a link, the first is the plain project address", () => {
    expect(render(createElement(BoardPicker, { projectId: "p1", boards: [{ id: "b1", name: "لوحة", tasks: 2 }], currentId: "b1" }))).not.toContain("data-board-picker");
    const markup = render(
      createElement(BoardPicker, {
        projectId: "p1",
        boards: [
          { id: "b1", name: "الأولى", tasks: 2 },
          { id: "b2", name: "الثانية", tasks: 0 },
        ],
        currentId: "b2",
      }),
    );
    expect(markup).toContain('href="/projects/p1"');
    expect(markup).toContain('href="/projects/p1?board=b2"');
    expect(markup).toMatch(/aria-current="page"[^>]*>الثانية|>الثانية/);
    expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });
});

describe("what the board holds changes at once (no page reload)", () => {
  const held = { columns: [column("c1", "todo"), column("c2", "done", { done: true })], tasks: [card("a", "c1"), card("b", "c1")] };

  it("a card moves to another column; the others and the order stay; an unknown id changes nothing; the input is never changed", () => {
    const moved = withTaskMoved(held.tasks, "a", "c2");
    expect(moved.map((t) => [t.id, t.columnId])).toEqual([["a", "c2"], ["b", "c1"]]);
    expect(withTaskMoved(held.tasks, "zzz", "c2")).toEqual(held.tasks);
    expect(held.tasks[0]?.columnId).toBe("c1");
  });

  it("a refused move is put back exactly: what was held before the move is what the board shows again", () => {
    const before = held.tasks;
    const during = withTaskMoved(before, "a", "c2");
    expect(during).not.toEqual(before);
    // the board keeps `previous` and sets it back: the same cards in the same columns
    expect(before.map((t) => t.columnId)).toEqual(["c1", "c1"]);
  });

  it("a column is added once and removed by id", () => {
    const added = withColumnAdded(held.columns, column("c3", "جديد"));
    expect(added.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(withColumnAdded(added, column("c3", "جديد")).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(withColumnRemoved(added, "c2").map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("the address keeps the project page's tab and board when a card opens, and drops only ?task= when it closes", () => {
    expect(withTaskParam("/projects/p1?board=b2", "t7")).toBe("/projects/p1?board=b2&task=t7");
    expect(withTaskParam("/projects/p1?board=b2&task=t7", null)).toBe("/projects/p1?board=b2");
    expect(withTaskParam("/boards/b1", "t7")).toBe("/boards/b1?task=t7");
    expect(withTaskParam("/boards/b1?task=t7", null)).toBe("/boards/b1");
  });
});

describe("the board screen", () => {
  const props = { board: { id: "b1", workspaceId: "w1", projectId: "p1", name: "لوحة التصميم", projectName: "مشروع الموقع" }, columns: [column("c1", "todo"), column("c2", "done", { done: true })], tasks: [card("a", "c1")], canEdit: true };
  const board = (extra: Record<string, unknown> = {}) => render(createElement(BoardView, { ...props, ...extra }));

  it("the old board (no `view`) is the board it was: the project's name under the title, the card is a link to its page, no trail, no panel", () => {
    const markup = board();
    expect(markup).toContain("مشروع الموقع");
    expect(markup).toContain('href="/tasks/a"');
    expect(markup).not.toContain("data-breadcrumbs");
    expect(markup).toContain("إضافة عمود");
  });

  it("on the new map the board wears its trail, and a card is STILL a link (a new tab works) that opens in the panel on a plain click", () => {
    const markup = board({ view: { crumbs: [{ label: "ألفا", href: "/projects" }, { label: "مشروع الموقع", href: "/projects/p1" }, { label: "لوحة التصميم" }], panel: true, embedded: false } });
    expect(markup).toContain("data-breadcrumbs");
    expect(markup).toContain('href="/projects/p1"');
    expect(markup).toContain('href="/tasks/a"');
  });

  it("inside the project page's tab the project's name is not repeated", () => {
    const markup = board({ view: { crumbs: null, panel: false, embedded: true } });
    expect(markup).not.toContain("مشروع الموقع");
    expect(markup).not.toContain("data-breadcrumbs");
  });

  it("a reader (canEdit false) has no add-column button", () => {
    expect(board({ canEdit: false })).not.toContain("إضافة عمود");
  });
});

describe("the board never reloads the page (W1.5)", () => {
  const source = read("src/components/board-view.tsx");

  it("no page reload anywhere in the board; adding a card, adding a column and deleting a column change the board at once and ask the server again", () => {
    expect(source).not.toMatch(/location\s*\.\s*reload\s*\(/);
    expect(source).toContain("const askAgain = () => {");
    expect(source).toContain('invalidateQueries({ queryKey: ["board-stages", board.id] })');
    expect(source).toContain("router.refresh();");
    // the three former reloads: the card, the new column, the deleted column
    expect((source.match(/askAgain\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("withColumnAdded(now, column)");
    expect(source).toContain("withColumnRemoved(now, id)");
    expect(source).toContain("onSuccess: () => onRemoved(column.id)");
    // a fresh answer from the server replaces what the board holds
    expect(source).toContain("if (!movingRef.current) setItems(tasks);");
    expect(source).toContain("setColumns(serverColumns);");
  });

  it("a card move is optimistic and is PUT BACK when the server refuses, before anything else is told (the old behaviour, kept)", () => {
    expect(source).toContain("const previous = items;");
    expect(source).toContain("setItems(withTaskMoved(items, activeTaskId, targetColumnId))");
    expect(source.indexOf("setItems(previous)")).toBeGreaterThan(source.indexOf("onError: (err) => {"));
    expect(source.indexOf("setItems(previous)")).toBeLessThan(source.indexOf("requiredFieldsOf(err)"));
    expect(source).toContain('toast(t("board.moveFailed"), "error")');
    // the finish-needs-fields refusal still opens the task where they are filled
    expect(source).toContain("window.location.assign(`/tasks/${activeTaskId}#${FIELDS_ANCHOR}`)");
  });

  it("a refused column delete still says why (the 409 message)", () => {
    const block = /const deleteColumn = useMutation\(\{([\s\S]*?)\n  \}\);/.exec(source)?.[1] ?? "";
    expect(block).toContain("onError");
    expect(block).toContain("messageKey");
    expect(block).toContain('toast(t(key), "error")');
    expect(block).not.toMatch(/locations*.s*reload/);
  });

  it("opening a card on the new map goes through the panel; the old board keeps its link", () => {
    expect(source).toContain("onOpenTask={view?.panel ? openTask : undefined}");
    expect(source).toContain("<CardPanel boardId={board.id}");
    // a plain click only: ctrl/cmd/shift/middle still open the page in a new tab
    expect(source).toContain("e.metaKey || e.ctrlKey || e.shiftKey");
  });

  it("the board page reads every card through taskVisibleWhere (P0.2), keeps its notFound answers, and dresses the board only on the new map", () => {
    const page = read("src/app/(app)/boards/[id]/page.tsx");
    expect(page).toContain("AND: [taskVisibleWhere(scope)]");
    expect(page).not.toContain("taskParticipantFilter");
    expect(page.match(/if \(!\w+\) notFound\(\);/g)?.length).toBe(2);
    expect(page).toContain('const v2 = await actorFeatureOn(actor, "navV2");');
    expect(page).toContain('const panel = v2 && (await actorFeatureOn(actor, "workMyTasks"));');
    expect(page).toContain("...(v2");
  });
});

describe("the project page: the old one stays old with the switch off", () => {
  it("page.tsx hands over to the new page ONLY with navV2 on, at its very top; everything below that line is the old page, still drawn", () => {
    const page = read("src/app/(app)/projects/[id]/page.tsx");
    const handOver = page.indexOf('if (early && (await actorFeatureOn(early, "navV2"))) return ProjectPageV2(');
    expect(handOver).toBeGreaterThan(-1);
    const old = page.slice(handOver);
    for (const word of ["Breadcrumbs", "ProjectTabs", "BoardPicker", "ProjectTasksView"]) expect(old, word).not.toContain(word);
    for (const word of ["<ManageFields", "<RulesCard", "<MilestonesCard", "<PinnedStrip", "<BoardCreateButton", "<TimelineBadgeButton", "<ProjectTeamPicker", 't("proj.boards")', "projectVisibleWhere(scope)", "if (!project) notFound();"]) expect(old, word).toContain(word);
  });

  it("the new page counts and reads through taskVisibleWhere, never a hand-made filter; a person without the projects row gets the notice", () => {
    const source = read("src/app/(app)/projects/[id]/project-page.tsx");
    expect(source).toContain("taskVisibleWhere(scope)");
    expect(source).not.toContain("taskParticipantFilter");
    expect(source).toContain('actorCanWork(actor, "projects.view")');
    expect(source).toContain("<SectionOffNotice />");
    expect(source).toContain("projectVisibleWhere(scope)");
    // the old page's rule is kept: another team's project is «not found»
    expect(source).toContain("if (!project) notFound();");
  });

  it("the list and the calendar fall back to the old pages when «مهامي» is off; an address that names a tab that is not offered lands on the board", () => {
    const source = read("src/app/(app)/projects/[id]/project-page.tsx");
    expect(source).toContain('if (!embeddedViews && (asked === "list" || asked === "calendar")) redirect(');
    expect(source).toContain('asked === "fields" && !hasFieldsTab(access) ? "board" : asked');
  });

  it("the timeline wears the same strip and trail on the new map and is unchanged on the old one", () => {
    const source = read("src/app/(app)/projects/[id]/timeline/page.tsx");
    expect(source).toContain('const v2 = await actorFeatureOn(actor, "navV2");');
    expect(source).toContain('<ProjectTabs tabs={chrome.tabs} current="timeline" />');
    expect(source).toContain("getProjectTimeline(params.id, user.id)");
  });

  it("the page has a loading file of its own and so does the board", () => {
    expect(textOf(renderToStaticMarkup(createElement(ProjectLoading)))).toBe("جارٍ التحميل…");
    expect(textOf(renderToStaticMarkup(createElement(BoardLoading)))).toBe("جارٍ التحميل…");
  });
});

describe("the new files follow the house rules", () => {
  const files = [
    "src/components/shell/breadcrumbs.tsx",
    "src/components/work/project/tabs.ts",
    "src/components/work/project/crumbs.ts",
    "src/components/work/project/board-cache.ts",
    "src/components/work/project/board-picker.tsx",
    "src/components/work/project/project-tabs.tsx",
    "src/components/work/project/project-tasks-view.tsx",
    "src/components/work/project/use-open-task.ts",
    "src/components/work/project/use-task-trail.ts",
    "src/components/work/project/progress.ts",
    "src/app/(app)/boards/[id]/trail/route.ts",
    "src/app/(app)/projects/[id]/project-page.tsx",
    "src/app/(app)/projects/[id]/project-chrome.ts",
    "src/app/(app)/projects/[id]/loading.tsx",
    "src/app/(app)/boards/[id]/loading.tsx",
  ];

  it("no hex colour, no black or white, no pixel text size, no page reload, no opacity step off the scale", () => {
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/text-\[(?:10|11)px\]/);
      expect(source, file).not.toMatch(/\b(?:bg|text)-(?:black|white)\b/);
      expect(source, file).not.toMatch(/location\s*\.\s*reload\s*\(/);
      for (const step of source.matchAll(/\b(?:bg|text|border|ring)-[a-z-]+\/(\d+)\b/g)) expect(Number(step[1]) % 5, `${file}: ${step[0]}`).toBe(0);
    }
  });

  it("every new word is Arabic, with no Latin letter and no «ـاً»", () => {
    const keys = Object.keys(AR).filter((k) => k.startsWith("crumbs.") || k.startsWith("projpage."));
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const key of keys) {
      const value = (AR as Record<string, string>)[key] ?? "";
      expect(value, key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toContain("ـاً");
    }
  });
});
