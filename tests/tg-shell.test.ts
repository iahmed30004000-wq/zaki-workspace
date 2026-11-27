import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

(globalThis as { React?: typeof React }).React = React;

import { I18nProvider } from "@/lib/i18n";
import { TelegramTabBar } from "@/components/shell/telegram-tab-bar";
import { TgPhoneProvider, TgPhoneScope } from "@/components/shell/tg-phone";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { commitsBack, COMMIT_PX } from "@/lib/chat/v2/phone/edge-swipe";
import { scrollDirection } from "@/lib/chat/v2/list-scroll";
import { matchPieces } from "@/lib/chat/match-pieces";
import { chatPrefsSchema, TG_BUBBLE_RADIUS, TG_FONT_PX } from "@/lib/chat/prefs";
import { cleanDevicePrefs, mirrorOf } from "@/lib/device-prefs";
import { bootScript } from "@/lib/themes/boot";
import { revealPolygon } from "@/lib/themes/switch-motion";
import { PALETTES } from "@/lib/themes/palettes";

/** Phases 1 and 2 of the owner's Telegram spec: the shell's look and movement on a phone, all behind «tgPhone». */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const css = SRC("app/tg-phone.css");

const bar = (on: boolean) =>
  renderToStaticMarkup(
    React.createElement(I18nProvider, {
      locale: "ar",
      children: React.createElement(TgPhoneProvider, { on, children: React.createElement(TelegramTabBar, { pathname: "/contacts", chatUnread: 0, user: { name: "سارة", avatarUrl: null } }) }),
    } as never),
  );

describe("the colours of the spec", () => {
  it("the Telegram day theme: the sent bubble, the received one, the settings background and the open tab's pill; the night one's dark ground", () => {
    expect(PALETTES["tg-day"].colors["bubble-out"]).toBe("#ECFDDB");
    expect(PALETTES["tg-day"].colors["bubble-in"]).toBe("#FFFFFF");
    expect(PALETTES["tg-day"].colors.surface).toBe("#EDEFEF");
    expect(PALETTES["tg-day"].colors["selected-row"]).toBe("#E1EFF5");
    expect(PALETTES["tg-night"].colors.surface).toBe("#1A2530");
  });
});

describe("the floating bar", () => {
  it("with the switch: one pill that stands under the open tab and moves in 120 ms; without it, the previous bar", () => {
    const on = bar(true);
    expect(on).toContain("data-tg-tab-pill");
    expect(on).toContain("--at:1");
    expect(on).toContain("bg-selected-row");
    const off = bar(false);
    expect(off).not.toContain("data-tg-tab-pill");
    expect(off).toContain("bg-accent/15");
    expect(css).toMatch(new RegExp(`\\[data-tg-tab-pill\\] \\{\\s*transition: transform ${TG_MOTION.tabSwitchMs}ms`));
  });

  it("the mark for the stylesheet exists only while the switch is on", () => {
    const draw = (on: boolean) => renderToStaticMarkup(React.createElement(TgPhoneScope, { on, bar: true, children: React.createElement("p", null, "x") }));
    expect(draw(true)).toContain('data-tg-phone=""');
    expect(draw(true)).toContain('data-tg-bar=""');
    expect(draw(false)).toBe("<p>x</p>");
  });
});

describe("the stylesheet", () => {
  const timed: [string, number][] = [
    ["zk-tg-push", TG_MOTION.openMs],
    ["zk-tg-leave", TG_MOTION.backMs],
    ["zk-tg-tab-next", TG_MOTION.tabSwitchMs],
    ["zk-tg-folder-next", TG_MOTION.folderSwitchMs],
    ["zk-tg-menu", TG_MOTION.menuScaleMs],
    ["zk-tg-ripple", TG_MOTION.rippleMs],
  ];
  it.each(timed)("%s runs for the spec's %i ms", (name, ms) => {
    expect(css).toMatch(new RegExp(`animation: ${name} ${ms}ms`));
  });

  it("the other timings: the search fade, the avatars after the slide, the menu's dim, 24px of travel", () => {
    expect(css).toContain(`animation: zk-tg-fade ${TG_MOTION.searchFadeMs}ms`);
    expect(css).toContain(`animation: zk-tg-fade ${TG_MOTION.folderAvatarsMs}ms ease-out ${TG_MOTION.folderAvatarsMs}ms both`);
    expect(css).toContain(`animation: zk-tg-fade ${TG_MOTION.menuDimMs}ms`);
    expect(css).toContain(`translateX(${TG_MOTION.openShiftPx}px)`);
  });

  it("moves nothing for somebody who asked for less movement, and holds no colour of its own", () => {
    const beforeKeyframes = css.slice(0, css.indexOf("@keyframes"));
    const calm = beforeKeyframes.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n {2}\}\n/g, "");
    expect(calm).not.toMatch(/animation:/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgb\(\s*\d/);
  });

  it("is only for a phone and only under the switch", () => {
    const rules = css
      .slice(0, css.indexOf("@keyframes"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .match(/^[ \t]*[^@{}\s][^{}]*\{/gm) ?? [];
    for (const rule of rules) expect(rule, rule).toMatch(/\[data-tg-|data-tg-doc|^\s*(from|to|\d+%)/);
    expect(css.indexOf("@media not all and (min-width: 768px)")).toBeLessThan(css.indexOf("[data-tg-phone] [data-chat-phone-screen]"));
  });
});

describe("going back", () => {
  it("a slow pull goes back only past half the screen; a quick flick still does; without the switch the old distance stands", () => {
    const width = 390;
    const commitPx = TG_MOTION.backCommitShare * width;
    expect(commitsBack({ inward: commitPx - 5, dy: 0, ms: 2000, commitPx })).toBe(false);
    expect(commitsBack({ inward: commitPx + 1, dy: 0, ms: 2000, commitPx })).toBe(true);
    expect(commitsBack({ inward: 60, dy: 0, ms: 60, commitPx })).toBe(true);
    expect(commitsBack({ inward: COMMIT_PX, dy: 0, ms: 2000 })).toBe(true);
  });
});

describe("the list", () => {
  it("scrolling down puts the buttons away, scrolling up or reaching the top brings them back, a tremble decides nothing", () => {
    expect(scrollDirection(100, 160)).toBe(true);
    expect(scrollDirection(160, 100)).toBe(false);
    expect(scrollDirection(100, 103)).toBeNull();
    expect(scrollDirection(100, 4)).toBe(false);
  });

  it("the part of a result that matched is marked, the way Arabic is typed, and the letters stay as they were", () => {
    expect(matchPieces("الإجتماع غدًا", "اجتماع")).toEqual([
      { text: "ال", match: false },
      { text: "إجتماع", match: true },
      { text: " غدًا", match: false },
    ]);
    expect(matchPieces("خطة المدرسة", "المدرسه").filter((p) => p.match)).toEqual([{ text: "المدرسة", match: true }]);
    expect(matchPieces("مَرحبا", "مرحبا")).toEqual([{ text: "مَرحبا", match: true }]);
    expect(matchPieces("صباح الخير", "مساء")).toEqual([{ text: "صباح الخير", match: false }]);
    expect(matchPieces("abc ABC", "abc").filter((p) => p.match)).toHaveLength(2);
  });
});

describe("the chat's text size and the bubble's corners", () => {
  it("are 12 to 30 and 0 to 17 on the account", () => {
    expect([TG_FONT_PX.min, TG_FONT_PX.max, TG_FONT_PX.default]).toEqual([12, 30, 16]);
    expect([TG_BUBBLE_RADIUS.min, TG_BUBBLE_RADIUS.max, TG_BUBBLE_RADIUS.default]).toEqual([0, 17, 17]);
    expect(chatPrefsSchema.safeParse({ chat: { fontPx: 22, bubbleRadius: 0 } }).success).toBe(true);
    for (const chat of [{ fontPx: 11 }, { fontPx: 31 }, { bubbleRadius: -1 }, { bubbleRadius: 18 }, { fontPx: 16.5 }]) expect(chatPrefsSchema.safeParse({ chat }).success, JSON.stringify(chat)).toBe(false);
  });

  it("reach this device's copy and are on the page before the first paint", () => {
    expect(mirrorOf({ chat: { fontPx: 22, bubbleRadius: 4 } }, 1)).toMatchObject({ fontPx: 22, bubbleRadius: 4 });
    expect(cleanDevicePrefs({ mirror: { fontPx: 99, bubbleRadius: 3 } })).toEqual({ mirror: { bubbleRadius: 3 } });
    const style: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    const html = { style: { setProperty: (k: string, v: string) => (style[k] = v), removeProperty() {} }, setAttribute: (k: string, v: string) => (attrs[k] = v), classList: { toggle() {} } };
    vm.runInNewContext(bootScript(), {
      document: { documentElement: html, cookie: "", querySelector: () => null },
      localStorage: { getItem: () => JSON.stringify({ mirror: { fontPx: 20, bubbleRadius: 8, wallpaper: "stars" } }) },
      window: {},
    });
    expect(style["--tg-font-px"]).toBe("20px");
    expect(style["--tg-bubble-radius"]).toBe("8px");
    expect(attrs["data-chat-wallpaper-chosen"]).toBe("");
    expect(css).toContain("border-radius: var(--tg-bubble-radius, 17px)");
    expect(css).toContain("font-size: var(--tg-font-px, 16px)");
  });
});

describe("night mode", () => {
  it("a clean circle: every point of the edge is the same distance from the button", () => {
    const points = [...revealPolygon(10, 20, 100, "circle", 1, 12).matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => Math.hypot(Number(m[1]) - 10, Number(m[2]) - 20));
    expect(points).toHaveLength(12);
    for (const r of points) expect(Math.abs(r - 100)).toBeLessThan(0.2);
  });

  it("the Telegram pair of themes keeps to itself", () => {
    expect(SRC("components/theme/use-theme-toggle.ts")).toContain('toDark ? (theme === "tg-day" ? "tg-night" : pref.dark) : theme === "tg-night" ? "tg-day" : "day"');
  });
});
