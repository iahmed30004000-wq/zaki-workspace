/**
 * «بدي الشكل اللي بالملف» (the owner, 2026-11-27): his pictures of Telegram in Arabic run the bars, the strips of tabs and the conversation LEFT TO RIGHT
 * (back at the left, the mic and the person's own messages at the right, «المحادثات» the leftmost tab) while the rows stay right to left, in the file's colours
 * whatever theme was chosen. These hold that order, on a phone, under the switch `tgPhone` only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fmtTime12 } from "@/lib/format";
import { folderSwipe } from "@/lib/chat/v2/folder-swipe";
import { placeOverlay } from "@/lib/chat/v2/menu/phone-menu";
import { renderThemesCss } from "@/lib/themes/css";
import { TG_PHONE_ART, TG_PHONE_NIGHT_THEMES } from "@/lib/themes/palettes";

const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const css = SRC("app/tg-phone.css");

describe("the order of things", () => {
  it.each([
    "header[data-pane-header]",
    "[data-composer-row]",
    "[data-message-row]",
    "[data-tg-record]",
    "[data-tg-reply-bar]",
    "[data-pinned-bar]",
    "[data-tg-voice]",
    "[data-chat-folders]",
    "[data-tg-tab-bar] ul",
    "[data-chat-phone-search]",
    "[data-settings-phone-head]",
    "[data-selection-bar]",
  ])("%s runs left to right on a phone, under the switch", (box) => {
    const block = css.slice(css.indexOf("THE ORDER OF THINGS"), css.indexOf("direction: ltr;", css.indexOf("THE ORDER OF THINGS")));
    expect(block).toContain(`[data-tg-phone] ${box},`);
  });

  it("the words inside stay right to left, and the marks the stylesheet looks for are really drawn", () => {
    expect(css).toMatch(/\[data-tg-phone\] \[data-composer-row\] textarea,[\s\S]*?direction: rtl;/);
    expect(SRC("components/chat/v2/composer/composer-surface.tsx")).toContain('data-composer-row=""');
    expect(SRC("components/chat/v2/message-bubble.tsx")).toContain('data-bubble-words=""');
  });

  it("the next folder is at the right: the finger goes left to reach it; the row's own buttons keep their side", () => {
    const base = { dy: 0, ms: 200, rtl: true, ltrTabs: true, onActionRow: false, rowOpen: false, fromStartEdge: false };
    expect(folderSwipe({ ...base, dx: -120 })).toBe("next");
    expect(folderSwipe({ ...base, dx: 120 })).toBe("prev");
    expect(folderSwipe({ ...base, dx: 120, onActionRow: true })).toBeNull();
    expect(folderSwipe({ ...base, ltrTabs: false, dx: 120 })).toBe("next");
  });

  it("my message is at the right, so its menu hangs from the right", () => {
    expect(SRC("components/chat/v2/menu/message-overlay.tsx")).toContain('align: latest.current.mine ? "right" : "left"');
    const placed = placeOverlay({ anchor: { top: 300, left: 200, width: 180, height: 40 }, viewport: { width: 390, height: 800 }, bar: { width: 300, height: 48 }, menu: { width: 224, height: 260 }, align: "right", tap: null });
    expect(placed.menu.left + 224).toBe(380);
  });
});

describe("the time, as in his pictures", () => {
  it("is the twelve-hour clock with «ص» or «م»", () => {
    expect(fmtTime12(new Date(2026, 10, 27, 18, 49))).toBe("6:49 م");
    expect(fmtTime12(new Date(2026, 10, 27, 0, 5))).toBe("12:05 ص");
    expect(fmtTime12(new Date(2026, 10, 27, 12, 0))).toBe("12:00 م");
  });
});

describe("the file's colours, whatever theme was chosen", () => {
  const sheet = renderThemesCss();
  const phone = sheet.slice(sheet.indexOf("@media not all and (min-width: 768px)"));

  it("only on a phone and only while the phone look is drawn", () => {
    expect(sheet.indexOf("data-tg-phone")).toBeGreaterThan(sheet.indexOf("@media not all and (min-width: 768px)"));
    expect(phone).toContain("html:has([data-tg-phone]) {");
  });

  it("the plain dark themes get Telegram's night; every other theme its day, with the light green bubble and the bright blue", () => {
    expect([...TG_PHONE_NIGHT_THEMES]).toEqual(["night", "blue-night", "tg-night"]);
    expect(phone).not.toContain('[data-theme="neon-coast"]');
    const day = phone.slice(0, phone.indexOf("html:has([data-tg-phone]):is("));
    expect(day).toContain("--bubble-out: 236 253 219;");
    expect(day).toContain("--tg-shape: 30 146 229;");
    expect(day).toContain("color-scheme: light;");
    expect(TG_PHONE_ART.day["tg-shape"]).toBe("#1E92E5");
  });
});
