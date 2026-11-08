/**
 * «مظهر المفتاح» — the pure core of the light/dark switch and its four optional looks.
 *
 * Pure on purpose (no React, no DOM, no server imports; relative imports only): the root layout, the
 * client switch, the API route and the tests all read the same rules from here.
 *
 *   plain   the compact switch (the default): «نهار» <-> the person's own dark theme.
 *   glass   «زجاج»: the same switch with a glass knob. Real refraction only where the browser can do it.
 *   lamp    «لمبة»: a slider whose knob is a lamp; dragging sets how bright the whole app is.
 *   sky     «سما»: a draggable sky; scrubbing it from midnight to noon flips «نهار» / dark at 06:00 and 18:00.
 *   warmth  «حرارة اللون»: a cool <-> warm slider; a gentle tint over the app. Reset puts it back to nothing.
 *
 * What is stored per person (`User.themeSwitch`, mirrored in the cookie `zk-switch` so the first frame
 * is already right): the style, the two numbers and the dark theme to come back to — nothing else.
 * ⚠️ The tint changes the colours of the whole screen a little. 🔧 It is capped, only the chosen style
 * draws it, «رجّع» clears it, and the feature switch `themeSwitchFx` removes it for everybody.
 */
import { THEMES, isThemeKey, themeOf, type ThemeKey } from "./registry";

export const SWITCH_STYLES = ["plain", "glass", "lamp", "sky", "warmth"] as const;
export type SwitchStyle = (typeof SWITCH_STYLES)[number];
export const DEFAULT_SWITCH_STYLE: SwitchStyle = "plain";

export function isSwitchStyle(value: unknown): value is SwitchStyle {
  return typeof value === "string" && (SWITCH_STYLES as readonly string[]).includes(value);
}

/** The cookie that carries the choice to the server (same year-long, script-readable cookie as the theme's). */
export const SWITCH_COOKIE = "zk-switch";

export const BRIGHTNESS_MIN = 40;
export const BRIGHTNESS_MAX = 100;
export const WARMTH_MIN = -100;
export const WARMTH_MAX = 100;

export interface SwitchPref {
  style: SwitchStyle;
  /** 40..100 (%): the lamp's light. 100 = the app as it is. */
  brightness: number;
  /** -100 (cool) .. 100 (warm). 0 = the app as it is. */
  warmth: number;
  /** The dark theme the switch goes back to when the person turns the light off. */
  dark: ThemeKey;
}

export const DEFAULT_DARK_THEME: ThemeKey = "night";
export const DEFAULT_SWITCH_PREF: SwitchPref = { style: DEFAULT_SWITCH_STYLE, brightness: BRIGHTNESS_MAX, warmth: 0, dark: DEFAULT_DARK_THEME };

export function clampBrightness(value: number): number {
  if (!Number.isFinite(value)) return BRIGHTNESS_MAX;
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, Math.round(value)));
}

export function clampWarmth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(WARMTH_MAX, Math.max(WARMTH_MIN, Math.round(value)));
}

/** A dark theme (kept as the one to come back to); a light one or anything unknown is the default dark theme. */
export function darkThemeOf(value: unknown): ThemeKey {
  const key = themeOf(value);
  return THEMES[key].dark ? key : DEFAULT_DARK_THEME;
}

/** `style.brightness.warmth.dark`, e.g. `warmth.70.-35.night`: letters, digits, dots and a minus — safe in a cookie. */
export const SWITCH_PREF_PATTERN = /^([a-z]+)\.(\d{1,3})\.(-?\d{1,3})\.([a-z-]+)$/;

export function serializeSwitchPref(pref: SwitchPref): string {
  return `${pref.style}.${clampBrightness(pref.brightness)}.${clampWarmth(pref.warmth)}.${darkThemeOf(pref.dark)}`;
}

/** Whatever was stored (cookie, column) becomes a real choice; anything broken or hostile is the default. */
export function parseSwitchPref(raw: unknown): SwitchPref {
  if (typeof raw !== "string") return DEFAULT_SWITCH_PREF;
  const m = SWITCH_PREF_PATTERN.exec(raw);
  if (!m || !isSwitchStyle(m[1])) return DEFAULT_SWITCH_PREF;
  return {
    style: m[1],
    brightness: clampBrightness(Number(m[2])),
    warmth: clampWarmth(Number(m[3])),
    dark: isThemeKey(m[4]) ? darkThemeOf(m[4]) : DEFAULT_DARK_THEME,
  };
}

// ── the tint ────────────────────────────────────────────────────────────────

/** The most the lamp may dim the app, the most a warm tint may colour it, the most a cool one may. Gentle on purpose: text stays readable. */
export const DIM_MAX = 0.36;
export const WARM_MAX = 0.18;
export const COOL_MAX = 0.14;

export interface TintVars {
  dim: number;
  warm: number;
  cool: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** The overlay's three opacities. Only the lamp dims and only «حرارة اللون» tints: the numbers kept from another style do nothing. */
export function tintOf(pref: SwitchPref): TintVars {
  const dim = pref.style === "lamp" ? ((BRIGHTNESS_MAX - clampBrightness(pref.brightness)) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN)) * DIM_MAX : 0;
  const w = pref.style === "warmth" ? clampWarmth(pref.warmth) : 0;
  return { dim: round3(dim), warm: round3(w > 0 ? (w / WARMTH_MAX) * WARM_MAX : 0), cool: round3(w < 0 ? (-w / WARMTH_MAX) * COOL_MAX : 0) };
}

/** The overlay's variables, or nothing at all when there is nothing to draw. */
export function tintStyle(pref: SwitchPref): Record<"--zk-dim" | "--zk-warm" | "--zk-cool", string> | undefined {
  const t = tintOf(pref);
  if (t.dim === 0 && t.warm === 0 && t.cool === 0) return undefined;
  return { "--zk-dim": String(t.dim), "--zk-warm": String(t.warm), "--zk-cool": String(t.cool) };
}

// ── the sky ─────────────────────────────────────────────────────────────────

/** Day is 06:00 up to 18:00 (minutes of the day); the sky flips the theme at exactly these two moments. */
export const DAY_START = 6 * 60;
export const DAY_END = 18 * 60;
const DAY_MINUTES = 24 * 60;

export function isDayMinute(minute: number): boolean {
  return minute >= DAY_START && minute < DAY_END;
}

export function themeForMinute(minute: number, dark: ThemeKey): ThemeKey {
  return isDayMinute(minute) ? "day" : darkThemeOf(dark);
}

/** Where the sky rests for a theme: noon for the light one, midnight for a dark one. */
export function minuteForTheme(theme: ThemeKey): number {
  return THEMES[theme].dark ? 0 : 12 * 60;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** A drag position 0..1 (midnight .. the minute before midnight) as a minute of the day. */
export function minuteOf(position: number): number {
  return Math.round(clamp01(position) * (DAY_MINUTES - 1));
}

export function positionOfMinute(minute: number): number {
  return clamp01(minute / (DAY_MINUTES - 1));
}

export const SKY_PHASES = ["midnight", "dawn", "morning", "noon", "afternoon", "sunset", "night"] as const;
export type SkyPhase = (typeof SKY_PHASES)[number];

/** The name of the time of day (its words are `themeSwitch.sky.<phase>`). Morning..sunset are exactly the light theme's hours. */
export function skyPhase(minute: number): SkyPhase {
  const m = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (m < 60) return "midnight";
  if (m < 270) return "night";
  if (m < DAY_START) return "dawn";
  if (m < 11 * 60) return "morning";
  if (m < 14 * 60) return "noon";
  if (m < 17 * 60) return "afternoon";
  if (m < DAY_END) return "sunset";
  if (m < 23 * 60) return "night";
  return "midnight";
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** 0 = the night scene, 1 = the day scene, easing across the hour around each threshold. */
export function sceneBlend(minute: number): number {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return round3(smooth(330, 390, m) * (1 - smooth(1050, 1110, m)));
}

export interface Body {
  /** 0..100 across the window, 0 = the start side. */
  x: number;
  /** 0..100 down the window. */
  y: number;
  visible: boolean;
}

/** Where the sun and the moon are in the window (a 0..100 box) for a minute of the day. */
export function bodyArcs(minute: number): { sun: Body; moon: Body } {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const arc = (t: number): { x: number; y: number } => {
    const c = clamp01(t);
    return { x: round3(c * 100), y: round3(70 - 55 * Math.sin(Math.PI * c)) };
  };
  const sunT = (m - DAY_START) / (DAY_END - DAY_START);
  const moonT = (((m - DAY_END) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES / (DAY_MINUTES / 2);
  return {
    sun: { ...arc(sunT), visible: m >= 330 && m <= 1110 },
    moon: { ...arc(moonT), visible: m <= 390 || m >= 1050 },
  };
}

// ── pointers and keys ───────────────────────────────────────────────────────

export type Direction = "rtl" | "ltr";

/** Where a pointer is on a track, 0 at the START of the reading direction (the right edge in this app) and 1 at its end. */
export function pFromPointer(clientX: number, rect: { left: number; right: number; width: number }, dir: Direction): number {
  if (!(rect.width > 0)) return 0;
  return clamp01(((dir === "rtl" ? rect.right - clientX : clientX - rect.left)) / rect.width);
}

/** A switch's keys: the arrow toward the END of the line turns it on («ليل»), the other turns it off; Home/End are the two ends. Enter and Space are the button's own click (null). */
export function arrowToDark(key: string, dir: Direction): boolean | null {
  if (key === "Home") return false;
  if (key === "End") return true;
  if (key === "ArrowLeft") return dir === "rtl";
  if (key === "ArrowRight") return dir === "ltr";
  return null;
}

export interface SliderRange {
  min: number;
  max: number;
  step: number;
  big: number;
}

/** A slider's keys; up and the arrow toward the end of the line increase. Null for a key that is not the slider's. */
export function sliderStep(key: string, value: number, range: SliderRange, dir: Direction): number | null {
  const toward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const away = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
  let next: number;
  if (key === "ArrowUp" || key === toward) next = value + range.step;
  else if (key === "ArrowDown" || key === away) next = value - range.step;
  else if (key === "PageUp") next = value + range.big;
  else if (key === "PageDown") next = value - range.big;
  else if (key === "Home") next = range.min;
  else if (key === "End") next = range.max;
  else return null;
  return Math.min(range.max, Math.max(range.min, next));
}

// ── gating: the feature switch, «وضع التوفير», prefers-reduced-motion ───────

export interface FxGate {
  /** The company's `themeSwitchFx` switch. */
  fxOn: boolean;
  /** «وضع التوفير». */
  economy: boolean;
  /** The person's `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
}

/** The feature OFF means the plain switch and nothing else, whatever was chosen. */
export function effectiveStyle(style: SwitchStyle, gate: FxGate): SwitchStyle {
  return gate.fxOn ? style : "plain";
}

/** Decorative motion (reveal, sparks, rays, twinkle): needs the feature, no economy mode and no reduced-motion request. */
export function motionAllowed(gate: FxGate): boolean {
  return gate.fxOn && !gate.economy && !gate.reducedMotion;
}

/** The hard ceiling on particles anywhere in this feature. */
export const MAX_PARTICLES = 60;

export function particleBudget(gate: FxGate, wanted: number): number {
  if (!motionAllowed(gate) || !Number.isFinite(wanted)) return 0;
  return Math.min(MAX_PARTICLES, Math.max(0, Math.round(wanted)));
}

/** The glass refracts only on a Chromium engine (the SVG filter inside `backdrop-filter`) and only while motion is allowed; elsewhere it is the flat knob. */
export function glassAllowed(gate: FxGate, chromium: boolean): boolean {
  return chromium && motionAllowed(gate);
}

// ── seeded randomness (a render never calls Math.random) ────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SparkSeed {
  /** Radians. */
  angle: number;
  /** 0.4..1: a share of the maximum distance. */
  speed: number;
  /** 1..3 px. */
  size: number;
  /** 0.5..1: a share of the animation's length. */
  life: number;
}

export function sparkSeeds(count: number, seed: number): SparkSeed[] {
  const n = Math.min(MAX_PARTICLES, Math.max(0, Math.round(Number.isFinite(count) ? count : 0)));
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => ({
    angle: rand() * Math.PI * 2,
    speed: 0.4 + rand() * 0.6,
    size: 1 + rand() * 2,
    life: 0.5 + rand() * 0.5,
  }));
}

// ── the ragged reveal ───────────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * A circle of `radius` around (cx, cy) with a torn edge: `points` vertices, each pushed in or out by up to 14%.
 * Every size has the same number of vertices, so `clip-path` can animate from radius 0 to the full reveal.
 */
export function raggedCircle(cx: number, cy: number, radius: number, points = 36, seed = 1): string {
  const rand = mulberry32(seed);
  const vertices: string[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = radius * (1 + (rand() * 2 - 1) * 0.14);
    vertices.push(`${round1(cx + r * Math.cos(angle))}px ${round1(cy + r * Math.sin(angle))}px`);
  }
  return `polygon(${vertices.join(", ")})`;
}

/** The radius that covers the whole viewport from (cx, cy) even where the edge is torn inward. */
export function revealRadius(cx: number, cy: number, width: number, height: number): number {
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy));
  return Math.ceil(far * 1.2);
}

// ── track positions <-> values ──────────────────────────────────────────────

/** 0 (the start of the track) is the dimmest, 1 the brightest; the top of the track snaps to a full 100%. */
export function brightnessOfPosition(position: number): number {
  const b = BRIGHTNESS_MIN + clamp01(position) * (BRIGHTNESS_MAX - BRIGHTNESS_MIN);
  return clampBrightness(b >= BRIGHTNESS_MAX - 1.5 ? BRIGHTNESS_MAX : b);
}

export function positionOfBrightness(brightness: number): number {
  return round3((clampBrightness(brightness) - BRIGHTNESS_MIN) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN));
}

/** 0 is the coolest, 1 the warmest; the middle of the track is a sticky 0 (no tint at all). */
export function warmthOfPosition(position: number): number {
  const w = clampWarmth((clamp01(position) * 2 - 1) * WARMTH_MAX);
  return Math.abs(w) <= 4 ? 0 : w;
}

export function positionOfWarmth(warmth: number): number {
  return round3((clampWarmth(warmth) - WARMTH_MIN) / (WARMTH_MAX - WARMTH_MIN));
}

/** `08:05` — a minute of the day for the sky's label (Western digits; the page's digit setting restyles them). */
export function clockOf(minute: number): string {
  const m = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
