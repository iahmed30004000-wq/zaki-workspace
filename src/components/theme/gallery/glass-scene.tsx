"use client";

import "../fx/exact.css";
import "./glass.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { followStep, lerp } from "@/lib/themes/switch-motion";
import { GlassKnob, isChromium } from "../fx/glass-knob";
import { paintPairs, prefersReducedMotion, useFrameLoop, useFxReader, useKnob } from "../fx/kit";
import { PixelIcon, type PixelIconHandle } from "../fx/pixel-icon";
import type { SceneHandle } from "./scene-types";

/**
 * «06 · Real glass»: a glass lozenge over a huge word. The knob is real refraction (0.72x, 22% circular bevel, red/blue split ±22%,
 * a Fresnel rim and a caustic glow that leans toward the pointer — "your pointer is the light"); it slides along a frosted track and
 * the whole page goes from the light scene to the dark one as it travels (colours mixed by the knob's position, so half way is the
 * brown the reference passes through). The four callouts keep their lines glued to points on the knob while they slide apart.
 */

const KNOB = 335;
const KNOB_TOP = 328;
const KNOB_X0 = 415; // dark: the knob rests at the left end
const KNOB_X1 = 1000; // light: at the right end
const PAIRS = ["gl-bg", "gl-ink", "gl-veil", "gl-tint", "gl-line", "gl-mono"] as const;
const CH = 13.2; // the mono labels' advance in design px
/** The reference's own monospace annotations: kept in English on purpose (they are part of the picture, not the interface). */
const FEATURES = ["REFRACTION", "DISPERSION", "FRESNEL", "CAUSTIC"] as const;

interface Callout {
  text: string;
  /** Left edge of the text when light / dark, and the baseline row. */
  xl: number;
  xd: number;
  y: number;
  side: "left" | "right";
  /** The anchor on the knob (relative to its top-left corner). */
  ax: number;
  ay: number;
}

const CALLOUTS: Callout[] = [
  { text: "BEVEL 22% · CIRCULAR PROFILE", xl: 418, xd: 30, y: 175, side: "left", ax: 15, ay: 141 },
  { text: "0.72× MAGNIFICATION", xl: 1442, xd: 946, y: 175, side: "right", ax: 200, ay: 135 },
  { text: "CAUSTIC · FOCUSED GLOW", xl: 518, xd: 30, y: 883, side: "left", ax: 103, ay: 324 },
  { text: "DISPERSION · R/B ±22%", xl: 1416, xd: 968, y: 883, side: "right", ax: 325, ay: 263 },
];

export const GlassScene = forwardRef<SceneHandle>(function GlassScene(_props, handle) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const knobWrap = useRef<HTMLDivElement>(null);
  const knobEl = useRef<HTMLSpanElement>(null);
  const icon = useRef<PixelIconHandle>(null);
  const lines = useRef<SVGPolylineElement[]>([]);
  const anchors = useRef<SVGGElement[]>([]);
  const labels = useRef<HTMLSpanElement[]>([]);
  const lightDot = useRef<HTMLSpanElement>(null);
  const reader = useFxReader(root);
  const [refract, setRefract] = useState(false);
  const pointer = useRef({ x: 1240, y: 700, tx: 1240, ty: 700, inside: false });
  const lastM = useRef(-1);

  useEffect(() => setRefract(isChromium()), []);

  const paint = (p: number) => {
    const m = 1 - p;
    const r = root.current;
    const read = reader();
    if (!r || !read) return;
    const x = lerp(KNOB_X0, KNOB_X1, p);
    if (Math.abs(m - lastM.current) > 0.0005) {
      paintPairs(r, read, PAIRS, m, { "gl-bg": "gl-bg-x" });
      r.style.setProperty("--m", m.toFixed(4));
      lastM.current = m;
    }
    r.style.setProperty("--kx", `${x}px`);
    icon.current?.setMorph(m);
    CALLOUTS.forEach((c, i) => {
      const tx = lerp(c.xl, c.xd, m);
      const w = c.text.length * CH;
      const label = labels.current[i];
      if (label) label.style.transform = `translate(${tx}px, ${c.y - 18}px)`;
      const start = c.side === "left" ? tx + w + 15 : tx - 14;
      const knee = c.side === "left" ? start + 52 : start - 51;
      const ax = x + c.ax;
      const ay = KNOB_TOP + c.ay;
      lines.current[i]?.setAttribute("points", `${start},${c.y} ${knee},${c.y} ${ax},${ay}`);
      anchors.current[i]?.setAttribute("transform", `translate(${ax} ${ay})`);
    });
    aim(x);
  };

  /** The light leans the caustic toward the pointer's side of the knob. */
  const aim = (knobX: number) => {
    const el = knobEl.current;
    if (!el) return;
    const cx = knobX + KNOB / 2;
    const cy = KNOB_TOP + KNOB / 2;
    const dx = pointer.current.x - cx;
    const dy = pointer.current.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const lx = 50 + (dx / len) * 46;
    const ly = 50 + (dy / len) * 46;
    el.style.setProperty("--lx", `${lx.toFixed(1)}%`);
    el.style.setProperty("--ly", `${ly.toFixed(1)}%`);
  };

  const light = useFrameLoop((dt) => {
    const q = pointer.current;
    q.x = followStep(q.x, q.tx, dt, 110);
    q.y = followStep(q.y, q.ty, dt, 110);
    const dot = lightDot.current;
    if (dot) dot.style.transform = `translate(${q.x - 6}px, ${q.y - 6}px)`;
    aim(lerp(KNOB_X0, KNOB_X1, knob.get()));
    return Math.abs(q.tx - q.x) + Math.abs(q.ty - q.y) > 0.4;
  });

  const knob = useKnob(rail, {
    initial: 1,
    snap: true,
    instant: typeof window !== "undefined" && prefersReducedMotion(),
    onFrame: (p) => paint(p),
    onPointer: ({ x, y }) => {
      const stage = root.current?.querySelector<HTMLElement>(".fx-sc-stage");
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const s = r.width / 1720 || 1;
      pointer.current.tx = (x - r.left) / s;
      pointer.current.ty = (y - r.top) / s;
      pointer.current.inside = true;
      light.start();
    },
  });

  useEffect(() => {
    knob.set(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useImperativeHandle(handle, () => ({ toggle: knob.toggle }), [knob.toggle]);

  return (
    <div ref={root} className="fx-sc fx-gl" dir="ltr" data-scene="glass" onPointerMove={knob.bind.onPointerMove}>
      <div className="fx-grid" aria-hidden="true" />
      <div className="fx-sc-stage">
        <div className="fx-gl-blobs" aria-hidden="true">
          <i className="b1" />
          <i className="b2" />
          <i className="b3" />
          <i className="b4" />
          <i className="b5" />
        </div>
        <div className="fx-gl-word" dir="rtl" lang="ar" aria-hidden="true">
          {t("gallery.glass.word")}
        </div>
        <div className="fx-gl-track" aria-hidden="true" />
        <div ref={rail} className="fx-gl-rail" aria-hidden="true" />
        <div className="fx-gl-hit" {...knob.bind} />
        <div ref={knobWrap} className="fx-gl-knob" {...knob.bind} data-grab="">
          <span className="fx-gl-halo" aria-hidden="true" />
          <GlassKnob ref={knobEl} size={KNOB} refract={refract} className="fx-gl-glass">
            <PixelIcon ref={icon} size={196} className="fx-gl-icon" morph={0} />
          </GlassKnob>
        </div>
        <svg className="fx-gl-lines" viewBox="0 0 1720 1080" aria-hidden="true">
          {CALLOUTS.map((c, i) => (
            <g key={c.text}>
              <polyline
                ref={(el) => {
                  if (el) lines.current[i] = el;
                }}
                fill="none"
              />
            </g>
          ))}
          {CALLOUTS.map((c, i) => (
            <g
              key={`a${c.text}`}
              ref={(el) => {
                if (el) anchors.current[i] = el;
              }}
            >
              <circle r="12" className="ring" />
              <circle r="6" className="dot" />
            </g>
          ))}
        </svg>
        {CALLOUTS.map((c, i) => (
          <span
            key={c.text}
            className="fx-gl-label"
            ref={(el) => {
              if (el) labels.current[i] = el;
            }}
          >
            {c.text}
          </span>
        ))}
        <div className="fx-gl-dots" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <i key={n} className={`d${n}`} />
          ))}
        </div>
        <div className="fx-gl-feat" aria-hidden="true">
          {FEATURES.map((f, i) => (
            <span key={f} className={i > 0 ? "sep" : undefined}>
              {f}
            </span>
          ))}
        </div>
        <p className="fx-gl-caption" dir="rtl">
          {t("gallery.glass.caption")}
        </p>
        <span ref={lightDot} className="fx-gl-light" aria-hidden="true" />
      </div>
    </div>
  );
});
