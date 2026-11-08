"use client";

import "../fx/exact.css";
import "./temp.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { PARTICLE_CAP, clamp01, emit, formatKelvin, kelvinCaption, kelvinOf, lerp, mulberry32, rgbOf, stepParticles, type Particle } from "@/lib/themes/switch-motion";
import { GlassKnob, isChromium } from "../fx/glass-knob";
import { paintPairs, prefersReducedMotion, useFrameLoop, useFxReader, useKnob } from "../fx/kit";
import { PixelIcon, type PixelIconHandle } from "../fx/pixel-icon";
import type { SceneHandle } from "./scene-types";

/**
 * «01 · colour temperature»: a moon on the left, a sun on the right and a track between them with a draggable glass knob. The knob
 * does not snap: it stays where it is dropped and the scale under it reads the colour temperature (10,500 K at the moon, 2,100 K
 * at the sun) with its caption. Moving toward the moon leaves a trail of stars and snow-sparkles, toward the sun a halo of square
 * dots; the page goes from the dark one to the light one with the knob.
 */

const KNOB = 96;
const KNOB_X0 = 604;
const KNOB_X1 = 1060;
const KNOB_TOP = 436;
const BAR_X = 580;
const BAR_W = 560;
const PAIRS = ["tp-bg", "tp-track", "tp-ink", "tp-mute", "tp-dot", "tp-tint"] as const;

function Moon() {
  return (
    <svg viewBox="-40 -40 80 80" aria-hidden="true">
      <path d="M8 -26 A28 28 0 1 0 26 14 A22 22 0 0 1 8 -26Z" fill="rgb(var(--fx-tp-moon))" />
      <path d="M22 -30 v10 M17 -25 h10 M-30 -14 v7 M-33.5 -10.5 h7" stroke="rgb(var(--fx-tp-moon))" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
function Sun() {
  return (
    <svg viewBox="-40 -40 80 80" aria-hidden="true">
      <g stroke="rgb(var(--fx-tp-sun))" strokeWidth="3" strokeLinecap="round">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <line key={i} x1={Math.cos(a) * 24} y1={Math.sin(a) * 24} x2={Math.cos(a) * (i % 2 ? 31 : 36)} y2={Math.sin(a) * (i % 2 ? 31 : 36)} />;
        })}
      </g>
      <circle r="16" fill="rgb(var(--fx-tp-sun))" />
      <circle r="16" fill="none" stroke="rgb(var(--fx-glass-edge))" strokeOpacity="0.5" strokeWidth="2" />
    </svg>
  );
}

export const TempScene = forwardRef<SceneHandle>(function TempScene(_props, handle) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const icon = useRef<PixelIconHandle>(null);
  const read = useRef<HTMLSpanElement>(null);
  const cap = useRef<HTMLSpanElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reader = useFxReader(root);
  const particles = useRef<Particle[]>([]);
  const prev = useRef({ x: KNOB_X1 });
  const rand = useRef(mulberry32(21));
  const reduced = useRef(false);
  const [refract, setRefract] = useState(false);
  const lastCap = useRef("");
  /** Where the pointer is along the track (0..1), or null: the reference's reading follows the POINTER (hover or press), the knob follows the press. */
  const hover = useRef<number | null>(null);

  useEffect(() => setRefract(isChromium()), []);

  const draw = useFrameLoop((dt) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const r = reader();
    if (!el || !ctx || !r) return false;
    ctx.clearRect(0, 0, el.width, el.height);
    stepParticles(particles.current, dt, 1.4, 14);
    for (const p of particles.current) {
      const k = Math.max(0, p.life / p.max);
      ctx.globalAlpha = k;
      if (p.kind === 0) {
        // a four-point sparkle toward the moon
        ctx.fillStyle = rgbOf(r("tp-moon"), 1);
        ctx.beginPath();
        const s = p.size * (0.6 + k * 0.6);
        ctx.moveTo(p.x, p.y - s * 1.8);
        ctx.quadraticCurveTo(p.x, p.y, p.x + s * 1.8, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s * 1.8);
        ctx.quadraticCurveTo(p.x, p.y, p.x - s * 1.8, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s * 1.8);
        ctx.fill();
      } else {
        ctx.fillStyle = rgbOf(r("tp-sun"), 1);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
    return particles.current.length > 0;
  });

  /** The scale under the knob: the readout, its caption and the marker, for a position 0..1 (the knob's, or the pointer's while it is over the track). */
  const showReading = (p: number) => {
    const k = kelvinOf(p);
    if (read.current) read.current.textContent = formatKelvin(k);
    const c = kelvinCaption(k);
    if (cap.current && lastCap.current !== c) {
      lastCap.current = c;
      cap.current.textContent = t(`gallery.temp.${c}`);
    }
    if (marker.current) marker.current.style.transform = `translateX(${(clamp01(p) * BAR_W).toFixed(1)}px)`;
  };

  const track = (e: PointerEvent<HTMLDivElement>) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    // only along the track's own band, so the reading does not jump while the pointer is elsewhere on the page
    if (e.clientY < r.top - r.height * 0.6 || e.clientY > r.bottom + r.height * 0.6) return;
    const q = clamp01((e.clientX - r.left) / r.width);
    hover.current = q;
    showReading(q);
  };
  const onHover = (e: PointerEvent<HTMLDivElement>) => {
    knob.bind.onPointerMove(e);
    track(e);
  };

  const paint = (p: number) => {
    const r = root.current;
    const rd = reader();
    if (!r || !rd) return;
    const m = 1 - p;
    paintPairs(r, rd, PAIRS, m, { "tp-bg": "tp-bg-x" });
    r.style.setProperty("--m", m.toFixed(4));
    r.style.setProperty("--p", p.toFixed(4));
    const x = lerp(KNOB_X0, KNOB_X1, p);
    r.style.setProperty("--kx", `${x}px`);
    icon.current?.setMorph(m);
    if (hover.current === null) showReading(p);
    const dx = x - prev.current.x;
    prev.current.x = x;
    if (!reduced.current && Math.abs(dx) > 0.8) {
      const toward = dx < 0 ? 0 : 1;
      const n = Math.min(3, 1 + Math.floor(Math.abs(dx) / 8));
      for (let i = 0; i < n; i++) {
        const spread = (rand.current() - 0.5) * 60;
        emit(
          particles.current,
          {
            x: x + KNOB / 2 + (toward === 0 ? 30 : -30) + (rand.current() - 0.5) * 24,
            y: KNOB_TOP + KNOB / 2 + spread,
            vx: (toward === 0 ? 1 : -1) * (30 + rand.current() * 90),
            vy: (rand.current() - 0.5) * 80,
            life: 0.7 + rand.current() * 0.9,
            max: 1.6,
            size: 2.5 + rand.current() * 3.5,
            kind: toward,
          },
          Math.min(PARTICLE_CAP, 80),
        );
      }
      draw.start();
    }
  };

  const knob = useKnob(rail, {
    initial: 1,
    snap: false,
    instant: typeof window !== "undefined" && prefersReducedMotion(),
    onFrame: (p) => paint(p),
  });

  useEffect(() => {
    reduced.current = prefersReducedMotion();
    const el = canvas.current;
    if (el) {
      el.width = 1720;
      el.height = 1080;
    }
    knob.set(0.82);
    prev.current.x = lerp(KNOB_X0, KNOB_X1, 0.82);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useImperativeHandle(
    handle,
    () => ({
      toggle: () => {
        hover.current = null;
        knob.toggle();
      },
    }),
    [knob],
  );

  return (
    <div ref={root} className="fx-sc fx-tp" dir="ltr" data-scene="temp" onPointerMove={onHover} onPointerDownCapture={track}>
      <div className="fx-tp-dots" aria-hidden="true" />
      <div className="fx-sc-stage">
        <div className="fx-tp-halo" aria-hidden="true" />
        <div className="fx-tp-orb moon" aria-hidden="true">
          <Moon />
        </div>
        <div className="fx-tp-orb sun" aria-hidden="true">
          <Sun />
        </div>
        <div className="fx-tp-flare" aria-hidden="true" />
        <div className="fx-tp-track" aria-hidden="true" />
        <div ref={rail} className="fx-tp-rail" aria-hidden="true" />
        <div className="fx-tp-hit" {...knob.bind} />
        <div className="fx-tp-knob" {...knob.bind}>
          <GlassKnob size={KNOB} refract={refract} className="fx-tp-glass">
            <PixelIcon ref={icon} size={62} className="fx-tp-icon" morph={0} />
          </GlassKnob>
        </div>
        <canvas ref={canvas} className="fx-tp-sheds" aria-hidden="true" />
        <div className="fx-tp-scale" aria-label={t("gallery.temp.scale")}>
          <i className="bar" />
          <span ref={marker} className="marker" />
          <b className="lo fx-mono">10,500 K</b>
          <b className="hi fx-mono">2,100 K</b>
        </div>
        <span ref={read} className="fx-tp-read fx-mono">
          5,900 K
        </span>
        <span ref={cap} className="fx-tp-cap" dir="rtl" />
      </div>
    </div>
  );
});
