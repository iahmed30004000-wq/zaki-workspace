import { describe, expect, it } from "vitest";
import { chatAutomationSchema, withinWorkHours, workHoursSchema, type WorkHours } from "@/lib/chat/work-hours";

/** «ساعات الدوام»: the pure rules — the shape the screen may save, and whether a moment falls inside the hours of the person's own time zone. */
const AMMAN_WEEK: WorkHours = { days: [0, 1, 2, 3, 4], from: "09:00", to: "17:00", tz: "Asia/Amman" };

describe("withinWorkHours", () => {
  it("inside on a working day, outside before, after and on a day off — in the person's own zone (Amman is UTC+3 in the winter)", () => {
    // 2026-11-24 is a Tuesday (2); 12:00 in Amman = 09:00 UTC
    expect(withinWorkHours(AMMAN_WEEK, new Date("2026-11-24T09:00:00Z"))).toBe(true);
    expect(withinWorkHours(AMMAN_WEEK, new Date("2026-11-24T05:59:00Z"))).toBe(false); // 08:59 in Amman
    expect(withinWorkHours(AMMAN_WEEK, new Date("2026-11-24T06:00:00Z"))).toBe(true); // 09:00 sharp
    expect(withinWorkHours(AMMAN_WEEK, new Date("2026-11-24T14:00:00Z"))).toBe(false); // 17:00 sharp is already out
    // 2026-11-27 is a Friday (5): not a working day
    expect(withinWorkHours(AMMAN_WEEK, new Date("2026-11-27T09:00:00Z"))).toBe(false);
  });

  it("the same instant is a different hour in another zone", () => {
    const berlin: WorkHours = { ...AMMAN_WEEK, tz: "Europe/Berlin" }; // UTC+1: 09:00Z is 10:00 there
    expect(withinWorkHours(berlin, new Date("2026-11-24T09:00:00Z"))).toBe(true);
    expect(withinWorkHours(berlin, new Date("2026-11-24T16:30:00Z"))).toBe(false); // 17:30 in Berlin
  });
});

describe("the shapes the screen may save", () => {
  it("accepts a normal week and refuses an empty day list, a backwards range, a bad time and a made-up zone", () => {
    expect(workHoursSchema.safeParse(AMMAN_WEEK).success).toBe(true);
    expect(workHoursSchema.safeParse({ ...AMMAN_WEEK, days: [] }).success).toBe(false);
    expect(workHoursSchema.safeParse({ ...AMMAN_WEEK, days: [7] }).success).toBe(false);
    expect(workHoursSchema.safeParse({ ...AMMAN_WEEK, from: "18:00", to: "09:00" }).success).toBe(false);
    expect(workHoursSchema.safeParse({ ...AMMAN_WEEK, from: "9am" }).success).toBe(false);
    expect(workHoursSchema.safeParse({ ...AMMAN_WEEK, tz: "Mars/Olympus" }).success).toBe(false);
  });

  it("the away line is plain text of the person's own, at most 300 characters, never empty when it is on", () => {
    expect(chatAutomationSchema.safeParse({ on: true, text: "خارج الدوام، برد عليك بكرة" }).success).toBe(true);
    expect(chatAutomationSchema.safeParse({ on: true, text: "   " }).success).toBe(false);
    expect(chatAutomationSchema.safeParse({ on: true, text: "ا".repeat(301) }).success).toBe(false);
    expect(chatAutomationSchema.safeParse({ on: false, text: "" }).success).toBe(true);
  });
});
