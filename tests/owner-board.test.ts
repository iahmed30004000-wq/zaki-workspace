import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
// the components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React
(globalThis as { React?: typeof React }).React = React;

import { AR } from "@/lib/i18n/dict";
import { getServerT } from "@/lib/i18n/server";
import { FEATURES, FEATURE_DEFAULTS, featureOn, featuresOff } from "@/lib/features";
import { buildNav, canOpenTab, locate, offeredToGuests } from "@/lib/nav/places";
import {
  MAX_WINDOW_DAYS,
  WindowError,
  addDays,
  buildCsv,
  csvCell,
  dayKeyOf,
  daysBetween,
  formatDays,
  formatRate,
  onTimeRate,
  parseDayKey,
  resolveWindow,
  timeOfDay,
} from "@/lib/owner-board";
import { CAPABILITIES, OWNER_ONLY, RANK_DEFAULTS, WIRED_CAPABILITIES, can, effectiveCapabilities, grantProblem } from "@/server/policy/capabilities";
import { CAPABILITY_GROUPS } from "@/lib/members-ui";
import { loadSections, type BoardSection } from "@/server/services/owner-board-sections";
import { parseBoardQuery } from "@/server/services/owner-board-io";
import { sortPeople, type Cards, type Overview, type PersonRow, type PersonView } from "@/server/services/owner-board";
import { BoardCards, DefinitionNote, PeopleTable, PersonPage, TodayStrip } from "@/components/owner-board/board";
import { Sparkline } from "@/components/owner-board/sparkline";

const { t } = getServerT();
const ROOT = path.resolve(__dirname, "..");
const DAMASCUS = "Asia/Damascus";
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

// ───────────────────────────────────────── pure: days ─────────────────────────────────────────

describe("the company's day (never UTC's)", () => {
  it("23:30 in Damascus is that day, 00:30 is the next one, whatever UTC says", () => {
    expect(dayKeyOf(new Date("2026-10-29T20:30:00Z"), DAMASCUS)).toBe("2026-10-29"); // 23:30
    expect(dayKeyOf(new Date("2026-10-29T20:59:59Z"), DAMASCUS)).toBe("2026-10-29"); // 23:59:59
    expect(dayKeyOf(new Date("2026-10-29T21:00:00Z"), DAMASCUS)).toBe("2026-10-30"); // midnight
    expect(dayKeyOf(new Date("2026-10-29T21:30:00Z"), DAMASCUS)).toBe("2026-10-30"); // 00:30, still the 29th in UTC
    expect(dayKeyOf(new Date("2026-10-29T21:30:00Z"), "UTC")).toBe("2026-10-29");
    expect(dayKeyOf(new Date("2026-10-29T03:00:00Z"), "America/Los_Angeles")).toBe("2026-10-28");
  });

  it("is the same in every machine zone (the pure helper reads the company's zone, not the process's)", () => {
    // vitest.config.ts pins the process to UTC, the clock work ran the suite under Amman and Los Angeles: the answer is the zone's
    expect(dayKeyOf(new Date("2026-10-29T21:30:00Z"), DAMASCUS)).toBe("2026-10-30");
  });

  it("day keys: real days only, calendar arithmetic across month and year ends", () => {
    expect(parseDayKey("2026-10-30")).toEqual({ year: 2026, month: 10, day: 30 });
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-30", "2026-1-3", "", null, undefined, 20261030, "2026-10-30T00:00"]) expect(parseDayKey(bad), String(bad)).toBeNull();
    expect(addDays("2026-10-30", 1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-28", "2026-10-30")).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(daysBetween("2026-10-30", "2026-10-28")).toEqual([]);
  });

  it("the clock of a day: «23:05» in the company's wall time, «—» for nothing", () => {
    expect(timeOfDay(new Date("2026-10-29T20:05:00Z"), DAMASCUS)).toBe("23:05");
    expect(timeOfDay(new Date("2026-10-29T21:00:00Z"), DAMASCUS)).toBe("00:00");
    expect(timeOfDay(null, DAMASCUS)).toBe("—");
  });
});

describe("the window", () => {
  const now = new Date("2026-10-30T09:00:00Z");

  it("defaults to the last 14 days ending today; presets are today, 7, 14 and 30 days", () => {
    const w = resolveWindow({}, now, DAMASCUS);
    expect(w.days).toHaveLength(14);
    expect([w.from, w.to, w.today, w.preset]).toEqual(["2026-10-17", "2026-10-30", "2026-10-30", "14"]);
    expect(resolveWindow({ preset: "today" }, now, DAMASCUS).days).toEqual(["2026-10-30"]);
    expect(resolveWindow({ preset: "7" }, now, DAMASCUS).days).toHaveLength(7);
    expect(resolveWindow({ preset: "30" }, now, DAMASCUS).days).toHaveLength(30);
    expect(resolveWindow({ preset: "9999" }, now, DAMASCUS).days).toHaveLength(14); // an unknown preset is the default
  });

  it("starts at the company's midnight and ends at the next one, exclusive", () => {
    const w = resolveWindow({ from: "2026-10-28", to: "2026-10-29" }, now, DAMASCUS);
    expect(w.start.toISOString()).toBe("2026-10-27T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-29T21:00:00.000Z");
    expect(w.preset).toBe("custom");
  });

  it("a custom range is at most 92 days; 93 is refused; a backwards or impossible one is refused; one ending after today is cut at today", () => {
    expect(MAX_WINDOW_DAYS).toBe(92);
    expect(resolveWindow({ from: "2026-07-31", to: "2026-10-30" }, now, DAMASCUS).days).toHaveLength(92);
    expect(() => resolveWindow({ from: "2026-07-30", to: "2026-10-30" }, now, DAMASCUS)).toThrowError(WindowError);
    try {
      resolveWindow({ from: "2026-07-30", to: "2026-10-30" }, now, DAMASCUS);
    } catch (e) {
      expect((e as WindowError).key).toBe("ownerboard.range_too_long");
    }
    for (const bad of [{ from: "2026-10-30", to: "2026-10-01" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-10-01" }, { to: "2026-10-01" }, { from: "x", to: "y" }, { from: "2026-11-05", to: "2026-11-09" }]) {
      expect(() => resolveWindow(bad, now, DAMASCUS), JSON.stringify(bad)).toThrowError(WindowError);
    }
    expect(resolveWindow({ from: "2026-10-28", to: "2026-12-31" }, now, DAMASCUS).to).toBe("2026-10-30");
  });
});

// ───────────────────────────────────────── pure: arithmetic ─────────────────────────────────────────

describe("the arithmetic", () => {
  it("the on-time rate: finished on time ÷ finished with a due day; nothing to divide is «—», never 0%", () => {
    expect(onTimeRate(1, 2)).toBe(50);
    expect(onTimeRate(2, 3)).toBe(67);
    expect(onTimeRate(0, 4)).toBe(0); // a real zero: four finished with a due day, none on time
    expect(onTimeRate(4, 4)).toBe(100);
    expect(onTimeRate(0, 0)).toBeNull();
    expect(onTimeRate(3, 0)).toBeNull();
    expect(onTimeRate(Number.NaN, 3)).toBeNull();
    expect(formatRate(onTimeRate(0, 0))).toBe("—");
    expect(formatRate(onTimeRate(0, 4))).toBe("0%");
    expect(formatRate(50)).toBe("50%");
  });

  it("days with one decimal, «—» for nothing", () => {
    expect(formatDays(2)).toBe("2");
    expect(formatDays(2.46)).toBe("2.5");
    expect(formatDays(0)).toBe("0");
    expect(formatDays(null)).toBe("—");
    expect(formatDays(Number.NaN)).toBe("—");
  });

  it("a CSV cell that starts with = + - @ (or a tab or CR) gets a leading apostrophe; quotes and commas are quoted; numbers are as they are", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) expect(csvCell(`${lead}1+1`), JSON.stringify(lead)).toMatch(/^"?'/);
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("سطر\nثان")).toBe('"سطر\nثان"');
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(csvCell("يوسف")).toBe("يوسف");
  });

  it("the CSV file starts with a BOM and uses CRLF", () => {
    const text = buildCsv([["الاسم", "رقم"], ["=x", 3]]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toBe("﻿الاسم,رقم\r\n'=x,3\r\n");
  });

  it("the query string is parsed once: unknown keys and over-long values are dropped", () => {
    expect(parseBoardQuery(new URLSearchParams("range=7&space=s1&person=u1&sort=name&dir=asc&x=1"))).toEqual({ preset: "7", from: null, to: null, space: "s1", person: "u1", sort: "name", dir: "asc" });
    expect(parseBoardQuery({ range: ["30", "7"], from: "2026-10-01", to: undefined })).toMatchObject({ preset: "30", from: "2026-10-01", to: null });
    expect(parseBoardQuery(new URLSearchParams(`space=${"x".repeat(200)}`)).space).toBeNull();
  });
});

// ───────────────────────────────────────── the extension point ─────────────────────────────────────────

describe("sections (the extension point)", () => {
  const win = resolveWindow({}, new Date("2026-10-30T09:00:00Z"), DAMASCUS);
  const ctx = { orgId: "o", timeZone: DAMASCUS, window: win, scope: { restricted: false, workspaceIds: [], teamIds: [] }, userIds: ["u1", "u2"] };
  const col = (key: string) => ({ key, labelKey: "ownerboard.col.steps", formulaKey: "ownerboard.col.steps.formula", kind: "count" as const });

  it("the registry is empty today, and an empty registry returns nothing and breaks nothing", async () => {
    expect(await loadSections(ctx)).toEqual({ columns: [], values: new Map() });
    expect(await loadSections(ctx, [])).toEqual({ columns: [], values: new Map() });
  });

  it("merges the columns and values of every section; a failing section is skipped; a clashing column key cannot overwrite an earlier one", async () => {
    const one: BoardSection = { id: "one", columns: [col("one.a")], load: async () => new Map([["u1", { "one.a": 5 }]]) };
    const bad: BoardSection = { id: "bad", columns: [col("bad.a")], load: async () => Promise.reject(new Error("table missing")) };
    const clash: BoardSection = { id: "clash", columns: [col("one.a"), col("clash.b")], load: async () => new Map([["u1", { "one.a": 999, "clash.b": 7 }]]) };
    const out = await loadSections(ctx, [one, bad, clash]);
    expect(out.columns.map((c) => c.key)).toEqual(["one.a", "clash.b"]);
    expect(out.values.get("u1")).toEqual({ "one.a": 5, "clash.b": 7 });
    expect(out.values.get("u2")).toBeUndefined();
  });

  it("every section column names a label and a formula that exist in the dictionary (checked on the fake used by the db test)", () => {
    for (const k of ["ownerboard.col.steps", "ownerboard.col.steps.formula"]) expect(AR[k], k).toBeTruthy();
  });
});

// ───────────────────────────────────────── sorting ─────────────────────────────────────────

function person(over: Partial<PersonRow> = {}): PersonRow {
  return {
    userId: "u1",
    name: "سامر",
    jobTitle: null,
    role: "MEMBER",
    status: "ACTIVE",
    online: false,
    completed: 0,
    openTasks: 0,
    overdue: 0,
    withDue: 0,
    onTime: 0,
    late: 0,
    onTimeRate: null,
    avgDays: null,
    steps: 0,
    messages: 0,
    lastActivity: null,
    spark: [0, 0, 0],
    ...over,
  };
}

describe("sortPeople", () => {
  const rows = [person({ userId: "a", name: "باسل", completed: 1, onTimeRate: 100, lastActivity: "2026-10-29T08:00:00.000Z" }), person({ userId: "b", name: "أحمد", completed: 3, onTimeRate: null }), person({ userId: "c", name: "جمال", completed: 3, onTimeRate: 0, lastActivity: "2026-10-30T08:00:00.000Z" })];
  it("by number, ties by name, both directions", () => {
    expect(sortPeople(rows, "completed", "desc").map((r) => r.userId)).toEqual(["b", "c", "a"]);
    expect(sortPeople(rows, "completed", "asc").map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });
  it("the on-time rate puts «—» below a real 0%", () => {
    expect(sortPeople(rows, "onTime", "desc").map((r) => r.userId)).toEqual(["a", "c", "b"]);
  });
  it("by name and by last activity (a person with none last)", () => {
    expect(sortPeople(rows, "name", "asc").map((r) => r.userId)).toEqual(["b", "a", "c"]);
    expect(sortPeople(rows, "lastActivity", "desc").map((r) => r.userId)).toEqual(["c", "a", "b"]);
  });
});

// ───────────────────────────────────────── render ─────────────────────────────────────────

describe("the sparkline", () => {
  it("draws one bar per day with the theme accent, a thin flat bar for a zero, and says the total for a screen reader", () => {
    const out = html(createElement(Sparkline, { values: [0, 2, 4], label: "6 مهمة" }));
    expect(out.match(/<rect /g)).toHaveLength(3);
    expect(out).toContain("text-accent");
    expect(out).toContain('fill="currentColor"');
    expect(out).toContain('aria-label="6 مهمة"');
    expect(out).toContain('role="img"');
    // the tallest bar is full height, the zero is one unit high and dimmed, never missing
    const bars = [...out.matchAll(/<rect [^>]*height="([\d.]+)"[^>]*data-v="(\d+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
    expect(bars).toEqual([[0, 1], [2, 10], [4, 20]]);
    expect(out).toContain('opacity="0.3"');
  });

  it("no colour is a hex value or a default palette colour", () => {
    const out = html(createElement(Sparkline, { values: [1, 2], label: "x", large: true }));
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(out).not.toMatch(/(red|blue|green|gray|slate)-\d{3}/);
  });

  it("an empty list still draws a valid svg", () => {
    expect(html(createElement(Sparkline, { values: [], label: "x" }))).toContain("<svg");
  });
});

describe("the cards", () => {
  const cards: Cards = { completed: 12, open: 30, overdue: 4, late: 2, avgDays: 2.46, messages: 321, activePeople: 5, idlePeople: 0 };

  it("every card carries its number AND its formula line; a zero is shown as zero", () => {
    const out = html(createElement(BoardCards, { t, cards, title: "ملخص" }));
    for (const key of ["completed", "open", "overdue", "late", "avgDays", "messages", "active", "idle"]) {
      expect(out, key).toContain(`data-card="${key}"`);
      expect(out, key).toContain(t(`ownerboard.card.${key}.formula`));
      expect(AR[`ownerboard.card.${key}`], key).toBeTruthy();
    }
    const value = (key: string) => new RegExp(`data-card="${key}"[\\s\\S]*?data-value="([^"]*)"`).exec(out)?.[1];
    expect(value("completed")).toBe("12");
    expect(value("avgDays")).toBe("2.5");
    expect(value("idle")).toBe("0");
  });

  it("an average with nothing to average is «—», not 0", () => {
    const out = html(createElement(BoardCards, { t, cards: { ...cards, avgDays: null }, title: "ملخص" }));
    expect(/data-card="avgDays"[\s\S]*?data-value="([^"]*)"/.exec(out)?.[1]).toBe("—");
  });
});

function overview(over: Partial<Overview> = {}): Overview {
  const days = ["2026-10-28", "2026-10-29", "2026-10-30"];
  return {
    mode: "owner",
    window: { from: days[0]!, to: days[2]!, days, today: days[2]!, preset: "custom", timeZone: DAMASCUS },
    filters: { space: null, person: null, sort: "completed", dir: "desc" },
    spaces: [],
    cards: null,
    people: [person({ userId: "u1", name: "سامر", completed: 3, spark: [1, 2, 0], onTimeRate: null, lastActivity: "2026-10-29T20:05:00.000Z" }), person({ userId: "u2", name: "ليلى", status: "SUSPENDED", completed: 1, onTimeRate: 100, spark: [0, 0, 1] })],
    today: { done: [{ userId: "u1", name: "سامر", tasks: 1, steps: 2, messages: 3, first: "2026-10-29T21:10:00.000Z", last: "2026-10-30T05:00:00.000Z" }], idle: [{ userId: "u2", name: "ليلى" }] },
    sections: [],
    sectionValues: {},
    ...over,
  };
}

describe("the people table", () => {
  const draw = (o: Overview) => html(createElement(PeopleTable, { t, o, personHref: (id) => `/owner/people/${id}`, sortHref: (k, d) => `/owner?sort=${k}&dir=${d}` }));

  it("one row per person with a link to the person page, the sparkline, «—» for a rate with nothing to divide, and the inactive person marked", () => {
    const out = draw(overview());
    expect(out).toContain('href="/owner/people/u1"');
    expect(out).toContain('data-person="u1"');
    expect(out.match(/data-sparkline="3"/g)).toHaveLength(2);
    const u1 = /data-person="u1"[\s\S]*?<\/tr>/.exec(out)![0];
    expect(u1).toContain("—"); // the on-time rate of somebody who finished nothing with a due day
    const u2 = /data-person="u2"[\s\S]*?<\/tr>/.exec(out)![0];
    expect(u2).toContain(t("ownerboard.status.inactive"));
    expect(u2).toContain("100%");
    expect(u1).not.toContain(t("ownerboard.status.inactive"));
  });

  it("every sortable column header is a link, the sorted one says so, and every column's formula is in the legend", () => {
    const out = draw(overview());
    for (const key of ["name", "completed", "openTasks", "overdue", "onTime", "steps", "messages", "lastActivity"]) expect(out, key).toContain(`href="/owner?sort=${key}`);
    expect(out).toContain('aria-sort="descending"');
    const legend = /data-testid="ob-legend"[\s\S]*$/.exec(out)![0];
    for (const key of ["completed", "open", "overdue", "onTime", "steps", "messages", "lastActivity", "spark"]) expect(legend, key).toContain(t(`ownerboard.col.${key}.formula`));
  });

  it("an empty table says so; a section's columns and values are drawn with their formula, empty values as «—»", () => {
    expect(draw(overview({ people: [] }))).toContain(t("ownerboard.people.empty"));
    const o = overview({ sections: [{ key: "fake.minutes", labelKey: "ownerboard.col.steps", formulaKey: "ownerboard.col.messages.formula", kind: "count" }], sectionValues: { u1: { "fake.minutes": 90 } } });
    const out = draw(o);
    expect(/data-person="u1"[\s\S]*?<\/tr>/.exec(out)![0]).toContain("90");
    expect(/data-person="u2"[\s\S]*?<\/tr>/.exec(out)![0]).toMatch(/—<\/td><\/tr>$/);
    expect(out).toContain(t("ownerboard.col.messages.formula"));
  });

  it("no ranking words, no judgement: nothing like «الأسوأ» or «الأفضل» in the board's own strings", () => {
    for (const [key, text] of Object.entries(AR)) {
      if (!key.startsWith("ownerboard.")) continue;
      for (const word of ["الأسوأ", "الأفضل", "كسول", "مقصّر", "مقصر", "تحذير", "فاشل", "ممتاز"]) expect(text, `${key}: ${word}`).not.toContain(word);
    }
  });
});

describe("«اليوم» and the definition", () => {
  it("lists who did what today with the clock of the company, and who has done nothing yet, with the meaning of the zero", () => {
    const o = overview();
    const out = html(createElement(TodayStrip, { t, today: o.today!, timeZone: DAMASCUS, personHref: (id) => `/owner/people/${id}` }));
    expect(out).toContain('data-today-done="u1"');
    expect(out).toContain('data-today-idle="u2"');
    expect(out).toContain("08:00"); // 05:00Z
    expect(out).toContain(t("ownerboard.today.line", { tasks: 1, steps: 2, messages: 3 }));
    expect(out).toContain(t("ownerboard.today.formula"));
    expect(out).toContain(t("ownerboard.today.idle_note"));
  });

  it("says «nobody yet» and «everybody did» instead of drawing an empty list", () => {
    const none = html(createElement(TodayStrip, { t, today: { done: [], idle: [{ userId: "u", name: "س" }] }, timeZone: DAMASCUS, personHref: () => "#" }));
    expect(none).toContain(t("ownerboard.today.none_done"));
    const all = html(createElement(TodayStrip, { t, today: { done: [], idle: [] }, timeZone: DAMASCUS, personHref: () => "#" }));
    expect(all).toContain(t("ownerboard.today.none_idle"));
  });

  it("the definition of «إنجاز» is written on the screen, honest about the missing «completed by»", () => {
    const out = html(createElement(DefinitionNote, { t }));
    expect(out).toContain(t("ownerboard.def.body"));
    expect(AR["ownerboard.def.body"]).toContain("ما بيخزّن");
    expect(AR["ownerboard.def.body"]).toContain("المؤرشفة");
    expect(AR["ownerboard.def.body"]).toContain("اتفتحت من جديد");
  });
});

describe("a person's page (and the reduced view of whoever reads only their own)", () => {
  const view = (over: Partial<PersonView> = {}): PersonView => ({
    mode: "self",
    window: overview().window,
    person: person({ userId: "me", name: "رنا", completed: 2, openTasks: 1, overdue: 1, withDue: 0, onTimeRate: null, spark: [1, 0, 1] }),
    days: [
      { day: "2026-10-30", tasks: [], steps: 0, messages: 0, first: null, last: null },
      { day: "2026-10-29", tasks: [{ id: "t1", number: 7, title: "مهمة الإنجاز" }], steps: 2, messages: 4, first: "2026-10-28T21:10:00.000Z", last: "2026-10-29T08:00:00.000Z" },
    ],
    open: [{ id: "t2", number: 8, title: "مهمة متأخرة", dueDate: "2026-10-27T21:00:00.000Z", overdue: true, space: "مساحة أ" }],
    openTotal: 1,
    spaces: [{ id: "s1", name: "مساحة أ" }],
    sections: [],
    sectionValues: {},
    own: true,
    ...over,
  });
  const draw = (v: PersonView) => html(createElement(PersonPage, { t, v, taskHref: (id) => `/tasks/${id}` }));

  it("day by day with titles linking to each task, steps and message counts, first and last of the day; a day with nothing is a row of zeros", () => {
    const out = draw(view());
    expect(out).toContain('href="/tasks/t1"');
    expect(out).toContain("مهمة الإنجاز");
    const d29 = /data-day="2026-10-29"[\s\S]*?<\/tr>/.exec(out)![0];
    expect(d29).toContain(">2<"); // steps
    expect(d29).toContain(">4<"); // messages
    expect(d29).toContain("00:10");
    expect(d29).toContain("11:00");
    const d30 = /data-day="2026-10-30"[\s\S]*?<\/tr>/.exec(out)![0];
    expect(d30).toContain(t("ownerboard.person.no_tasks"));
    expect(d30.match(/>0</g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("every number of the page has its formula; the on-time rate with nothing to divide is «—»; the trend and the open and overdue tasks and spaces are there", () => {
    const out = draw(view());
    for (const key of ["completed", "open", "overdue", "late", "avgDays", "messages"]) expect(out, key).toContain(t(`ownerboard.card.${key}.formula`));
    expect(out).toContain(t("ownerboard.col.onTime.formula"));
    expect(out).toContain(t("ownerboard.col.steps.formula"));
    expect(/data-card="onTime"[\s\S]*?data-value="([^"]*)"/.exec(out)?.[1]).toBe("—");
    expect(out).toContain('data-testid="ob-trend"');
    expect(out).toContain(t("ownerboard.person.trend.formula"));
    expect(out).toContain('data-open="t2"');
    expect(out).toContain(t("ownerboard.person.overdue_tag"));
    expect(out).toContain('data-testid="ob-spaces"');
    expect(out).toContain("مساحة أ");
  });

  it("the reduced view of a person reading their own page has no company totals, no people table, no «اليوم» strip", () => {
    const out = draw(view());
    expect(out).not.toContain('data-testid="ob-cards"');
    expect(out).not.toContain('data-testid="ob-people"');
    expect(out).not.toContain('data-testid="ob-today"');
  });

  it("an empty open list and no spaces say so", () => {
    const out = draw(view({ open: [], openTotal: 0, spaces: [] }));
    expect(out).toContain(t("ownerboard.person.open_none"));
    expect(out).toContain(t("ownerboard.person.spaces_none"));
  });

  it("an inactive person is marked on their page too", () => {
    expect(draw(view({ person: person({ status: "OFFBOARDED" }) }))).toContain(t("ownerboard.status.inactive"));
  });
});

// ───────────────────────────────────────── the map, the capabilities, the switch ─────────────────────────────────────────

describe("the tab, in the menu", () => {
  const who = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST", switches: { capabilities?: string[]; revokedCapabilities?: string[] } = {}) => ({
    role,
    caps: [...effectiveCapabilities({ role, ...switches })],
  });
  const board = (subject: ReturnType<typeof who> & { off?: readonly (typeof FEATURES)[number][] }) => buildNav(subject).places.flatMap((p) => p.tabs).find((tab) => tab.key === "board");

  it("the owner sees «لوحة التحكم» («لوحة المالك» while that switch is off); a person with the team switch «لوحة الفريق»; everybody else «لوحتي»; a guest nothing", () => {
    expect(board(who("OWNER"))).toEqual({ key: "board", href: "/owner", labelKey: "nav.tab.controlPanel" });
    expect(board({ ...who("OWNER"), off: ["controlPanel"] })).toEqual({ key: "board", href: "/owner", labelKey: "nav.tab.board" });
    expect(AR["nav.tab.controlPanel"]).toBe("لوحة التحكم");
    expect(board(who("LEAD", { capabilities: ["board.team"] }))?.labelKey).toBe("nav.tab.boardTeam");
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) expect(board(who(role))?.labelKey, role).toBe("nav.tab.boardSelf");
    expect(board(who("GUEST"))).toBeUndefined();
    expect(board({ role: "GUEST", caps: [...CAPABILITIES] })).toBeUndefined();
    expect(AR["nav.tab.board"]).toBe("لوحة المالك");
    expect(AR["nav.tab.boardTeam"]).toBe("لوحة الفريق");
    expect(AR["nav.tab.boardSelf"]).toBe("لوحتي");
  });

  it("a person with neither switch is not offered it; the switched-off feature removes it for everybody, the owner included", () => {
    expect(board(who("MEMBER", { revokedCapabilities: ["board.self"] }))).toBeUndefined();
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER"] as const) expect(board({ ...who(role), off: ["ownerBoard"] }), role).toBeUndefined();
    expect(canOpenTab({ ...who("OWNER"), off: ["ownerBoard"] }, "board")).toBe(false);
    expect(canOpenTab(who("OWNER"), "board")).toBe(true);
    expect(offeredToGuests("board")).toBe(false);
  });

  it("the address belongs to «الإدارة» and the tab, and so does a person's page under it", () => {
    expect(locate("/owner")).toEqual({ place: "admin", tab: "board" });
    expect(locate("/owner/people/abc")).toEqual({ place: "admin", tab: "board" });
  });

  it("a member's «الإدارة» keeps the menu order: the team, then «لوحتي»; nothing else moves", () => {
    const nav = buildNav(who("MEMBER"));
    expect(nav.places.map((p) => p.key)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(nav.places.find((p) => p.key === "admin")!.tabs.map((tab) => tab.key)).toEqual(["team", "board"]);
  });
});

describe("the capabilities «لوحتي» and «لوحة الفريق»", () => {
  it("«لوحتي» is on by rank for admin, lead and member; «لوحة الفريق» is the owner's alone by default; a guest holds neither", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      expect(RANK_DEFAULTS[role], role).toContain("board.self");
      expect(RANK_DEFAULTS[role], role).not.toContain("board.team");
    }
    expect(RANK_DEFAULTS.OWNER).toEqual(expect.arrayContaining(["board.self", "board.team"]));
    expect(RANK_DEFAULTS.GUEST).toEqual([]);
    expect(can({ role: "GUEST", capabilities: ["board.self", "board.team"] }, "board.self")).toBe(false);
    expect(can({ role: "GUEST", capabilities: ["board.self", "board.team"] }, "board.team")).toBe(false);
  });

  it("the owner switches them per person: granted, revoked, and a revoked rank default really goes", () => {
    expect(can({ role: "LEAD" }, "board.team")).toBe(false);
    expect(can({ role: "LEAD", capabilities: ["board.team"] }, "board.team")).toBe(true);
    expect(can({ role: "LEAD", capabilities: ["board.team"], revokedCapabilities: ["board.team"] }, "board.team")).toBe(false);
    expect(can({ role: "MEMBER", revokedCapabilities: ["board.self"] }, "board.self")).toBe(false);
    expect(can({ role: "MEMBER" }, "board.self")).toBe(true);
  });

  it("neither is owner-only (they can be handed out), both are wired switches of the people screen under one group with Arabic names", () => {
    for (const c of ["board.self", "board.team"] as const) {
      expect(OWNER_ONLY).not.toContain(c);
      expect(grantProblem("MEMBER", c)).toBeNull();
      expect(grantProblem("GUEST", c)).toBe("not_for_guests");
      expect(WIRED_CAPABILITIES).toContain(c);
      expect(AR[`members.cap.${c}.title`], c).toBeTruthy();
      expect(AR[`members.cap.${c}.hint`], c).toBeTruthy();
    }
    const group = CAPABILITY_GROUPS.find((g) => g.id === "board");
    expect(group?.capabilities).toEqual(["board.self", "board.team"]);
    expect(AR["members.group_board"]).toBeTruthy();
  });

  it("an OWNER row holds both whatever is stored; a partner holds both unless the primary owner took one away", () => {
    expect(effectiveCapabilities({ role: "OWNER", revokedCapabilities: ["board.team"] }).has("board.team")).toBe(true);
    expect(effectiveCapabilities({ role: "OWNER", primaryOwner: true }).has("board.self")).toBe(true);
    expect(effectiveCapabilities({ role: "OWNER", primaryOwner: false }).has("board.team")).toBe(true);
  });
});

describe("the feature switch", () => {
  it("«ownerBoard» is a feature, on by default, with its name and hint", () => {
    expect(FEATURES).toContain("ownerBoard");
    expect(FEATURE_DEFAULTS.ownerBoard).toBe(true);
    expect(featureOn({}, "ownerBoard")).toBe(true);
    expect(featureOn({ features: { ownerBoard: false } }, "ownerBoard")).toBe(false);
    expect(featuresOff({ features: { ownerBoard: false } })).toContain("ownerBoard");
    expect(AR["features.ownerBoard.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.ownerBoard.hint"]).toMatch(/[؀-ۿ]/);
  });
});

// ───────────────────────────────────────── the gates in the source ─────────────────────────────────────────

function filesUnder(dir: string, pick: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, pick) : pick(name) ? [full] : [];
  });
}
const read = (file: string) => readFileSync(file, "utf8");
/** The code without its comments (a comment may say «no audit row»; only code can write one). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the gates (pinned in the source where a database test cannot see them)", () => {
  const routes = filesUnder(path.join(ROOT, "src/app/api/owner-board"), (n) => n === "route.ts");
  // «مساعد المالك» lives under /owner/assistant and has its own gate (tests/owner-assistant*.test.ts)
  const pages = filesUnder(path.join(ROOT, "src/app/(app)/owner"), (n) => n === "page.tsx").filter((f) => !/owner[\\/]assistant[\\/]/.test(f));

  it("there are three routes and two pages, and every one decides access through boardAccess and nothing else", () => {
    expect(routes).toHaveLength(3);
    expect(pages).toHaveLength(2);
    for (const file of [...routes, ...pages]) {
      const src = read(file);
      expect(src, file).toMatch(/boardAccess\(/);
      expect(src, file).not.toMatch(/actor\.role\s*[=!]==|orgRole\s*[=!]==|=== "OWNER"|\.isOwner/);
    }
  });

  it("the board only reads: no write, no audit, no notification, no read mark anywhere in its files", () => {
    const files = [...routes, ...pages, ...filesUnder(path.join(ROOT, "src/components/owner-board"), () => true), path.join(ROOT, "src/server/services/owner-board.ts"), path.join(ROOT, "src/server/policy/board.ts"), path.join(ROOT, "src/server/services/owner-board-io.ts"), path.join(ROOT, "src/server/services/owner-board-sections.ts")];
    for (const file of files) {
      const src = code(file);
      expect(src, file).not.toMatch(/(db|tx)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
      expect(src, file).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s/);
      expect(src, file).not.toMatch(/auditLog|notification|lastReadAt|writeAudit|notify/i);
    }
  });

  it("the service never reads a message body", () => {
    const src = read(path.join(ROOT, "src/server/services/owner-board.ts"));
    expect(src).not.toMatch(/m\."body"|\bbody\b\s*:\s*true|select:\s*\{[^}]*\bbody\b/);
    expect(src).not.toMatch(/chatMessage\.find/);
  });

  it("no colour is a hex value or a default palette colour in the board's components", () => {
    for (const file of filesUnder(path.join(ROOT, "src/components/owner-board"), (n) => n.endsWith(".tsx"))) {
      const src = read(file);
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, file).not.toMatch(/\b(text|bg|border)-(red|blue|green|gray|slate|zinc|yellow|orange|amber|emerald|sky)-\d{2,3}\b/);
    }
  });

  it("every dictionary key the board names exists (literals in its components and pages)", () => {
    const files = [...pages, ...filesUnder(path.join(ROOT, "src/components/owner-board"), (n) => n.endsWith(".tsx"))];
    for (const file of files) {
      for (const m of read(file).matchAll(/\bt\("(ownerboard\.[a-zA-Z_.]+)"/g)) expect(AR[m[1]!], `${path.basename(file)}: ${m[1]}`).toBeTruthy();
    }
    for (const mode of ["owner", "team", "self"]) {
      expect(AR[`ownerboard.title.${mode}`], mode).toBeTruthy();
      expect(AR[`ownerboard.subtitle.${mode}`], mode).toBeTruthy();
    }
    for (const key of ["ownerboard.not_found", "ownerboard.range_invalid", "ownerboard.range_too_long"]) expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });
});
