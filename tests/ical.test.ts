import { describe, expect, it } from "vitest";
import { MAX_LINE_OCTETS, buildIcs, escapeText, foldLine, formatDay, formatUtc, nextDay, octets, type IcsEvent } from "@/lib/ical";
import { whenOfInstant } from "@/server/services/calendar-feed";
import { zonedWallTime } from "@/lib/zoned-time";

/**
 * The iCalendar writer of «اشتراك التقويم». A calendar app drops a whole event for a line that is too long, split in the
 * middle of a letter, or ended with a bare line feed, so those are pinned here, with Arabic text at the 75-octet boundary.
 */

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const STAMP = new Date("2026-10-30T10:00:00.000Z");

/** The physical lines of a folded property, unfolded the way a calendar app reads them (CRLF + one space removed). */
const unfold = (folded: string): string => folded.replace(/\r\n /g, "");

function event(over: Partial<IcsEvent> = {}): IcsEvent {
  return { uid: "task-abc@workspace.zakiai.io", stamp: STAMP, summary: "مهمة", when: { kind: "date", day: "2026-11-05" }, ...over };
}

describe("folding at 75 octets", () => {
  it("leaves a line of exactly 75 octets alone and folds one of 76", () => {
    // "SUMMARY:" is 8 octets; 33 Arabic letters are 66; plus 1 ASCII = 75
    const exactly = "SUMMARY:" + "ب".repeat(33) + "x";
    expect(octets(exactly)).toBe(MAX_LINE_OCTETS);
    expect(foldLine(exactly)).toBe(exactly);
    const over = exactly + "y";
    expect(octets(over)).toBe(76);
    expect(foldLine(over)).toContain("\r\n ");
  });

  it("never splits a two-octet Arabic letter that would straddle the boundary: the whole letter moves down", () => {
    // 8 + 66 = 74 octets, then one more letter (2 octets) would end at 76
    const line = "SUMMARY:" + "ب".repeat(34);
    const pieces = foldLine(line).split("\r\n");
    expect(pieces).toHaveLength(2);
    expect(octets(pieces[0]!)).toBe(74);
    expect(pieces[1]).toBe(" ب");
    // every piece decodes as valid UTF-8 on its own (a split letter would not)
    for (const piece of pieces) expect(() => decoder.decode(encoder.encode(piece))).not.toThrow();
    expect(unfold(foldLine(line))).toBe(line);
  });

  it("keeps every physical line within 75 octets (the space of a continuation counts) for a long Arabic title", () => {
    const text = "اجتماع مراجعة خطة الإطلاق مع فريق المبيعات والتسويق، ثم إرسال الملخص للإدارة قبل نهاية الأسبوع؛ ".repeat(6);
    const folded = foldLine("SUMMARY:" + text);
    const pieces = folded.split("\r\n");
    expect(pieces.length).toBeGreaterThan(3);
    for (const piece of pieces) expect(octets(piece)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
    for (const piece of pieces.slice(1)) expect(piece.startsWith(" ")).toBe(true);
    expect(unfold(folded)).toBe("SUMMARY:" + text);
  });

  it("does not cut an emoji (a surrogate pair of four octets) in half", () => {
    for (let pad = 60; pad < 80; pad++) {
      const line = "x".repeat(pad) + "😀".repeat(5);
      const folded = foldLine(line);
      for (const piece of folded.split("\r\n")) {
        expect(octets(piece)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
        expect(() => decoder.decode(encoder.encode(piece))).not.toThrow();
        expect(piece).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      }
      expect(unfold(folded)).toBe(line);
    }
  });
});

describe("escaping a TEXT value", () => {
  it("escapes backslash, semicolon, comma and every kind of line break", () => {
    expect(escapeText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeText("one\ntwo\r\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour");
    expect(escapeText("مهمة، ثم؛ أخرى")).toBe("مهمة، ثم؛ أخرى"); // the Arabic comma and semicolon are not the ASCII ones
  });

  it("drops control characters a calendar app may reject", () => {
    expect(escapeText("a\u0000b\u0007c\u001fd")).toBe("abcd");
  });

  it("a title with a comma and a line break lands escaped in the file, on one logical line", () => {
    const ics = buildIcs({ name: "x", timeZone: "UTC", events: [event({ summary: "a, b; c\nd" })] });
    expect(unfold(ics)).toContain("SUMMARY:a\\, b\\; c\\nd\r\n");
  });
});

describe("the calendar text", () => {
  const ics = buildIcs({ name: "ذكي — شغلي", timeZone: "Asia/Damascus", events: [event()] });

  it("ends every line with CRLF, the last one too, and has no bare line feed", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("names the calendar and its zone", () => {
    expect(unfold(ics)).toContain("X-WR-CALNAME:ذكي — شغلي\r\n");
    expect(ics).toContain("X-WR-TIMEZONE:Asia/Damascus\r\n");
  });

  it("every physical line of a whole calendar is at most 75 octets", () => {
    const long = buildIcs({
      name: "ذكي — شغلي",
      timeZone: "Asia/Damascus",
      events: [event({ summary: "مراجعة ".repeat(40), description: "المشروع: " + "حملة الربيع ".repeat(20) + "\nhttps://workspace.zakiai.io/tasks/abc", url: "https://workspace.zakiai.io/tasks/" + "a".repeat(80) })],
    });
    for (const physical of long.split("\r\n")) expect(octets(physical)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
  });

  it("keeps the UID the caller gave, the same on every build, and a stable DTSTAMP (an unchanged feed is byte-identical)", () => {
    const a = buildIcs({ name: "x", timeZone: "UTC", events: [event()] });
    const b = buildIcs({ name: "x", timeZone: "UTC", events: [event()] });
    expect(a).toBe(b);
    expect(a).toContain("UID:task-abc@workspace.zakiai.io\r\n");
    expect(a).toContain("DTSTAMP:20261030T100000Z\r\n");
  });

  it("an all-day event is VALUE=DATE ending on the day AFTER, across a month and a year end", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261105\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261106\r\n");
    expect(nextDay("2026-11-30")).toBe("20261201");
    expect(nextDay("2026-12-31")).toBe("20270101");
    expect(nextDay("2028-02-28")).toBe("20280229");
    expect(nextDay("nope")).toBeNull();
    expect(formatDay("2026-11-05")).toBe("20261105");
    expect(formatDay("5/11/2026")).toBeNull();
  });

  it("a timed event is UTC with a Z and has a length", () => {
    const timed = buildIcs({ name: "x", timeZone: "UTC", events: [event({ when: { kind: "time", at: new Date("2026-11-05T06:30:00.000Z"), minutes: 15 } })] });
    expect(timed).toContain("DTSTART:20261105T063000Z\r\n");
    expect(timed).toContain("DTEND:20261105T064500Z\r\n");
    expect(timed).not.toContain("VALUE=DATE");
    expect(formatUtc(new Date("2026-01-02T03:04:05.000Z"))).toBe("20260102T030405Z");
  });

  it("a VALARM is written only for an event that asks for one", () => {
    expect(ics).not.toContain("VALARM");
    const withAlarm = buildIcs({ name: "x", timeZone: "UTC", events: [event({ when: { kind: "time", at: new Date("2026-11-05T06:30:00.000Z") }, alarm: { description: "اتصل بالمورّد" } }), event({ uid: "task-2@h" })] });
    expect(withAlarm.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(unfold(withAlarm)).toContain("ACTION:DISPLAY\r\nDESCRIPTION:اتصل بالمورّد\r\nTRIGGER:PT0M\r\nEND:VALARM");
  });

  it("refuses a malformed day instead of writing a broken file", () => {
    expect(() => buildIcs({ name: "x", timeZone: "UTC", events: [event({ when: { kind: "date", day: "soon" } })] })).toThrow();
  });
});

describe("a stored due instant: a day or a moment", () => {
  const zone = "Asia/Damascus";

  it("noon of the company's zone is the DAY the person picked (the app stores a picked day as noon)", () => {
    const noon = zonedWallTime({ year: 2026, month: 11, day: 5, hour: 12 }, zone);
    expect(whenOfInstant(noon, zone, 30)).toEqual({ kind: "date", day: "2026-11-05" });
  });

  it("any other time is a moment, kept as the instant the app stores", () => {
    const at = zonedWallTime({ year: 2026, month: 11, day: 5, hour: 9, minute: 30 }, zone);
    expect(whenOfInstant(at, zone, 30)).toEqual({ kind: "time", at, minutes: 30 });
  });

  it("the day is read in the company's zone, not the server's", () => {
    // 23:30 on 5 November in Damascus is already 20:30Z on the 5th; noon is the all-day marker only at 12:00 local
    const lateNoon = zonedWallTime({ year: 2026, month: 3, day: 31, hour: 12 }, "America/New_York");
    expect(whenOfInstant(lateNoon, "America/New_York", 30)).toEqual({ kind: "date", day: "2026-03-31" });
    expect(whenOfInstant(lateNoon, "Asia/Damascus", 30).kind).toBe("time");
  });
});
