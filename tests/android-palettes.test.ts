import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANDROID_PALETTES_FILE, argb, kotlinName, renderAndroidPalettes } from "@/lib/themes/android";
import { COLOR_TOKENS, PALETTES } from "@/lib/themes/palettes";
import { DEFAULT_THEME, THEME_KEYS } from "@/lib/themes/registry";
import { AR } from "@/lib/i18n/dict";

/** The Android app draws with the site's own palettes (M2 N0): one generated Kotlin file that never drifts. */
const ROOT = path.resolve(__dirname, "..");
const source = renderAndroidPalettes(AR);

describe("renderAndroidPalettes", () => {
  it("names a token as a Kotlin property and a colour as opaque ARGB", () => {
    expect(kotlinName("surface-1")).toBe("surface1");
    expect(kotlinName("bubble-out-fg")).toBe("bubbleOutFg");
    expect(kotlinName("cat-6")).toBe("cat6");
    expect(argb("#36b5cc")).toBe("0xFF36B5CC");
    expect(() => argb("#FFF")).toThrow();
  });

  it("carries every theme, in the picker's order, with every colour of its palette and its Arabic name", () => {
    let at = 0;
    for (const key of THEME_KEYS) {
      const start = source.indexOf(`key = "${key}",`);
      expect(start, key).toBeGreaterThan(at);
      at = start;
      const block = source.slice(start, source.indexOf("    ),\n", source.indexOf("colors = ZkColors(", start)));
      for (const token of COLOR_TOKENS) expect(block, `${key} ${token}`).toContain(`${kotlinName(token)} = Color(${argb(PALETTES[key].colors[token])}),`);
      expect(block).toContain(`label = "${AR[`theme.${key}`]}"`);
      expect(AR[`theme.${key}`], key).toMatch(/[؀-ۿ]/);
    }
    expect(source).toContain(`const val DEFAULT_THEME_KEY = "${DEFAULT_THEME}"`);
  });

  it("is the same text every time, LF only, ending with a newline", () => {
    expect(renderAndroidPalettes(AR)).toBe(source);
    expect(source).not.toContain("\r");
    expect(source.endsWith("\n")).toBe(true);
  });
});

describe("the committed Palettes.kt is the generated file (drift)", () => {
  it("equals renderAndroidPalettes() — after editing palettes.ts run: npx tsx scripts/build-android-palettes.mjs", () => {
    const file = readFileSync(path.join(ROOT, ANDROID_PALETTES_FILE), "utf8").replace(/\r\n/g, "\n");
    expect(file).toBe(source);
  });

  it("is UTF-8 without a byte-order mark", () => {
    const bytes = readFileSync(path.join(ROOT, ANDROID_PALETTES_FILE));
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});
