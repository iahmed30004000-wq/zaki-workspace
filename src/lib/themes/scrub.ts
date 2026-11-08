/**
 * «سحب المظهر» — the pure core of the continuous theme: a position t in [0, 1] (0 = the light theme «نهار», 1 = the person's own dark
 * theme) becomes every colour token of the app, mixed between the two palettes.
 *
 * The owner's correction to the first switch: in the reference recording you DRAG the knob and the page changes WHILE it moves.
 * This file is the maths of that; the engine that writes the numbers onto the page is src/components/theme/scrub/page-scrub.ts.
 *
 *   - colours are mixed in OKLab (equal steps look like equal steps; the muddy middle is a real mid-tone, not a flash of grey);
 *     the three surface tokens get a small warm bump in the middle so the page passes through the brown the reference passes through;
 *   - the endpoints are EXACTLY the two palettes (t = 0 and t = 1 return the stored triplets, never a round trip through OKLab);
 *   - what is not a colour (fonts, radius, shadow, color-scheme, the `dark` class) switches at the middle;
 *   - the knob's position of each look maps to t in one place (`darknessOf`): the lamp, the glass and the temperature look run
 *     night .. day left to right, the sky runs midnight .. noon and the page follows the sky's own `day` curve.
 *
 * Pure on purpose: no React, no DOM, no Math.random. `plan` is built once per drag; `scrubValues` runs once per frame.
 */
import { COLOR_TOKENS, PALETTES, STYLE_TOKENS, type ColorToken, type StyleToken } from "./palettes";
import { THEMES, type ThemeKey } from "./registry";
import { clamp01, settleTarget, skyBodies, skyMinute, springDone, springStep, type Spring } from "./switch-motion";
import type { FxGate } from "./switch-fx";
import { motionAllowed } from "./switch-fx";

export type Triplet = readonly [number, number, number];
export interface Lab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

// ── OKLab (Björn Ottosson, 2020) ────────────────────────────────────────────

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

export function toOklab(rgb: Triplet): Lab {
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function fromOklab(lab: Lab): Triplet {
  const l = Math.pow(lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b, 3);
  const m = Math.pow(lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b, 3);
  const s = Math.pow(lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b, 3);
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `#RRGGBB` (the palettes' own spelling) as a triplet. */
export function hexTriplet(hex: string): Triplet {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}

export const tripletText = (c: Triplet): string => `${c[0]} ${c[1]} ${c[2]}`;

/** The warm bump the page surfaces get half way: OKLab a (red) and b (yellow) at their peak, scaled by sin(pi t), so it is 0 at both ends. */
export const MUD = { a: 0.028, b: 0.03 } as const;

/** The tokens that carry the page (not the text or the status colours): the ones that pass through the reference's brown. */
export const MUDDY_TOKENS: readonly ColorToken[] = ["surface", "surface-1", "surface-2", "border"];

/**
 * The text-like tokens (text, muted text, the label ON a solid colour) do not fade through a grey: half way a mid-grey word on a
 * mid-brown page cannot be read. They flip across the middle fifth of the drag (a steep smoothstep), so the page is dark text on a
 * light-brown page before the middle and light text on a dark-brown one after it — as the reference's cards read at every position.
 */
export const FLIP_TOKENS: readonly ColorToken[] = ["fg", "fg-muted", "muted", "accent-fg", "ok-fg", "warn-fg", "danger-fg", "info-fg"];
export const FLIP_FROM = 0.48;
export const FLIP_TO = 0.52;

/** The share of the way a text-like token has gone at page position `t`. */
export function flipCurve(t: number): number {
  const x = clamp01((clamp01(t) - FLIP_FROM) / (FLIP_TO - FLIP_FROM));
  return x * x * (3 - 2 * x);
}

/** `a` and `b` mixed by `t` in OKLab. `mud` (0..1) adds the warm bump of the middle. */
export function mixOklab(a: Lab, b: Lab, t: number, mud = 0): Lab {
  const k = clamp01(t);
  const bump = mud * Math.sin(Math.PI * k);
  return {
    L: a.L + (b.L - a.L) * k,
    a: a.a + (b.a - a.a) * k + MUD.a * bump,
    b: a.b + (b.b - a.b) * k + MUD.b * bump,
  };
}

/** One colour between two, exactly `from` at 0 and exactly `to` at 1. */
export function scrubColor(from: Triplet, to: Triplet, t: number, mud = 0): Triplet {
  const k = clamp01(t);
  if (k === 0) return from;
  if (k === 1) return to;
  return fromOklab(mixOklab(toOklab(from), toOklab(to), k, mud));
}

// ── the plan: every token, parsed ONCE per drag ─────────────────────────────

interface ColorPlan {
  readonly name: ColorToken;
  readonly from: Triplet;
  readonly to: Triplet;
  readonly fromLab: Lab;
  readonly toLab: Lab;
  readonly mud: number;
  /** A text-like token: it flips across the middle (see FLIP_TOKENS). */
  readonly flip: boolean;
}
interface StylePlan {
  readonly name: StyleToken;
  readonly from: string;
  readonly to: string;
}

export interface ScrubPlan {
  readonly light: ThemeKey;
  readonly dark: ThemeKey;
  readonly colors: readonly ColorPlan[];
  readonly style: readonly StylePlan[];
}

/** The two themes a scrub runs between: «نهار» and a dark theme (a light `dark` argument falls back to «ليل»). */
export function planScrub(dark: ThemeKey, light: ThemeKey = "day"): ScrubPlan {
  const to = THEMES[dark].dark ? dark : "night";
  const from = THEMES[light].dark ? "day" : light;
  const a = PALETTES[from];
  const b = PALETTES[to];
  return {
    light: from,
    dark: to,
    colors: COLOR_TOKENS.map((name) => {
      const fromC = hexTriplet(a.colors[name]);
      const toC = hexTriplet(b.colors[name]);
      return { name, from: fromC, to: toC, fromLab: toOklab(fromC), toLab: toOklab(toC), mud: MUDDY_TOKENS.includes(name) ? 1 : 0, flip: FLIP_TOKENS.includes(name) };
    }),
    style: STYLE_TOKENS.map((name) => ({ name, from: a.style[name], to: b.style[name] })),
  };
}

/** One custom property of the page: `--surface` -> `5 15 31`. */
export type ScrubWrite = readonly [name: string, value: string];

/** Every colour token mixed at `t`, then the non-colour ones (they switch at the middle). */
export function scrubValues(plan: ScrubPlan, t: number): ScrubWrite[] {
  const k = clamp01(t);
  const out: ScrubWrite[] = [];
  for (const c of plan.colors) {
    const v = k === 0 ? c.from : k === 1 ? c.to : fromOklab(mixOklab(c.fromLab, c.toLab, c.flip ? flipCurve(k) : k, c.mud));
    out.push([`--${c.name}`, tripletText(v)]);
  }
  for (const s of plan.style) out.push([`--${s.name}`, k < 0.5 ? s.from : s.to]);
  return out;
}

/** Which of the two themes the page's switches (`dark` class, color-scheme) belong to at `t`. */
export function scrubSideAt(plan: ScrubPlan, t: number): { theme: ThemeKey; dark: boolean } {
  const theme = clamp01(t) < 0.5 ? plan.light : plan.dark;
  return { theme, dark: THEMES[theme].dark };
}

/** The theme a settled end means: t 0 = the light one, t 1 = the dark one. */
export const themeOfEnd = (plan: ScrubPlan, end: 0 | 1): ThemeKey => (end === 1 ? plan.dark : plan.light);

// ── a knob's position -> t ──────────────────────────────────────────────────

/** The looks that scrub the page. */
export type ScrubLook = "plain" | "glass" | "lamp" | "sky" | "warmth";

/**
 * How dark the page is for a knob at `p` (0..1, the track drawn left to right: night / moon / midnight at 0, day / sun / noon at 1).
 * The lamp, the glass and the temperature look are linear. The sky follows its own `day` curve (the page is dark through 05:30 and
 * light after 06:30), so the page and the sky art always agree.
 */
export function darknessOf(look: ScrubLook, p: number): number {
  const c = clamp01(p);
  if (look === "sky") return clamp01(1 - skyBodies(skyMinute(c)).day);
  return 1 - c;
}

/** The knob position (0..1) at which the page is half way, i.e. where a release decides «ليل» or «نهار» (the sky's is not the middle). */
export function midOf(look: ScrubLook): number {
  if (look !== "sky") return 0.5;
  // darknessOf(sky) is monotone: bisect for 0.5 (a fixed number, found once)
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (darknessOf("sky", mid) > 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The end a knob let go at `p` settles on (0 = dark end, 1 = light end), given its speed, for a look whose half-way is `mid`. */
export function settleEnd(p: number, velocity: number, mid = 0.5): 0 | 1 {
  return settleTarget(clamp01(p - mid + 0.5), velocity);
}

// ── the settle: a spring from the release to the end ────────────────────────

/** One frame of the settle (the same damped spring as the knob). `done` when the page has reached the end. */
export function settleStep(s: Spring, end: 0 | 1, dtMs: number): { spring: Spring; done: boolean } {
  const next = springStep(s, end, dtMs);
  return { spring: next, done: springDone(next, end) };
}

// ── gating ──────────────────────────────────────────────────────────────────

/**
 * May the page follow the knob? Only with the feature on, outside «وضع التوفير» and without a reduced-motion request: a full-page
 * repaint every frame is the heaviest thing this feature does. Otherwise the knob still moves and a release is one plain, instant swap.
 */
export function scrubAllowed(gate: FxGate): boolean {
  return motionAllowed(gate);
}

/** A write is only worth making when it changes a number the eye can see (a step of one level of any channel). */
export function sameWrites(a: readonly ScrubWrite[] | null, b: readonly ScrubWrite[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]?.[1] !== b[i]?.[1]) return false;
  return true;
}
