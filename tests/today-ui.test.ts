import "./ui-render";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { beforeAll, describe, expect, it, vi } from "vitest";
import config from "../tailwind.config";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";
import { stripComments } from "./themes-decor-helpers";

// The rows and the form call useRouter(); neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { ActiveProjects } from "@/components/today/active-projects";
import { completeTask } from "@/components/today/complete-task";
import { QuickAddForm, QuickAddSheet, TodayQuickAdd } from "@/components/today/quick-add";
import { TeamPulse } from "@/components/today/team-pulse";
import { TodayHero } from "@/components/today/today-hero";
import { TodayTaskRow } from "@/components/today/today-task-row";
import { TodayTasksCard } from "@/components/today/today-tasks";
import { ApiError } from "@/lib/api-client";
import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import {
  dayProgress,
  missionOf,
  quickTaskBody,
  TODAY_LIMITS,
  type TodayProject,
  type TodayPulse,
  type TodayQuickAddData,
  type TodayTask,
  type TodayTasks,
} from "@/lib/today";
import { ToastProvider } from "@/components/ui/toast";

/**
 * «اليوم» — structural tests over the parts of the Today page. The pixels are checked in a browser; here are
 * the rules that make the pixels right: the hooks the guide's tours look for, tokens and logical CSS only,
 * thumb-sized controls, Arabic names, nothing that looks like the old wall of 18 navigation cards, and every
 * class is one Tailwind really generates.
 */

const { t } = getServerT();

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

function html(element: ReactElement): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Toasts, null, element)));
}

const hrefs = (markup: string): string[] => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1] as string);

// ───────────────────────────────────────── fixtures ─────────────────────────────────────────

const task = (over: Partial<TodayTask> = {}): TodayTask => ({
  id: "t1",
  title: "تصميم الشعار",
  projectId: "p1",
  projectName: "مشروع الهوية",
  priority: "NORMAL",
  priorityLabel: AR["priority.NORMAL"] as string,
  dueLabel: "اليوم",
  editable: true,
  ...over,
});

const counts = (over: Partial<TodayTasks["counts"]> = {}): TodayTasks["counts"] => ({ open: 0, overdue: 0, today: 0, later: 0, doneToday: 0, ...over });

const tasksOf = (over: Partial<TodayTasks> = {}): TodayTasks => ({ overdue: [], today: [], later: [], counts: counts(), ...over });

const FULL: TodayTasks = {
  overdue: [
    task({ id: "o1", title: "مراجعة العقد", dueLabel: "قبل 3 أيام", priority: "URGENT", priorityLabel: AR["priority.URGENT"] as string }),
    task({ id: "o2", title: "رد على المورّد", dueLabel: "أمس", priority: "HIGH", priorityLabel: AR["priority.HIGH"] as string }),
  ],
  today: [task({ id: "d1", title: "كتابة التقرير", dueLabel: "اليوم" }), task({ id: "d2", title: "اجتماع الفريق", dueLabel: "اليوم", editable: false })],
  later: [task({ id: "l1", title: "تجهيز العرض", dueLabel: "بكرا" }), task({ id: "l2", title: "أرشفة الملفات", dueLabel: "" })],
  counts: counts({ open: 6, overdue: 2, today: 2, later: 2 }),
};

const QUICK: TodayQuickAddData = {
  assigneeId: "u1",
  dueToday: "2026-10-22T09:00:00.000Z",
  dueTomorrow: "2026-10-23T09:00:00.000Z",
  targets: [
    { projectId: "p1", projectName: "مشروع الهوية", workspaceId: "w1", workspaceName: "مساحة التصميم", boardId: "b1" },
    { projectId: "p2", projectName: "حملة رمضان", workspaceId: "w2", workspaceName: "مساحة التسويق", boardId: "b2" },
  ],
};

const PULSE: TodayPulse = {
  open: 42,
  overdue: 7,
  worst: [
    { id: "x1", title: "تسليم الدفعة الأولى", projectName: "مشروع الهوية", assigneeName: "سارة خالد", dueLabel: "قبل 12 يومًا" },
    { id: "x2", title: "تحديث القائمة", projectName: "حملة رمضان", assigneeName: "عمر", dueLabel: "قبل 4 أيام" },
  ],
};

const PROJECTS: TodayProject[] = [
  { id: "p1", name: "مشروع الهوية", status: "ACTIVE", statusLabel: AR["enum.ProjectStatus.ACTIVE"] as string, openTasks: 5 },
  { id: "p2", name: "حملة رمضان", status: "AT_RISK", statusLabel: AR["enum.ProjectStatus.AT_RISK"] as string, openTasks: 11 },
];

// ───────────────────────────────────────── the hero strip ─────────────────────────────────────────

describe("the hero strip, with nothing due: the greeting", () => {
  const markup = html(createElement(TodayHero, { greeting: "صباح الخير يا أحمد", date: "الخميس 22 تشرين الأول 2026", mission: null }));

  it("is the one place of the Today page that draws the strip: the decoration layer and the owner's picture slot", () => {
    expect(markup).toContain('class="zk-decor zk-decor-strip"');
    // no artwork has shipped yet (WP-UI2 item 5): the strip's picture slot is empty, the ornament carries it
    expect(markup).not.toContain("data-art-slot");
    // behind the words, saying nothing
    expect(markup).toMatch(/<div aria-hidden="true" class="zk-decor zk-decor-strip">/);
  });

  it("carries the greeting and the date, on a scrim panel (text over a picture always sits on one)", () => {
    expect(markup).toMatch(/<h1[^>]*>صباح الخير يا أحمد<\/h1>/);
    expect(markup).toContain("الخميس 22 تشرين الأول 2026");
    expect(markup).toMatch(/class="zk-scrim[^"]*"/);
    expect(markup.indexOf("zk-scrim")).toBeLessThan(markup.indexOf("صباح الخير"));
  });

  it("holds no count, no amount and no link: nothing that is measured is drawn over a picture", () => {
    expect(hrefs(markup)).toEqual([]);
    expect(markup).not.toMatch(/<(button|ul|li|table)\b/);
    const dimmer = classTokens(markup).filter((c) => /(^|:)text-muted$/.test(c));
    expect(dimmer, "only fg, fg-muted and accent are held over a picture").toEqual([]);
  });

  it("says what to do when nothing is due", () => {
    expect(markup).toContain(t("today.mission.empty_body"));
    expect(markup).not.toContain(t("today.mission.ribbon"));
  });
});

// ───────────────────────────────────────── «المهمّة الجاية» ─────────────────────────────────────────

describe("«المهمّة الجاية»: the mission card («نجمة وطريق»)", () => {
  const mission = task({ id: "o1", title: "مراجعة العقد", dueLabel: "قبل 3 أيام", priority: "URGENT", priorityLabel: AR["priority.URGENT"] as string });
  const markup = html(createElement(TodayHero, { greeting: "صباح الخير يا أحمد", date: "الخميس 22 تشرين الأول 2026", mission }));

  it("the mission is the most overdue task, else the first due today, else none", () => {
    expect(missionOf(FULL)?.id).toBe("o1");
    expect(missionOf({ overdue: [], today: FULL.today })?.id).toBe("d1");
    expect(missionOf({ overdue: [], today: [] })).toBeNull();
  });

  it("its title is the page's ONE heading, in the wordmark face, under the gold ribbon «المهمّة الجاية»", () => {
    expect([...markup.matchAll(/<h1\b/g)]).toHaveLength(1);
    expect(markup).toMatch(/<h1 id="today-mission" class="[^"]*\bfont-brand\b[^"]*"><bdi>مراجعة العقد<\/bdi><\/h1>/);
    expect(markup).toMatch(/class="zk-ribbon[^"]*"><span>المهمّة الجاية<\/span>/);
    expect(markup).toContain("مشروع الهوية");
    expect(markup).toContain("قبل 3 أيام");
    expect(markup).toContain(AR["priority.URGENT"] as string);
    expect(markup).toContain("صباح الخير يا أحمد · الخميس 22 تشرين الأول 2026");
  });

  it("«ابدأ المهمّة» opens the task, «خلّصتها» finishes it: both 44px", () => {
    expect(markup).toMatch(new RegExp(`<a[^>]*href="/tasks/o1"[^>]*>${t("today.mission.start")}</a>`));
    const done = new RegExp(`<button[^>]*aria-label="${t("today.mission.done_aria", { title: "مراجعة العقد" })}"[^>]*>`).exec(markup)?.[0] ?? "";
    expect(done).toMatch(/\bmin-h-11\b/);
    expect(/<a[^>]*href="\/tasks\/o1"[^>]*>/.exec(markup)?.[0]).toMatch(/\bmin-h-11\b/);
  });

  it("THE RULE, CHANGED ON PURPOSE: the buttons are on the strip, but only inside the scrim panel — never on the picture", () => {
    // everything of the card before the panel is the picture and its layers: no control there
    const card = /<section\b[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
    const panelAt = card.indexOf('class="zk-scrim');
    expect(panelAt).toBeGreaterThan(0);
    expect(card.slice(0, panelAt)).not.toMatch(/<(a|button)\b/);
    expect([...card.slice(panelAt).matchAll(/<(a|button)\b/g)]).toHaveLength(2);
    // still no count, no list, no table over the picture
    expect(markup).not.toMatch(/<(ul|li|table)\b/);
  });

  it("the photograph is a theme-scoped CSS background (no request on another theme, nothing at «off»), behind and silent", () => {
    expect(markup).toMatch(/<div aria-hidden="true" class="zk-hero-photo pointer-events-none absolute inset-0"><\/div>/);
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.zk-hero-photo \{\s*display: none;\s*\}/);
    expect(css).toContain('[data-theme="night"]:not([data-decor="off"]) .zk-hero-photo');
    expect(css).toContain('[data-theme="day"]:not([data-decor="off"]) .zk-hero-photo');
    expect(css).toContain('url("/brand/hero/workspace-dusk.svg")');
    const file = path.join(ROOT, "public/brand/hero/workspace-dusk.svg");
    const svg = readFileSync(file, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(statSync(file).size / 1024).toBeLessThanOrEqual(150);
    // the scene is the project's own drawing: no photograph in it, and the credits say so
    expect(svg).not.toMatch(/<image|data:image/);
    expect(readFileSync(path.join(ROOT, "public/brand/CREDITS.md"), "utf8")).toMatch(/brand\/hero\/workspace-dusk\.svg[^\n]*own original/);
  });

  it("a task the person may not change gets «ابدأ» and no «خلّصتها»", () => {
    const readOnly = html(createElement(TodayHero, { greeting: "مرحبا", date: "اليوم", mission: { ...mission, editable: false } }));
    expect(readOnly).toContain(t("today.mission.start"));
    expect(readOnly).not.toContain(t("today.mission.done"));
  });

  it("«تمّت المهمّة!» promises no star (the stars are the rewards phase)", () => {
    expect(AR["today.mission.passed_title"]).toBe("تمّت المهمّة!");
    expect(AR["today.mission.passed_sub"]).not.toMatch(/نجم|\+/);
  });
});

// ───────────────────────────────────────── the tasks ─────────────────────────────────────────

describe("«مهامي اليوم»: overdue, today and later", () => {
  const markup = html(createElement(TodayTasksCard, { tasks: FULL, hasSpaces: true }));

  it("carries the tour's hook on the list container, once", () => {
    expect([...markup.matchAll(/data-tour="today-tasks"/g)]).toHaveLength(1);
  });

  it("names the three groups in Arabic, in the order overdue, today, later", () => {
    const headings = [...markup.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => textOf(m[1] as string));
    expect(headings).toEqual([t("mywork.tab.overdue"), t("mywork.tab.today"), t("today.tasks.later")]);
    expect(markup).toContain(t("today.tasks.title"));
  });

  it("links every row to its task and shows the project, the due day and the priority in Arabic", () => {
    for (const id of ["o1", "o2", "d1", "d2", "l1", "l2"]) expect(hrefs(markup)).toContain(`/tasks/${id}`);
    expect(markup).toContain("مراجعة العقد");
    expect(markup).toContain("مشروع الهوية");
    expect(markup).toContain("قبل 3 أيام");
    expect(markup).toContain("بكرا");
    expect(markup).toContain(AR["priority.URGENT"] as string);
    expect(markup).toContain(AR["priority.HIGH"] as string);
  });

  it("marks only the urgent and the high priorities (a calm list does not label every row «عادية»)", () => {
    expect(markup).not.toContain(AR["priority.NORMAL"] as string);
    expect(markup).not.toContain(AR["priority.LOW"] as string);
  });

  it("offers the done button for the tasks the person may change, and none for the ones they may not", () => {
    for (const title of ["مراجعة العقد", "رد على المورّد", "كتابة التقرير", "تجهيز العرض", "أرشفة الملفات"]) {
      expect(markup, title).toContain(`aria-label="${t("today.done_aria", { title })}"`);
    }
    expect(markup).not.toContain(`aria-label="${t("today.done_aria", { title: "اجتماع الفريق" })}"`);
    expect(markup).toContain("اجتماع الفريق"); // still listed, to read
  });

  it("shows the overdue day in the danger colour and does not repeat «اليوم» on every row of today's group", () => {
    expect(markup).toMatch(/text-danger[^"]*"[^>]*>قبل 3 أيام/);
    // the rows of today's group carry no due label: only the group's heading says «اليوم»
    const section = /<section aria-labelledby="today-group-today">[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
    expect(section).toContain("كتابة التقرير");
    expect(section.replace(/<h3[\s\S]*?<\/h3>/, "")).not.toContain("اليوم");
  });

  it("summarises the counts in the header, and links to every task of the person", () => {
    expect(markup).toContain(t("today.tasks.see_all"));
    expect(hrefs(markup)).toContain("/my-work");
    expect(textOf(markup)).toMatch(/2\s+متأخرة/);
  });

  it("says how many more there are, with a link, when the lists were cut", () => {
    const cut = html(
      createElement(TodayTasksCard, {
        tasks: { ...FULL, counts: counts({ open: 40, overdue: 20, today: 2, later: 18 }) },
        hasSpaces: true,
      }),
    );
    expect(cut).toContain(t("today.tasks.show_rest", { n: 18 })); // overdue: 20 counted, 2 shown
    expect(hrefs(cut)).toEqual(expect.arrayContaining(["/my-work?tab=overdue", "/my-work?tab=mine"]));
    expect(TODAY_LIMITS.overdue).toBeGreaterThan(0);
  });

  it("when nothing is due today but something is coming, says so instead of showing an empty box", () => {
    const quiet = html(
      createElement(TodayTasksCard, {
        tasks: tasksOf({ later: [task({ id: "l1", title: "تجهيز العرض", dueLabel: "بكرا" })], counts: counts({ open: 1, later: 1 }) }),
        hasSpaces: true,
      }),
    );
    expect(quiet).toContain(t("today.tasks.nothing_today"));
    expect(quiet).toContain("تجهيز العرض");
    expect(quiet).not.toContain(t("today.empty.title"));
  });
});

describe("«مهامي اليوم» with nothing in it: no dead end", () => {
  it("shows the empty state with the next step, «افتح مهامي», and the empty-tasks drawing slot", () => {
    const markup = html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: true }));
    expect(markup).toContain(t("today.empty.title"));
    expect(markup).toContain(t("today.empty.hint"));
    expect(markup).toMatch(new RegExp(`<a[^>]*href="/my-work"[^>]*>${t("today.empty.action")}</a>`));
    // no artwork has shipped yet (WP-UI2 item 5): the drawing slot is empty, the ornament carries it
    expect(markup).not.toContain("data-art-slot");
    expect(markup).toContain('class="zk-decor zk-decor-empty"');
    // the hook is on the page whether or not there is anything in the list
    expect([...markup.matchAll(/data-tour="today-tasks"/g)]).toHaveLength(1);
    expect(markup).not.toContain(t("today.tasks.see_all")); // nothing to see
  });

  it("a person who is in no space yet is told so, with a way to learn what a space is", () => {
    const markup = html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: false }));
    expect(markup).toContain(t("today.empty.no_space_title"));
    expect(markup).toContain(t("today.empty.no_space_hint"));
    expect(hrefs(markup)).toContain("/guide/spaces");
    expect(markup).not.toContain(t("today.empty.title"));
    expect(markup).not.toContain(t("today.empty.create_space_title"));
  });

  it("somebody who may open a space of their own is told to open the first one, not to wait for the owner", () => {
    const markup = html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: false, canCreateSpaces: true }));
    expect(markup).toContain(t("today.empty.create_space_title"));
    expect(markup).toContain(t("today.empty.create_space_hint"));
    expect(markup).toMatch(new RegExp(`<a[^>]*href="/projects"[^>]*>${t("today.empty.create_space_action")}</a>`));
    expect(markup).not.toContain("data-art-slot");
    expect(markup).not.toContain(t("today.empty.no_space_title"));
    // being in a space makes the question moot, whatever the person may open
    const inSpace = html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: true, canCreateSpaces: true }));
    expect(inSpace).toContain(t("today.empty.title"));
    expect(inSpace).not.toContain(t("today.empty.create_space_title"));
  });
});

describe("a task row", () => {
  const row = (over: Partial<TodayTask>, tone: "overdue" | "today" | "later" = "later") => html(createElement("ul", null, createElement(TodayTaskRow, { task: task(over), tone })));

  it("is a link to the task with a done button before it, 44px wide at least (a thumb)", () => {
    const markup = row({});
    expect(hrefs(markup)).toEqual(["/tasks/t1"]);
    const button = /<button\b[^>]*>/.exec(markup)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toMatch(/\bsize-11\b/);
    expect(markup.indexOf("<button")).toBeLessThan(markup.indexOf("<a "));
  });

  it("has no button at all for a task the person cannot change", () => {
    expect(row({ editable: false })).not.toContain("<button");
  });

  it("puts the project on the second line, and the due day with it unless it is today's group", () => {
    const later = row({ dueLabel: "بكرا" }, "later");
    expect(later).toContain("مشروع الهوية");
    expect(later).toContain("بكرا");
    const today = row({ dueLabel: "اليوم" }, "today");
    expect(today).toContain("مشروع الهوية");
    expect(today).not.toContain(">اليوم<");
  });

  it("the danger colour is for the overdue day only", () => {
    expect(row({ dueLabel: "أمس" }, "overdue")).toMatch(/text-danger[^"]*"[^>]*>أمس/);
    expect(row({ dueLabel: "بكرا" }, "later")).not.toContain("text-danger");
  });
});

describe("completing a task: the existing endpoint, a refusal explained in Arabic", () => {
  it("says so when the 403 is about the board (no done column to move the task to), not about the person", async () => {
    const noColumn = async () => {
      throw new ApiError("forbidden", 403, undefined, "board.no_done_column");
    };
    expect(await completeTask("a", noColumn)).toEqual({ ok: false, messageKey: "today.done_no_column" });
  });

  it("posts {complete: true} to /api/tasks/<id>/complete and says it worked", async () => {
    const calls: Array<[string, unknown]> = [];
    const post = async (path: string, body?: unknown) => {
      calls.push([path, body]);
      return { task: {} };
    };
    expect(await completeTask("abc123", post)).toEqual({ ok: true });
    expect(calls).toEqual([["/api/tasks/abc123/complete", { complete: true }]]);
  });

  it("maps a 403 to the «ليس لديك صلاحية» sentence, and everything else to «تعذّر إنجاز المهمة»", async () => {
    const refuse = async () => {
      throw new ApiError("forbidden", 403, undefined, "insufficient_role");
    };
    expect(await completeTask("a", refuse)).toEqual({ ok: false, messageKey: "forbidden" });
    for (const err of [new ApiError("not_found", 404), new ApiError("internal", 500), new Error("network down")]) {
      const fail = async () => {
        throw err;
      };
      expect(await completeTask("a", fail)).toEqual({ ok: false, messageKey: "today.done_failed" });
    }
  });
});

// ───────────────────────────────────────── the quick add ─────────────────────────────────────────

describe("«إضافة سريعة»", () => {
  it("is an inline line at the foot of the list: type, press Enter; the tour's hook on the field, once", () => {
    const markup = html(createElement(TodayQuickAdd, { quickAdd: QUICK, timeZone: "Asia/Damascus" }));
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(1);
    const field = /<input\b[^>]*data-tour="quick-add"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(field).toContain(`aria-label="${t("today.quick.inline_aria")}"`);
    expect(field).toContain(`placeholder="${t("today.quick.inline_placeholder")}"`);
    expect(field).toMatch(/\bmin-h-11\b/);
    expect(field).toMatch(/\bborder-dashed\b/);
    expect(markup).toMatch(/<form\b/);
    // «المشروع والموعد» opens the full sheet, which is not on the page until then
    expect(textOf(markup)).toContain(t("today.quick.more"));
    expect(markup).not.toContain(t("today.quick.submit"));
  });

  it("with no project that has a board: no field, only the button (its sheet says why), carrying the hook", () => {
    const markup = html(createElement(TodayQuickAdd, { quickAdd: { ...QUICK, targets: [] }, timeZone: "Asia/Damascus" }));
    expect(markup).not.toContain("<input");
    expect(markup).toMatch(/<button\b[^>]*data-tour="quick-add"[^>]*>/);
  });

  it("builds the request for the existing POST /api/tasks: the person's own task, due today unless they say otherwise", () => {
    // the noon is computed at SUBMIT time in the company's zone (item 11), from the injected clock:
    // 2026-10-22 09:00Z is 12:00 in Asia/Damascus (UTC+3), so "today" noon is 2026-10-22T09:00Z
    const body = quickTaskBody(QUICK, { projectId: "p1", title: "  اتصل بالمورّد  ", due: "today", timeZone: "Asia/Damascus", now: new Date("2026-10-22T09:00:00.000Z") });
    expect(body).toEqual({
      workspaceId: "w1",
      projectId: "p1",
      boardId: "b1",
      title: "اتصل بالمورّد",
      assigneeId: "u1",
      dueDate: "2026-10-22T09:00:00.000Z",
    });
    expect(
      quickTaskBody(QUICK, { projectId: "p2", title: "x", due: "tomorrow", timeZone: "Asia/Damascus", now: new Date("2026-10-22T09:00:00.000Z") }),
    ).toMatchObject({ workspaceId: "w2", boardId: "b2", dueDate: "2026-10-23T09:00:00.000Z" });
    // «بدون موعد» is SAID (null): an absent date would take the company's default
    expect(quickTaskBody(QUICK, { projectId: "p1", title: "x", due: "none", timeZone: "Asia/Damascus" })).toHaveProperty("dueDate", null);
  });

  it("computes noon at submit time, not from the server render: a phone resumed after midnight gets the NEW day (item 11)", () => {
    // the server render baked noon of 2026-10-22 (QUICK.dueToday). A phone resumed at 00:30 on
    // 2026-10-23 in Damascus must create a task due 2026-10-23 noon, not yesterday's.
    expect(QUICK.dueToday).toBe("2026-10-22T09:00:00.000Z");
    const body = quickTaskBody(QUICK, { projectId: "p1", title: "x", due: "today", timeZone: "Asia/Damascus", now: new Date("2026-10-22T21:30:00.000Z") });
    expect(body?.dueDate).toBe("2026-10-23T09:00:00.000Z");
    // DST boundary: Damascus is UTC+3 in summer, UTC+2 from late October — the wall noon stays 12:00 local
    const dstBody = quickTaskBody(QUICK, { projectId: "p1", title: "x", due: "today", timeZone: "Asia/Damascus", now: new Date("2026-10-28T10:00:00.000Z") });
    expect(dstBody?.dueDate).toBe("2026-10-28T09:00:00.000Z"); // 12:00 +02:00
  });

  it("builds nothing for a blank title or a project that is not on the list, and cuts a title at the API's limit", () => {
    expect(quickTaskBody(QUICK, { projectId: "p1", title: "   ", due: "today", timeZone: "Asia/Damascus" })).toBeNull();
    expect(quickTaskBody(QUICK, { projectId: "nope", title: "x", due: "today", timeZone: "Asia/Damascus" })).toBeNull();
    expect(quickTaskBody({ ...QUICK, targets: [] }, { projectId: "p1", title: "x", due: "today", timeZone: "Asia/Damascus" })).toBeNull();
    expect(quickTaskBody(QUICK, { projectId: "p1", title: "ا".repeat(400), due: "none", timeZone: "Asia/Damascus" })?.title).toHaveLength(280);
  });

  describe("the form", () => {
    const form = html(createElement(QuickAddForm, { quickAdd: QUICK, timeZone: "Asia/Damascus", onDone: () => {} }));

    it("asks for a title, a project and a day: three things, the day already on «اليوم»", () => {
      expect(form).toContain("<form");
      expect(form).toMatch(/<input[^>]*required[^>]*>/);
      expect(form).toContain('maxLength="280"');
      expect(form).toContain(`placeholder="${t("today.quick.title_placeholder")}"`);
      expect(form).toContain(t("task.title"));
      expect(form).toContain(t("proj.one"));
      expect([...form.matchAll(/<option\b/g)]).toHaveLength(2);
      expect([...form.matchAll(/type="radio"/g)]).toHaveLength(3);
      for (const label of [t("time.today"), t("time.tomorrow"), t("today.quick.no_date")]) expect(form).toContain(label);
      expect(form).toMatch(/<input[^>]*value="today"[^>]*checked=""[^>]*>|<input[^>]*checked=""[^>]*value="today"[^>]*>/);
    });

    it("ends with one big button that says what it does", () => {
      expect(form).toContain(t("today.quick.submit"));
      expect(/<button\b[^>]*type="submit"[^>]*>/.exec(form)?.[0] ?? "").toMatch(/\bmin-h-12\b/);
    });

    it("names the space beside the project only when the projects live in more than one", () => {
      expect(form).toContain("مشروع الهوية · مساحة التصميم");
      const single = html(
        createElement(QuickAddForm, {
          quickAdd: { ...QUICK, targets: QUICK.targets.map((x) => ({ ...x, workspaceId: "w1", workspaceName: "مساحة التصميم" })) },
          timeZone: "Asia/Damascus",
          onDone: () => {},
        }),
      );
      expect(single).not.toContain("مساحة التصميم");
      expect(single).toContain("حملة رمضان");
    });

    it("uses thumb-sized controls", () => {
      for (const tag of form.matchAll(/<(button|input|select)\b[^>]*>/g)) {
        if (/type="radio"/.test(tag[0])) continue; // a visually hidden input inside a 44px label
        const cls = /class="([^"]*)"/.exec(tag[0])?.[1] ?? "";
        expect(/(^|\s)(h|size)-(8|9|10)(\s|$)/.test(cls), tag[0]).toBe(false);
      }
    });
  });

  describe("the sheet", () => {
    const open = (quickAdd: TodayQuickAddData) => html(createElement(QuickAddSheet, { open: true, onOpenChange: () => {}, quickAdd, timeZone: "Asia/Damascus", portal: false }));

    it("is a dialog named «مهمة جديدة», that tells the person the task will be theirs, with the form inside", () => {
      const sheet = open(QUICK);
      expect(sheet).toContain('role="dialog"');
      expect(sheet).toContain(t("task.new"));
      expect(sheet).toContain(t("today.quick.assigned_hint"));
      expect(sheet).toContain("<form");
      expect(sheet).not.toContain(t("today.quick.no_target_title"));
    });

    it("with no project that has a board says what to do first, and links to the projects: no dead end, no form", () => {
      const sheet = open({ ...QUICK, targets: [] });
      expect(sheet).toContain(t("today.quick.no_target_title"));
      expect(sheet).toContain(t("today.quick.no_target_hint"));
      expect(sheet).toMatch(new RegExp(`<a[^>]*href="/projects"[^>]*>${t("today.quick.open_projects")}</a>`));
      expect(sheet).not.toContain("<form");
    });

    it("draws nothing at all while it is closed", () => {
      const closed = html(createElement(QuickAddSheet, { open: false, onOpenChange: () => {}, quickAdd: QUICK, timeZone: "Asia/Damascus", portal: false }));
      expect(closed).not.toContain("<form");
      expect(closed).not.toContain('role="dialog"');
    });
  });
});

// ───────────────────────────────────────── the pulse and the projects ─────────────────────────────────────────

describe("«نبض الفريق»", () => {
  const markup = html(createElement(TeamPulse, { pulse: PULSE }));

  it("shows the two company numbers and names the scope", () => {
    expect(markup).toContain(t("today.pulse.title"));
    expect(markup).toContain(t("today.pulse.scope"));
    expect(textOf(markup)).toMatch(/42\s+مفتوحة/);
    expect(textOf(markup)).toMatch(/7\s+متأخرة/);
    expect(markup).toMatch(/text-danger[^"]*"[^>]*>7</);
  });

  it("lists the most overdue tasks, each a link to the task with its assignee and how late it is", () => {
    expect(markup).toContain(t("today.pulse.worst"));
    expect(hrefs(markup)).toEqual(["/tasks/x1", "/tasks/x2"]);
    for (const text of ["تسليم الدفعة الأولى", "سارة خالد", "مشروع الهوية", "قبل 12 يومًا", "عمر"]) expect(markup).toContain(text);
  });

  it("says «لا شيء متأخر» instead of an empty list when nothing is overdue, and shows no danger colour", () => {
    const calm = html(createElement(TeamPulse, { pulse: { open: 9, overdue: 0, worst: [] } }));
    expect(calm).toContain(t("analytics.allGood"));
    expect(calm).not.toContain(t("today.pulse.worst"));
    expect(calm).not.toContain("text-danger");
  });
});

describe("«مشاريعي النشطة»", () => {
  it("is a compact list of links to the projects, with the status in Arabic and the open tasks", () => {
    const markup = html(createElement(ActiveProjects, { projects: PROJECTS, isExternal: false }));
    expect(markup).toContain(t("today.projects.title"));
    expect(hrefs(markup)).toEqual(expect.arrayContaining(["/projects/p1", "/projects/p2", "/projects"]));
    expect(markup).toContain(AR["enum.ProjectStatus.ACTIVE"] as string);
    expect(markup).toContain(AR["enum.ProjectStatus.AT_RISK"] as string);
    expect(markup).toContain(t("today.projects.open", { n: 5 }));
    expect(markup).toContain(t("today.projects.open", { n: 11 }));
  });

  it("speaks of the partner's own tasks, not the project's", () => {
    const markup = html(createElement(ActiveProjects, { projects: PROJECTS, isExternal: true }));
    expect(markup).toContain(t("today.projects.open_mine", { n: 5 }));
    expect(markup).not.toContain(t("today.projects.open", { n: 5 }));
  });

  it("with no project says so and points to the projects page", () => {
    const markup = html(createElement(ActiveProjects, { projects: [], isExternal: false }));
    expect(markup).toContain(t("today.projects.empty"));
    expect(hrefs(markup)).toContain("/projects");
  });
});

// ───────────────────────────────────────── rules over everything the page renders ─────────────────────────────────────────

const everything = [
  html(createElement(TodayHero, { greeting: "صباح الخير يا أحمد", date: "الخميس 22 تشرين الأول 2026", mission: null })),
  html(createElement(TodayHero, { greeting: "صباح الخير يا أحمد", date: "الخميس 22 تشرين الأول 2026", mission: FULL.overdue[0]! })),
  html(createElement(TodayTasksCard, { tasks: FULL, hasSpaces: true, quickAdd: QUICK, timeZone: "Asia/Damascus" })),
  html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: true })),
  html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: false })),
  html(createElement(TodayTasksCard, { tasks: tasksOf(), hasSpaces: false, canCreateSpaces: true })),
  html(createElement(TodayQuickAdd, { quickAdd: QUICK, timeZone: "Asia/Damascus" })),
  html(createElement(QuickAddForm, { quickAdd: QUICK, timeZone: "Asia/Damascus", onDone: () => {} })),
  html(createElement(QuickAddSheet, { open: true, onOpenChange: () => {}, quickAdd: QUICK, timeZone: "Asia/Damascus", portal: false })),
  html(createElement(QuickAddSheet, { open: true, onOpenChange: () => {}, quickAdd: { ...QUICK, targets: [] }, timeZone: "Asia/Damascus", portal: false })),
  html(createElement(TeamPulse, { pulse: PULSE })),
  html(createElement(TeamPulse, { pulse: { open: 1, overdue: 0, worst: [] } })),
  html(createElement(ActiveProjects, { projects: PROJECTS, isExternal: false })),
  html(createElement(ActiveProjects, { projects: [], isExternal: false })),
];
const rendered = everything.join("\n");
const tokens = classTokens(rendered);

describe("the page is made of the theme's tokens, in logical CSS, with nothing of the old card wall", () => {
  it("renders something real (so the checks below are not vacuous)", () => {
    expect(tokens.length).toBeGreaterThan(60);
    expect(rendered.length).toBeGreaterThan(4000);
  });

  it("uses no palette colour, black or white, no inline colour", () => {
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
    expect(rendered).not.toMatch(/style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/);
  });

  it("uses no left/right/ml/mr/pl/pr/inset-x utility: the page is right-to-left", () => {
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
  });

  it("has no card grid and no navigation cards: no grid columns, and no link to a place that has its own tab", () => {
    expect(tokens.filter((c) => /(^|:)grid-cols-/.test(c))).toEqual([]);
    const places = ["/chat", "/list", "/calendar", "/goals", "/ideas", "/production", "/departments", "/teams", "/members", "/files", "/documents", "/crm", "/analytics", "/automation", "/telegram", "/settings"];
    const found = hrefs(rendered).filter((h) => places.some((p) => h === p || h.startsWith(`${p}/`) || h.startsWith(`${p}?`)));
    expect(found).toEqual([]);
  });

  it("links only to tasks, projects, «مهامي» and the spaces article", () => {
    const allowed = /^(\/tasks\/[\w-]+|\/projects(\/[\w-]+)?|\/my-work(\?tab=\w+)?|\/guide\/spaces)$/;
    expect(hrefs(rendered).filter((h) => !allowed.test(h))).toEqual([]);
  });

  it("makes every control thumb-sized: no button, input or select at 32 to 40px", () => {
    for (const tag of rendered.matchAll(/<(button|select|textarea)\b[^>]*>/g)) {
      const cls = /class="([^"]*)"/.exec(tag[0])?.[1] ?? "";
      expect(/(^|\s)(h|size)-(8|9|10)(\s|$)/.test(cls), tag[0].slice(0, 140)).toBe(false);
    }
  });

  it("gives every button an Arabic accessible name", () => {
    let checked = 0;
    for (const markup of everything) {
      for (const [whole, inner] of markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)) {
        const named = /[؀-ۿ]/.test(textOf(inner as string)) || /aria-label="[^"]*[؀-ۿ]/.test(whole);
        expect(named, whole.slice(0, 140)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("shows no English word and prints no dictionary key", () => {
    const visible = [...rendered.matchAll(/>([^<>]+)</g)].map((m) => m[1] as string);
    const labels = [...rendered.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1] as string);
    for (const text of [...visible, ...labels]) {
      expect(text, text).not.toMatch(/[A-Za-z]{2,}/);
      expect(text, text).not.toMatch(/\b(?:today|common|task|mywork|proj|time|priority)\.[a-z_]+/);
    }
  });

  it("scrolls only down: nothing is wider than a phone", () => {
    expect(tokens.filter((c) => /^(?:min-|max-)?w-\[\d{3,}px\]$/.test(c))).toEqual([]);
  });
});

describe("every class is one Tailwind really generates (a typo would silently do nothing)", () => {
  let css = "";

  beforeAll(async () => {
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: tokens.join(" "), extension: "html" }] })]).process("@tailwind utilities;", { from: undefined });
    css = result.css;
  });

  const escapeSelector = (token: string) => token.replace(/[^a-zA-Z0-9_-]/g, (c) => (c === "," ? "\\2c " : `\\${c}`));
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasRule = (token: string) => new RegExp(`\\.${escapeRegExp(escapeSelector(token))}(?![\\w\\\\-])`).test(css);
  /** Marker classes (the decoration's zk-*, the icon library's, Tailwind's group/peer names) have no rule of their own. */
  const marker = (token: string) => /^zk-/.test(token) || /^lucide(-|$)/.test(token) || /^(group|peer)(\/|$)/.test(token);

  it("every class has a rule", () => {
    expect(tokens.filter((c) => !marker(c) && !hasRule(c))).toEqual([]);
  });
});

// ───────────────────────────────────────── the source ─────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function sourcesIn(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) sourcesIn(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const MINE = [...sourcesIn("src/components/today"), "src/app/(app)/page.tsx", "src/lib/today.ts", "src/lib/zoned-time.ts", "src/server/services/today.ts"];
const code = (rel: string) => stripComments(read(rel));

describe("the source of the Today page", () => {
  it("is where it is supposed to be", () => {
    expect(MINE.length).toBeGreaterThanOrEqual(11);
    for (const rel of MINE) expect(read(rel).length, rel).toBeGreaterThan(100);
  });

  it("writes no colour of its own: no hex, no rgb(), no palette class", () => {
    for (const rel of MINE) {
      const text = code(rel);
      expect(text, `${rel}: hex or rgb colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
      for (const line of text.split(/\r?\n/)) expect(PALETTE_COLOUR.test(line), `${rel}: ${line.trim()}`).toBe(false);
    }
  });

  it("uses logical properties only", () => {
    for (const rel of MINE.filter((f) => f.endsWith(".tsx"))) {
      const text = code(rel);
      expect(text, `${rel}: physical margin or padding`).not.toMatch(/(^|[\s"'`])-?(?:ml|mr|pl|pr)-(?:\d|\[|px|auto)/);
      expect(text, `${rel}: left/right offset`).not.toMatch(/(^|[\s"'`])-?(?:left|right)-(?:\d|\[|px|full|1\/)/);
      expect(text, `${rel}: text-left / text-right`).not.toMatch(/(^|[\s"'`])text-(?:left|right)\b/);
      expect(text, `${rel}: rounded-l / rounded-r`).not.toMatch(/(^|[\s"'`])rounded-[lr]-/);
    }
  });

  it("formats no date or number with the browser's locale: every date goes through lib/format", () => {
    for (const rel of MINE.filter((f) => f !== "src/lib/zoned-time.ts")) {
      expect(code(rel), rel).not.toMatch(/\bIntl\b|\.toLocale(Date|Time)?String\(/);
    }
    // the clock maths reads NUMBERS from the platform's zone data and never writes text for a person
    expect(code("src/lib/zoned-time.ts")).not.toMatch(/\.toLocale(Date|Time)?String\(/);
  });

  it("asks the dictionary only for words that exist, and every word of its own fragment is used", () => {
    const used = new Set<string>();
    for (const rel of MINE) for (const m of read(rel).matchAll(/["'`]((?:today|common|task|mywork|proj|time|priority|analytics|forbidden|guide|ui|enum)\.[\w.]+|forbidden)["'`]/g)) used.add(m[1] as string);
    for (const key of used) expect(AR[key], key).toBeTruthy();
    const fragment = JSON.parse(read("src/lib/i18n/ar.today.json")) as Record<string, string>;
    for (const key of Object.keys(fragment)) {
      expect(key.startsWith("today."), key).toBe(true);
      expect(used.has(key), `${key} is in the dictionary but no code asks for it`).toBe(true);
      expect(fragment[key], key).toMatch(/[؀-ۿ]/);
      expect(fragment[key]!.replace(/\{[^{}]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(fragment[key], key).not.toMatch(/[٠-٩]/);
    }
  });

  it("carries the two hooks of the tour as literals, each once, and no other hook", () => {
    const all = MINE.map((rel) => read(rel)).join("\n");
    const hooks = [...all.matchAll(/data-tour=["']([^"']+)["']/g)].map((m) => m[1]);
    expect(hooks.sort()).toEqual(["quick-add", "today-tasks"]);
  });

  it("draws the strip once and no other place, and asks only for the two pictures the page has", () => {
    const all = MINE.map((rel) => code(rel)).join("\n");
    expect([...all.matchAll(/<ThemeDecor\s+kind="([^"]+)"/g)].map((m) => m[1])).toEqual(["strip"]);
    expect([...all.matchAll(/<ArtSlot\s+[^>]*slot="([^"]+)"/g)].map((m) => m[1])).toEqual(["today-strip"]);
    expect([...new Set([...all.matchAll(/\bart="([^"]+)"/g)].map((m) => m[1]))]).toEqual(["empty-tasks"]);
  });

  it("keeps the page itself thin: the data from one service, the parts from the today folder, no navigation cards, no icons of its own", () => {
    const page = code("src/app/(app)/page.tsx");
    expect(page).toContain("getToday(");
    expect(page).toContain("pageActor()");
    expect(page).toContain("<FirstStepsCard");
    expect(page).toContain("<InstallHint");
    expect(page).not.toMatch(/lucide-react|NavGrid|NavCardItem|ProjectsToolbar/);
    expect(page).not.toMatch(/db\.|from "@\/server\/db"/);
    expect((page.match(/<Link\b/g) ?? []).length).toBe(0);
    // the first-steps card comes first, then the tasks; the install hint sits BELOW the tasks
    // (WP-UI2 item 1 moved it there on purpose: it must not push the tasks down)
    expect(page.indexOf("<FirstStepsCard")).toBeLessThan(page.indexOf("<TodayTasksCard"));
    expect(page.indexOf("<TodayTasksCard")).toBeLessThan(page.indexOf("<InstallHint"));
  });
});

// ───────────────────────────────────────── «نجمة وطريق» in the list ─────────────────────────────────────────

describe("«مهمّاتي اليوم» in the shape of «نجمة وطريق»", () => {
  it("«x من y خلصت»: what was finished today out of today's work (late + today + finished); later work is not the day's", () => {
    expect(dayProgress(counts({ overdue: 2, today: 2, later: 2, doneToday: 3 }))).toEqual({ done: 3, total: 7 });
    expect(dayProgress(counts({ later: 5 }))).toEqual({ done: 0, total: 0 });
    const markup = html(createElement(TodayTasksCard, { tasks: { ...FULL, counts: counts({ open: 6, overdue: 2, today: 2, later: 2, doneToday: 3 }) }, hasSpaces: true }));
    expect(markup).toContain(t("today.tasks.progress", { done: "3", total: "7" }));
    expect(AR["today.tasks.title"]).toBe("مهمّاتي اليوم");
  });

  it("says no progress on a day with nothing in it", () => {
    const markup = html(createElement(TodayTasksCard, { tasks: tasksOf({ counts: counts({ open: 1, later: 1 }), later: [task({ id: "l1" })] }), hasSpaces: true }));
    expect(markup).not.toContain("خلصت");
  });

  it("the star between two rules under the title, silent", () => {
    const markup = html(createElement(TodayTasksCard, { tasks: FULL, hasSpaces: true }));
    expect(markup).toContain('<div aria-hidden="true" class="zk-orn mx-4 mt-2"></div>');
  });

  it("the finishing circle is 44px around a gold star (hidden until done or hovered)", () => {
    const markup = html(createElement(TodayTaskRow, { task: task(), tone: "today" }));
    const button = /<button\b[^>]*>[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
    expect(button).toMatch(/class="[^"]*\bsize-11\b/);
    expect(button).toMatch(/<span aria-hidden="true" class="zk-star size-3\.5 text-accent-2[^"]*opacity-0/);
  });

  it("the inline quick add sits at the foot of the list, inside the card, for whoever may add", () => {
    const markup = html(createElement(TodayTasksCard, { tasks: FULL, hasSpaces: true, quickAdd: QUICK, timeZone: "Asia/Damascus" }));
    const list = /<div data-tour="today-tasks"[\s\S]*$/.exec(markup)?.[0] ?? "";
    expect(list).toContain('data-tour="quick-add"');
    const none = html(createElement(TodayTasksCard, { tasks: FULL, hasSpaces: true, quickAdd: null }));
    expect(none).not.toContain('data-tour="quick-add"');
  });
});
