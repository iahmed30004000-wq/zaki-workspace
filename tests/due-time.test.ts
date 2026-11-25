import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUE_HOUR,
  defaultDueDate,
  defaultDueHourOf,
  dueLaterTodayWhere,
  dueWallOfInstant,
  isAllDayDue,
  isDueOverdue,
  isDueToday,
  overdueDueFilter,
  parseDueInput,
} from "@/lib/due-day";

/** Day AND time for a due date (the owner, 2026-11-25). A bare day stays what it was: noon in the company's zone, «the whole day». */
const ZONE = "Asia/Amman";
const at = (wall: string) => parseDueInput(wall, ZONE)!;
const NOW = at("2026-11-25T15:00");

describe("what a due date means", () => {
  it("noon is the whole day: what a picked day has always stored", () => {
    expect(isAllDayDue(at("2026-11-25"), ZONE)).toBe(true);
    expect(isAllDayDue(at("2026-11-25T12:00"), ZONE)).toBe(true);
    expect(isAllDayDue(at("2026-11-25T18:00"), ZONE)).toBe(false);
    expect(isAllDayDue(at("2026-11-25T12:30"), ZONE)).toBe(false);
  });

  it("a whole-day task is late only after its day ends", () => {
    expect(isDueOverdue(at("2026-11-25"), ZONE, NOW)).toBe(false);
    expect(isDueOverdue(at("2026-11-24"), ZONE, NOW)).toBe(true);
    expect(isDueOverdue(at("2026-11-25"), ZONE, at("2026-11-25T23:59"))).toBe(false);
    expect(isDueOverdue(at("2026-11-25"), ZONE, at("2026-11-26T00:00"))).toBe(true);
  });

  it("a task with an hour is late once the hour passes", () => {
    expect(isDueOverdue(at("2026-11-25T14:59"), ZONE, NOW)).toBe(true);
    expect(isDueOverdue(at("2026-11-25T18:00"), ZONE, NOW)).toBe(false);
    expect(isDueOverdue(at("2026-11-26T09:00"), ZONE, NOW)).toBe(false);
  });

  it("due today and not yet late is «اليوم» (the amber one)", () => {
    expect(isDueToday(at("2026-11-25T18:00"), ZONE, NOW)).toBe(true);
    expect(isDueToday(at("2026-11-25"), ZONE, NOW)).toBe(true);
    expect(isDueToday(at("2026-11-25T09:00"), ZONE, NOW)).toBe(false);
    expect(isDueToday(at("2026-11-26T09:00"), ZONE, NOW)).toBe(false);
  });
});

describe("the same rule for the database", () => {
  const matches = (due: Date, filter: { lt: Date; not: Date }) => due.getTime() < filter.lt.getTime() && due.getTime() !== filter.not.getTime();

  it("the overdue filter agrees with the rule on every kind of due date", () => {
    const filter = overdueDueFilter(NOW, ZONE);
    for (const wall of ["2026-11-24", "2026-11-24T23:00", "2026-11-25", "2026-11-25T00:00", "2026-11-25T14:59", "2026-11-25T18:00", "2026-11-26"]) {
      expect(matches(at(wall), filter), wall).toBe(isDueOverdue(at(wall), ZONE, NOW));
    }
  });

  it("«still due today» is what is left of today, and today's whole-day tasks", () => {
    const [later, wholeDay] = dueLaterTodayWhere(NOW, ZONE).OR;
    expect(later!.dueDate).toEqual({ gte: NOW, lt: at("2026-11-26T00:00") });
    expect(wholeDay!.dueDate).toEqual(at("2026-11-25"));
  });
});

describe("what a client sends", () => {
  it("a day is noon, a day and an hour is the company's wall clock, a full instant is itself", () => {
    expect(parseDueInput("2026-11-25", ZONE)!.toISOString()).toBe("2026-11-25T09:00:00.000Z");
    expect(parseDueInput("2026-11-25T18:00", ZONE)!.toISOString()).toBe("2026-11-25T15:00:00.000Z");
    expect(parseDueInput("2026-11-25T18:00:00.000Z", ZONE)!.toISOString()).toBe("2026-11-25T18:00:00.000Z");
    expect(parseDueInput("2026-11-25T18:00:00+03:00", ZONE)!.toISOString()).toBe("2026-11-25T15:00:00.000Z");
  });

  it("refuses what is not a date", () => {
    for (const bad of ["", "غدا", "2026-13-01T10:00", "2026-11-25T24:00", "2026-11-25T10:61"]) expect(parseDueInput(bad, ZONE), bad).toBeNull();
  });

  it("and gives the box back the same wall clock", () => {
    expect(dueWallOfInstant(at("2026-11-25T18:30"), ZONE)).toBe("2026-11-25T18:30");
    expect(dueWallOfInstant(at("2026-11-25"), ZONE)).toBe("2026-11-25T12:00");
  });
});

describe("a new task with no date", () => {
  it("is due today at 18:00 in the company's zone", () => {
    expect(DEFAULT_DUE_HOUR).toBe(18);
    expect(defaultDueDate({}, ZONE, NOW)!.toISOString()).toBe("2026-11-25T15:00:00.000Z");
    // after 18:00 it is still TODAY (the owner's rule): the card is born late
    expect(defaultDueDate({}, ZONE, at("2026-11-25T20:00"))!.toISOString()).toBe("2026-11-25T15:00:00.000Z");
  });

  it("the company picks the hour, or none at all; a broken value is the default", () => {
    expect(defaultDueHourOf({ defaultDueHour: 9 })).toBe(9);
    expect(defaultDueHourOf({ defaultDueHour: 0 })).toBe(0);
    expect(defaultDueHourOf({ defaultDueHour: null })).toBeNull();
    expect(defaultDueDate({ defaultDueHour: null }, ZONE, NOW)).toBeNull();
    for (const settings of [null, undefined, {}, { defaultDueHour: "18" }, { defaultDueHour: 24 }, { defaultDueHour: 1.5 }, []]) {
      expect(defaultDueHourOf(settings)).toBe(18);
    }
  });
});
