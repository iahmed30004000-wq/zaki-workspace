/**
 * Colour maths for the themes, and the contrast gate every palette must pass. Pure: no React, no
 * DOM, no server imports (the palettes, the CSS generator, the Tailwind config and the tests all
 * read it). Relative imports only — the Tailwind config loads this file outside the `@/` alias.
 *
 * WCAG 2.x: relative luminance from linearised sRGB, contrast = (L1 + 0.05) / (L2 + 0.05).
 * 4.5:1 for text, 3:1 for shapes a person must see (a button's edge, a chart mark).
 */
import type { ColorToken } from "./palettes";

export type Rgb = readonly [number, number, number];

/** Body text, and anything read as text (a status word, a chip label, a link). */
export const AA_TEXT = 4.5;
/** Shapes that carry meaning: a focus ring, a filled button against the page, a chart series. */
export const AA_UI = 3;
/**
 * Two colours that must be told apart (two categories in a legend, the warning colour and the
 * action colour) are at least this far apart in OKLab. A just-noticeable difference is about 0.02;
 * 0.08 is clearly different side by side, in a 10-pixel dot, on a phone.
 */
export const DISTINCT_MIN = 0.08;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** `#RRGGBB` (either case) as 0-255 channels. Anything else throws: a typo must not become black. */
export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${JSON.stringify(hex)}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** The `R G B` triplet a Tailwind colour written as `rgb(var(--x) / <alpha-value>)` needs. */
export function hexToTriplet(hex: string): string {
  return parseHex(hex).join(" ");
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function linear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` laid at `alpha` over `bottom`, channel by channel in sRGB — what a browser paints for `bg-ok/10`. */
export function blend(top: string, alpha: number, bottom: string): string {
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex([0, 1, 2].map((i) => t[i]! * alpha + b[i]! * (1 - alpha)) as unknown as Rgb);
}

/** OKLab (Björn Ottosson, 2020): a space where equal distances look like equal differences. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How different two colours look: the Euclidean distance in OKLab (0 = the same, ~1 = black/white). */
export function deltaEOK(a: string, b: string): number {
  const p = oklab(a);
  const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ── the gate ────────────────────────────────────────────────────────────────

export type GateRule = "text" | "chip" | "ui" | "distinct" | "scrim" | "field-border";

export interface GateProblem {
  rule: GateRule;
  /** e.g. "fg-muted on surface-2" or "cat-1 ~ cat-3". */
  pair: string;
  /** The measured value: a contrast ratio, or an OKLab distance for `distinct`. */
  value: number;
  min: number;
}

/** The three page levels text is drawn on: the page, a card, a hover row or a chip's ground. */
const GROUNDS = ["surface", "surface-1", "surface-2"] as const;
/** Colours that are also used AS TEXT: links and the active tab (accent), status words, category labels. */
const TEXT_COLOURS = ["accent", "ok", "warn", "danger", "info", "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;
/** Each meaning and the text colour drawn ON it (a solid danger button, a solid status badge). */
const ON = [
  ["accent-fg", "accent"],
  ["ok-fg", "ok"],
  ["warn-fg", "warn"],
  ["danger-fg", "danger"],
  ["info-fg", "info"],
  // D1.1: the chat — an own bubble's text on it, an incoming bubble's, the selected row's, and the label of a muted unread badge (the card colour on it)
  ["bubble-out-fg", "bubble-out"],
  ["bubble-in-fg", "bubble-in"],
  ["selected-row-fg", "selected-row"],
  ["surface-1", "badge-muted"],
] as const;
/** The meanings that must never be mistaken for one another. */
const MEANINGS = ["accent", "ok", "warn", "danger", "info"] as const;
const CATS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;

/**
 * A field boundary is the only thing that shows where a field is (`bg-surface` on the page is
 * deliberately invisible), so WCAG 1.4.11 non-text contrast applies: the boundary colour must
 * clear 3:1 against every ground a field sits on. `border` is far too faint for this — the field
 * primitives use `border-muted` instead — so the gate holds `muted` to this bar in every theme,
 * and a future palette cannot quietly break the rule.
 */
export const FIELD_BORDER_MIN = AA_UI;

/** The opacity of the tinted ground a status chip is drawn on: `bg-ok/10 text-ok`. */
export const CHIP_TINT = 0.1;
/**
 * The scrim is a DARK veil in every theme. Laid at this opacity (at least) under a light caption
 * that sits on a picture, the caption reads over the worst picture there is: pure white.
 */
export const SCRIM_PANEL_ALPHA = 0.7;
/** The dialog / sheet backdrop: `bg-scrim/60`. On a light theme the dialog's card must stand out from the page dimmed by it. */
export const SCRIM_BACKDROP_ALPHA = 0.6;

/**
 * Every pair a screen actually draws, measured. Returns the failures (empty = the palette passes):
 *  - text  >= 4.5:1  fg, fg-muted and muted on the page, a card and a hover row; every colour that is
 *                    also used as text (accent, ok, warn, danger, info, cat-1..6) on the same three;
 *                    the label colour on each solid meaning (accent-fg on accent, ok-fg on ok, ...), and
 *                    the scrim's dark on the gold of accent-2 (the «جديد» button's label).
 *  - chip  >= 4.5:1  the same text colours on their OWN 10% tint over the page, a card and a hover row
 *                    (`bg-ok/10 text-ok` is how the code draws a status chip).
 *  - ui    >= 3:1    accent and accent-2 as shapes on the page and a card.
 *  - distinct        the six categorical colours, and the five meanings, pairwise >= DISTINCT_MIN.
 *  - scrim           a dark veil: darker than the page, a card and a hover row (it DIMS what is
 *                    under it); a white caption — and a dark theme's own text — on it at
 *                    SCRIM_PANEL_ALPHA over a pure white picture >= 4.5:1; on a light theme a
 *                    dialog's card against the page dimmed at SCRIM_BACKDROP_ALPHA >= 3:1.
 * `border` on the page is exempt (a border is never the only thing that shows an edge).
 */
export function checkPalette(colors: Readonly<Record<ColorToken, string>>): GateProblem[] {
  const problems: GateProblem[] = [];
  const need = (rule: GateRule, pair: string, value: number, min: number) => {
    if (value < min) problems.push({ rule, pair, value: Math.round(value * 100) / 100, min });
  };

  for (const ground of GROUNDS) {
    for (const text of ["fg", "fg-muted", "muted", ...TEXT_COLOURS] as const) {
      need("text", `${text} on ${ground}`, contrastRatio(colors[text], colors[ground]), AA_TEXT);
    }
  }
  for (const [text, ground] of ON) need("text", `${text} on ${ground}`, contrastRatio(colors[text], colors[ground]), AA_TEXT);
  // the gold button («جديد») and a wheel action under the finger are labelled in the scrim's dark
  need("text", "scrim on accent-2 (the gold button's label)", contrastRatio(colors.scrim, colors["accent-2"]), AA_TEXT);

  // a chip sits on every ground text does, a hover row (surface-2) included (review C item 15)
  for (const ground of GROUNDS) {
    for (const text of TEXT_COLOURS) {
      const tint = blend(colors[text], CHIP_TINT, colors[ground]);
      need("chip", `${text} on ${text}/10 over ${ground}`, contrastRatio(colors[text], tint), AA_TEXT);
    }
  }
  for (const ground of ["surface", "surface-1"] as const) {
    for (const shape of ["accent", "accent-2"] as const) {
      need("ui", `${shape} on ${ground}`, contrastRatio(colors[shape], colors[ground]), AA_UI);
    }
  }

  for (const group of [CATS, MEANINGS] as const) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i]!, group[j]!];
        need("distinct", `${a} ~ ${b}`, deltaEOK(colors[a], colors[b]), DISTINCT_MIN);
      }
    }
  }

  // the field-boundary rule: whatever colour the field primitives draw their border with
  // (muted, in the design) must read against every ground a field sits on (WCAG 1.4.11).
  for (const ground of GROUNDS) {
    need("field-border", `field border (muted) on ${ground}`, contrastRatio(colors.muted, colors[ground]), FIELD_BORDER_MIN);
  }

  // the focus-ring rule: the global focus ring is solid `ring-accent` (a translucent one fails
  // 3:1 on the light themes), so hold the accent to WCAG 1.4.11 on every ground a control sits on.
  for (const ground of GROUNDS) {
    need("ui", `focus ring (accent) on ${ground}`, contrastRatio(colors.accent, colors[ground]), AA_UI);
  }

  // a dark theme is one whose page is darker than its text
  const dark = relativeLuminance(colors.surface) < relativeLuminance(colors.fg);
  const scrim = relativeLuminance(colors.scrim);
  for (const ground of GROUNDS) {
    if (scrim >= relativeLuminance(colors[ground])) problems.push({ rule: "scrim", pair: `scrim darker than ${ground}`, value: 0, min: 1 });
  }
  const caption = blend(colors.scrim, SCRIM_PANEL_ALPHA, "#FFFFFF");
  need("scrim", "white caption on scrim over a white picture", contrastRatio("#FFFFFF", caption), AA_TEXT);
  // `on-photo` is the caption colour a screen writes over a picture (on its scrim panel)
  need("scrim", "on-photo on scrim over a white picture", contrastRatio(colors["on-photo"], caption), AA_TEXT);
  if (dark) {
    need("scrim", "fg on scrim over a white picture", contrastRatio(colors.fg, caption), AA_TEXT);
    // a dark theme's panel cannot be separated from the dimmed page by its FILL (the two hues
    // converge at ~1.2:1 — see PANEL_EDGE_MIN), so the panel's 1px EDGE carries that job: it is
    // drawn in `muted` (ring-1 ring-muted) and must clear 3:1 against the dimmed page.
    const dimmedDark = blend(colors.scrim, SCRIM_BACKDROP_ALPHA, colors.surface);
    need("scrim", "dialog edge (muted) on the dimmed page", contrastRatio(colors.muted, dimmedDark), AA_UI);
  } else {
    const dimmed = blend(colors.scrim, SCRIM_BACKDROP_ALPHA, colors.surface);
    need("scrim", "surface-1 (a dialog) on the dimmed page", contrastRatio(colors["surface-1"], dimmed), AA_UI);
  }
  return problems;
}
