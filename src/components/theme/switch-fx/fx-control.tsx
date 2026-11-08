"use client";

import "./switch-fx.css";
import { memo, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Moon, RotateCcw, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  WARMTH_MAX,
  WARMTH_MIN,
  arrowToDark,
  bodyArcs,
  brightnessOfPosition,
  clockOf,
  glassAllowed,
  isDayMinute,
  minuteForTheme,
  minuteOf,
  particleBudget,
  positionOfBrightness,
  positionOfMinute,
  positionOfWarmth,
  sceneBlend,
  skyPhase,
  sliderStep,
  warmthOfPosition,
  type SwitchStyle,
} from "@/lib/themes/switch-fx";
import { useSwitchFx } from "../switch-fx-provider";
import { useThemeToggle } from "../use-theme-toggle";
import { useTrackDrag } from "./use-drag";

/**
 * The four LOOKS of the top bar's switch of «مظهر المفتاح» — one lazy chunk, fetched only by somebody who chose one of them
 * (src/components/theme/theme-switch.tsx), with its stylesheet (switch-fx.css). Every colour is a theme variable (`--fx-*`, palettes.ts);
 * the art lives inside the control's own pill and never behind a number, an amount or a table.
 *
 *   glass   «زجاج»        a switch with a glass knob: real refraction (an SVG filter in `backdrop-filter`) on Chromium engines only,
 *                         a flat frosted knob everywhere else. An APPROXIMATION of the showcase: a magnifier with a small colour split.
 *   lamp    «لمبة»        a slider whose knob is a lamp; it dims the whole app (`brightness`), with rays that follow the light.
 *   sky     «سما»         a draggable sky; scrubbing it flips «نهار» / the dark theme at 06:00 and 18:00.
 *   warmth  «حرارة اللون»  a cool <-> warm slider that tints the app gently; one button puts it back.
 *
 * Dragging re-renders only these tiny leaves, once per animation frame (use-drag.ts); the tint itself is written straight to the
 * overlay (`preview`), so the page never re-renders while the pointer moves.
 */

export type FxStyle = Exclude<SwitchStyle, "plain">;
export type FxSize = "bar" | "preview";

const vars = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

export function FxControl({ style, size = "bar" }: { style: FxStyle; size?: FxSize }) {
  if (style === "glass") return <GlassSwitch size={size} />;
  if (style === "lamp") return <LampSlider size={size} />;
  if (style === "sky") return <SkySlider size={size} />;
  return <WarmthSlider size={size} />;
}

function centreOf(el: HTMLElement | null): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function dirOf(el: HTMLElement): "rtl" | "ltr" {
  return getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
}

function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands;
  return Boolean(brands?.some((b) => /chromium/i.test(b.brand)));
}

// ── glass ───────────────────────────────────────────────────────────────────

/**
 * The refraction map: a left-to-right red ramp and a top-to-bottom green ramp (named colours only), so the displacement is a
 * magnifier (every point samples a little nearer the middle). Three displacements at slightly different strengths, one per colour
 * channel, are screened back together: the small colour split at the edge of real glass.
 */
const GLASS_MAP =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="black"/><stop offset="1" stop-color="red"/></linearGradient><linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="black"/><stop offset="1" stop-color="lime"/></linearGradient></defs><rect width="64" height="64" fill="url(#x)"/><rect width="64" height="64" fill="url(#y)" style="mix-blend-mode:screen"/></svg>',
  );

const CHANNELS = [
  { name: "r", scale: -9, matrix: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { name: "g", scale: -11, matrix: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { name: "b", scale: -13, matrix: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" },
] as const;

export function GlassFilter({ id }: { id: string }) {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="zk-fx-defs">
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={GLASS_MAP} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        {CHANNELS.map((c) => (
          <feDisplacementMap key={c.name} in="SourceGraphic" in2="map" scale={c.scale} xChannelSelector="R" yChannelSelector="G" result={`d${c.name}`} />
        ))}
        {CHANNELS.map((c) => (
          <feColorMatrix key={c.name} in={`d${c.name}`} type="matrix" values={c.matrix} result={c.name} />
        ))}
        <feBlend in="r" in2="g" mode="screen" result="rg" />
        <feBlend in="rg" in2="b" mode="screen" />
      </filter>
    </svg>
  );
}

function GlassSwitch({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { dark, setDark } = useThemeToggle();
  const { gate } = useSwitchFx();
  const filterId = `zkg${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [refract, setRefract] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const lightRaf = useRef(0);
  const light = useRef({ x: 30, y: 25 });

  useEffect(() => {
    setRefract(glassAllowed(gate, isChromium()));
  }, [gate]);
  useEffect(() => () => cancelAnimationFrame(lightRaf.current), []);

  const drag = useTrackDrag<HTMLButtonElement>({
    onMove: (p) => setLive(p),
    onEnd: (p, travelled) => {
      setLive(null);
      setDark(travelled ? p > 0.5 : !dark, centreOf(knob.current));
    },
  });

  // the pointer is the light: the caustic glow follows it across the knob (one write per frame, only over the knob)
  const aim = (e: PointerEvent<HTMLButtonElement>) => {
    drag.onPointerMove(e);
    if (!gate.fxOn || gate.economy || gate.reducedMotion || !knob.current) return;
    const r = knob.current.getBoundingClientRect();
    light.current = { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
    if (!lightRaf.current) {
      lightRaf.current = requestAnimationFrame(() => {
        lightRaf.current = 0;
        knob.current?.style.setProperty("--zk-lx", `${light.current.x}%`);
        knob.current?.style.setProperty("--zk-ly", `${light.current.y}%`);
      });
    }
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail !== 0) return; // a pointer press is handled by the drag's end; this is Enter or Space
    setDark(!dark, centreOf(knob.current));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const toDark = arrowToDark(e.key, dirOf(e.currentTarget));
    if (toDark === null) return;
    e.preventDefault();
    setDark(toDark, centreOf(knob.current));
  };

  const p = live ?? (dark ? 1 : 0);
  return (
    <div className="zk-fx" data-style="glass" data-size={size} data-dragging={live !== null} data-motion={gate.fxOn && !gate.economy && !gate.reducedMotion} style={vars({ "--zk-p": p })}>
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={t("themeSwitch.aria")}
        className="zk-fx-track zk-glass-track"
        onPointerDown={drag.onPointerDown}
        onPointerMove={aim}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <span className="zk-glass-end" aria-hidden="true">
          {size === "preview" ? <span className="zk-glass-word">{t("shell.theme.day")}</span> : <Sun className="size-5" />}
        </span>
        <span className="zk-glass-end" aria-hidden="true">
          {size === "preview" ? <span className="zk-glass-word">{t("shell.theme.night")}</span> : <Moon className="size-5" />}
        </span>
        <span
          ref={knob}
          aria-hidden="true"
          className="zk-fx-knob zk-glass-knob"
          data-refract={refract}
          style={refract ? { backdropFilter: `url(#${filterId}) blur(0.4px) saturate(1.6)`, WebkitBackdropFilter: `url(#${filterId}) blur(0.4px) saturate(1.6)` } : undefined}
        />
      </button>
      {refract ? <GlassFilter id={filterId} /> : null}
    </div>
  );
}

// ── lamp ────────────────────────────────────────────────────────────────────

const RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const f = (r: number) => Math.round(r * 100) / 100;
  return { x1: f(Math.cos(a) * 27), y1: f(Math.sin(a) * 27), x2: f(Math.cos(a) * (i % 2 ? 38 : 45)), y2: f(Math.sin(a) * (i % 2 ? 38 : 45)) };
});

function LampSlider({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { pref, motion, commit, preview } = useSwitchFx();
  const [live, setLive] = useState<number | null>(null);
  const value = live ?? pref.brightness;
  const p = positionOfBrightness(value);

  const drag = useTrackDrag<HTMLDivElement>({
    onMove: (pos) => {
      const b = brightnessOfPosition(pos);
      setLive(b);
      preview({ brightness: b });
    },
    onEnd: (pos) => {
      setLive(null);
      commit({ brightness: brightnessOfPosition(pos) });
    },
  });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = sliderStep(e.key, value, { min: BRIGHTNESS_MIN, max: BRIGHTNESS_MAX, step: 5, big: 20 }, dirOf(e.currentTarget));
    if (next === null) return;
    e.preventDefault();
    commit({ brightness: next });
  };

  return (
    <div className="zk-fx" data-style="lamp" data-size={size} data-dragging={live !== null} data-motion={motion} style={vars({ "--zk-p": p, "--zk-b": p })}>
      <div
        role="slider"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t("themeSwitch.lamp.label")}
        aria-valuemin={BRIGHTNESS_MIN}
        aria-valuemax={BRIGHTNESS_MAX}
        aria-valuenow={value}
        aria-valuetext={t("themeSwitch.lamp.value", { value })}
        className="zk-fx-track zk-lamp-track"
        {...drag}
        onKeyDown={onKeyDown}
      >
        <span className="zk-lamp-fill" aria-hidden="true" />
        <span className="zk-fx-knob zk-lamp-knob" aria-hidden="true">
          <svg className="zk-lamp-rays" viewBox="-50 -50 100 100" focusable="false">
            {RAYS.map((r, i) => (
              <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
            ))}
          </svg>
          <Sun className="relative size-5" />
        </span>
      </div>
      <span aria-hidden="true" className="zk-fx-readout">
        {value}%
      </span>
    </div>
  );
}

// ── sky ─────────────────────────────────────────────────────────────────────

const STARS = Array.from({ length: 18 }, (_, i) => ({ x: ((i * 53 + 7) % 97) + 1.5, y: ((i * 29 + 3) % 20) + 1, r: 0.3 + (i % 3) * 0.15, d: (i % 6) * 0.5 }));

/** The scene never re-renders while the sky is dragged: only the variables on its parent change. */
const SkyScene = memo(function SkyScene({ uid }: { uid: string }) {
  return (
    <svg className="zk-sky-svg" viewBox="0 0 100 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}n`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="zk-stop-night-top" />
          <stop offset="1" className="zk-stop-night-low" />
        </linearGradient>
        <linearGradient id={`${uid}d`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="zk-stop-day-top" />
          <stop offset="1" className="zk-stop-day-low" />
        </linearGradient>
        <linearGradient id={`${uid}a`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" className="zk-stop-aurora-a" stopOpacity="0" />
          <stop offset="0.5" className="zk-stop-aurora-a" stopOpacity="0.55" />
          <stop offset="1" className="zk-stop-aurora-b" stopOpacity="0" />
        </linearGradient>
        <mask id={`${uid}m`}>
          <rect x="-10" y="-10" width="30" height="30" fill="white" />
          <circle cx="2" cy="-1" r="3.4" fill="black" />
        </mask>
      </defs>
      <rect width="100" height="40" fill={`url(#${uid}d)`} />
      <g className="zk-night-layer">
        <rect width="100" height="40" fill={`url(#${uid}n)`} />
        <path d="M0 11 C 20 3, 38 16, 58 8 S 90 4, 100 10 L100 17 C 80 12, 60 20, 40 15 S 12 18, 0 17 Z" fill={`url(#${uid}a)`} />
        {STARS.map((s, i) => (
          <circle key={i} className="zk-star" cx={s.x} cy={s.y} r={s.r} style={{ ["--d" as string]: `${s.d}s` }} />
        ))}
      </g>
      <g className="zk-day-layer">
        <g className="zk-cloud zk-cloud-a">
          <ellipse cx="22" cy="9" rx="7" ry="2.2" />
          <ellipse cx="26" cy="7.6" rx="4.5" ry="2.2" />
        </g>
        <g className="zk-cloud zk-cloud-b">
          <ellipse cx="68" cy="14" rx="6" ry="1.8" />
          <ellipse cx="71.5" cy="12.8" rx="3.8" ry="1.9" />
        </g>
      </g>
      <g className="zk-sun">
        <circle r="7" className="zk-sun-glow" />
        <circle r="3.6" className="zk-sun-disc" />
      </g>
      <g className="zk-moon">
        <circle r="3.4" className="zk-moon-disc" mask={`url(#${uid}m)`} />
      </g>
      <path className="zk-hill-far" d="M0 31 L12 25 L26 29 L40 21 L58 28 L72 23 L88 29 L100 26 V40 H0Z" />
      <path className="zk-hill-near" d="M0 36 L18 31 L34 35 L55 30 L75 35 L100 32 V40 H0Z" />
      <g className="zk-cabin zk-night-layer">
        <polygon points="45,31 50,27.5 55,31" />
        <rect x="46" y="31" width="8" height="5" />
        <rect x="48" y="32.4" width="1.8" height="1.8" className="zk-cabin-light" />
        <rect x="50.6" y="32.4" width="1.8" height="1.8" className="zk-cabin-light" />
      </g>
    </svg>
  );
});

function SkySlider({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { theme, dark, setDark } = useThemeToggle();
  const { motion } = useSwitchFx();
  const uid = `zks${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [minute, setMinute] = useState(() => minuteForTheme(theme));
  const latest = useRef({ dark, setDark });
  latest.current = { dark, setDark };

  // the theme changed somewhere else (the picker, the plain switch): rest the sky where that theme belongs
  useEffect(() => {
    setMinute((m) => (isDayMinute(m) === !dark ? m : minuteForTheme(theme)));
  }, [dark, theme]);

  const follow = (m: number) => {
    const wantDark = !isDayMinute(m);
    if (wantDark !== latest.current.dark) latest.current.setDark(wantDark, undefined, true);
  };
  const go = (m: number) => {
    setMinute(m);
    follow(m);
  };

  const drag = useTrackDrag<HTMLDivElement>({ onMove: (pos) => go(minuteOf(pos)), onEnd: () => {} });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = sliderStep(e.key, minute, { min: 0, max: 1439, step: 30, big: 180 }, dirOf(e.currentTarget));
    if (next === null) return;
    e.preventDefault();
    go(next);
  };

  const { sun, moon } = bodyArcs(minute);
  const phase = skyPhase(minute);
  const phaseName = t(`themeSwitch.sky.${phase}`);
  return (
    <div className="zk-fx zk-fx-column" data-style="sky" data-size={size} data-motion={motion}>
      <div
        role="slider"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t("themeSwitch.sky.label")}
        aria-valuemin={0}
        aria-valuemax={1439}
        aria-valuenow={minute}
        aria-valuetext={`${phaseName} ${clockOf(minute)}`}
        className="zk-fx-track zk-sky-track"
        style={vars({
          "--zk-p": positionOfMinute(minute),
          "--zk-blend": sceneBlend(minute),
          "--zk-sunx": sun.x,
          "--zk-suny": Math.round(sun.y * 4) / 10,
          "--zk-sunv": sun.visible ? 1 : 0,
          "--zk-moonx": moon.x,
          "--zk-moony": Math.round(moon.y * 4) / 10,
          "--zk-moonv": moon.visible ? 1 : 0,
        })}
        {...drag}
        onKeyDown={onKeyDown}
      >
        <SkyScene uid={uid} />
      </div>
      {size === "preview" ? (
        <p className="text-center">
          <span className="block text-sm font-semibold text-fg">{phaseName}</span>
          <span className="block text-xs text-fg-muted">
            {clockOf(minute)} · {t("themeSwitch.sky.drag")}
          </span>
        </p>
      ) : null}
    </div>
  );
}

// ── colour temperature ──────────────────────────────────────────────────────

function WarmthSlider({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { pref, gate, motion, commit, preview } = useSwitchFx();
  const [live, setLive] = useState<number | null>(null);
  const value = live ?? pref.warmth;
  const p = positionOfWarmth(value);
  const dots = particleBudget(gate, size === "preview" ? 14 : 6);

  const drag = useTrackDrag<HTMLDivElement>({
    onMove: (pos) => {
      const w = warmthOfPosition(pos);
      setLive(w);
      preview({ warmth: w });
    },
    onEnd: (pos) => {
      setLive(null);
      commit({ warmth: warmthOfPosition(pos) });
    },
  });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = sliderStep(e.key, value, { min: WARMTH_MIN, max: WARMTH_MAX, step: 10, big: 50 }, dirOf(e.currentTarget));
    if (next === null) return;
    e.preventDefault();
    commit({ warmth: next });
  };
  const text = value === 0 ? t("themeSwitch.warmth.neutral") : t(value > 0 ? "themeSwitch.warmth.value_warm" : "themeSwitch.warmth.value_cool", { value: Math.abs(value) });

  return (
    <div className="zk-fx" data-style="warmth" data-size={size} data-dragging={live !== null} data-motion={motion} style={vars({ "--zk-p": p })}>
      <div
        role="slider"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t("themeSwitch.warmth.label")}
        aria-valuemin={WARMTH_MIN}
        aria-valuemax={WARMTH_MAX}
        aria-valuenow={value}
        aria-valuetext={text}
        className="zk-fx-track zk-warm-track"
        {...drag}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: dots }, (_, i) => (
          <span key={i} className="zk-dot" aria-hidden="true" style={{ insetInlineStart: `${((i * 37 + 11) % 90) + 3}%`, animationDelay: `${((i * 53) % 30) / 10}s` }} />
        ))}
        <span className="zk-fx-knob zk-warm-knob" aria-hidden="true">
          <Moon className="zk-warm-moon size-5" />
          <Sun className="zk-warm-sun size-5" />
        </span>
      </div>
      {size === "preview" ? (
        <span aria-hidden="true" className="zk-fx-readout">
          {text}
        </span>
      ) : null}
      {value !== 0 ? (
        <button type="button" onClick={() => commit({ warmth: 0 })} aria-label={t("themeSwitch.warmth.reset")} title={t("themeSwitch.warmth.reset")} className={cn("zk-fx-reset inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent")}>
          <RotateCcw aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

