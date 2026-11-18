/**
 * The four themes of the app. A pure module (no React, no server imports, no `@/` imports — the
 * Tailwind config reaches it through palettes.ts): the root layout, the client provider, the
 * decoration engine and the tests all read the theme list from here.
 *
 * A theme is the `data-theme` attribute on <html>; the dark ones also carry the `dark` class so
 * Tailwind's `dark:` variants keep working. The chosen key lives in the cookie `zaki_theme` (so the
 * server paints the right theme with no flash) and in `User.theme` (so it follows the person).
 * The colours are in palettes.ts; the stylesheet they become is src/app/themes.css (generated).
 */

/**
 * «نجمة وطريق» (the owner's adopted look, 2026-10-24): «ليل» and «نهار» replace «إسلامي هادي» and the old
 * «نهاري»; «إسلامي ملحمي» and «ساحل النيون» stay as further themes. «ليل» is everybody's default.
 */
// D1.1: «سماء» (light) and «ليل أزرق» (dark), the flat, list-first look; they are selectable like the others, and become the default of people who never chose
// a theme only when a later step connects `systemTheme()` below (there is no switch yet: a switch that did nothing would lie); `DEFAULT_THEME` stays «ليل».
export const THEME_KEYS = ["night", "day", "islamic-epic", "neon-coast", "sky", "blue-night"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

/** The night: the default for everybody who has not chosen. */
export const DEFAULT_THEME: ThemeKey = "night";

export interface ThemeInfo {
  key: ThemeKey;
  /** Dark themes also get the `dark` class. */
  dark: boolean;
  /** The face of the headings: Reem Kufi for the Islamic themes, IBM Plex Sans Arabic otherwise. */
  headingFont: "reem-kufi" | "plex";
}

export const THEMES: Record<ThemeKey, ThemeInfo> = {
  night: { key: "night", dark: true, headingFont: "reem-kufi" },
  day: { key: "day", dark: false, headingFont: "reem-kufi" },
  "islamic-epic": { key: "islamic-epic", dark: true, headingFont: "reem-kufi" },
  "neon-coast": { key: "neon-coast", dark: true, headingFont: "plex" },
  sky: { key: "sky", dark: false, headingFont: "plex" },
  "blue-night": { key: "blue-night", dark: true, headingFont: "plex" },
};

/** The themes in the order the picker shows them. */
export const THEME_LIST: readonly ThemeInfo[] = THEME_KEYS.map((key) => THEMES[key]);

/**
 * The theme of a person who never chose one (`User.theme = "system"`), NOT CONNECTED YET (D1 review: nothing calls it, the layout still says «ليل»): with `v2` false it
 * is the old default for a dark device («ليل») and «نهار» for a light one; with `v2` true the flat themes take over — «ليل أزرق» for a dark device, «سماء» for a light one (D-D1). Nobody who CHOSE a theme is moved.
 */
export function systemTheme(opts: { dark: boolean; v2: boolean }): ThemeKey {
  if (opts.v2) return opts.dark ? "blue-night" : "sky";
  return opts.dark ? DEFAULT_THEME : "day";
}

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEME_KEYS as readonly string[]).includes(value);
}

/**
 * The keys a person may still have stored from before «نجمة وطريق», and the theme each now means.
 * No migration rewrites `User.theme` or the cookie: they are read through this map.
 */
export const LEGACY_THEME_KEYS: Readonly<Record<string, ThemeKey>> = { "islamic-calm": "night" };

/**
 * Whatever was stored (`User.theme` used to hold "system" for the old light/dark/system toggle, a
 * cookie can be edited, an old key) becomes a real theme: a retired key is its successor, anything
 * else that is not one of the four is the default.
 */
export function themeOf(value: unknown): ThemeKey {
  if (isThemeKey(value)) return value;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_THEME_KEYS, value)) return LEGACY_THEME_KEYS[value]!;
  return DEFAULT_THEME;
}

/** Was a theme really chosen (a current key, or a retired one that maps on)? "system" or nothing is not a choice. */
export function isChosenTheme(value: unknown): boolean {
  return isThemeKey(value) || (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_THEME_KEYS, value));
}

export function isDarkTheme(key: ThemeKey): boolean {
  return THEMES[key].dark;
}

/** The dictionary keys of a theme's Arabic name and one-line mood (src/lib/i18n/ar.theme.json). */
export function themeLabelKey(key: ThemeKey): string {
  return `theme.${key}`;
}
export function themeMoodKey(key: ThemeKey): string {
  return `theme.${key}.mood`;
}

/**
 * The cookie that carries the theme to the server, so the first paint is already right. Not
 * httpOnly: the client provider writes it the moment somebody picks a theme, and POST /api/me/theme
 * sets it again from the server (a server-set cookie keeps its full year on Safari, which caps the
 * ones a script writes).
 */
export const THEME_COOKIE = "zaki_theme";

/** How much decoration is drawn: nothing, a light touch (default) or the full effect with slow motion. */
export const DECOR_LEVELS = ["off", "light", "full"] as const;
export type DecorLevel = (typeof DECOR_LEVELS)[number];
export const DEFAULT_DECOR: DecorLevel = "light";
export const DECOR_COOKIE = "zk-decor";

export function isDecorLevel(value: unknown): value is DecorLevel {
  return typeof value === "string" && (DECOR_LEVELS as readonly string[]).includes(value);
}

export function decorLevelOf(value: unknown): DecorLevel {
  return isDecorLevel(value) ? value : DEFAULT_DECOR;
}

/** What <html> carries for a theme and a decoration level (the root layout and the client provider agree through this). */
export function rootThemeAttributes(theme: ThemeKey, decor: DecorLevel): { "data-theme": ThemeKey; "data-decor": DecorLevel; dark: boolean } {
  return { "data-theme": theme, "data-decor": decor, dark: isDarkTheme(theme) };
}

/** Both preference cookies live a year. */
export const PREF_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** The options of a preference cookie set by the server (`response.cookies.set(name, value, options)`). */
export function prefCookieOptions(secure: boolean): {
  path: "/";
  maxAge: number;
  sameSite: "lax";
  httpOnly: false;
  secure: boolean;
} {
  return { path: "/", maxAge: PREF_COOKIE_MAX_AGE, sameSite: "lax", httpOnly: false, secure };
}

/** The same cookie as the browser writes it (`document.cookie = ...`). Values are plain keys: nothing to encode. */
export function prefCookieString(name: string, value: string, secure: boolean): string {
  return `${name}=${value}; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
