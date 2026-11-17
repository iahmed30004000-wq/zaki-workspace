import { describe, expect, it } from "vitest";
import { workedMinutes } from "../src/lib/tickets/work-hours";

/** Q1.5: the hours a ticket has waited, counted only inside the company's working hours (09:00–18:00, Friday off, in its time zone). */
const hours = { from: "09:00", to: "18:00", daysOff: [5] };
const TZ = "Asia/Amman"; // UTC+3 in the winter of 2026
const at = (iso: string) => new Date(iso);

describe("worked minutes", () => {
  it("inside one working day it is the plain difference", () => {
    // Monday 16 Nov 2026, 10:00 → 13:30 local (UTC+3) = 07:00 → 10:30 UTC
    expect(workedMinutes(at("2026-11-16T07:00:00Z"), at("2026-11-16T10:30:00Z"), hours, TZ)).toBe(210);
  });
  it("the night does not count: 17:00 to next morning 10:00 is two hours", () => {
    expect(workedMinutes(at("2026-11-16T14:00:00Z"), at("2026-11-17T07:00:00Z"), hours, TZ)).toBe(60 + 60);
  });
  it("a day off does not count at all (Thursday 17:00 → Saturday 10:00; Friday is off)", () => {
    // Thursday 19 Nov 17:00 local = 14:00Z; Saturday 21 Nov 10:00 local = 07:00Z
    expect(workedMinutes(at("2026-11-19T14:00:00Z"), at("2026-11-21T07:00:00Z"), hours, TZ)).toBe(60 + 60);
  });
  it("before opening and after closing count nothing; a backwards range is zero", () => {
    expect(workedMinutes(at("2026-11-16T22:00:00Z"), at("2026-11-17T04:00:00Z"), hours, TZ)).toBe(0);
    expect(workedMinutes(at("2026-11-16T10:00:00Z"), at("2026-11-16T07:00:00Z"), hours, TZ)).toBe(0);
  });
  it("a full working day is nine hours", () => {
    expect(workedMinutes(at("2026-11-16T00:00:00Z"), at("2026-11-17T00:00:00Z"), hours, TZ)).toBe(9 * 60);
  });
});
