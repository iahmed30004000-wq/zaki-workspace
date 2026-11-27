import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lastSeenLabel, lastSeenText } from "@/lib/last-seen";
import { dmSubtitle } from "@/lib/chat/conversation/last-seen-line";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { ConversationHeader } from "@/components/chat/conversation/conversation-header";
import { ProfileCard } from "@/components/profile-card";
import type { PublicProfile } from "@/server/services/users";

// the profile card's message button reads the router
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * «آخر ظهور» — the words (the owner, 2026-10-31). The company's zone is Asia/Damascus (UTC+3, no daylight time since
 * 2022): its midnight is 21:00 UTC, which is exactly where a formatter that counts days in UTC goes wrong.
 */
// the components of this project are compiled with the classic JSX runtime in tests
(globalThis as { React?: typeof React }).React = React;

const DAMASCUS = "Asia/Damascus";
const at = (iso: string) => new Date(iso);
const text = (lastSeenAt: string | null, now: string, timeZone: string | null = DAMASCUS) => lastSeenText({ online: false, lastSeenAt, now: at(now), timeZone });

describe("lastSeenText: minutes and hours, with the Arabic number forms", () => {
  const now = "2026-10-31T12:00:00Z";
  const minutesAgo = (n: number) => new Date(at(now).getTime() - n * 60_000).toISOString();
  const hoursAgo = (n: number) => new Date(at(now).getTime() - n * 3_600_000).toISOString();

  it("says «قبل دقيقة / دقيقتين / 3 دقايق … 11 دقيقة»", () => {
    expect(text(minutesAgo(0), now)).toBe("آخر ظهور قبل دقيقة");
    expect(text(minutesAgo(1), now)).toBe("آخر ظهور قبل دقيقة");
    expect(text(minutesAgo(2), now)).toBe("آخر ظهور قبل دقيقتين");
    expect(text(minutesAgo(3), now)).toBe("آخر ظهور قبل 3 دقايق");
    expect(text(minutesAgo(10), now)).toBe("آخر ظهور قبل 10 دقايق");
    expect(text(minutesAgo(11), now)).toBe("آخر ظهور قبل 11 دقيقة");
    expect(text(minutesAgo(59), now)).toBe("آخر ظهور قبل 59 دقيقة");
  });

  it("says «قبل ساعة / ساعتين / 3 ساعات» up to six hours, then a clock reading", () => {
    expect(text(hoursAgo(1), now)).toBe("آخر ظهور قبل ساعة");
    expect(text(hoursAgo(2), now)).toBe("آخر ظهور قبل ساعتين");
    expect(text(hoursAgo(3), now)).toBe("آخر ظهور قبل 3 ساعات");
    expect(text(hoursAgo(5), now)).toBe("آخر ظهور قبل 5 ساعات");
    // 5 h 59 m is still «5 ساعات»; six hours is a clock reading («اليوم 9:00 ص»: 06:00 UTC is 09:00 in Damascus)
    expect(text(new Date(at(now).getTime() - (6 * 60 - 1) * 60_000).toISOString(), now)).toBe("آخر ظهور قبل 5 ساعات");
    expect(text(hoursAgo(6), now)).toBe("آخر ظهور اليوم 9:00 ص");
  });

  it("a clock that runs ahead of the server is «قبل دقيقة», never a negative or empty phrase", () => {
    expect(text("2026-10-31T12:05:00Z", now)).toBe("آخر ظهور قبل دقيقة");
  });
});

describe("lastSeenText: days are the company's days (Asia/Damascus), not UTC's", () => {
  it("«اليوم» with a 12-hour clock, ص and م, Western digits", () => {
    // 10:40 UTC = 13:40 in Damascus
    expect(text("2026-10-31T10:40:00Z", "2026-10-31T20:59:00Z")).toBe("آخر ظهور اليوم 1:40 م");
    // 21:50 UTC the day before = 00:50 Damascus: noon is 12, midnight is 12 too
    expect(text("2026-10-30T21:50:00Z", "2026-10-31T10:00:00Z")).toBe("آخر ظهور اليوم 12:50 ص");
    expect(text("2026-10-31T09:00:00Z", "2026-10-31T20:59:00Z")).toBe("آخر ظهور اليوم 12:00 م");
  });

  it("23:59 and 00:01 in Damascus are different days: the clock of the server does not decide", () => {
    const seen = "2026-10-31T10:40:00Z"; // 13:40 Damascus, Saturday 31 October
    // 20:59 UTC is 23:59 in Damascus: still the same day
    expect(text(seen, "2026-10-31T20:59:00Z")).toBe("آخر ظهور اليوم 1:40 م");
    // 21:01 UTC is 00:01 in Damascus on 1 November: yesterday, although in UTC it is still the 31st
    expect(text(seen, "2026-10-31T21:01:00Z")).toBe("آخر ظهور أمس 1:40 م");
    expect(text(seen, "2026-11-01T20:59:00Z")).toBe("آخر ظهور أمس 1:40 م");
    // the midnight after that: two days back, so the weekday («السبت» is the 31st)
    expect(text(seen, "2026-11-01T21:01:00Z")).toBe("آخر ظهور السبت");
  });

  it("names the weekday for the last six days, and the date from the seventh", () => {
    const now = "2026-10-31T12:00:00Z"; // Saturday
    expect(text("2026-10-28T12:00:00Z", now)).toBe("آخر ظهور الأربعاء");
    expect(text("2026-10-25T12:00:00Z", now)).toBe("آخر ظهور الأحد"); // six days back
    expect(text("2026-10-24T12:00:00Z", now)).toBe("آخر ظهور 24 تشرين الأول"); // seven days back
    expect(text("2026-10-12T12:00:00Z", now)).toBe("آخر ظهور 12 تشرين الأول");
    expect(text("2026-01-03T12:00:00Z", now)).toBe("آخر ظهور 3 كانون الثاني");
  });

  it("adds the year only for another year", () => {
    expect(text("2025-12-30T12:00:00Z", "2026-10-31T12:00:00Z")).toBe("آخر ظهور 30 كانون الأول 2025");
  });

  it("a zone with daylight time: a 25-hour day does not move «أمس»", () => {
    const ny = "America/New_York"; // the clocks go back at 02:00 on 1 November 2026
    // 12:00 EDT on the 31st; 24 h 30 m later it is 11:30 EST on the 1st: yesterday, although more than 24 h passed
    expect(text("2026-10-31T16:00:00Z", "2026-11-01T16:30:00Z", ny)).toBe("آخر ظهور أمس 12:00 م");
    // 00:30 EDT on the 1st, then 12:30 EST the same day: today, 13 real hours later
    expect(text("2026-11-01T04:30:00Z", "2026-11-01T17:30:00Z", ny)).toBe("آخر ظهور اليوم 12:30 ص");
  });

  it("an unknown or missing zone falls back to the company default", () => {
    const a = text("2026-10-31T10:40:00Z", "2026-10-31T20:59:00Z", "Nowhere/Land");
    const b = text("2026-10-31T10:40:00Z", "2026-10-31T20:59:00Z", null);
    expect(a).toBe("آخر ظهور اليوم 1:40 م");
    expect(b).toBe(a);
  });
});

describe("lastSeenText: online, unknown, hidden", () => {
  it("online is «متصل الآن» whatever the time says", () => {
    expect(lastSeenText({ online: true, lastSeenAt: "2020-01-01T00:00:00Z", now: at("2026-10-31T12:00:00Z") })).toBe("متصل الآن");
    expect(lastSeenText({ online: true, lastSeenAt: null })).toBe("متصل الآن");
  });

  it("nothing recorded, hidden (null), empty or unreadable is «غير معروف»", () => {
    for (const value of [null, undefined, "", "not a date"]) {
      expect(lastSeenText({ online: false, lastSeenAt: value as never, now: at("2026-10-31T12:00:00Z") }), String(value)).toBe("غير معروف");
    }
  });

  it("never prints a Latin letter or an Arabic-Indic digit", () => {
    const now = "2026-10-31T12:00:00Z";
    for (const seen of ["2026-10-31T11:57:00Z", "2026-10-31T08:00:00Z", "2026-10-30T08:00:00Z", "2026-10-27T08:00:00Z", "2026-03-04T08:00:00Z", "2024-03-04T08:00:00Z", null]) {
      const out = text(seen, now);
      expect(out, out).not.toMatch(/[A-Za-z]/);
      expect(out, out).not.toMatch(/[٠-٩]/);
    }
  });
});

describe("lastSeenLabel: an answer without the field keeps the screen's old words", () => {
  it("an absent field (switch off, a guest, an older server) is null: the caller says «غير متصل» as before", () => {
    expect(lastSeenLabel({ online: false })).toBeNull();
    expect(lastSeenLabel({ online: true })).toBeNull();
  });
  it("null is a real answer: «غير معروف»; a time is the phrase", () => {
    expect(lastSeenLabel({ online: false, lastSeenAt: null })).toBe("غير معروف");
    expect(lastSeenLabel({ online: false, lastSeenAt: "2026-10-31T11:00:00Z" }, { now: at("2026-10-31T12:00:00Z") })).toBe("آخر ظهور قبل ساعة");
    expect(lastSeenLabel({ online: true, lastSeenAt: null })).toBe("متصل الآن");
  });
});

describe("«الميزات»: lastSeen", () => {
  it("is a switch, ON by default, with its two lines in Arabic", () => {
    expect(FEATURES).toContain("lastSeen");
    expect(FEATURE_DEFAULTS.lastSeen).toBe(true);
    expect(featureOn({}, "lastSeen")).toBe(true);
    expect(featureOn({ features: { lastSeen: false } }, "lastSeen")).toBe(false);
    expect(AR["features.lastSeen.name"]).toMatch(/آخر ظهور/);
    expect(AR["features.lastSeen.hint"]).toMatch(/[؀-ۿ]/);
  });
});

describe("the screens", () => {
  it("a private chat's header carries the peer's line under the name; a topic keeps its own line", () => {
    const dm = {
      kind: "DM" as const,
      peerLastSeenAt: "2026-10-31T11:00:00Z" as string | null | undefined,
      timeZone: DAMASCUS,
      me: { id: "me" } as never,
      members: [
        { id: "me", name: "أنا", online: true },
        { id: "peer", name: "هو", online: false },
      ],
    };
    const line = dmSubtitle(dm, at("2026-10-31T12:00:00Z"));
    expect(line).toBe("آخر ظهور قبل ساعة");
    const html = renderToStaticMarkup(
      React.createElement(ConversationHeader, {
        conversationId: "c1",
        title: "هو",
        subtitle: line ?? "",
        call: null,
        searching: false,
        onSearch: () => undefined,
        canSet: false,
        onSettings: () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(html).toContain("آخر ظهور قبل ساعة");
    // the peer at their screen
    expect(dmSubtitle({ ...dm, members: [{ id: "me", name: "أنا", online: true }, { id: "peer", name: "هو", online: true }] })).toBe("متصل الآن");
    // hidden: unknown
    expect(dmSubtitle({ ...dm, peerLastSeenAt: null })).toBe("غير معروف");
    // no field (switch off / older server / a topic): the header keeps the line it always had
    expect(dmSubtitle({ ...dm, peerLastSeenAt: undefined })).toBeNull();
    expect(dmSubtitle({ ...dm, kind: "TOPIC" as never })).toBeNull();
    expect(dmSubtitle(null)).toBeNull();
  });

  const profile = (extra: Partial<PublicProfile>): PublicProfile => ({
    id: "u1",
    name: "سامر",
    jobTitle: "مصمم",
    bio: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    organizationId: "o1",
    organizationName: "ذكي",
    organizationRole: "MEMBER",
    avatarUrl: null,
    stats: { ideasCreated: 0, ideasVotesReceived: 0, openTasksAssigned: 0, tasksCompleted: 0 },
    sharedSpaces: [],
    ...extra,
  });

  it("the profile card shows «آخر ظهور» of another person, «متصل الآن» when they are here, nothing on one's own page or without the field", () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    const away = renderToStaticMarkup(React.createElement(ProfileCard, { profile: profile({ lastSeenAt: recent, online: false, lastSeenTimeZone: DAMASCUS }), mine: false }));
    expect(away).toContain("data-last-seen");
    expect(away).toContain("آخر ظهور قبل 5 دقايق");
    const here = renderToStaticMarkup(React.createElement(ProfileCard, { profile: profile({ lastSeenAt: recent, online: true }), mine: false }));
    expect(here).toContain("متصل الآن");
    const hidden = renderToStaticMarkup(React.createElement(ProfileCard, { profile: profile({ lastSeenAt: null, online: false }), mine: false }));
    expect(hidden).toContain("غير معروف");
    const mine = renderToStaticMarkup(React.createElement(ProfileCard, { profile: profile({ lastSeenAt: recent }), mine: true }));
    expect(mine).not.toContain("data-last-seen");
    const absent = renderToStaticMarkup(React.createElement(ProfileCard, { profile: profile({}), mine: false }));
    expect(absent).not.toContain("data-last-seen");
    expect(absent).not.toContain("آخر ظهور");
  });
});
