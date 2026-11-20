import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/tasks/t1",
}));

import { AR } from "@/lib/i18n/dict";
import { RunningChip } from "@/components/time/running-chip";
import { TimeTodayLine } from "@/components/time/my-time-today";
import { EntryLine, RunningClock, TaskTimeCard } from "@/components/time/task-time-card";
import { TimeReportView } from "@/components/time/time-report";
import { errorKeyOf } from "@/lib/time-client";
import { PLACES } from "@/lib/nav/places";
import type { EntryDto, MyTimeToday, TaskTimeCard as CardData, TimeReport } from "@/server/services/time-tracking";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The two rules every screen of this feature keeps: theme tokens only, and logical (RTL-safe) directions. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

/** What a screen says in words must hold no Latin letters (the interface is Arabic only). */
function expectArabicOnly(markup: string) {
  expect(textOf(markup).replace(/\b(?:hh|mm|ss)\b/g, "")).not.toMatch(/[A-Za-z]/);
}

const entry = (over: Partial<EntryDto> = {}): EntryDto => ({
  id: "e1",
  workspaceId: "w1",
  userId: "u1",
  userName: "سامر",
  taskId: "t1",
  taskTitle: "مراجعة العرض",
  startedAt: "2031-03-10T06:00:00.000Z",
  stoppedAt: "2031-03-10T07:30:00.000Z",
  seconds: 5400,
  note: "",
  source: "TIMER",
  autoStopped: false,
  running: false,
  day: "2031-03-10",
  canEdit: true,
  ...over,
});

const card = (over: Partial<CardData> = {}): CardData => ({
  entries: [entry()],
  totalSeconds: 5400,
  running: null,
  serverNow: "2031-03-10T10:00:00.000Z",
  timeZone: "Asia/Damascus",
  canTrack: true,
  manager: false,
  ...over,
});

describe("«الوقت»: the clock", () => {
  it("is drawn from the server's startedAt and serverNow, never from the browser's date", () => {
    const run = entry({ running: true, stoppedAt: null, seconds: 0, startedAt: "2031-03-10T08:00:00.000Z" });
    const markup = render(createElement(RunningClock, { entry: run, serverNow: "2031-03-10T08:10:30.000Z", receivedAt: 0, nowMs: 0 }));
    expect(textOf(markup)).toBe("10:30");
    expect(markup).toContain("data-running-clock");
    expect(markup).toContain('role="timer"');
    expect(markup).toContain('dir="ltr"');
    // the browser's own seconds since it received the answer are the only thing added
    const later = render(createElement(RunningClock, { entry: run, serverNow: "2031-03-10T08:10:30.000Z", receivedAt: 1_000_000, nowMs: 1_000_000 + 61_000 }));
    expect(textOf(later)).toBe("11:31");
    // an hour or more switches to h:mm:ss
    const long = render(createElement(RunningClock, { entry: run, serverNow: "2031-03-10T09:05:07.000Z", receivedAt: 0, nowMs: 0 }));
    expect(textOf(long)).toBe("1:05:07");
  });
});

describe("«الوقت»: the card on the task page", () => {
  it("offers «ابدأ», the total as hh:mm and decimal, the entries, the manual form button and the warning with its fix", () => {
    const markup = render(createElement(TaskTimeCard, { taskId: "t1", initial: card(), viewerId: "u1" }));
    const text = textOf(markup);
    expect(text).toContain("الوقت");
    expect(text).toContain("ابدأ");
    expect(text).not.toContain("وقّف");
    expect(text).toContain("المجموع: 01:30 · 1.50");
    expect(markup).toContain("data-time-total");
    expect(markup).toContain('data-time-entry="e1"');
    expect(text).toContain("01:30 · 1.50");
    expect(text).toContain("إضافة وقت يدوي");
    expect(markup).toContain('href="/time?taskId=t1"');
    // an automatic thing is shown as ⚠️ with the fix under it as 🔧, together
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(text).toContain(AR["tt.warn"]!);
    expect(text).toContain(AR["tt.fix"]!);
    expect(markup).toContain('aria-label="عدّل سجلّ الوقت: 10 آذار"');
    expect(markup).toContain('aria-label="احذف سجلّ الوقت: 10 آذار"');
    expectClean(markup);
    expectArabicOnly(markup);
  });

  it("shows the live clock and «وقّف» while this task's timer runs, and no «ابدأ»", () => {
    const run = entry({ id: "r1", running: true, stoppedAt: null, seconds: 0, startedAt: "2031-03-10T09:50:00.000Z" });
    const markup = render(createElement(TaskTimeCard, { taskId: "t1", initial: card({ running: run, entries: [run], totalSeconds: 0 }), viewerId: "u1" }));
    const text = textOf(markup);
    expect(text).toContain("10:00");
    expect(text).toContain("وقّف");
    expect(text).not.toContain("ابدأ");
    expect(text).toContain("شغّال الآن");
    expect(markup).toContain("data-running-clock");
    expectClean(markup);
  });

  it("says where the person's timer is when it runs on ANOTHER task, and still offers «ابدأ» here", () => {
    const run = entry({ id: "r1", taskId: "t2", taskTitle: "مهمة تانية", running: true, stoppedAt: null, seconds: 0 });
    const markup = render(createElement(TaskTimeCard, { taskId: "t1", initial: card({ running: run }), viewerId: "u1" }));
    const text = textOf(markup);
    expect(text).toContain("ابدأ");
    expect(text).toContain("مؤقّتك شغّال على «مهمة تانية»");
    expect(markup).not.toContain("data-running-clock");
  });

  it("marks an automatically stopped entry with the warning and its fix", () => {
    const auto = entry({ autoStopped: true, seconds: 43200 });
    const markup = render(createElement(EntryLine, { entry: auto, viewerId: "u1", showPerson: false }));
    expect(markup).toContain("data-auto-stopped");
    const text = textOf(markup);
    expect(text).toContain("أُوقف تلقائيًا بعد 12 ساعة");
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(text).toContain("12:00 · 12.00");
    expectArabicOnly(markup);
  });

  it("draws no edit or delete button on an entry the viewer may not change, and names the person for a manager", () => {
    const theirs = entry({ id: "e2", userId: "u2", userName: "ليلى", canEdit: false });
    const markup = render(createElement(TaskTimeCard, { taskId: "t1", initial: card({ entries: [theirs], manager: true }), viewerId: "u1" }));
    expect(markup).not.toContain("عدّل سجلّ الوقت");
    expect(markup).not.toContain("احذف سجلّ الوقت");
    expect(textOf(markup)).toContain("بواسطة ليلى");
    // the person's own entry names nobody
    const mine = render(createElement(EntryLine, { entry: entry(), viewerId: "u1", showPerson: true }));
    expect(textOf(mine)).not.toContain("بواسطة");
  });

  it("the owner reading a space he is not in sees the entries and a note, and no start button", () => {
    const markup = render(createElement(TaskTimeCard, { taskId: "t1", initial: card({ canTrack: false, manager: true }), viewerId: "owner" }));
    const text = textOf(markup);
    expect(text).not.toContain("ابدأ");
    expect(text).not.toContain("إضافة وقت يدوي");
    expect(text).toContain(AR["tt.oversight"]!);
    expect(markup).toContain('data-time-entry="e1"');
  });

  it("says so when nothing is logged yet", () => {
    const markup = render(createElement(TaskTimeCard, { taskId: "t1", initial: card({ entries: [], totalSeconds: 0 }), viewerId: "u1" }));
    expect(textOf(markup)).toContain(AR["tt.empty"]!);
    expect(textOf(markup)).toContain("المجموع: 00:00 · 0.00");
  });
});

describe("«وقتي اليوم»: the line on the Today page", () => {
  const data = (over: Partial<MyTimeToday> = {}): MyTimeToday => ({ running: null, todaySeconds: 5400, serverNow: "2031-03-10T10:00:00.000Z", timeZone: "Asia/Damascus", ...over });

  it("shows today's finished time as hh:mm and decimal, and says no timer was started", () => {
    const markup = render(createElement(TimeTodayLine, { data: data(), receivedAt: 0, nowMs: 0, onStop: () => {} }));
    expect(markup).toContain("data-time-today");
    expect(textOf(markup)).toContain("01:30");
    expect(textOf(markup)).toContain("1.50");
    expect(textOf(markup)).toContain(AR["tt.today.none"]!);
    expect(markup).not.toContain("data-time-running");
    expectClean(markup);
  });

  it("adds the running timer, drawn from the server's start, to today's total, with a link to the task and «وقّف»", () => {
    const run = entry({ running: true, stoppedAt: null, seconds: 0, startedAt: "2031-03-10T09:30:00.000Z" });
    const markup = render(createElement(TimeTodayLine, { data: data({ running: run, todaySeconds: 3600 }), receivedAt: 0, nowMs: 0, onStop: () => {} }));
    const text = textOf(markup);
    // 30 minutes running (server clock 10:00 - start 09:30) + 1 hour finished = 01:30
    expect(text).toContain("30:00");
    expect(text).toContain("01:30");
    expect(text).toContain("وقّف");
    expect(markup).toContain('href="/tasks/t1"');
    expect(markup).toContain("data-time-running");
    expectClean(markup);
    expectArabicOnly(markup);
  });
});

describe("«الوقت شغّال» on a row or a card", () => {
  it("draws the chip only while the person's own timer runs on the task", () => {
    const on = render(createElement(RunningChip, { running: true }));
    expect(on).toContain("data-time-running-chip");
    expect(textOf(on)).toBe("الوقت شغّال");
    expectClean(on);
    expect(render(createElement(RunningChip, { running: false }))).toBe("");
    expect(render(createElement(RunningChip, { running: undefined }))).toBe("");
  });

  it("the board card and the list row both draw it, and the pages hand it over from the person's own timer", () => {
    expect(read("src/components/board-view.tsx")).toContain("<RunningChip running={task.running} />");
    expect(read("src/components/task-row.tsx")).toContain("<RunningChip running={task.running} />");
    for (const page of ["src/app/(app)/boards/[id]/page.tsx", "src/app/(app)/list/page.tsx", "src/app/(app)/my-work/legacy-page.tsx", "src/server/services/my-work.ts"]) {
      expect(read(page), page).toContain("myRunningTaskId(actor)");
    }
  });
});

const report = (over: Partial<TimeReport> = {}): TimeReport => ({
  from: "2031-03-09",
  to: "2031-03-15",
  timeZone: "Asia/Damascus",
  totalSeconds: 6600,
  rows: [
    { id: "e1", day: "2031-03-10", userId: "u1", userName: "سامر", workspaceId: "w1", projectId: "p1", projectName: "مشروع أ", taskId: "t1", taskKey: "ZW-1", taskTitle: "مراجعة العرض", seconds: 5400, note: "اجتماع", source: "TIMER", autoStopped: false },
    { id: "e2", day: "2031-03-11", userId: "u2", userName: "ليلى", workspaceId: "w1", projectId: null, projectName: null, taskId: null, taskKey: null, taskTitle: "مهمة انحذفت", seconds: 1200, note: "", source: "MANUAL", autoStopped: true },
  ],
  byPerson: [
    { key: "u1", label: "سامر", seconds: 5400 },
    { key: "u2", label: "ليلى", seconds: 1200 },
  ],
  byProject: [
    { key: "p1", label: "مشروع أ", seconds: 5400 },
    { key: "none", label: "", seconds: 1200 },
  ],
  byDay: [
    { key: "2031-03-10", label: "2031-03-10", seconds: 5400 },
    { key: "2031-03-11", label: "2031-03-11", seconds: 1200 },
  ],
  people: [
    { id: "u1", name: "سامر" },
    { id: "u2", name: "ليلى" },
  ],
  canPickPerson: true,
  spaces: [
    { id: "w1", name: "الأولى" },
    { id: "w2", name: "الثانية" },
  ],
  projects: [{ id: "p1", name: "مشروع أ" }],
  filters: { userId: null, projectId: null, taskId: null, workspaceId: "w1" },
  ...over,
});

const view = (over: Partial<TimeReport> = {}) =>
  createElement(TimeReportView, {
    report: report(over),
    csvHref: "/api/time/report?from=2031-03-09&to=2031-03-15&format=csv",
    presets: { week: { from: "2031-03-09", to: "2031-03-15" }, month: { from: "2031-03-01", to: "2031-03-31" } },
    spaceValue: "w1",
  });

describe("«تقرير الوقت»: the page", () => {
  it("shows the total, the groups and every entry as hh:mm AND decimal, from the integer seconds", () => {
    const markup = render(view());
    const text = textOf(markup);
    expect(text).toContain("تقرير الوقت");
    expect(markup).toContain("data-report-total");
    expect(text).toContain("01:50 1.83"); // 6600 s
    for (const [hm, dec] of [["01:30", "1.50"], ["00:20", "0.33"]] as const) {
      expect(text).toContain(hm);
      expect(text).toContain(dec);
    }
    expect(text).toContain("حسب الشخص");
    expect(text).toContain("حسب المشروع");
    expect(text).toContain("حسب اليوم");
    expect(text).toContain("بدون مشروع");
    expect(markup).toContain('data-group="u1"');
    expect(markup).toContain('data-entry="e1"');
    expect(markup).toContain('href="/tasks/t1"');
    expect(text).toContain("مراجعة العرض");
    expect(text).toContain("يدوي");
    expect(text).toContain("أُوقف تلقائيًا بعد 12 ساعة");
    expect(markup).toContain("⚠️");
    expect(markup).toContain("🔧");
    expectClean(markup);
    expectArabicOnly(markup);
  });

  it("has the filters as a plain GET form: dates, the person (only for a manager), the project and the space, with the presets and the CSV link", () => {
    const markup = render(view());
    expect(markup).toContain('method="get"');
    expect(markup).toContain('action="/time"');
    expect(markup).toContain('name="from"');
    expect(markup).toContain('name="to"');
    expect(markup).toContain('name="userId"');
    expect(markup).toContain('name="projectId"');
    expect(markup).toContain('name="workspaceId"');
    expect(markup).toContain("هذا الأسبوع");
    expect(markup).toContain("هذا الشهر");
    expect(markup).toContain("from=2031-03-01");
    expect(markup).toContain('href="/api/time/report?from=2031-03-09&amp;to=2031-03-15&amp;format=csv"');
    expect(textOf(markup)).toContain("نزّل ملف إكسل");

    const member = render(view({ canPickPerson: false, spaces: [{ id: "w1", name: "الأولى" }], people: [{ id: "u1", name: "سامر" }] }));
    expect(member).not.toContain('name="userId"');
    expect(textOf(member)).toContain("أنا فقط");
    // one space: no space picker, the value travels in a hidden field
    expect(member).toContain('type="hidden" name="workspaceId" value="w1"');
  });

  it("says so for an empty range, and shows the task filter with its way out", () => {
    const empty = render(view({ rows: [], totalSeconds: 0, byPerson: [], byProject: [], byDay: [], filters: { userId: null, projectId: null, taskId: "t1", workspaceId: "w1" } }));
    const text = textOf(empty);
    expect(text).toContain(AR["tt.report.empty"]!);
    expect(text).toContain("00:00 0.00");
    expect(text).toContain("مهمة محدّدة");
    expect(text).toContain("إزالة فلتر المهمة");
    expect(empty).toContain('name="taskId"');
    expect(empty).not.toContain("data-group");
    expectClean(empty);
  });
});

describe("«حساب وقت الشغل»: wiring", () => {
  it("turns a refusal or a validation failure into its Arabic string, and anything unknown into the general error", () => {
    expect(errorKeyOf({ message: "tt.e.window_closed" })).toBe("tt.e.window_closed");
    expect(errorKeyOf({ message: "validation.failed", details: [{ path: "hours", message: "tt.e.day_full" }] })).toBe("tt.e.day_full");
    expect(errorKeyOf({ message: "something.else" })).toBe("tt.failed");
    expect(errorKeyOf(null)).toBe("tt.failed");
  });

  it("every error key the server throws has an Arabic string", () => {
    const source = [read("src/server/services/time-tracking.ts"), read("src/lib/time-tracking.ts")].join("\n");
    const keys = new Set([...source.matchAll(/"(tt\.e\.[a-z_]+)"/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });

  it("the task page and the Today page mount their piece only while the switch is on and the person is not a partner", () => {
    const task = read("src/app/(app)/tasks/[id]/page.tsx");
    expect(task).toMatch(/actorFeatureOn\(actor, "timeTracking"\)\)\s*&&\s*!actor\.isExternal/);
    expect(task).toContain("time={timeCard}");
    const today = read("src/app/(app)/page.tsx");
    expect(today).toMatch(/!actor\.isExternal && \(await actorFeatureOn\(actor, "timeTracking"\)\)/);
    expect(today).toContain("{timeOn ? <MyTimeToday /> : null}");
    expect(read("src/components/task-detail.tsx")).toContain("{time ? <TaskTimeCard");
  });

  it("the report page belongs to «الشغل» without being one of its tabs (the menu and its order are untouched)", () => {
    const work = PLACES.find((p) => p.key === "work")!;
    expect(work.owns).toContain("/time");
    expect(work.tabs.map((t) => t.href)).not.toContain("/time");
    const page = read("src/app/(app)/time/page.tsx");
    expect(page).toContain("<GuestNotice />");
    expect(page).toMatch(/actorFeatureOn\(actor, "timeTracking"\)\)\) notFound\(\)/);
  });

  it("the runner step closes at startedAt + 12h in one claiming UPDATE and the audit row is written in the same transaction", () => {
    const src = read("src/server/jobs/time-entries.ts");
    expect(src).toContain('"stoppedAt" = "startedAt" + interval \'12 hours\'');
    expect(src).toContain('"stoppedAt" IS NULL AND "startedAt" <');
    expect(src).toContain("RETURNING");
    expect(src).toMatch(/\{features,timeTracking\}/);
    const claim = src.indexOf('UPDATE "TimeEntry"');
    const audit = src.indexOf("tx.auditLog.create");
    const end = src.indexOf("return true");
    expect(claim).toBeGreaterThan(0);
    expect(audit).toBeGreaterThan(claim);
    expect(audit).toBeLessThan(end);
    expect(read("src/server/jobs/run.ts")).toContain("autoStopTimers(now)");
  });

  it("the migration is additive, hand-writes the partial unique index, and the entry keeps its task title when the task goes", () => {
    const sql = read("prisma/migrations/20261031140000_time_entries/migration.sql");
    expect(sql).toContain('CREATE UNIQUE INDEX "TimeEntry_one_running_per_user" ON "TimeEntry"("userId") WHERE "stoppedAt" IS NULL');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain('"seconds" INTEGER NOT NULL');
    expect(sql).not.toMatch(/DROP |TRUNCATE|DELETE FROM|ALTER COLUMN/i);
  });

  it("holds no money: no rate, no cost, no price anywhere in the feature", () => {
    const files = ["src/server/services/time-tracking.ts", "src/lib/time-tracking.ts", "src/lib/time-report-csv.ts", "src/components/time/time-report.tsx", "src/components/time/task-time-card.tsx"];
    for (const f of files) expect(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), f).not.toMatch(/\b(rate|cost|price|salary|wage|amount|money|hourlyRate)\b/i);
    expect(read("prisma/schema.prisma").match(/model TimeEntry \{[\s\S]*?\n\}/)![0]).not.toMatch(/Decimal|Float|price|cost|rate/i);
  });
});
