import { describe, expect, it } from "vitest";
import {
  IDLE_DAYS,
  INSIGHT_IDS,
  OVERLOAD_MIN,
  buildInsights,
  changePercent,
  dayGap,
  fillSeries,
  forecastDays,
  median,
  namesOf,
  rateOf,
  seriesMax,
  sortInsights,
  type Insight,
  type InsightInput,
  type PersonWeek,
} from "@/lib/control-panel";
import { AR } from "@/lib/i18n/dict";

/**
 * «لوحة التحكم» — the sentences the owner is told. Every threshold and every number is proven here, with no database: the same numbers give
 * the same sentences, a quiet company gets one «ما في شي لافت», and every sentence has its dictionary line AND its formula line.
 */

const person = (name: string, over: Partial<PersonWeek> = {}): PersonWeek => ({ userId: `u-${name}`, name, completed: 2, openTasks: 3, overdue: 0, lastActiveDay: "2026-11-02", ...over });
const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  today: "2026-11-02",
  week: [person("أحمد"), person("سارة"), person("خالد")],
  thisWeek: { completed: 6, onTime: 5, withDue: 6 },
  prevWeek: { completed: 6, onTime: 5, withDue: 6 },
  open: 12,
  overdue: 0,
  unassigned: 0,
  stale: 0,
  completedForecastWindow: 0,
  ideasWaiting: 0,
  overdueBySpace: [],
  ...over,
});
const ids = (input: InsightInput) => buildInsights(input).map((i) => i.id);

describe("the arithmetic", () => {
  it("changePercent: a whole percent, null when there is nothing to compare with", () => {
    expect(changePercent(12, 10)).toBe(20);
    expect(changePercent(5, 10)).toBe(-50);
    expect(changePercent(10, 10)).toBe(0);
    expect(changePercent(3, 0)).toBeNull();
    expect(changePercent(Number.NaN, 4)).toBeNull();
  });

  it("rateOf: never 0% for «nothing to divide by»", () => {
    expect(rateOf(3, 4)).toBe(75);
    expect(rateOf(0, 4)).toBe(0);
    expect(rateOf(0, 0)).toBeNull();
  });

  it("median: the middle, the mean of the two middle ones, and 0 for nothing", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("forecastDays: open ÷ (finished ÷ window), rounded up; null with no pace or nothing open", () => {
    expect(forecastDays(28, 14, 28)).toBe(56);
    expect(forecastDays(10, 28, 28)).toBe(10);
    expect(forecastDays(1, 28, 28)).toBe(1);
    expect(forecastDays(10, 0, 28)).toBeNull();
    expect(forecastDays(0, 5, 28)).toBeNull();
  });

  it("dayGap counts calendar days between two day keys", () => {
    expect(dayGap("2026-10-31", "2026-11-02")).toBe(2);
    expect(dayGap("2026-11-02", "2026-11-02")).toBe(0);
    expect(dayGap("2026-12-30", "2027-01-02")).toBe(3);
    expect(dayGap("nope", "2026-11-02")).toBeNaN();
  });

  it("namesOf lists three and counts the rest", () => {
    expect(namesOf(["أ", "ب"])).toEqual({ list: "أ، ب", rest: 0 });
    expect(namesOf(["أ", "ب", "ج", "د", "هـ"])).toEqual({ list: "أ، ب، ج", rest: 2 });
  });
});

describe("the insights", () => {
  it("a quiet company: one «ما في شي لافت» next to the week's trend, and nothing that warns", () => {
    const list = buildInsights(base());
    expect(list.filter((i) => i.tone === "warn")).toEqual([]);
    expect(list.map((i) => i.id)).toContain("all_clear");
    expect(list.map((i) => i.id)).toContain("trend_same");
  });

  it("overdue work: the company's count and the space that holds most of it", () => {
    const list = buildInsights(base({ overdue: 9, overdueBySpace: [{ name: "التسويق", n: 2 }, { name: "المبيعات", n: 7 }] }));
    const first = list[0]!;
    expect(first).toMatchObject({ id: "overdue", tone: "warn", params: { n: 9, space: "المبيعات", spaceN: 7 } });
    expect(list.map((i) => i.id)).not.toContain("all_clear");
  });

  it("the people with late tasks: only from the threshold up, the worst first, and linked by id", () => {
    const week = [person("أحمد", { overdue: 1 }), person("سارة", { overdue: 5 }), person("خالد", { overdue: 2 })];
    const late = buildInsights(base({ week })).find((i) => i.id === "late_people")!;
    expect(late.params).toMatchObject({ n: 2, names: "سارة (5)، خالد (2)", rest: 0 });
    expect(late.people).toEqual(["u-سارة", "u-خالد"]);
    expect(ids(base({ week: [person("أحمد", { overdue: 1 })] }))).not.toContain("late_people");
  });

  it("idle: nobody who acted today or yesterday; somebody with no action in three days, or none at all, is named", () => {
    const week = [person("أحمد", { lastActiveDay: "2026-11-02" }), person("سارة", { lastActiveDay: "2026-10-31" }), person("خالد", { lastActiveDay: null }), person("ليلى", { lastActiveDay: "2026-11-01" })];
    const idle = buildInsights(base({ week })).find((i) => i.id === "idle_people")!;
    expect(IDLE_DAYS).toBe(3);
    expect(idle.params).toMatchObject({ n: 1, names: "خالد" });
    // two days without an action is still inside the window
    expect(dayGap("2026-10-31", "2026-11-02")).toBe(2);
    const wider = buildInsights(base({ week: [person("سارة", { lastActiveDay: "2026-10-30" })] })).find((i) => i.id === "idle_people")!;
    expect(wider.params).toMatchObject({ n: 1, names: "سارة" });
  });

  it("the trend: up, down, the same, none; a first productive week after an empty one is «up»", () => {
    const trend = (cur: number, prev: number) => buildInsights(base({ thisWeek: { completed: cur, onTime: 0, withDue: 0 }, prevWeek: { completed: prev, onTime: 0, withDue: 0 } })).find((i) => i.id.startsWith("trend_"))!;
    expect(trend(12, 10)).toMatchObject({ id: "trend_up", tone: "good", params: { cur: 12, prev: 10, pct: 20 } });
    expect(trend(5, 10)).toMatchObject({ id: "trend_down", tone: "warn", params: { cur: 5, prev: 10, pct: 50 } });
    expect(trend(10, 10)).toMatchObject({ id: "trend_same", tone: "info" });
    expect(trend(0, 0)).toMatchObject({ id: "trend_none" });
    expect(trend(4, 0)).toMatchObject({ id: "trend_up", params: { pct: 100 } });
  });

  it("the on-time rate speaks only when it moved ten points or more, either way", () => {
    const rate = (now: [number, number], prev: [number, number]) =>
      ids(base({ thisWeek: { completed: 6, onTime: now[0], withDue: now[1] }, prevWeek: { completed: 6, onTime: prev[0], withDue: prev[1] } }));
    expect(rate([5, 10], [8, 10])).toContain("on_time_down"); // 50% from 80%
    expect(rate([9, 10], [6, 10])).toContain("on_time_up"); // 90% from 60%
    expect(rate([7, 10], [8, 10])).toContain("on_time_down"); // 70% from 80%: exactly ten points counts
    expect(rate([75, 100], [80, 100])).not.toContain("on_time_down"); // five points: quiet
    expect(rate([75, 100], [80, 100])).not.toContain("on_time_up");
    expect(rate([0, 0], [8, 10])).not.toContain("on_time_down"); // nothing to divide by this week
  });

  it("the load: from the minimum and at least double the median, never a small team's ordinary week", () => {
    const week = [person("أحمد", { openTasks: 2 }), person("سارة", { openTasks: 3 }), person("خالد", { openTasks: OVERLOAD_MIN + 4 })];
    const loaded = buildInsights(base({ week })).find((i) => i.id === "overloaded")!;
    expect(loaded.params).toMatchObject({ n: 1, names: `خالد (${OVERLOAD_MIN + 4})`, median: 3 });
    expect(ids(base({ week: [person("أحمد", { openTasks: 6 }), person("سارة", { openTasks: 1 })] }))).not.toContain("overloaded");
    // everybody is equally loaded: nobody stands out
    expect(ids(base({ week: [person("أحمد", { openTasks: 10 }), person("سارة", { openTasks: 10 }), person("خالد", { openTasks: 11 })] }))).not.toContain("overloaded");
  });

  it("work nobody holds, work that stopped, ideas waiting: each only when there is some", () => {
    expect(ids(base())).not.toEqual(expect.arrayContaining(["unassigned", "stale", "ideas_waiting"]));
    const list = buildInsights(base({ unassigned: 4, stale: 7, ideasWaiting: 2 }));
    expect(list.find((i) => i.id === "unassigned")?.params).toEqual({ n: 4 });
    expect(list.find((i) => i.id === "stale")?.params).toEqual({ n: 7, days: 14 });
    expect(list.find((i) => i.id === "ideas_waiting")).toMatchObject({ params: { n: 2, days: 7 }, href: "/ideas" });
  });

  it("the forecast: at the pace of the last 28 days; none without a pace", () => {
    const f = buildInsights(base({ open: 20, completedForecastWindow: 28 })).find((i) => i.id === "forecast")!;
    expect(f.params).toEqual({ open: 20, rate: 1, days: 20, window: 28 });
    expect(ids(base({ open: 20, completedForecastWindow: 0 }))).not.toContain("forecast");
  });

  it("the best of the week is named with their count; nobody who finished nothing is", () => {
    const week = [person("أحمد", { completed: 3 }), person("سارة", { completed: 9 }), person("خالد", { completed: 0 })];
    expect(buildInsights(base({ week })).find((i) => i.id === "top")).toMatchObject({ tone: "good", params: { name: "سارة", n: 9 }, people: ["u-سارة"] });
    expect(ids(base({ week: [person("خالد", { completed: 0 })] }))).not.toContain("top");
  });

  it("order: the warnings first, then what to know, then the good news; a tie keeps the order it was written in", () => {
    const week = [person("أحمد", { overdue: 4, lastActiveDay: null, completed: 5 })];
    const tones = buildInsights(base({ week, overdue: 4, unassigned: 1, thisWeek: { completed: 9, onTime: 0, withDue: 0 }, prevWeek: { completed: 3, onTime: 0, withDue: 0 } })).map((i) => i.tone);
    const firstInfo = tones.indexOf("info");
    const firstGood = tones.indexOf("good");
    expect(tones.lastIndexOf("warn")).toBeLessThan(firstInfo);
    expect(tones.lastIndexOf("info")).toBeLessThan(firstGood);
    const make = (id: Insight["id"], tone: Insight["tone"]): Insight => ({ id, tone, params: {}, people: [], href: null });
    const list = [make("stale", "info"), make("overdue", "warn"), make("top", "good"), make("unassigned", "info")];
    expect(sortInsights(list).map((i) => i.id)).toEqual(["overdue", "stale", "unassigned", "top"]);
  });

  it("the same numbers give the same sentences, and the function never changes what it was given", () => {
    const input = base({ overdue: 3, overdueBySpace: [{ name: "أ", n: 3 }], week: [person("أحمد", { overdue: 3 })] });
    const frozen = JSON.stringify(input);
    expect(buildInsights(input)).toEqual(buildInsights(input));
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe("the weekly series", () => {
  it("fills every week, oldest first, with zeros for a week with nothing; the tallest bar is at least 1", () => {
    const rows = [
      { ago: 0, created: 4, completed: 3 },
      { ago: 2, created: 1, completed: 6 },
    ];
    const series = fillSeries(rows, 4);
    expect(series.map((p) => p.ago)).toEqual([3, 2, 1, 0]);
    expect(series.map((p) => [p.created, p.completed])).toEqual([
      [0, 0],
      [1, 6],
      [0, 0],
      [4, 3],
    ]);
    expect(seriesMax(series)).toBe(6);
    expect(seriesMax(fillSeries([], 3))).toBe(1);
  });
});

describe("every sentence has its words", () => {
  it("each insight id has its sentence `cp.i.<id>` and its formula `cp.f.<id>` in the dictionary", () => {
    for (const id of INSIGHT_IDS) {
      expect(AR[`cp.i.${id}`], `cp.i.${id}`).toBeTruthy();
      expect(AR[`cp.f.${id}`], `cp.f.${id}`).toBeTruthy();
    }
  });

  it("a sentence uses only the parameters its insight carries", () => {
    const input = base({
      overdue: 5,
      overdueBySpace: [{ name: "المبيعات", n: 5 }],
      week: [person("أحمد", { overdue: 4, lastActiveDay: null, openTasks: 20, completed: 7 }), person("سارة", { openTasks: 2 }), person("خالد", { openTasks: 3 })],
      thisWeek: { completed: 4, onTime: 2, withDue: 10 },
      prevWeek: { completed: 8, onTime: 9, withDue: 10 },
      unassigned: 2,
      stale: 3,
      open: 40,
      completedForecastWindow: 56,
      ideasWaiting: 2,
    });
    for (const insight of buildInsights(input)) {
      const template = AR[`cp.i.${insight.id}`] ?? "";
      for (const [, key] of template.matchAll(/\{(\w+)\}/g)) expect(Object.keys(insight.params), `${insight.id} uses {${key}}`).toContain(key);
    }
  });
});
