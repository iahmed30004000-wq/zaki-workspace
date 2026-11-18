import { describe, expect, it } from "vitest";
import { dayKeyOf, msUntilNextDay, rowMarks, rowPinned, rowPreview, rowSpokenLabel, rowTicks, rowTimeLabel, typingText, unreadText } from "@/lib/chat/row-preview";
import type { ChatRowDto } from "@/lib/chat/cache/types";

/**
 * C2.2 — what a row says, as pure functions of the row the cache holds (row anatomy of the spec, C2 §3).
 */
const row = (over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id: "c1",
  kind: "TOPIC",
  title: "الطلبات",
  emoji: "📦",
  space: null,
  lastMessage: null,
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});
const msg = (over: Record<string, unknown> = {}) => ({ id: "m1", authorName: "سلمى", preview: "وصلت الشحنة", kind: "TEXT" as const, at: "2026-11-17T09:05:00.000Z", mine: false, ...over });
const NOW = new Date("2026-11-17T15:00:00");

describe("the time at the end of the row", () => {
  it("today: HH:MM with Western digits", () => {
    expect(rowTimeLabel(new Date("2026-11-17T09:05:00").toISOString(), NOW)).toBe("09:05");
  });
  it("this week: the day's name", () => {
    expect(rowTimeLabel(new Date("2026-11-15T09:05:00").toISOString(), NOW)).toBe("أحد");
    expect(rowTimeLabel(new Date("2026-11-11T09:05:00").toISOString(), NOW)).toBe("أربعاء");
  });
  it("older: d/M", () => {
    expect(rowTimeLabel(new Date("2026-10-03T09:05:00").toISOString(), NOW)).toBe("3/10");
    expect(rowTimeLabel(new Date("2026-11-10T09:05:00").toISOString(), NOW)).toBe("10/11");
  });
  it("nothing for a missing or broken time", () => {
    expect(rowTimeLabel(null, NOW)).toBe("");
    expect(rowTimeLabel("nope", NOW)).toBe("");
  });
});

describe("the second line", () => {
  it("a topic: «فلان: النص»", () => {
    expect(rowPreview(row({ lastMessage: msg() }))).toEqual({ tone: "text", author: "سلمى", text: "وصلت الشحنة" });
  });
  it("my own message in a topic: «أنت: …»", () => {
    expect(rowPreview(row({ lastMessage: msg({ mine: true }) })).author).toBe("أنت");
  });
  it("a private chat: plain, no author", () => {
    expect(rowPreview(row({ kind: "DM", lastMessage: msg() })).author).toBeNull();
    expect(rowPreview(row({ kind: "DM", lastMessage: msg({ mine: true }) })).author).toBeNull();
  });
  it("a space row: the newest message of any of its topics with its author", () => {
    expect(rowPreview(row({ kind: "SPACE", lastMessage: msg() }))).toMatchObject({ author: "سلمى", text: "وصلت الشحنة" });
  });
  it("typing wins over everything: «عم يكتب…» in a private chat, the name in a topic", () => {
    expect(rowPreview(row({ kind: "DM", lastMessage: msg() }), { typingNames: ["سلمى"], draft: "مسودة" })).toEqual({ tone: "typing", author: null, text: "عم يكتب…" });
    expect(rowPreview(row({ lastMessage: msg() }), { typingNames: ["سلمى"] }).text).toBe("سلمى عم يكتب…");
    expect(typingText(["سلمى", "أحمد", "رنا"], { kind: "TOPIC" })).toBe("سلمى، أحمد عم يكتبوا…");
  });
  it("my unsent draft is next: «مسودة: …» tone, the draft text only", () => {
    expect(rowPreview(row({ lastMessage: msg() }), { draft: "  شو رأيكم\n بالسعر؟ " })).toEqual({ tone: "draft", author: null, text: "شو رأيكم بالسعر؟" });
    expect(rowPreview(row({ lastMessage: msg() }), { draft: "   " }).tone).toBe("text");
    expect(rowPreview(row({ lastMessage: msg() }), { draft: null }).tone).toBe("text");
  });
  it("a voice note, a poll, a card, a file with no words", () => {
    expect(rowPreview(row({ lastMessage: msg({ kind: "VOICE", preview: "" }) })).text).toBe("🎤 رسالة صوتية");
    expect(rowPreview(row({ lastMessage: msg({ kind: "POLL", preview: "وين نتغدى؟" }) })).text).toBe("📊 وين نتغدى؟");
    expect(rowPreview(row({ lastMessage: msg({ kind: "CARD", preview: "طلب 1234" }) })).text).toBe("🧾 طلب 1234");
    expect(rowPreview(row({ lastMessage: msg({ kind: "CARD", preview: "" }) })).text).toBe("🧾 كرت");
    expect(rowPreview(row({ lastMessage: msg({ preview: "" }) })).text).toBe("📎 مرفق");
  });
  it("a deleted message says so and carries no text; the author is still named", () => {
    const out = rowPreview(row({ lastMessage: msg({ preview: null }) }));
    expect(out).toEqual({ tone: "deleted", author: "سلمى", text: "رسالة محذوفة" });
  });
  it("a DELETED voice note, poll or card says «رسالة محذوفة» too: its kind is not told once the message is gone (the server sends a null preview for any deleted message)", () => {
    for (const kind of ["VOICE", "POLL", "CARD", "TEXT"] as const) {
      expect(rowPreview(row({ lastMessage: msg({ kind, preview: null }) })), kind).toEqual({ tone: "deleted", author: "سلمى", text: "رسالة محذوفة" });
    }
  });
  it("a system line is a sentence of its own: no author in front of it", () => {
    const out = rowPreview(row({ lastMessage: msg({ kind: "SYSTEM", preview: "أحمد ثبّت رسالة", authorName: "أحمد" }) }));
    expect(out).toEqual({ tone: "text", author: null, text: "أحمد ثبّت رسالة" });
  });
  it("no message yet", () => {
    expect(rowPreview(row()).tone).toBe("empty");
    expect(rowPreview(row({ kind: "DM" })).text).toBe("ابدأ المحادثة");
  });
  it("long text is cut and white space collapsed", () => {
    expect(rowPreview(row({ lastMessage: msg({ preview: `${"ا".repeat(300)}` }) })).text.length).toBe(140);
    expect(rowPreview(row({ lastMessage: msg({ preview: "سطر\n\nتاني" }) })).text).toBe("سطر تاني");
  });
});

describe("the small marks after the title", () => {
  it("a private topic is a lock with the word «خاص», never the names; a topic for a «مقطع» says so", () => {
    expect(rowMarks(row({ restricted: true }))).toEqual([{ key: "restricted", labelKey: "chatui.row.private" }]);
    expect(rowMarks(row({ teamId: "t1" }))).toEqual([{ key: "team", labelKey: "chatui.row.team" }]);
  });
  it("a restricted topic is not also marked as a «مقطع» one", () => {
    expect(rowMarks(row({ restricted: true, teamId: "t1" })).map((m) => m.key)).toEqual(["restricted"]);
  });
  it("announcements: the megaphone; closed; muted last", () => {
    expect(rowMarks(row({ topicType: "ANNOUNCEMENTS", closed: true, muted: true })).map((m) => m.key)).toEqual(["announcements", "closed", "muted"]);
  });
  it("a private chat has no topic marks (only muted)", () => {
    expect(rowMarks(row({ kind: "DM", restricted: true, topicType: "ANNOUNCEMENTS" }))).toEqual([]);
    expect(rowMarks(row({ kind: "DM", muted: true })).map((m) => m.key)).toEqual(["muted"]);
  });
});

describe("ticks, pin and the unread pill", () => {
  it("ticks only on my own last message: the status of a private chat, a single tick elsewhere", () => {
    expect(rowTicks(row({ kind: "DM", lastMessage: msg({ mine: true, status: "read" }) }))).toBe("read");
    expect(rowTicks(row({ kind: "DM", lastMessage: msg({ mine: true, status: "delivered" }) }))).toBe("delivered");
    expect(rowTicks(row({ lastMessage: msg({ mine: true }) }))).toBe("sent");
    expect(rowTicks(row({ lastMessage: msg({ mine: false }) }))).toBeNull();
    expect(rowTicks(row({ lastMessage: msg({ mine: true, kind: "SYSTEM" }) }))).toBeNull();
    expect(rowTicks(row())).toBeNull();
  });
  it("the pin: the managers' pin of a topic, or my own (C3a)", () => {
    expect(rowPinned(row({ pinned: true }))).toBe(true);
    expect(rowPinned(row({ kind: "DM", pinnedByMe: true }))).toBe(true);
    expect(rowPinned(row({ kind: "DM", pinned: true }))).toBe(false);
    expect(rowPinned(row())).toBe(false);
  });
  it("the pill caps at 99+", () => {
    expect(unreadText(7)).toBe("7");
    expect(unreadText(100)).toBe("99+");
  });
  it("the sentence a screen reader gets", () => {
    const label = rowSpokenLabel(row({ unread: 3, mentionsUnread: 1, lastMessage: msg({ at: new Date("2026-11-17T09:05:00").toISOString() }) }), NOW);
    expect(label).toBe("الطلبات، 3 رسائل غير مقروءة، فيه رسالة بتذكرك، 09:05");
  });
});

describe("the labels roll over at midnight", () => {
  it("the day key changes with the local date and only then", () => {
    expect(dayKeyOf(new Date("2026-11-17T00:00:00"))).toBe("2026-11-17");
    expect(dayKeyOf(new Date("2026-11-17T23:59:59"))).toBe("2026-11-17");
    expect(dayKeyOf(new Date("2026-11-18T00:00:00"))).toBe("2026-11-18");
    expect(dayKeyOf(new Date("2026-12-31T12:00:00"))).toBe("2026-12-31");
    expect(dayKeyOf(new Date("2027-01-01T00:00:01"))).toBe("2027-1-1");
  });
  it("the timer lands just after the next midnight, never sooner than a second", () => {
    expect(msUntilNextDay(new Date("2026-11-17T23:00:00"))).toBe(3_600_000 + 500);
    expect(msUntilNextDay(new Date("2026-11-17T23:59:59.999"))).toBe(1000);
    expect(msUntilNextDay(new Date("2026-11-17T00:00:00"))).toBe(86_400_000 + 500);
  });
});
