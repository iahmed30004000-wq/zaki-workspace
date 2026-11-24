import { describe, expect, it } from "vitest";
import {
  DECOR_COOKIE,
  DECOR_LEVELS,
  DEFAULT_DECOR,
  DEFAULT_THEME,
  PREF_COOKIE_MAX_AGE,
  THEME_COOKIE,
  THEME_KEYS,
  THEME_LIST,
  THEMES,
  decorLevelOf,
  isDarkTheme,
  isDecorLevel,
  isChosenTheme,
  isThemeKey,
  LEGACY_THEME_KEYS,
  prefCookieOptions,
  prefCookieString,
  rootThemeAttributes,
  themeLabelKey,
  themeMoodKey,
  themeOf,
} from "@/lib/themes/registry";

describe("the eight themes", () => {
  it("are exactly the eight agreed keys, in the picker's order (the two of D1, then the two of «تيليجرام»)", () => {
    expect([...THEME_KEYS]).toEqual(["night", "day", "islamic-epic", "neon-coast", "sky", "blue-night", "tg-night", "tg-day"]);
    expect(THEME_LIST.map((t) => t.key)).toEqual([...THEME_KEYS]);
  });

  it("«ليل» is the default, and it is a dark theme («نجمة وطريق», 2026-10-24)", () => {
    expect(DEFAULT_THEME).toBe("night");
    expect(isDarkTheme(DEFAULT_THEME)).toBe(true);
  });

  it("five are dark (they also carry the `dark` class); «نهار», «سماء» and «تيليجرام نهاري» are light", () => {
    expect(THEME_KEYS.filter(isDarkTheme)).toEqual(["night", "islamic-epic", "neon-coast", "blue-night", "tg-night"]);
    expect(THEME_KEYS.filter((k) => !isDarkTheme(k))).toEqual(["day", "sky", "tg-day"]);
  });

  it("«ليل», «نهار» and «إسلامي ملحمي» title in Reem Kufi, «ساحل النيون» in IBM Plex", () => {
    expect(THEMES.night.headingFont).toBe("reem-kufi");
    expect(THEMES.day.headingFont).toBe("reem-kufi");
    expect(THEMES["islamic-epic"].headingFont).toBe("reem-kufi");
    expect(THEMES["neon-coast"].headingFont).toBe("plex");
  });
});

describe("whatever was stored becomes a real theme", () => {
  it("keeps a valid key", () => {
    for (const key of THEME_KEYS) {
      expect(isThemeKey(key)).toBe(true);
      expect(themeOf(key)).toBe(key);
    }
  });

  it("maps the old light/dark/system values, garbage, nothing and non-strings to the default", () => {
    for (const value of ["system", "light", "dark", "", "ISLAMIC-CALM", " day", "neon", "<script>", "toString", "__proto__", undefined, null, 7, {}, ["day"]]) {
      expect(isThemeKey(value), String(value)).toBe(false);
      expect(isChosenTheme(value), String(value)).toBe(false);
      expect(themeOf(value), String(value)).toBe(DEFAULT_THEME);
    }
  });
});

describe("a retired theme a person may still have stored", () => {
  it("«إسلامي هادي» (islamic-calm) is read as «ليل» — the cookie and User.theme need no migration", () => {
    expect(LEGACY_THEME_KEYS).toEqual({ "islamic-calm": "night" });
    expect(isThemeKey("islamic-calm")).toBe(false);
    expect(themeOf("islamic-calm")).toBe("night");
  });

  it("and it still counts as a choice (the first-steps fact «اختار ثيمك» stays done)", () => {
    expect(isChosenTheme("islamic-calm")).toBe(true);
    for (const key of THEME_KEYS) expect(isChosenTheme(key)).toBe(true);
  });

  it("every retired key maps onto a current one", () => {
    for (const target of Object.values(LEGACY_THEME_KEYS)) expect(isThemeKey(target)).toBe(true);
    for (const old of Object.keys(LEGACY_THEME_KEYS)) expect(isThemeKey(old), old).toBe(false);
  });
});

describe("decoration level", () => {
  it("is off / light / full, light by default, and anything else is the default", () => {
    expect([...DECOR_LEVELS]).toEqual(["off", "light", "full"]);
    expect(DEFAULT_DECOR).toBe("light");
    for (const level of DECOR_LEVELS) {
      expect(isDecorLevel(level)).toBe(true);
      expect(decorLevelOf(level)).toBe(level);
    }
    for (const value of ["", "FULL", "none", undefined, null, 1]) {
      expect(isDecorLevel(value), String(value)).toBe(false);
      expect(decorLevelOf(value), String(value)).toBe("light");
    }
  });
});

describe("the attributes <html> carries for a theme", () => {
  it("names the theme and the decoration level, and asks for the dark class on dark themes only", () => {
    expect(rootThemeAttributes("islamic-epic", "full")).toEqual({ "data-theme": "islamic-epic", "data-decor": "full", dark: true });
    expect(rootThemeAttributes("day", "off")).toEqual({ "data-theme": "day", "data-decor": "off", dark: false });
  });
});

describe("the preference cookies", () => {
  it("are called zaki_theme and zk-decor", () => {
    expect(THEME_COOKIE).toBe("zaki_theme");
    expect(DECOR_COOKIE).toBe("zk-decor");
  });

  it("live one year, on every path, SameSite=Lax, and are readable by the page (it writes them too)", () => {
    expect(PREF_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
    expect(prefCookieOptions(false)).toEqual({ path: "/", maxAge: PREF_COOKIE_MAX_AGE, sameSite: "lax", httpOnly: false, secure: false });
    expect(prefCookieOptions(true).secure).toBe(true);
  });

  it("are written by the browser as one document.cookie string", () => {
    expect(prefCookieString(THEME_COOKIE, "neon-coast", false)).toBe(`zaki_theme=neon-coast; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`);
    expect(prefCookieString(DECOR_COOKIE, "off", true)).toBe(`zk-decor=off; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax; Secure`);
  });
});

describe("the Arabic name and mood of a theme", () => {
  it("are looked up under theme.<key> and theme.<key>.mood", () => {
    expect(themeLabelKey("neon-coast")).toBe("theme.neon-coast");
    expect(themeMoodKey("day")).toBe("theme.day.mood");
  });
});
