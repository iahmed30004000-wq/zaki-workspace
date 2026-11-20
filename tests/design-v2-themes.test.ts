import { readFileSync, readdirSync, statSync } from "node:fs";
import { PHOTO_WALLPAPERS } from "@/lib/chat/prefs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isDarkTheme, systemTheme, THEME_KEYS } from "../src/lib/themes/registry";
import { PALETTES } from "../src/lib/themes/palettes";
import { checkPalette, contrastRatio } from "../src/lib/themes/contrast";
import { AR } from "../src/lib/i18n/dict";

/** D1.1: the two flat themes, the chat tokens in every theme, the wallpapers drawn in-house. */
describe("the default theme", () => {
  it("is still «ليل» while the switch is off: a dark device gets it, a light one «نهار»", () => {
    expect(DEFAULT_THEME).toBe("night");
    expect(systemTheme({ dark: true, v2: false })).toBe("night");
    expect(systemTheme({ dark: false, v2: false })).toBe("day");
  });
  it("with the switch ON the flat themes take over, by the device's light or dark", () => {
    expect(systemTheme({ dark: true, v2: true })).toBe("blue-night");
    expect(systemTheme({ dark: false, v2: true })).toBe("sky");
    expect(isDarkTheme(systemTheme({ dark: true, v2: true }))).toBe(true);
    expect(isDarkTheme(systemTheme({ dark: false, v2: true }))).toBe(false);
  });
  it("the two new themes are selectable and have their Arabic names", () => {
    for (const k of ["sky", "blue-night"] as const) {
      expect(THEME_KEYS).toContain(k);
      expect(AR[`theme.${k}`]).toBeTruthy();
      expect(AR[`theme.${k}.mood`]).toBeTruthy();
    }
  });
});

describe("the chat tokens", () => {
  it("every theme draws a chat: an own bubble and an incoming one that can be read, a selected row, a muted badge", () => {
    for (const key of THEME_KEYS) {
      const c = PALETTES[key].colors;
      expect(checkPalette(c), key).toEqual([]);
      expect(contrastRatio(c["bubble-out-fg"], c["bubble-out"]), `${key} own bubble`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c["bubble-in-fg"], c["bubble-in"]), `${key} incoming bubble`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c["selected-row-fg"], c["selected-row"]), `${key} selected row`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("the flat themes carry the owner's mock-up bubbles: an own bubble is a soft blue by day and a deep blue by night, an incoming one is the card colour", () => {
    expect(PALETTES.sky.colors["bubble-out"]).toBe("#D6E9FF");
    expect(PALETTES.sky.colors["bubble-in"]).toBe(PALETTES.sky.colors["surface-1"]);
    expect(PALETTES["blue-night"].colors["bubble-out"]).toBe("#2B5378");
    expect(PALETTES["blue-night"].colors["bubble-in"]).toBe("#182533");
  });
  it("the wallpaper's ink is quiet on purpose: less contrast with the wallpaper than the text has", () => {
    for (const key of THEME_KEYS) {
      const c = PALETTES[key].colors;
      expect(contrastRatio(c["chat-pattern"], c["chat-wallpaper"]), key).toBeLessThan(3);
    }
  });
});

describe("the wallpapers", () => {
  const dir = path.join(process.cwd(), "public", "brand", "wallpapers");
  const files = readdirSync(dir).filter((f) => !f.startsWith(".") && f.endsWith(".svg"));
  it("are the six agreed, drawn as vectors, each under 2 KB", () => {
    expect(files.sort()).toEqual(["boxes.svg", "bubbles.svg", "coins.svg", "leaves.svg", "phones.svg", "stars.svg"]);
    for (const f of files) expect(statSync(path.join(dir, f)).size, f).toBeLessThan(2048);
  });
  it("hold no script, no picture and no link to anywhere (they are credited as our own work)", () => {
    for (const f of files) {
      const svg = readFileSync(path.join(dir, f), "utf8");
      expect(svg, f).toMatch(/^<svg /);
      expect(svg, f).not.toMatch(/<script|<image|href=|https?:\/\/(?!www\.w3\.org)/i);
    }
  });
  it("the owner's fifteen picture wallpapers are in photo/: each has a wide, a tall and a thumbnail file, small enough to load on a phone", () => {
    const photo = path.join(dir, "photo");
    for (const key of PHOTO_WALLPAPERS) {
      for (const [suffix, max] of [["", 150], ["-tall", 150], ["-thumb", 12]] as const) {
        const f = path.join(photo, key + suffix + ".webp");
        expect(statSync(f).size, key + suffix).toBeLessThan(max * 1024);
      }
    }
    expect(readdirSync(photo).length).toBe(PHOTO_WALLPAPERS.length * 3);
  });
  it("are listed in the credits", () => {
    const credits = readFileSync(path.join(process.cwd(), "public", "brand", "CREDITS.md"), "utf8");
    expect(credits).toContain("brand/wallpapers/");
  });
});
