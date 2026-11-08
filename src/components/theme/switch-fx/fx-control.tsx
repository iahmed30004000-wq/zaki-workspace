"use client";

import "./switch-fx.css";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  WARMTH_MAX,
  WARMTH_MIN,
  clampBrightness,
  glassAllowed,
  particleBudget,
  positionOfWarmth,
  sliderStep,
  warmthOfPosition,
  type SwitchStyle,
} from "@/lib/themes/switch-fx";
import { SKY_RANGE_MIN, endForKey, formatKelvin, kelvinCaption, kelvinOf, lampStats, lerp, skyClock, skyIsDay, skyMinute, skyMoment, skyPosition } from "@/lib/themes/switch-motion";
import { GlassKnob, isChromium } from "../fx/glass-knob";
import { paintPairs, useFxReader, useKnob } from "../fx/kit";
import { PixelIcon, type PixelIconHandle } from "../fx/pixel-icon";
import { SkyArt, type SkyArtHandle } from "../fx/sky-art";
import { Sheds, type ShedsHandle } from "../fx/sheds";
import { useSwitchFx } from "../switch-fx-provider";
import { useThemeToggle } from "../use-theme-toggle";

/**
 * The four LOOKS of the top bar's switch of «مظهر المفتاح» — one lazy chunk, fetched only by somebody who chose one of them
 * (src/components/theme/theme-switch.tsx), with its stylesheet (switch-fx.css). They are the compact versions of the gallery's
 * variants (src/components/theme/gallery/, docs/THEME-SWITCH-FX.md), built from the same parts:
 *
 *   glass   «زجاج»        a frosted track with a glass knob: real refraction on Chromium engines (0.72x, 22% bevel, R/B split), the
 *                         pixel sun / moon dissolving into each other while it travels; a flat frosted knob everywhere else.
 *   lamp    «لمبة»        a pill whose square knob is a lamp: its rays and the % follow it, the whole app dims while it is dragged,
 *                         and on release it lets the day or the night in.
 *   sky     «سما»         a landscape in a pill: drag from midnight to noon, the theme flips at 06:00.
 *   warmth  «حرارة اللون»  moon <-> sun with a glass knob that stays where it is dropped: a gentle tint over the app, the scale
 *                         under it reads 10,500 K .. 2,100 K; one button puts it back.
 *
 * The tracks are always drawn left to right (the night on the left, the day on the right) — they are pictures of a lamp and a sky,
 * not text. Everything is written straight to the DOM per frame (kit.ts); React renders each look once. Colours: theme variables.
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

/** Sizes in px: the track, the knob and the padding (the bar's switch is one 44 px target; the settings' preview is bigger). */
const DIM = {
  bar: { glass: { w: 112, h: 44, k: 38 }, lamp: { w: 148, h: 44, k: 38 }, sky: { w: 168, h: 48, k: 0 }, warmth: { w: 148, h: 44, k: 38 } },
  preview: { glass: { w: 200, h: 68, k: 58 }, lamp: { w: 264, h: 68, k: 58 }, sky: { w: 300, h: 96, k: 0 }, warmth: { w: 264, h: 68, k: 58 } },
} as const;
const PAD = 3;

function dimVars(size: FxSize, key: keyof (typeof DIM)["bar"]): CSSProperties {
  const d = DIM[size][key];
  return vars({ "--zx-w": `${d.w}px`, "--zx-h": `${d.h}px`, "--zx-k": `${d.k}px`, "--zx-pad": `${PAD}px`, "--zx-travel": `${d.w - d.k - PAD * 2}px` });
}

function centreOf(el: HTMLElement | null): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ── glass ───────────────────────────────────────────────────────────────────

function GlassSwitch({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { dark, setDark } = useThemeToggle();
  const { gate, motion } = useSwitchFx();
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const icon = useRef<PixelIconHandle>(null);
  const reader = useFxReader(root);
  const [refract, setRefract] = useState(false);
  const latest = useRef({ dark, setDark });
  latest.current = { dark, setDark };
  useEffect(() => setRefract(glassAllowed(gate, isChromium())), [gate]);
  const d = DIM[size].glass;

  const paint = (p: number) => {
    const r = root.current;
    const read = reader();
    if (!r || !read) return;
    r.style.setProperty("--p", p.toFixed(4));
    paintPairs(r, read, ["gl-tint"], 1 - p);
    icon.current?.setMorph(1 - p);
  };
  const knob = useKnob(rail, {
    initial: dark ? 0 : 1,
    snap: true,
    instant: !motion,
    onFrame: paint,
    onSettled: (_p, end) => {
      if (end === null) return;
      if ((end === 0) !== latest.current.dark) latest.current.setDark(end === 0, centreOf(track.current));
    },
  });
  useEffect(() => {
    if (!knob.dragging()) knob.set(dark ? 0 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) knob.toggle(); // a press from the keyboard (Enter, Space); a pointer press is the knob's own release
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const end = endForKey(e.key);
    if (end === null) return;
    e.preventDefault();
    knob.goTo(end);
  };

  return (
    <div ref={root} dir="ltr" className="zx" data-style="glass" data-size={size} data-motion={motion} style={dimVars(size, "glass")}>
      <button
        ref={track}
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={t("themeSwitch.aria")}
        className="zx-track"
        onPointerDown={knob.bind.onPointerDown}
        onPointerMove={knob.bind.onPointerMove}
        onPointerUp={knob.bind.onPointerUp}
        onPointerCancel={knob.bind.onPointerCancel}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <span ref={rail} className="zx-rail" aria-hidden="true" />
        <span className="zx-end zx-end-night" aria-hidden="true" />
        <span className="zx-end zx-end-day" aria-hidden="true" />
        <span className="zx-knob zx-knob-glass" aria-hidden="true">
          <GlassKnob size={d.k} refract={refract} className="zx-glass">
            <PixelIcon ref={icon} size={Math.round(d.k * 0.62)} className="zx-icon" morph={dark ? 1 : 0} />
          </GlassKnob>
        </span>
      </button>
    </div>
  );
}

// ── lamp ────────────────────────────────────────────────────────────────────

function LampSlider({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { dark, setDark } = useThemeToggle();
  const { motion, commit, preview } = useSwitchFx();
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const icon = useRef<PixelIconHandle>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const reader = useFxReader(root);
  const [value, setValue] = useState(dark ? 0 : 100);
  const latest = useRef({ dark, setDark, commit, preview });
  latest.current = { dark, setDark, commit, preview };

  const paint = (p: number) => {
    const r = root.current;
    const read = reader();
    if (!r || !read) return;
    r.style.setProperty("--p", p.toFixed(4));
    paintPairs(r, read, ["lp-ray", "lp-edge"], 1 - p);
    icon.current?.setMorph(1 - p);
    const s = lampStats(p);
    if (pct.current) {
      pct.current.textContent = `${s.pct}%`;
      const k = DIM[size].lamp.k;
      const left = PAD + p * (DIM[size].lamp.w - k - PAD * 2);
      pct.current.style.insetInlineStart = `${Math.round(p > 0.5 ? left - 38 : left + k + 8)}px`;
    }
    // while the knob is in the hand, the whole app is lit by it: dimmer toward the night (capped, see tintOf)
    if (knob.dragging()) latest.current.preview({ brightness: clampBrightness(lerp(BRIGHTNESS_MIN, BRIGHTNESS_MAX, p)) });
  };
  const knob = useKnob(rail, {
    initial: dark ? 0 : 1,
    snap: true,
    instant: !motion,
    onFrame: paint,
    onSettled: (p, end) => {
      if (end === null) return;
      setValue(end === 1 ? 100 : 0);
      latest.current.commit({ brightness: BRIGHTNESS_MAX });
      if ((end === 0) !== latest.current.dark) latest.current.setDark(end === 0, centreOf(track.current));
    },
  });
  useEffect(() => {
    if (!knob.dragging()) {
      knob.set(dark ? 0 : 1);
      setValue(dark ? 0 : 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const end = endForKey(e.key);
    if (end === null) return;
    e.preventDefault();
    knob.goTo(end);
  };

  return (
    <div ref={root} dir="ltr" className="zx" data-style="lamp" data-size={size} data-motion={motion} style={dimVars(size, "lamp")}>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t("themeSwitch.lamp.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={t("themeSwitch.lamp.value", { value })}
        className="zx-track"
        onPointerDown={knob.bind.onPointerDown}
        onPointerMove={knob.bind.onPointerMove}
        onPointerUp={knob.bind.onPointerUp}
        onPointerCancel={knob.bind.onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <span ref={rail} className="zx-rail" aria-hidden="true" />
        <span className="zx-rays" aria-hidden="true" />
        <span className="zx-knob zx-knob-lamp" aria-hidden="true">
          <PixelIcon ref={icon} size={Math.round(DIM[size].lamp.k * 0.66)} className="zx-icon" morph={dark ? 1 : 0} />
        </span>
        <span ref={pct} className="zx-readout" aria-hidden="true">
          {dark ? 0 : 100}%
        </span>
      </div>
    </div>
  );
}

// ── sky ─────────────────────────────────────────────────────────────────────

function SkySlider({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { dark, setDark } = useThemeToggle();
  const { motion } = useSwitchFx();
  const track = useRef<HTMLDivElement>(null);
  const art = useRef<SkyArtHandle>(null);
  const title = useRef<HTMLSpanElement>(null);
  const sub = useRef<HTMLSpanElement>(null);
  const latest = useRef({ dark, setDark });
  latest.current = { dark, setDark };
  const rest = dark ? 0 : 1;

  const paint = (p: number) => {
    const minute = skyMinute(p);
    art.current?.paint(minute);
    const el = track.current;
    if (el) {
      el.setAttribute("aria-valuenow", String(minute));
      el.setAttribute("aria-valuetext", `${t(`gallery.sky.${skyMoment(minute)}`)} ${skyClock(minute)}`);
    }
    if (title.current) title.current.textContent = t(`gallery.sky.${skyMoment(minute)}`);
    if (sub.current) sub.current.textContent = `${skyClock(minute)} · ${t("themeSwitch.sky.drag")}`;
    const wantDark = !skyIsDay(minute);
    if (wantDark !== latest.current.dark) latest.current.setDark(wantDark, undefined, true);
  };
  const knob = useKnob(track, { initial: rest, snap: false, instant: !motion, tau: 80, onFrame: paint });
  useEffect(() => {
    // the theme changed somewhere else (the picker, the plain switch): rest the sky where that theme belongs
    if (!knob.dragging() && skyIsDay(skyMinute(knob.get())) === dark) knob.set(rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);
  useEffect(() => {
    paint(knob.get());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const minute = skyMinute(knob.get());
    const next = sliderStep(e.key, minute, { min: 0, max: SKY_RANGE_MIN, step: 30, big: 120 }, "ltr");
    if (next === null) return;
    e.preventDefault();
    knob.set(skyPosition(next));
  };

  return (
    <div dir="ltr" className="zx zx-column" data-style="sky" data-size={size} data-motion={motion} style={dimVars(size, "sky")}>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t("themeSwitch.sky.label")}
        aria-valuemin={0}
        aria-valuemax={SKY_RANGE_MIN}
        aria-valuenow={dark ? 0 : SKY_RANGE_MIN}
        aria-valuetext={`${t(`gallery.sky.${skyMoment(rest * SKY_RANGE_MIN)}`)} ${skyClock(rest * SKY_RANGE_MIN)}`}
        className="zx-track zx-sky"
        onPointerDown={knob.bind.onPointerDown}
        onPointerMove={knob.bind.onPointerMove}
        onPointerUp={knob.bind.onPointerUp}
        onPointerCancel={knob.bind.onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <SkyArt ref={art} className="zx-sky-art" />
        <span className="zx-sky-shine" aria-hidden="true" />
      </div>
      {size === "preview" ? (
        <p className="zx-caption" dir="rtl">
          <span ref={title} className="zx-caption-title" />
          <span ref={sub} className="zx-caption-sub" />
        </p>
      ) : null}
    </div>
  );
}

// ── colour temperature ──────────────────────────────────────────────────────

function WarmthSlider({ size }: { size: FxSize }) {
  const { t } = useI18n();
  const { pref, gate, motion, commit, preview } = useSwitchFx();
  const root = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const icon = useRef<PixelIconHandle>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const sheds = useRef<ShedsHandle>(null);
  const reader = useFxReader(root);
  const [refract, setRefract] = useState(false);
  const last = useRef(positionOfWarmth(pref.warmth));
  const latest = useRef({ commit, preview });
  latest.current = { commit, preview };
  useEffect(() => setRefract(glassAllowed(gate, isChromium())), [gate]);
  const d = DIM[size].warmth;
  const cap = particleBudget(gate, size === "preview" ? 30 : 14);

  const paint = (p: number) => {
    const r = root.current;
    const read = reader();
    if (!r || !read) return;
    r.style.setProperty("--p", p.toFixed(4));
    paintPairs(r, read, ["tp-tint"], 1 - p);
    icon.current?.setMorph(1 - p);
    const k = kelvinOf(p);
    if (readout.current) readout.current.textContent = formatKelvin(k);
    if (caption.current) caption.current.textContent = t(`gallery.temp.${kelvinCaption(k)}`);
    if (knob.dragging()) latest.current.preview({ warmth: warmthOfPosition(p) });
    const dx = p - last.current;
    last.current = p;
    if (cap > 0 && Math.abs(dx) > 0.004) {
      const x = PAD + p * (d.w - d.k - PAD * 2) + d.k / 2;
      const toMoon = dx < 0;
      sheds.current?.puff(x + (toMoon ? d.k / 2 : -d.k / 2), d.h / 2, toMoon ? -1 : 1, toMoon ? "star" : "square", toMoon ? read("tp-moon") : read("tp-sun"));
    }
  };
  const knob = useKnob(rail, {
    initial: positionOfWarmth(pref.warmth),
    snap: false,
    instant: !motion,
    onFrame: paint,
    onSettled: (p) => latest.current.commit({ warmth: warmthOfPosition(p) }),
  });
  useEffect(() => {
    if (!knob.dragging()) knob.set(positionOfWarmth(pref.warmth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref.warmth]);

  const value = pref.warmth;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = sliderStep(e.key, value, { min: WARMTH_MIN, max: WARMTH_MAX, step: 10, big: 50 }, "ltr");
    if (next === null) return;
    e.preventDefault();
    commit({ warmth: next });
  };
  const text = value === 0 ? t("themeSwitch.warmth.neutral") : t(value > 0 ? "themeSwitch.warmth.value_warm" : "themeSwitch.warmth.value_cool", { value: Math.abs(value) });

  return (
    <div ref={root} dir="ltr" className="zx zx-column" data-style="warmth" data-size={size} data-motion={motion} style={dimVars(size, "warmth")}>
      <div className="zx-row">
        <div
          role="slider"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label={t("themeSwitch.warmth.label")}
          aria-valuemin={WARMTH_MIN}
          aria-valuemax={WARMTH_MAX}
          aria-valuenow={value}
          aria-valuetext={text}
          className="zx-track"
          onPointerDown={knob.bind.onPointerDown}
          onPointerMove={knob.bind.onPointerMove}
          onPointerUp={knob.bind.onPointerUp}
          onPointerCancel={knob.bind.onPointerCancel}
          onKeyDown={onKeyDown}
        >
          <span ref={rail} className="zx-rail" aria-hidden="true" />
          <span className="zx-end zx-end-night" aria-hidden="true" />
          <span className="zx-end zx-end-day" aria-hidden="true" />
          <Sheds ref={sheds} width={d.w} height={d.h} cap={cap} className="zx-sheds" />
          <span className="zx-knob zx-knob-glass" aria-hidden="true">
            <GlassKnob size={d.k} refract={refract} className="zx-glass">
              <PixelIcon ref={icon} size={Math.round(d.k * 0.62)} className="zx-icon" morph={0} />
            </GlassKnob>
          </span>
        </div>
        {value !== 0 ? (
          <button
            type="button"
            onClick={() => commit({ warmth: 0 })}
            aria-label={t("themeSwitch.warmth.reset")}
            title={t("themeSwitch.warmth.reset")}
            className={cn("zx-reset inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent")}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
      {size === "preview" ? (
        <div className="zx-scale" aria-hidden="true">
          <i className="zx-scale-bar" />
          <span className="zx-scale-marker" />
          <b className="zx-scale-lo">{formatKelvin(10500)}</b>
          <b className="zx-scale-hi">{formatKelvin(2100)}</b>
          <span ref={readout} className="zx-scale-read" />
          <span ref={caption} className="zx-scale-cap" dir="rtl" />
        </div>
      ) : null}
    </div>
  );
}
