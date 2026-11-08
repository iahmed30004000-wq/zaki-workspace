/**
 * «مفاتيح المظهر» — the pure motion maths of the exact showcase variants (glass, lamp, repaint, ink, sky, colour temperature).
 *
 * Pure on purpose (no React, no DOM, no Math.random: a render and a test see the same numbers). The numbers here were read off the
 * 49-second recording the owner chose as the reference (docs/THEME-SWITCH-FX.md lists which frame each one comes from):
 *
 *   - the knob follows the pointer with a short lag and, once released, settles on the nearer end with a little overshoot;
 *   - the lamp's readouts (lux, colour temperature, %) are functions of the knob's position;
 *   - the sky is a 12-hour scrub (00:00 .. 12:00) with five named moments;
 *   - the colour temperature runs 10,500 K (moon) .. 2,100 K (sun);
 *   - the repaint/ink reveal is a torn polygon whose points and shards come from a seed.
 */

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t: number): number => {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
const round = (n: number, digits = 3): number => {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
};

// ── the knob's inertia ──────────────────────────────────────────────────────

/** While the pointer drags: the knob reaches a share of the remaining distance every frame, whatever the frame rate (exponential smoothing). */
export function followStep(current: number, target: number, dtMs: number, tauMs = 70): number {
  if (!(dtMs > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

export interface Spring {
  x: number;
  v: number;
}

/** After the release: a damped spring toward the end the knob is nearer to (semi-implicit Euler, stable for a frame up to 50 ms). */
export function springStep(s: Spring, target: number, dtMs: number, stiffness = 210, damping = 21): Spring {
  const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
  const v = s.v + (-stiffness * (s.x - target) - damping * s.v) * dt;
  return { x: s.x + v * dt, v };
}

export function springDone(s: Spring, target: number): boolean {
  return Math.abs(s.x - target) < 0.0015 && Math.abs(s.v) < 0.01;
}

/** The end a knob let go at `p` settles on, given how fast it was moving (a flick carries it over the middle). */
export function settleTarget(p: number, velocity = 0): 0 | 1 {
  return clamp01(p + velocity * 0.12) >= 0.5 ? 1 : 0;
}

// ── colours (read from the `--fx-*` tokens, mixed here) ─────────────────────

export type Rgb = readonly [number, number, number];

/** A token's value as the generated stylesheet writes it: `R G B`. Anything else is null. */
export function parseTriplet(value: string): Rgb | null {
  const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(value);
  if (!m) return null;
  const n = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  return n.every((c) => c <= 255) ? n : null;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [Math.round(lerp(a[0], b[0], k)), Math.round(lerp(a[1], b[1], k)), Math.round(lerp(a[2], b[2], k))];
}

/** `R G B` for a CSS variable that is read as `rgb(var(--x))`. */
export const tripletOf = (c: Rgb): string => `${c[0]} ${c[1]} ${c[2]}`;
/** `rgb(R G B / a)` for a canvas or an inline style. */
export const rgbOf = (c: Rgb, alpha = 1): string => `rgb(${c[0]} ${c[1]} ${c[2]} / ${round(clamp01(alpha))})`;

// ── colour temperature (moon ↔ sun) ─────────────────────────────────────────

export const KELVIN_COOL = 10500;
export const KELVIN_WARM = 2100;

/** Position 0 (the moon end) .. 1 (the sun end) as a Kelvin value rounded to 100, as the readout shows it. */
export function kelvinOf(p: number): number {
  return Math.round(lerp(KELVIN_COOL, KELVIN_WARM, clamp01(p)) / 100) * 100;
}

export function positionOfKelvin(k: number): number {
  return clamp01((KELVIN_COOL - k) / (KELVIN_COOL - KELVIN_WARM));
}

export type KelvinCaption = "cool" | "neutral" | "warm";

/** «cool · moonlight» above 6,500 K, «neutral · daylight» 4,800 .. 6,500 K, «warm · candle to sun» below. */
export function kelvinCaption(k: number): KelvinCaption {
  if (k > 6500) return "cool";
  if (k >= 4800) return "neutral";
  return "warm";
}

/** `5,900 K` — Western digits with a comma, like the reference. */
export function formatKelvin(k: number): string {
  return `${Math.round(k).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} K`;
}

// ── the lamp ────────────────────────────────────────────────────────────────

export interface LampStats {
  /** 0..100. */
  pct: number;
  lux: number;
  kelvin: number;
}

/** Lux 221 (off) .. 738 (full); colour temperature 7,800 K (off) .. 2,900 K (full); the percentage is the knob's position. */
export function lampStats(p: number): LampStats {
  const c = clamp01(p);
  return {
    pct: Math.round(c * 100),
    lux: Math.round(221 + 517 * Math.pow(c, 0.8)),
    kelvin: Math.round((7800 - 4900 * c) / 100) * 100,
  };
}

/** The lamp's own readouts for a drag position; the sparkline wobble is a fixed seed so the card never flickers. */
export function sparkline(count: number, seed: number, amp = 0.5): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: Math.max(2, Math.round(count)) }, () => round(0.5 + (rand() - 0.5) * amp, 3));
}

/** The bars of «Light over a day»: 24 hours, a bell around 11:00–13:00 (values 0..1). */
export function dayBars(hours = 24): number[] {
  return Array.from({ length: hours }, (_, h) => {
    const d = Math.abs(h - 12);
    const bell = d < 7 ? Math.pow(Math.cos((Math.PI * d) / 14), 1.3) : 0;
    return round(Math.max(0.05, bell), 3);
  });
}

// ── the sky ─────────────────────────────────────────────────────────────────

/** The scrub covers 00:00 .. 12:00 (the knob's position 0 .. 1). */
export const SKY_RANGE_MIN = 12 * 60;

export function skyMinute(p: number): number {
  return Math.round(clamp01(p) * SKY_RANGE_MIN);
}

export function skyPosition(minute: number): number {
  return clamp01(minute / SKY_RANGE_MIN);
}

export type SkyMoment = "midnight" | "moonset" | "goldenhour" | "morning" | "noon";

/** The caption under the pill (00:14 midnight, 01:27 moonset, 05:36 golden hour, 08:03 morning, 11:32 high noon). */
export function skyMoment(minute: number): SkyMoment {
  const m = Math.min(SKY_RANGE_MIN, Math.max(0, minute));
  if (m < 60) return "midnight";
  if (m < 5 * 60) return "moonset";
  if (m < 7 * 60) return "goldenhour";
  if (m < 11 * 60) return "morning";
  return "noon";
}

/** The page is dark through 05:30 and light after 06:30 (the two eased ends are the reference's brown in between). */
export const SKY_KEY_MINUTES = [0, 200, 336, 470, 620, 720] as const;

export interface KeyBlend {
  from: number;
  to: number;
  t: number;
}

/** Which two key-frames of the sky a minute lies between, and how far. */
export function skyKeyBlend(minute: number): KeyBlend {
  const m = Math.min(SKY_RANGE_MIN, Math.max(0, minute));
  for (let i = 0; i < SKY_KEY_MINUTES.length - 1; i++) {
    const a = SKY_KEY_MINUTES[i] ?? 0;
    const b = SKY_KEY_MINUTES[i + 1] ?? SKY_RANGE_MIN;
    if (m <= b) return { from: i, to: i + 1, t: round(smoothLinear((m - a) / (b - a)), 4) };
  }
  return { from: SKY_KEY_MINUTES.length - 2, to: SKY_KEY_MINUTES.length - 1, t: 1 };
}

const smoothLinear = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

export interface SkyBodies {
  sun: { x: number; y: number; alpha: number };
  moon: { x: number; y: number; alpha: number };
  stars: number;
  aurora: number;
  windowLight: number;
  clouds: number;
  /** 0 = the night page, 1 = the day page. */
  day: number;
}

/** Where things are in the pill (0..1 across, 0..1 down) and how visible, for a minute of the scrub. */
export function skyBodies(minute: number): SkyBodies {
  const m = Math.min(SKY_RANGE_MIN, Math.max(0, minute));
  const sunT = clamp01((m - 300) / 420);
  const moonT = clamp01(m / 340);
  return {
    sun: { x: round(lerp(0.3, 0.88, sunT)), y: round(lerp(0.74, 0.24, 1 - Math.pow(1 - sunT, 2))), alpha: round(smooth(300, 420, m)) },
    moon: { x: round(lerp(0.16, 0.52, moonT)), y: round(lerp(0.26, 0.62, moonT * moonT)), alpha: round(1 - smooth(300, 400, m)) },
    stars: round(1 - smooth(120, 330, m)),
    aurora: round(Math.max(0, 1 - smooth(60, 300, m)) * 0.9 + 0.05 * (1 - smooth(300, 340, m))),
    windowLight: round(1 - smooth(300, 480, m)),
    clouds: round(smooth(180, 420, m)),
    day: round(smooth(340, 560, m)),
  };
}

/** 00:00 .. 12:00 as the caption's clock (Western digits). */
export function skyClock(minute: number): string {
  const m = Math.min(SKY_RANGE_MIN, Math.max(0, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The product's switch: dark below 06:00, «نهار» from 06:00 (the middle of the scrub). */
export const SKY_THEME_MINUTE = 6 * 60;
export const skyIsDay = (minute: number): boolean => minute >= SKY_THEME_MINUTE;

// ── seeded randomness ───────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the pixel icon (sun ↔ moon) ─────────────────────────────────────────────

export const PIXEL_GRID = 15;
export interface Cell {
  x: number;
  y: number;
}

/** The pixel sun: a 5-wide disc with eight rays (the cardinal ones two pixels long, the diagonal ones one). */
export function sunCells(): Cell[] {
  const cells: Cell[] = [];
  const c = 7;
  for (let y = 0; y < PIXEL_GRID; y++)
    for (let x = 0; x < PIXEL_GRID; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const disc = d <= 2.7;
      const cardinal = (dx === 0 || dy === 0) && Math.abs(dx + dy) >= 4 && Math.abs(dx + dy) <= 6 && Math.abs(dx + dy) !== 5;
      const diagonal = Math.abs(dx) === Math.abs(dy) && Math.abs(dx) === 4;
      if (disc || cardinal || diagonal) cells.push({ x, y });
    }
  return cells;
}

/** The pixel crescent moon with two small sparkles. */
export function moonCells(): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < PIXEL_GRID; y++)
    for (let x = 0; x < PIXEL_GRID; x++) {
      const inside = Math.hypot(x - 6.5, y - 7.5) <= 5.2;
      const bite = Math.hypot(x - 9.2, y - 5.6) <= 4.5;
      if (inside && !bite) cells.push({ x, y });
    }
  for (const s of [{ x: 11, y: 3 }, { x: 12, y: 4 }, { x: 11, y: 5 }, { x: 10, y: 4 }]) cells.push(s);
  return cells;
}

export interface PixelFrame {
  x: number;
  y: number;
  alpha: number;
  /** Extra scatter, in cells, while the icon turns into the other one. */
  dx: number;
  dy: number;
}

const key = (c: Cell): string => `${c.x},${c.y}`;

/**
 * One frame of the sun ↔ moon icon at morph `m` (0 = sun, 1 = moon). Every cell has a threshold; a cell only in the sun leaves
 * when `m` passes its threshold, a cell only in the moon arrives, and while the icon is half way the cells fly a little (the
 * dissolve the reference shows while the knob is between the ends).
 */
export function pixelFrame(m: number, seed = 7): PixelFrame[] {
  const sun = sunCells();
  const moon = moonCells();
  const inSun = new Set(sun.map(key));
  const inMoon = new Set(moon.map(key));
  const rand = mulberry32(seed);
  const all = new Map<string, Cell>();
  for (const c of [...sun, ...moon]) all.set(key(c), c);
  const k = clamp01(m);
  const burst = Math.sin(Math.PI * k);
  const out: PixelFrame[] = [];
  for (const [id, c] of Array.from(all)) {
    const threshold = rand();
    const angle = rand() * Math.PI * 2;
    const reach = 1.5 + rand() * 3;
    const wasSun = inSun.has(id);
    const isMoon = inMoon.has(id);
    let alpha: number;
    if (wasSun && isMoon) alpha = 1;
    else if (wasSun) alpha = 1 - smooth(threshold * 0.55, threshold * 0.55 + 0.4, k);
    else alpha = smooth(0.45 + threshold * 0.5 - 0.4, 0.45 + threshold * 0.5, k);
    if (alpha <= 0.01) continue;
    out.push({ x: c.x, y: c.y, alpha: round(alpha, 2), dx: round(Math.cos(angle) * reach * burst, 2), dy: round(Math.sin(angle) * reach * burst, 2) });
  }
  return out;
}

// ── particles ───────────────────────────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left. */
  life: number;
  max: number;
  size: number;
  kind: number;
}

/** The hard ceiling: nothing in the gallery or the switch ever holds more live particles than this. */
export const PARTICLE_CAP = 120;

export function emit(list: Particle[], p: Particle, cap = PARTICLE_CAP): void {
  if (list.length >= cap) list.shift();
  list.push(p);
}

/** Advance every particle by `dtMs` (drag `drag` per second, gravity `gy` px/s²) and drop the dead ones in place. */
export function stepParticles(list: Particle[], dtMs: number, drag = 1.2, gy = 0): void {
  const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
  const keep = Math.exp(-drag * dt);
  let w = 0;
  for (const p of list) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vx *= keep;
    p.vy = p.vy * keep + gy * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    list[w++] = p;
  }
  list.length = w;
}

// ── the torn reveal (repainting · ink) ──────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;

export type RevealLook = "shards" | "ink";

/** Smooth-ish angular noise from a seed: the same seed is the same edge, `roughness` 0 = a circle. */
export function edgeProfile(points: number, seed: number, roughness: number, smoothing: number): number[] {
  const rand = mulberry32(seed);
  const raw = Array.from({ length: points }, () => rand() * 2 - 1);
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -smoothing; k <= smoothing; k++) {
      const w = smoothing + 1 - Math.abs(k);
      sum += (raw[(i + k + points) % points] ?? 0) * w;
      weight += w;
    }
    out.push(1 + (sum / weight) * roughness);
  }
  return out;
}

/**
 * The polygon the new page is shown through. `shards`: a spiky torn edge (a point may lag far behind its neighbour, so pieces look
 * broken off). `ink`: a soft wobbling blot. Every radius has the same number of vertices so `clip-path` can animate between them.
 */
export function revealPolygon(cx: number, cy: number, radius: number, look: RevealLook, seed: number, points = 72): string {
  const profile = look === "ink" ? edgeProfile(points, seed, 0.1, 5) : edgeProfile(points, seed, 0.42, 1);
  const spikes = look === "shards" ? edgeProfile(points, seed + 99, 0.2, 0) : null;
  const v: string[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const jag = spikes && i % 2 === 0 ? (spikes[i] ?? 1) : 1;
    const r = Math.max(0, radius * (profile[i] ?? 1) * jag);
    v.push(`${round1(cx + r * Math.cos(a))}px ${round1(cy + r * Math.sin(a))}px`);
  }
  return `polygon(${v.join(", ")})`;
}

/** The percentage on the «repainting NN%» pill for a progress 0..1 of the reveal (steps of 1). */
export function repaintPercent(t: number): number {
  return Math.round(clamp01(t) * 100);
}

export interface Shard {
  /** Angle from the origin, radians. */
  angle: number;
  /** 0..1 share of the growth radius the shard rides at. */
  ride: number;
  size: number;
  rotation: number;
  sides: number;
  /** 0..1: when (in the reveal's progress) it appears. */
  born: number;
}

/** The loose pieces of ink that run just ahead of the edge. */
export function shardSeeds(count: number, seed: number): Shard[] {
  const rand = mulberry32(seed);
  const n = Math.min(40, Math.max(0, Math.round(count)));
  return Array.from({ length: n }, () => ({
    angle: rand() * Math.PI * 2,
    ride: 0.78 + rand() * 0.32,
    size: 14 + rand() * 46,
    rotation: rand() * Math.PI * 2,
    sides: 5 + Math.floor(rand() * 4),
    born: rand() * 0.55,
  }));
}

/**
 * A progress along the reveal. `shards` (repainting): the reference reads 1% at 0.5 s, 16% at 1.0 s, 59% at 1.5 s, 96% at 2.0 s —
 * a logistic curve, slow to start and fast in the middle, normalised to run exactly 0..1. `ink`: fast at first with a long tail.
 */
export function revealEase(t: number, look: RevealLook = "shards"): number {
  const c = clamp01(t);
  if (look === "ink") return 1 - Math.pow(1 - c, 2.2);
  const k = 9;
  const mid = 0.64;
  const f = (x: number) => 1 / (1 + Math.exp(-k * (x - mid)));
  return (f(c) - f(0)) / (f(1) - f(0));
}

/** A pointer position along a track, 0 at the left edge and 1 at the right (the showcase's tracks are always drawn left to right). */
export function trackPosition(clientX: number, left: number, width: number): number {
  return width > 0 ? clamp01((clientX - left) / width) : 0;
}

/**
 * The keys of the showcase's tracks, which are always drawn left to right (the moon / the night on the left, the sun / the day on
 * the right): the arrow toward the sun (or Up, or End) is 1, toward the moon (or Down, or Home) is 0. Enter and Space are the
 * button's own click, everything else is not the track's.
 */
export function endForKey(key: string): 0 | 1 | null {
  if (key === "ArrowRight" || key === "ArrowUp" || key === "End") return 1;
  if (key === "ArrowLeft" || key === "ArrowDown" || key === "Home") return 0;
  return null;
}
