import { describe, expect, it } from "vitest";
import { GOAL_LIGHTS, KR_MAX, isGoalLight, keyResultPercent, linkedValue, objectivePercent, suggestLight } from "@/lib/okr";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { enumLabel } from "@/lib/i18n/enums";
import { periodWindow } from "@/server/services/goals";

describe("«الأهداف والنتائج»: the arithmetic", () => {
  it("a key result is where its value stands between start and target, cut to 0..100", () => {
    expect(keyResultPercent({ startValue: 0, targetValue: 100, currentValue: 25 })).toBe(25);
    expect(keyResultPercent({ startValue: 10, targetValue: 20, currentValue: 15 })).toBe(50);
    expect(keyResultPercent({ startValue: 0, targetValue: 10, currentValue: 25 })).toBe(100);
    expect(keyResultPercent({ startValue: 0, targetValue: 10, currentValue: -5 })).toBe(0);
    expect(keyResultPercent({ startValue: 0, targetValue: 3, currentValue: 1 })).toBe(33);
  });

  it("works downwards: from 30 complaints to 10, at 20 it is half", () => {
    expect(keyResultPercent({ startValue: 30, targetValue: 10, currentValue: 20 })).toBe(50);
    expect(keyResultPercent({ startValue: 30, targetValue: 10, currentValue: 5 })).toBe(100);
    expect(keyResultPercent({ startValue: 30, targetValue: 10, currentValue: 40 })).toBe(0);
  });

  it("a target equal to the start is done once reached; a broken number is nothing done", () => {
    expect(keyResultPercent({ startValue: 5, targetValue: 5, currentValue: 5 })).toBe(100);
    expect(keyResultPercent({ startValue: 5, targetValue: 5, currentValue: 4 })).toBe(0);
    expect(keyResultPercent({ startValue: 0, targetValue: 10, currentValue: Number.NaN })).toBe(0);
    expect(keyResultPercent({ startValue: 0, targetValue: Number.POSITIVE_INFINITY, currentValue: 1 })).toBe(0);
  });

  it("the objective is the plain average of its key results; none: null (the hand-set number applies)", () => {
    expect(objectivePercent([])).toBeNull();
    expect(
      objectivePercent([
        { startValue: 0, targetValue: 100, currentValue: 50 },
        { startValue: 0, targetValue: 10, currentValue: 10 },
        { startValue: 0, targetValue: 4, currentValue: 0 },
      ]),
    ).toBe(50);
    expect(objectivePercent([{ startValue: 0, targetValue: 3, currentValue: 1 }, { startValue: 0, targetValue: 3, currentValue: 2 }])).toBe(50);
  });

  it("at most five key results", () => {
    expect(KR_MAX).toBe(5);
  });

  it("a linked key result's value is its finished tasks, never negative or fractional", () => {
    expect(linkedValue(3)).toBe(3);
    expect(linkedValue(-2)).toBe(0);
    expect(linkedValue(2.9)).toBe(2);
    expect(linkedValue(Number.NaN)).toBe(0);
  });
});

describe("«الأهداف والنتائج»: the suggested light (a suggestion, never a decision)", () => {
  const periodStart = new Date("2026-10-01T00:00:00Z");
  const periodEnd = new Date("2026-10-31T23:59:59Z");
  const at = (day: number) => new Date(Date.UTC(2026, 9, day, 12));

  it("on pace is on track, a little behind is behind, far behind is at risk", () => {
    // about half of the month gone (the 16th at noon)
    expect(suggestLight({ percent: 50, periodStart, periodEnd, now: at(16) })).toBe("ON_TRACK");
    expect(suggestLight({ percent: 35, periodStart, periodEnd, now: at(16) })).toBe("BEHIND");
    expect(suggestLight({ percent: 10, periodStart, periodEnd, now: at(16) })).toBe("AT_RISK");
  });

  it("a finished objective is on track; an unfinished one after its period is at risk", () => {
    expect(suggestLight({ percent: 100, periodStart, periodEnd, now: new Date("2026-12-01T00:00:00Z") })).toBe("ON_TRACK");
    expect(suggestLight({ percent: 90, periodStart, periodEnd, now: new Date("2026-11-02T00:00:00Z") })).toBe("AT_RISK");
  });

  it("before the period starts there is nothing to be behind on", () => {
    expect(suggestLight({ percent: 0, periodStart, periodEnd, now: new Date("2026-09-20T00:00:00Z") })).toBe("ON_TRACK");
  });

  it("knows its three lights", () => {
    expect([...GOAL_LIGHTS]).toEqual(["ON_TRACK", "BEHIND", "AT_RISK"]);
    expect(isGoalLight("BEHIND")).toBe(true);
    expect(isGoalLight("GREEN")).toBe(false);
    expect(isGoalLight(null)).toBe(false);
  });
});

describe("«الأهداف والنتائج»: the quarter, the switch and the words", () => {
  it("a quarter is the calendar quarter of the anchor, in the company's zone", () => {
    const win = periodWindow("QUARTERLY", new Date("2026-11-15T09:00:00Z"), "Asia/Damascus");
    // Damascus is UTC+3: 1 October 00:00 local is 30 September 21:00Z; the quarter ends one millisecond before 1 January 00:00 local
    expect(win.start.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(win.end.toISOString()).toBe("2026-12-31T20:59:59.999Z");
    const first = periodWindow("QUARTERLY", new Date("2027-01-10T09:00:00Z"), "Asia/Damascus");
    expect(first.start.toISOString()).toBe("2026-12-31T21:00:00.000Z");
    expect(first.end.toISOString()).toBe("2027-03-31T20:59:59.999Z");
  });

  it("the switch `okr` exists, is on by default, and has its name and hint in Arabic", () => {
    expect(FEATURES).toContain("okr");
    expect(FEATURE_DEFAULTS.okr).toBe(true);
    expect(AR["features.okr.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.okr.hint"]).toMatch(/[؀-ۿ]/);
  });

  it("every light and the quarter are shown through enumLabel in Arabic", () => {
    expect(enumLabel("GoalPeriod", "QUARTERLY")).toMatch(/[؀-ۿ]/);
    for (const light of GOAL_LIGHTS) expect(enumLabel("GoalLight", light), light).toMatch(/[؀-ۿ]/);
    expect(enumLabel("GoalLight", "ON_TRACK")).toBe("على المسار");
    expect(enumLabel("GoalLight", "BEHIND")).toBe("متأخر");
    expect(enumLabel("GoalLight", "AT_RISK")).toBe("بخطر");
  });
});
