import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MENTIONS_TOP,
  OLD_TODAY_PIECES,
  TODAY_CARD_KEYS,
  TODAY_CARD_MAX,
  TODAY_HAND_OFF,
  WAITING_TOP,
  mentionRowsOf,
  placeOfPiece,
  teamCardOf,
  teamScopeOf,
  todayLayout,
  topWaiting,
  type TodayLayoutInput,
} from "@/lib/today";
import { AR } from "@/lib/i18n/dict";

/**
 * W1.7 «اليوم» simplified: at most six cards in one fixed order, ONE team card, and a tested hand-off for everything that moved.
 * The pure rules live in src/lib/today.ts; the page's own render tests are in tests/db/today-page.test.ts.
 */

const base: TodayLayoutInput = {
  external: false,
  waiting: 3,
  mentions: 2,
  remindersOn: true,
  followUps: 0,
  checkinsOn: true,
  team: false,
  digestOn: true,
  timeOn: true,
  pinned: 1,
  projects: 2,
  glance: true,
};

describe("the six cards", () => {
  it("are, in this order: my tasks, waiting for your decision, mentions, reminders, the daily check-in, the team", () => {
    expect([...TODAY_CARD_KEYS]).toEqual(["tasks", "waiting", "mentions", "reminders", "checkin", "team"]);
    expect(TODAY_CARD_MAX).toBe(6);
    expect(todayLayout({ ...base, team: true }).cards).toEqual(["tasks", "waiting", "mentions", "reminders", "checkin", "team"]);
  });

  it("leave out a card that has nothing to say: nothing waiting, no mention", () => {
    expect(todayLayout({ ...base, waiting: 0, mentions: 0 }).cards).toEqual(["tasks", "reminders", "checkin"]);
  });

  it("the reminders card is there while the switch is on, or when a follow-up date is due even with the switch off", () => {
    expect(todayLayout({ ...base, remindersOn: false, followUps: 0 }).cards).not.toContain("reminders");
    expect(todayLayout({ ...base, remindersOn: false, followUps: 2 }).cards).toContain("reminders");
  });

  it("the daily check-in follows its switch", () => {
    expect(todayLayout({ ...base, checkinsOn: false }).cards).not.toContain("checkin");
  });

  it("an external partner gets their tasks and nothing else of the six", () => {
    expect(todayLayout({ ...base, external: true, team: true }).cards).toEqual(["tasks"]);
  });

  it("is never more than six, and always a subset of the six in their order, for every combination", () => {
    for (let mask = 0; mask < 1 << 8; mask++) {
      const bit = (i: number) => (mask & (1 << i)) !== 0;
      const input: TodayLayoutInput = {
        external: bit(0),
        waiting: bit(1) ? 4 : 0,
        mentions: bit(2) ? 4 : 0,
        remindersOn: bit(3),
        followUps: bit(4) ? 1 : 0,
        checkinsOn: bit(5),
        team: bit(6),
        digestOn: bit(7),
        timeOn: bit(7),
        pinned: bit(7) ? 1 : 0,
        projects: bit(7) ? 1 : 0,
        glance: bit(7),
      };
      const cards = todayLayout(input).cards;
      expect(cards.length).toBeLessThanOrEqual(TODAY_CARD_MAX);
      expect(cards[0]).toBe("tasks");
      const positions = cards.map((c) => TODAY_CARD_KEYS.indexOf(c));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(cards).size).toBe(cards.length);
    }
  });
});

describe("nothing is lost: what left the page has a place", () => {
  it("every part of the old page is a card, in «المزيد», a guide strip, or handed off", () => {
    for (const piece of OLD_TODAY_PIECES) expect(placeOfPiece(piece), piece).not.toBeNull();
  });

  it("the three team cards become ONE card; the owner's panel is handed to «لوحة التحكم» (/owner); digest, time, pinned, projects and the personal numbers go to «المزيد»", () => {
    const by = Object.fromEntries(TODAY_HAND_OFF.map((h) => [h.piece, h]));
    expect(by["teamPulse"]).toMatchObject({ to: "card", card: "team" });
    expect(by["dashboardTeam"]).toMatchObject({ to: "card", card: "team" });
    expect(by["controlPanel"]).toMatchObject({ to: "panel", href: "/owner" });
    for (const piece of ["digest", "time", "pinned", "projects", "dashboard"]) expect(by[piece], piece).toMatchObject({ to: "more" });
    // exactly one of the old team pieces is drawn as a card, the others fold into it
    expect(TODAY_CARD_KEYS.filter((k) => k.includes("team"))).toEqual(["team"]);
  });

  it("what sits in «المزيد» follows the same switches as before; an external partner keeps only the pinned tasks and the projects they work in", () => {
    expect(todayLayout(base).more).toEqual(["glance", "digest", "time", "pinned", "projects"]);
    expect(todayLayout({ ...base, digestOn: false, timeOn: false, pinned: 0, projects: 0, glance: false }).more).toEqual([]);
    expect(todayLayout({ ...base, external: true }).more).toEqual(["pinned", "projects"]);
  });
});

describe("«بانتظار قرارك»", () => {
  const row = (id: string, at: string) => ({ id, kind: "ticket" as const, title: `t${id}`, href: "/tickets", place: null, at });

  it("lists the five newest across the sections and keeps the real total", () => {
    const sections = [
      { total: 4, rows: [row("a", "2026-11-01T10:00:00Z"), row("b", "2026-11-05T10:00:00Z"), row("c", "2026-11-03T10:00:00Z"), row("d", "2026-11-02T10:00:00Z")] },
      { total: 3, rows: [row("e", "2026-11-09T10:00:00Z"), row("f", "2026-11-04T10:00:00Z"), row("g", "2026-11-06T10:00:00Z")] },
    ];
    const top = topWaiting(sections)!;
    expect(WAITING_TOP).toBe(5);
    expect(top.rows.map((r) => r.id)).toEqual(["e", "g", "b", "f", "c"]);
    expect(top.total).toBe(7);
  });

  it("is null when nothing waits", () => {
    expect(topWaiting([{ total: 0, rows: [] }])).toBeNull();
    expect(topWaiting([])).toBeNull();
  });
});

describe("«ذكروك»", () => {
  const conv = (over: Record<string, unknown>) => ({
    id: "c",
    kind: "TOPIC",
    title: "موضوع",
    space: { id: "s", name: "مساحة" },
    lastMessage: { at: "2026-11-01T10:00:00Z" },
    mentionsUnread: 1,
    ...over,
  });

  it("keeps only conversations with an unread mention, newest first, links into the chat, caps at five, sums the mentions", () => {
    const rows = [
      conv({ id: "a", mentionsUnread: 2, lastMessage: { at: "2026-11-02T10:00:00Z" } }),
      conv({ id: "b", mentionsUnread: 0, lastMessage: { at: "2026-11-09T10:00:00Z" } }),
      conv({ id: "c", kind: "DM", title: "سارة", space: null, mentionsUnread: 1, lastMessage: { at: "2026-11-07T10:00:00Z" } }),
      conv({ id: "d", kind: "SPACE", title: "المبيعات", mentionsUnread: 3, lastMessage: { at: "2026-11-05T10:00:00Z" } }),
      ...["e", "f", "g", "h"].map((id, i) => conv({ id, mentionsUnread: 1, lastMessage: { at: `2026-10-0${i + 1}T10:00:00Z` } })),
    ];
    const out = mentionRowsOf(rows as never)!;
    expect(MENTIONS_TOP).toBe(5);
    expect(out.rows.map((r) => r.id)).toEqual(["c", "d", "a", "h", "g"]);
    expect(out.total).toBe(2 + 1 + 3 + 4);
    expect(out.rows.find((r) => r.id === "c")!.href).toBe("/chat/c");
    expect(out.rows.find((r) => r.id === "d")!.href).toBe("/chat/s/d");
    expect(out.rows.find((r) => r.id === "a")!.place).toBe("مساحة");
  });

  it("is null when nobody mentioned the person", () => {
    expect(mentionRowsOf([conv({ mentionsUnread: 0 })] as never)).toBeNull();
    expect(mentionRowsOf([])).toBeNull();
  });
});

describe("the one team card", () => {
  it("says its scope: the company for the owner outside a space, the space inside one, the person's spaces for a people manager", () => {
    expect(teamScopeOf({ isOwner: true, spaceName: null })).toEqual({ kind: "company", name: null });
    expect(teamScopeOf({ isOwner: true, spaceName: "مبيعات" })).toEqual({ kind: "space", name: "مبيعات" });
    expect(teamScopeOf({ isOwner: false, spaceName: null })).toEqual({ kind: "spaces", name: null });
    expect(teamScopeOf({ isOwner: false, spaceName: "مبيعات" })).toEqual({ kind: "space", name: "مبيعات" });
  });

  it("is built from the dashboard's team numbers and the pulse's, and is null when there is neither", () => {
    const scope = { kind: "company", name: null } as const;
    expect(teamCardOf(null, null, scope)).toBeNull();
    const worst = [{ id: "t", title: "x", projectName: "p", assigneeName: "n", dueLabel: "أمس" }];
    expect(teamCardOf({ doneWeek: 4, dueToday: 2, peopleLate: 1 }, { open: 9, overdue: 3, worst }, scope)).toEqual({
      scope,
      open: 9,
      overdue: 3,
      doneWeek: 4,
      dueToday: 2,
      peopleLate: 1,
      worst,
    });
  });
});

describe("the page and its parts (source pins)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the page rides on navV2 and keeps the old page for the OFF case", () => {
    const page = read("src/app/(app)/page.tsx");
    expect(page).toContain('"navV2"');
    expect(page).toContain("<TeamPulse");
    expect(page).toContain("<ControlPanelHome");
  });

  it("the «اليوم» strip is still the themed decoration (calm in the flat themes by F1.7) and no today part loops an animation", () => {
    expect(read("src/components/today/today-hero.tsx")).toContain('<ThemeDecor kind="strip" />');
    for (const f of ["waiting-card", "mentions-card", "follow-ups", "team-card", "more"]) {
      const src = read(`src/components/today/${f}.tsx`);
      expect(src, f).not.toMatch(/animate-(pulse|spin|ping|bounce)|animation-iteration-count:\s*infinite/);
      expect(src, f).not.toMatch(/text-\[1[01]px\]/);
    }
  });

  it("every new string is Arabic, with no Latin letter", () => {
    const keys = Object.keys(AR).filter((k) => /^today\.(waiting|mentions|follow|team|more)\./.test(k));
    expect(keys.length).toBeGreaterThan(12);
    for (const k of keys) expect(String(AR[k as keyof typeof AR]).replace(/{[a-z]+}/g, ""), k).not.toMatch(/[A-Za-z]/);
  });
});
