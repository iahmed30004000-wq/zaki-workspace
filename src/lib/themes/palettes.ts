/**
 * THE FOUR PALETTES — every colour a screen may use, per theme, by ROLE and never by look.
 *
 * Pure data and pure functions (no React, no DOM, no server imports, relative imports only: the
 * Tailwind config loads this file too). `src/app/themes.css` is GENERATED from it by
 * `npx tsx scripts/build-themes-css.mjs`, and tests/themes-css.test.ts fails while the two disagree.
 * tests/themes-palettes.test.ts runs every palette through the contrast gate (contrast.ts).
 *
 * ── Where the colours come from ──
 * «ليل» and «نهار» are the owner's adopted look «نجمة وطريق» (2026-10-24, the mock-up's values).
 * «إسلامي ملحمي» and «ساحل النيون» come from the OMS (`OMS/src/lib/system-themes.ts`), mapped onto
 * the Workspace's tokens:
 *   surface <- background · surface-1 <- card · surface-2 <- surface · border <- border
 *   fg <- foreground · fg-muted <- muted-foreground · muted <- muted (the dimmer grey, still 4.5:1)
 *   accent <- primary · accent-fg <- primary-foreground · ok <- success · warn <- warning
 *   danger <- destructive · cat-1..6 <- the chart series (re-picked where two were twins, below)
 * and four roles the OMS does not have:
 *   accent-2  the theme's second accent: the star's gold (night, day), turquoise (epic), the rose
 *             neon (neon-coast). A shape colour (3:1), not a text colour.
 *   info      a blue that fits the theme and is clearly not its accent.
 *   *-fg      the label colour ON a solid meaning (a solid danger button): white on the light
 *             themes, the page's own dark on the dark ones.
 *   on-photo  the caption colour written over a picture, on its scrim panel: white in every theme.
 *   scrim     a DARK veil, tinted to the theme, in every theme: the dialog / sheet backdrop
 *             (`bg-scrim/60`, SCRIM_BACKDROP_ALPHA) and the panel under a light caption on a photo
 *             (at least SCRIM_PANEL_ALPHA). It dims; it never lightens. (Dark text over a picture on
 *             a light theme sits on a `--surface` panel instead — the decoration layer does that.)
 *
 * ── Where they were moved, and why (each move is the smallest that passes, along the colour's own hue) ──
 * The gate in contrast.ts is stricter than the OMS's on two points the Workspace's code needs:
 *  1. Status colours and categories are drawn as TEXT on their own 10% tint (`bg-ok/10 text-ok`) —
 *     the colour codemod turns every `text-emerald-600` / `text-violet-500` into exactly that. So the
 *     light themes' ok/warn/danger and some categories are a few steps darker than the OMS's, and
 *     the dark themes' danger and some categories a few steps lighter.
 *  2. Six categories must be six different colours: the OMS series had twins (calm chart-1/chart-3
 *     are both purple, 0.044 apart; neon chart-4/chart-6 0.057). The set is now, in every theme, one
 *     colour per family, in this order: 1 violet · 2 fuchsia · 3 rose · 4 teal/cyan · 5 lime/olive ·
 *     6 indigo — the order the colour codemod maps violet, fuchsia, rose (and pink), teal, lime and
 *     purple onto.
 *  3. The chip is held on all three grounds, the hover row (surface-2) too (review C item 15): the
 *     colours that failed only there moved by the smallest step along their own hue (OKLab lightness, mostly alone).
 *  Also: «إسلامي ملحمي»'s warning moved from amber toward orange (the OMS amber was 0.058 from the
 *  theme's own gold: a warning that looks like the action colour).
 */
import { DEFAULT_THEME, type ThemeKey } from "./registry";
import { SCRIM_BACKDROP_ALPHA, SCRIM_PANEL_ALPHA, hexToTriplet } from "./contrast";

export { SCRIM_BACKDROP_ALPHA, SCRIM_PANEL_ALPHA };

/** The colour tokens, in the order they are written. Tailwind exposes each as `bg-x`, `text-x`, `border-x/40`, ... */
export const COLOR_TOKENS = [
  "surface",
  "surface-1",
  "surface-2",
  "border",
  "muted",
  "fg",
  "fg-muted",
  "accent",
  "accent-fg",
  "accent-2",
  "ok",
  "warn",
  "danger",
  "info",
  "ok-fg",
  "warn-fg",
  "danger-fg",
  "info-fg",
  "scrim",
  "cat-1",
  "cat-2",
  "cat-3",
  "cat-4",
  "cat-5",
  "cat-6",
  "on-photo",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** The categorical colours (labels, departments, chart series): 1 violet · 2 fuchsia · 3 rose · 4 teal · 5 lime · 6 indigo. */
export const CAT_TOKENS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;

/** The per-theme values that are not colours. */
export const STYLE_TOKENS = ["font-display", "radius-card", "shadow-card"] as const;
export type StyleToken = (typeof STYLE_TOKENS)[number];

export interface Palette {
  /** `#RRGGBB`, upper case. The stylesheet carries them as `R G B` triplets. */
  colors: Record<ColorToken, string>;
  style: Record<StyleToken, string>;
}

/**
 * Titles. IBM Plex Sans Arabic is the body face of every theme; Reem Kufi (public/fonts, SIL OFL,
 * loaded by the root layout through next/font/local with preload off, so only an Islamic theme
 * ever downloads it) is the face of the Islamic themes' h1-h3. Each `var()` carries a fallback so a
 * page rendered without the font classes still gets a valid stack.
 */
const PLEX_STACK = 'var(--font-plex, "IBM Plex Sans Arabic"), "Segoe UI", Tahoma, sans-serif';
const KUFI_STACK = `var(--font-reem, "Reem Kufi"), ${PLEX_STACK}`;

export const PALETTES: Record<ThemeKey, Palette> = {
  /** «ليل» — «نجمة وطريق» by night: deep navy, cyan, gold stars. Dark. The default. */
  night: {
    colors: {
      surface: "#050F1F",
      "surface-1": "#0A1A2E",
      "surface-2": "#0F2438",
      border: "#1C3A52",
      muted: "#9FB6C2",
      fg: "#E6F1F4",
      "fg-muted": "#AFC4CE",
      accent: "#36B5CC",
      "accent-fg": "#04182B",
      "accent-2": "#E3B04B", // the star's gold, as a shape
      ok: "#24DB70",
      warn: "#E98E3F",
      danger: "#F57B7E",
      info: "#8FA8FF",
      "ok-fg": "#04182B",
      "warn-fg": "#04182B",
      "danger-fg": "#04182B",
      "info-fg": "#04182B",
      scrim: "#030812", // the night under the navy
      "cat-1": "#AE7CF0", // violet
      "cat-2": "#DF67CB", // fuchsia
      "cat-3": "#F486AD", // rose
      "cat-4": "#62C6DA", // cyan
      "cat-5": "#AED561", // lime
      "cat-6": "#768EF9", // indigo (a hair lighter: the chip on a hover row)
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "1.125rem",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.52), 0 1px 3px rgb(0 0 0 / 0.30)",
    },
  },

  /** «نهار» — «نجمة وطريق» by day: warm paper, petrol blue, a deep gold. Light. */
  day: {
    colors: {
      surface: "#F6F2EA",
      "surface-1": "#FFFDF8",
      "surface-2": "#EFE9DE",
      border: "#D8CEBC",
      muted: "#5E6B72",
      fg: "#0C3252",
      "fg-muted": "#4E5A60",
      accent: "#1A6382",
      "accent-fg": "#FFFFFF",
      "accent-2": "#A8761F", // the star's gold, deepened for paper
      ok: "#146F33", // darker: the chip must clear 4.5:1 on the warm hover row
      warn: "#8D5308", // darker, same reason
      danger: "#B42318",
      info: "#094982",
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      scrim: "#0A1625", // the navy of the text, deepened — and the label on the gold «جديد» (4.5:1)
      "cat-1": "#624F91", // violet
      "cat-2": "#9A3B8B", // fuchsia
      "cat-3": "#8F4A62", // rose
      "cat-4": "#086A79", // teal
      "cat-5": "#56661A", // olive
      "cat-6": "#384DB8", // indigo
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "1.125rem",
      "shadow-card": "0 1px 2px rgb(12 50 82 / 0.06), 0 1px 3px rgb(12 50 82 / 0.08)",
    },
  },

  /** «إسلامي ملحمي» — night navy and gold, turquoise as the second accent. Dark. */
  "islamic-epic": {
    colors: {
      surface: "#0A1430",
      "surface-1": "#101C40",
      "surface-2": "#212C4D",
      border: "#404966",
      muted: "#A79F8B",
      fg: "#EEECE7",
      "fg-muted": "#C3B9A2",
      accent: "#D4AF5A",
      "accent-fg": "#0A0A0A",
      "accent-2": "#5CC6B9", // turquoise (new): the tile beside the gold
      ok: "#24DB70",
      warn: "#E98E3F", // OMS #DB9824 turned toward orange: it was the gold's twin
      danger: "#F57B7E", // OMS #E4585D, lightened further: the 10% chip must clear 4.5:1 on surface-2
      info: "#62A8DA", // sky (OMS chart-2)
      "ok-fg": "#0A1430",
      "warn-fg": "#0A1430",
      "danger-fg": "#0A1430",
      "info-fg": "#0A1430",
      scrim: "#050B1C", // the night under the navy
      "cat-1": "#BB89FE", // violet (OMS chart-3's family, lighter; lighter again for the chip on surface-2)
      "cat-2": "#EC73D7", // fuchsia (OMS chart-4, lighter: the chip on surface-2)
      "cat-3": "#F486AD", // rose (new)
      "cat-4": "#62C6DA", // cyan (OMS chart-5)
      "cat-5": "#AED561", // lime (new)
      "cat-6": "#849CFF", // indigo (OMS chart-6 #6262DA, lighter: the chip on surface-2)
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "0.75rem",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.52), 0 1px 3px rgb(0 0 0 / 0.30)",
    },
  },

  /** «ساحل النيون» — a coast after sunset: teal-black, aqua neon and rose neon. Dark. Original work. */
  "neon-coast": {
    colors: {
      surface: "#061C28",
      "surface-1": "#0B2737",
      "surface-2": "#113447",
      border: "#20506A",
      muted: "#7FA7B8",
      fg: "#EAF7F8",
      "fg-muted": "#A6C8D4",
      accent: "#4DD9DB",
      "accent-fg": "#05222E",
      "accent-2": "#F067AE", // the rose neon (OMS chart-2 #E75FA6, a step lighter)
      ok: "#4FC27C",
      warn: "#EAA23A",
      danger: "#FA7C76", // OMS #F0625C, lightened further: the 10% chip must clear 4.5:1 on surface-2
      info: "#6FB0E0", // sky (OMS chart-4)
      "ok-fg": "#05222E",
      "warn-fg": "#05222E",
      "danger-fg": "#05222E",
      "info-fg": "#05222E",
      scrim: "#03121A", // the sea at night
      "cat-1": "#CCABF3", // lavender-violet (OMS chart-5, a hair lighter: kept apart from cat-6)
      "cat-2": "#E27EE8", // fuchsia (new)
      "cat-3": "#FC72B9", // rose: the theme's rose neon, lighter for the chip on surface-2
      "cat-4": "#4DD9DB", // aqua: the theme's own aqua neon (OMS chart-1)
      "cat-5": "#B3DC5E", // lime (new)
      "cat-6": "#989EFB", // periwinkle-indigo (OMS chart-3, lighter: the chip on surface-2)
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": PLEX_STACK,
      "radius-card": "0.875rem",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.66), 0 1px 3px rgb(0 0 0 / 0.44)",
    },
  },
};

/**
 * The ILLUSTRATION colours of «مظهر المفتاح» (src/lib/themes/switch-fx.ts): the sky, the sun and moon, the lamp's rays, the sparks,
 * the glass' edge, and the two tints laid over the app. They are art, not interface: never text, never behind a number, an amount or
 * a table (the switch's own pill and the settings preview are the only places they appear), so they are NOT in COLOR_TOKENS (no
 * Tailwind utility, no contrast gate) and are written as `--fx-*` variables the stylesheet src/components/theme/switch-fx.css reads.
 * The sky is its own scene — a midnight sky stays a midnight sky inside the light theme's pill — so most values are shared; the
 * Islamic and neon themes tint the aurora and the sun toward their own accents.
 */
export const FX_TOKENS = [
  "fx-warm",
  "fx-cool",
  "fx-sky-night-top",
  "fx-sky-night-low",
  "fx-sky-day-top",
  "fx-sky-day-low",
  "fx-sun",
  "fx-moon",
  "fx-star",
  "fx-aurora-a",
  "fx-aurora-b",
  "fx-cloud",
  "fx-hill-far",
  "fx-hill-near",
  "fx-lamp-ray",
  "fx-spark",
  "fx-glass-edge",
  "fx-glass-glow",
] as const;
export type FxToken = (typeof FX_TOKENS)[number];

const FX_BASE: Record<FxToken, string> = {
  "fx-warm": "#FFB45C", // the warm tint: an amber lamp
  "fx-cool": "#6FA8FF", // the cool tint: a clear morning blue
  "fx-sky-night-top": "#0B1230",
  "fx-sky-night-low": "#2A2A5C",
  "fx-sky-day-top": "#5AA9E6",
  "fx-sky-day-low": "#CFE8F7",
  "fx-sun": "#FFC94A",
  "fx-moon": "#E8EAF2",
  "fx-star": "#FFF6D8",
  "fx-aurora-a": "#4FD8A0",
  "fx-aurora-b": "#8A6BE8",
  "fx-cloud": "#FFFFFF",
  "fx-hill-far": "#2B3560",
  "fx-hill-near": "#171C3A",
  "fx-lamp-ray": "#FFD27A",
  "fx-spark": "#FFC866",
  "fx-glass-edge": "#FFFFFF",
  "fx-glass-glow": "#FFE9B0",
};

export const FX_COLORS: Record<ThemeKey, Record<FxToken, string>> = {
  night: FX_BASE,
  day: { ...FX_BASE, "fx-hill-far": "#6F86B3", "fx-hill-near": "#41507E", "fx-glass-glow": "#FFF1CC" },
  "islamic-epic": { ...FX_BASE, "fx-sun": "#E6C070", "fx-aurora-a": "#5CC6B9", "fx-lamp-ray": "#E6C070", "fx-spark": "#D4AF5A" },
  "neon-coast": { ...FX_BASE, "fx-aurora-a": "#4DD9DB", "fx-aurora-b": "#F067AE", "fx-spark": "#4DD9DB", "fx-glass-glow": "#BFF3F4" },
};

/** The illustration colours of one theme as CSS custom properties (`R G B` triplets), written after the interface tokens. */
export function themeFxVariables(key: ThemeKey): Array<[string, string]> {
  return FX_TOKENS.map((token): [string, string] => [`--${token}`, hexToTriplet(FX_COLORS[key][token])]);
}

/** One theme as CSS custom properties, in a fixed order: colours as `R G B` triplets, then the style values. */
export function themeVariables(key: ThemeKey): Array<[string, string]> {
  const { colors, style } = PALETTES[key];
  return [
    ...COLOR_TOKENS.map((token): [string, string] => [`--${token}`, hexToTriplet(colors[token])]),
    ...STYLE_TOKENS.map((token): [string, string] => [`--${token}`, style[token]]),
  ];
}

/** The browser chrome colour (`<meta name="theme-color">`) of a theme: its page colour. */
export function themeColorOf(key: ThemeKey): string {
  return PALETTES[key].colors.surface;
}

/** The default theme's palette — what an unthemed page (`:root`) shows. */
export const DEFAULT_PALETTE: Palette = PALETTES[DEFAULT_THEME];
