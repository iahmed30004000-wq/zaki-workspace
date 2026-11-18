/**
 * Shared helpers of the decoration tests (tests/themes-decor-*.test.ts). Not a test file itself:
 * vitest only collects `*.test.ts`.
 *
 * Three things live here: reading the repository, colour maths the way a browser composites it, and a
 * small CSS parser (the decoration stylesheet is generated, so the tests read the RULES, not the text).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_THEME, THEME_KEYS, type ThemeKey } from "@/lib/themes/registry";

export const ROOT = path.resolve(__dirname, "..");
export const SRC = path.join(ROOT, "src");
export const DECOR_DIR = path.join(ROOT, "public", "brand", "decor");
export const DECOR_CSS_FILE = path.join(SRC, "components", "theme", "decor.css");

export const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");

/** CRLF -> LF and one trailing newline, so a Windows checkout and the Linux CI compare equal. */
export const normalizeText = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\s*$/, "\n");

/** Every .ts/.tsx file under `src` (not the tests), as paths relative to `src` with forward slashes. */
export function sourceFiles(dir: string = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(SRC, full).replace(/\\/g, "/"));
  }
  return out;
}

/** The source text without its comments, so a rule written in prose is not mistaken for a rule written in code. */
export const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ───────────────────────────── colour, the way a browser composites it ─────────────────────────────

export type Rgb = readonly [number, number, number];
export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

export const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;

const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const luminance = (c: Rgb): number => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);

/** WCAG contrast ratio of two opaque colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` laid over `bottom` at opacity `alpha` (what `rgb(x / alpha)` over an opaque picture is). */
export const over = (top: Rgb, bottom: Rgb, alpha: number): Rgb =>
  [0, 1, 2].map((i) => top[i]! * alpha + bottom[i]! * (1 - alpha)) as unknown as Rgb;

// ───────────────────────────── the palette the decoration is read against ─────────────────────────────

/** The tokens a decoration test needs, as RGB triplets (the same names as the CSS variables). */
export interface Tokens {
  surface: Rgb;
  "surface-1": Rgb;
  "surface-2": Rgb;
  fg: Rgb;
  "fg-muted": Rgb;
  muted: Rgb;
  accent: Rgb;
  "accent-fg": Rgb;
  "accent-2": Rgb;
}

/**
 * The four palettes: «ليل» and «نهار» from the «نجمة وطريق» mock-up, the other two mapped the way the
 * briefing maps the OMS palettes onto the Workspace tokens (surface <- background, surface-1 <- card,
 * surface-2 <- surface, fg <- foreground, fg-muted <- muted-foreground, accent <- primary).
 *
 * It is only the FALLBACK: `themeTokens()` reads the real values from the generated theme stylesheet
 * as soon as it exists, so a palette that the theme agent tunes is what these tests judge.
 */
const FALLBACK: Record<ThemeKey, Record<keyof Tokens, string>> = {
  night: {
    surface: "#050F1F",
    "surface-1": "#0A1A2E",
    "surface-2": "#0F2438",
    fg: "#E6F1F4",
    "fg-muted": "#AFC4CE",
    muted: "#9FB6C2",
    accent: "#36B5CC",
    "accent-fg": "#04182B",
    "accent-2": "#E3B04B",
  },
  "islamic-epic": {
    surface: "#0A1430",
    "surface-1": "#101C40",
    "surface-2": "#212C4D",
    fg: "#EEECE7",
    "fg-muted": "#C3B9A2",
    muted: "#A79F8B",
    accent: "#D4AF5A",
    "accent-fg": "#0A0A0A",
    "accent-2": "#5CC6B9",
  },
  "neon-coast": {
    surface: "#061C28",
    "surface-1": "#0B2737",
    "surface-2": "#113447",
    fg: "#EAF7F8",
    "fg-muted": "#A6C8D4",
    muted: "#7FA7B8",
    accent: "#4DD9DB",
    "accent-fg": "#05222E",
    "accent-2": "#F067AE",
  },
  day: {
    surface: "#F6F2EA",
    "surface-1": "#FFFDF8",
    "surface-2": "#EFE9DE",
    fg: "#0C3252",
    "fg-muted": "#4E5A60",
    muted: "#5E6B72",
    accent: "#1A6382",
    "accent-fg": "#FFFFFF",
    "accent-2": "#A8761F",
  },
  sky: {
    surface: "#E9EFF5",
    "surface-1": "#FFFFFF",
    "surface-2": "#EEF2F7",
    fg: "#0F1B2A",
    "fg-muted": "#44546A",
    muted: "#566676",
    accent: "#1D5BB0",
    "accent-fg": "#FFFFFF",
    "accent-2": "#A8761F",
  },
  "blue-night": {
    surface: "#0E1621",
    "surface-1": "#17212B",
    "surface-2": "#202D3B",
    fg: "#E8EEF4",
    "fg-muted": "#A9BBCC",
    muted: "#8EA3B8",
    accent: "#5AA9F0",
    "accent-fg": "#04182B",
    "accent-2": "#E3B04B",
  },
};

const TOKEN_NAMES = Object.keys(FALLBACK[DEFAULT_THEME]) as Array<keyof Tokens>;

/** `--name: R G B;` declarations of one block, by token name. */
function triplets(body: string): Partial<Record<keyof Tokens, Rgb>> {
  const out: Partial<Record<keyof Tokens, Rgb>> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:;|$)/g)) {
    const name = m[1] as keyof Tokens;
    if (TOKEN_NAMES.includes(name)) out[name] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

/** Where the palettes came from: the generated theme stylesheet when it exists, else the OMS-derived fallback. */
export function themeTokens(): { source: "themes.css" | "fallback"; byTheme: Record<ThemeKey, Tokens> } {
  const file = path.join(SRC, "app", "themes.css");
  const fallback = Object.fromEntries(
    THEME_KEYS.map((key) => [key, Object.fromEntries(TOKEN_NAMES.map((n) => [n, hexToRgb(FALLBACK[key][n])]))]),
  ) as unknown as Record<ThemeKey, Tokens>;
  if (!existsSync(file)) return { source: "fallback", byTheme: fallback };

  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Partial<Record<ThemeKey, Partial<Record<keyof Tokens, Rgb>>>> = {};
  let hit = false;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!;
    const values = triplets(m[2]!);
    if (Object.keys(values).length === 0) continue;
    for (const key of THEME_KEYS) {
      const named = new RegExp(`data-theme\\s*=\\s*["']?${key}["']?`).test(selector);
      // the default theme may be declared under `:root` / `html`
      const isRoot = key === DEFAULT_THEME && /(^|,)\s*(:root|html)\s*(,|$)/.test(selector.trim());
      if (named || isRoot) {
        found[key] = { ...(found[key] ?? {}), ...values };
        hit = true;
      }
    }
  }
  if (!hit) return { source: "fallback", byTheme: fallback };
  const merged = Object.fromEntries(THEME_KEYS.map((key) => [key, { ...fallback[key], ...(found[key] ?? {}) }])) as unknown as Record<ThemeKey, Tokens>;
  return { source: "themes.css", byTheme: merged };
}

// ───────────────────────────── a small CSS parser ─────────────────────────────

export interface CssRule {
  /** The enclosing at-rule's prelude (`@media (…)`), or null at the top level. */
  at: string | null;
  /** One selector of the rule (a rule with a selector list yields one entry per selector). */
  selector: string;
  /** The whole selector list as written. */
  selectors: string[];
  decls: Array<[prop: string, value: string]>;
}

export interface CssKeyframes {
  name: string;
  body: string;
}

function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function declsOf(body: string): Array<[string, string]> {
  return splitTop(body, ";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string];
    });
}

/** Rules (one level of @media / @supports flattened) and keyframes of a stylesheet, comments removed. */
export function parseCss(css: string): { rules: CssRule[]; keyframes: CssKeyframes[] } {
  const rules: CssRule[] = [];
  const keyframes: CssKeyframes[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const walk = (chunk: string, at: string | null) => {
    let i = 0;
    while (i < chunk.length) {
      const open = chunk.indexOf("{", i);
      if (open === -1) break;
      const prelude = chunk.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < chunk.length && depth > 0) {
        if (chunk[j] === "{") depth += 1;
        else if (chunk[j] === "}") depth -= 1;
        j += 1;
      }
      const body = chunk.slice(open + 1, j - 1);
      if (/^@(media|supports)/.test(prelude)) walk(body, prelude);
      else if (/^@keyframes/.test(prelude)) keyframes.push({ name: prelude.replace(/^@keyframes\s+/, ""), body });
      else if (prelude) {
        const selectors = splitTop(prelude, ",").map((s) => s.trim());
        for (const selector of selectors) rules.push({ at, selector, selectors, decls: declsOf(body) });
      }
      i = j;
    }
  };
  walk(text, null);
  return { rules, keyframes };
}

/** The value of a declaration in a rule, or undefined. */
export const valueOf = (rule: CssRule, prop: string): string | undefined => rule.decls.find(([p]) => p === prop)?.[1];
