import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { PALETTES } from "@/lib/themes/palettes";
import { DEFAULT_THEME, systemTheme } from "@/lib/themes/registry";
import { bootData } from "@/lib/themes/boot";
import { featureOn } from "@/lib/features";

/**
 * Three checks below read the icon files with `sharp`, or take the colour from scripts/make-icons.mjs, which imports
 * sharp itself. ⚠️ Where sharp's native binary cannot be loaded, importing it throws, and that took the whole file
 * down - the manifest checks, which need no sharp, included. 🔧 Only those three are skipped there; the manifest is
 * still checked everywhere, and on CI tests/pwa-icons.test.ts fails when sharp does not load.
 */
const sharp = await import("sharp").then(
  (module) => module.default,
  () => null,
);
const script = sharp ? await import("../scripts/make-icons.mjs") : null;

const ROOT = path.resolve(__dirname, "..");
const m = manifest();

describe("the web app manifest (served by Next at /manifest.webmanifest)", () => {
  it("names the app: «Zaki Workspace», short name «زاكي», with an Arabic description", () => {
    expect(m.name).toBe("Zaki Workspace");
    expect(m.short_name).toBe("زاكي");
    expect(m.description).toMatch(/[؀-ۿ]/);
    // the sentence is Arabic: the brand name is the only Latin text allowed in it
    expect((m.description ?? "").replace(/Zaki Workspace|Zaki/g, "")).not.toMatch(/[A-Za-z]/);
    expect((m.description ?? "").length).toBeLessThanOrEqual(140);
  });

  it("is Arabic and right-to-left", () => {
    expect(m.lang).toBe("ar");
    expect(m.dir).toBe("rtl");
  });

  it("starts at the home page and owns the whole site", () => {
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("/");
  });

  it("opens like an app, in any direction the device is held", () => {
    expect(m.display).toBe("standalone");
    // no `orientation` lock (WP-UI2 item 7): a tablet sideways must not letterbox
    expect(m.orientation).toBeUndefined();
  });

  it("paints the splash screen and the title bar in the default theme's surface colour", () => {
    expect(m.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(m.theme_color).toBe(m.background_color);
    expect(m.background_color).toBe(PALETTES[DEFAULT_THEME].colors.surface);
  });

  it("lists 192 and 512 icons for any use and a separate 512 icon made for the maskable shape, all under /icons/", () => {
    const icons = m.icons ?? [];
    const key = (i: { sizes?: string; purpose?: string }) => `${i.sizes}:${i.purpose}`;
    expect(icons.map(key).sort()).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
    for (const icon of icons) {
      expect(icon.src, icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
      expect(icon.type).toBe("image/png");
    }
  });

  it("no icon claims two purposes: a maskable icon is drawn for the mask, an ordinary one is not", () => {
    for (const icon of m.icons ?? []) expect(icon.purpose, icon.src).toMatch(/^(any|maskable)$/);
  });

  // C4.1 — the switch `themeV2Default` (OFF by default) decides what a person who never chose a theme sees, in the browser: the installed app itself (its start page, its
  // splash and title-bar colours, the ones every device is given once at install time) is never touched by it, ON or OFF.
  describe("with the switch «المظهر الجديد كافتراضي» (themeV2Default) ON", () => {
    const on = { features: { themeV2Default: true } };

    it("the switch is OFF until the owner turns it on, and ON means ON", () => {
      expect(featureOn({}, "themeV2Default")).toBe(false);
      expect(featureOn(on, "themeV2Default")).toBe(true);
    });

    it("the manifest is the same: start_url stays `/` (M1a / D-N1), and the splash and title bar stay the default theme's surface", () => {
      expect(featureOn(on, "themeV2Default")).toBe(true);
      const after = manifest();
      expect(after.start_url).toBe("/");
      expect(after.scope).toBe("/");
      expect(after.id).toBe("/");
      expect(after.background_color).toBe(PALETTES[DEFAULT_THEME].colors.surface);
      expect(after.theme_color).toBe(after.background_color);
      expect(after).toEqual(m);
    });

    it("DEFAULT_THEME does not change; only the device's own pair does: the flat pair when ON, the old pair when OFF", () => {
      expect(DEFAULT_THEME).toBe("night");
      expect(systemTheme({ dark: true, v2: true })).toBe("blue-night");
      expect(systemTheme({ dark: false, v2: true })).toBe("sky");
      expect(systemTheme({ dark: true, v2: false })).toBe("night");
      expect(systemTheme({ dark: false, v2: false })).toBe("day");
      const data = bootData();
      expect([data.v2.dark.key, data.v2.light.key, data.v1.dark.key, data.v1.light.key]).toEqual(["blue-night", "sky", "night", "day"]);
    });
  });

  describe.skipIf(!sharp)("its icons, read with sharp (skipped only where sharp cannot be loaded)", () => {
    it("the colour the icons are drawn on (scripts/make-icons.mjs) is that same colour: change the theme's paper and the icons must be redrawn", () => {
      expect(script!.BACKGROUND.toLowerCase()).toBe(PALETTES[DEFAULT_THEME].colors.surface.toLowerCase());
    });

    it("every icon file exists, is a PNG and has the size the manifest declares", async () => {
      for (const icon of m.icons ?? []) {
        const file = path.join(ROOT, "public", icon.src.replace(/^\//, ""));
        expect(existsSync(file), file).toBe(true);
        const meta = await sharp!(file).metadata();
        expect(meta.format, icon.src).toBe("png");
        expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
      }
    });

    it("the Apple touch icon (Next serves src/app/apple-icon.png) is 180 by 180", async () => {
      const file = path.join(ROOT, "src/app/apple-icon.png");
      expect(existsSync(file)).toBe(true);
      const meta = await sharp!(file).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(180);
      expect(meta.height).toBe(180);
    });
  });
});
