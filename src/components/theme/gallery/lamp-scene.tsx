"use client";

import "../fx/exact.css";
import "./lamp.css";
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { PARTICLE_CAP, dayBars, emit, lampStats, lerp, mulberry32, rgbOf, sparkline, stepParticles, formatKelvin, type Particle } from "@/lib/themes/switch-motion";
import { paintPairs, prefersReducedMotion, useFrameLoop, useFxReader, useKnob } from "../fx/kit";
import { PixelIcon, type PixelIconHandle } from "../fx/pixel-icon";
import type { SceneHandle } from "./scene-types";

/**
 * «02 · The knob is the lamp»: a pill slider whose square knob lights a whole analytics dashboard. Dragging moves the light:
 * the page, the rays, the colour of the bars and the numbers (lux, colour temperature, the % readout) all follow the knob's
 * position, so half way is a muddy violet-brown like the reference. The knob sheds small dots while it moves.
 * The numbers on the cards are FAKE (they only exist inside the gallery).
 */

const KNOB_X0 = 600;
const KNOB_X1 = 996;
const KNOB_TOP = 68;
const KNOB_W = 120;
const PAIRS = ["lp-bg", "lp-card", "lp-ink", "lp-mute", "lp-bar", "lp-ray", "lp-track", "lp-edge", "lp-line"] as const;

const BARS = dayBars(24);
const SPARKS = [sparkline(8, 11, 0.55), sparkline(8, 23, 0.4), sparkline(8, 37, 0.45)];

const Spark = memo(function Spark({ values }: { values: number[] }) {
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 472},${72 - v * 90}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 472 90" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="fxlpg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgb(var(--s-lp-line))" stopOpacity="0.28" />
          <stop offset="1" stopColor="rgb(var(--s-lp-line))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,90 ${pts} 472,90`} fill="url(#fxlpg)" />
      <polyline points={pts} fill="none" stroke="rgb(var(--s-lp-line))" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
});

export const LampScene = forwardRef<SceneHandle>(function LampScene(_props, handle) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const icon = useRef<PixelIconHandle>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const lux = useRef<HTMLSpanElement>(null);
  const kel = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reader = useFxReader(root);
  const particles = useRef<Particle[]>([]);
  const prev = useRef({ p: 1, x: 0 });
  const rand = useRef(mulberry32(5));
  const reduced = useRef(false);

  const draw = useFrameLoop((dt) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const read = reader();
    if (!el || !ctx || !read) return false;
    ctx.clearRect(0, 0, el.width, el.height);
    stepParticles(particles.current, dt, 1.6, 90);
    const m = 1 - prev.current.p;
    for (const p of particles.current) {
      const k = Math.max(0, p.life / p.max);
      ctx.globalAlpha = k;
      ctx.fillStyle = rgbOf(m > 0.5 ? [255, 255, 255] : read("lp-ray-l"), 1);
      if (p.kind === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size * 1.6, -1.2, p.size * 3.2, 2.4);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    return particles.current.length > 0;
  });

  const paint = (p: number) => {
    const r = root.current;
    const read = reader();
    if (!r || !read) return;
    const m = 1 - p;
    paintPairs(r, read, PAIRS, m, { "lp-bg": "lp-bg-x" });
    r.style.setProperty("--m", m.toFixed(4));
    const x = lerp(KNOB_X0, KNOB_X1, p);
    r.style.setProperty("--kx", `${x}px`);
    icon.current?.setMorph(m);
    const s = lampStats(p);
    if (pct.current) pct.current.textContent = `${s.pct}%`;
    if (lux.current) lux.current.textContent = String(s.lux);
    if (kel.current) kel.current.textContent = formatKelvin(s.kelvin);
    const moved = Math.abs(x - prev.current.x);
    prev.current = { p, x };
    if (!reduced.current && moved > 0.8) {
      const n = Math.min(3, 1 + Math.floor(moved / 6));
      for (let i = 0; i < n; i++) {
        const a = rand.current() * Math.PI * 2;
        const sp = 30 + rand.current() * 120;
        emit(particles.current, { x: x + KNOB_W / 2 - 20 + rand.current() * 40, y: KNOB_TOP + 60 + rand.current() * 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, life: 0.7 + rand.current() * 0.9, max: 1.6, size: 2 + rand.current() * 3, kind: rand.current() < 0.35 ? 1 : 0 }, Math.min(PARTICLE_CAP, 70));
      }
      draw.start();
    }
  };

  const knob = useKnob(rail, {
    initial: 1,
    snap: true,
    instant: typeof window !== "undefined" && prefersReducedMotion(),
    onFrame: (p) => paint(p),
  });

  useEffect(() => {
    reduced.current = prefersReducedMotion();
    const el = canvas.current;
    if (el) {
      el.width = 1720;
      el.height = 420;
    }
    knob.set(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useImperativeHandle(handle, () => ({ toggle: knob.toggle }), [knob.toggle]);

  const rows = [
    { c: "red", w: 322, ok: true },
    { c: "blue", w: 262, ok: true },
    { c: "green", w: 202, ok: false },
  ];

  return (
    <div ref={root} className="fx-sc fx-lp" dir="ltr" data-scene="lamp">
      <div className="fx-lp-glow" aria-hidden="true" />
      <div className="fx-sc-stage">
        <div className="fx-lp-rays" aria-hidden="true" />
        <div className="fx-lp-track" aria-hidden="true" />
        <div ref={rail} className="fx-lp-rail" aria-hidden="true" />
        <span className="fx-lp-label fx-mono">{t("gallery.lamp.label")}</span>
        <span ref={pct} className="fx-lp-pct fx-mono">
          100%
        </span>
        <div className="fx-lp-hit" {...knob.bind} />
        <div className="fx-lp-knob" {...knob.bind}>
          <PixelIcon ref={icon} size={78} className="fx-lp-icon" morph={0} />
        </div>
        <canvas ref={canvas} className="fx-lp-sheds" aria-hidden="true" />

        <div className="fx-lp-card c1">
          <p className="k">{t("gallery.lamp.daylight")}</p>
          <p className="v">{t("gallery.lamp.hours")}</p>
          <Spark values={SPARKS[0] ?? []} />
        </div>
        <div className="fx-lp-card c2">
          <p className="k">{t("gallery.lamp.lux")}</p>
          <p className="v">
            <span ref={lux}>738</span>
          </p>
          <Spark values={SPARKS[1] ?? []} />
        </div>
        <div className="fx-lp-card c3">
          <p className="k">{t("gallery.lamp.temp")}</p>
          <p className="v">
            <span ref={kel}>2,900 K</span>
          </p>
          <Spark values={SPARKS[2] ?? []} />
        </div>
        <div className="fx-lp-card big">
          <p className="h">{t("gallery.lamp.chart")}</p>
          <p className="s">{t("gallery.lamp.chart_sub")}</p>
          <div className="bars">
            {BARS.map((b, i) => (
              <i key={i} style={{ height: `${b * 100}%` }} />
            ))}
          </div>
          <div className="ticks fx-lp-ticks">
            <span style={{ left: 35 }}>00</span>
            <span style={{ left: 274 }}>06</span>
            <span style={{ left: 513 }}>12</span>
            <span style={{ left: 752 }}>18</span>
          </div>
        </div>
        <div className="fx-lp-card room">
          <p className="h">{t("gallery.lamp.room")}</p>
          {rows.map((r, i) => (
            <div key={r.c} className="row" style={{ top: 88 + i * 82 }}>
              <b className={r.c} />
              <i className="l1" style={{ width: r.w }} />
              <i className="l2" style={{ width: r.w * 0.56 }} />
              <u className={r.ok ? "ok" : "off"} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
