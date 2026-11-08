"use client";

import { forwardRef, useId, useImperativeHandle, useRef } from "react";
import { lerp, mixRgb, rgbOf, skyBodies, skyKeyBlend, type Rgb } from "@/lib/themes/switch-motion";
import { makeFxReader, type FxReader } from "./kit";

/**
 * The sky: an SVG landscape in a horizontal pill (mountains, pines, a cabin with smoke, a lake with a sailboat, birds, clouds)
 * that a time of day (minutes 0..720: midnight .. noon) repaints — the sky gradient, the sun and the moon on their arcs, stars,
 * an aurora, the window of the cabin, drifting lanterns. `paint(minute)` writes attributes straight onto the shapes (no React
 * render while the pointer drags) and returns the page colour so a scene can tint its own background to match.
 * Every colour is read from the `--fx-sk*` / `--fx-*` tokens (palettes.ts).
 */

export interface SkyPaint {
  page: Rgb;
  /** 0 = night page, 1 = day page: the caption's ink. */
  day: number;
}
export interface SkyArtHandle {
  paint: (minute: number) => SkyPaint;
}

const W = 1080;
const H = 430;
const PINES = Array.from({ length: 40 }, (_, i) => {
  const x = 8 + i * 27 + ((i * 17) % 9);
  const h = 24 + ((i * 7) % 5) * 5;
  return `M${x - 8} 322 L${x} ${322 - h} L${x + 8} 322Z`;
}).join("");
const STARS = Array.from({ length: 46 }, (_, i) => ({ x: (i * 197) % 1040 + 20, y: (i * 89) % 190 + 14, r: 1 + (i % 4) * 0.45 }));
const LANTERNS = [
  { x: 150, y: 338 }, { x: 250, y: 330 }, { x: 468, y: 336 }, { x: 560, y: 326 }, { x: 640, y: 342 }, { x: 760, y: 331 }, { x: 905, y: 338 }, { x: 985, y: 328 },
];
const CLOUD = [
  { x: 520, y: 112, rx: 200, ry: 56 }, { x: 395, y: 132, rx: 140, ry: 46 }, { x: 690, y: 126, rx: 160, ry: 48 }, { x: 300, y: 154, rx: 96, ry: 34 },
  { x: 840, y: 152, rx: 128, ry: 38 }, { x: 560, y: 86, rx: 120, ry: 38 }, { x: 160, y: 150, rx: 90, ry: 30 },
];

function mixKeys(read: FxReader, name: string, from: number, to: number, t: number): Rgb {
  return mixRgb(read(`sk${from}-${name}`), read(`sk${to}-${name}`), t);
}

export const SkyArt = forwardRef<SkyArtHandle, { className?: string }>(function SkyArt({ className }, handle) {
  const uid = `zksk${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const reader = useRef<FxReader | null>(null);
  const el = useRef<Record<string, SVGElement | null>>({});
  const set = (key: string) => (node: SVGElement | null) => {
    el.current[key] = node;
  };

  useImperativeHandle(handle, () => ({
    paint: (minute) => {
      const s = svg.current;
      if (!s) return { page: [0, 0, 0], day: 0 };
      if (!reader.current) reader.current = makeFxReader(s as unknown as HTMLElement);
      const read = reader.current;
      const b = skyKeyBlend(minute);
      const bodies = skyBodies(minute);
      const top = mixKeys(read, "top", b.from, b.to, b.t);
      const low = mixKeys(read, "low", b.from, b.to, b.t);
      const mid = mixRgb(top, low, 0.55);
      const far = mixKeys(read, "far", b.from, b.to, b.t);
      const near = mixKeys(read, "near", b.from, b.to, b.t);
      const page = mixKeys(read, "page", b.from, b.to, b.t);
      const css = (k: string, name: string, v: string) => el.current[k]?.setAttribute(name, v);
      css("t", "stop-color", rgbOf(top));
      css("m", "stop-color", rgbOf(mid));
      css("l", "stop-color", rgbOf(low));
      css("far", "fill", rgbOf(far));
      css("near", "fill", rgbOf(near));
      css("pines", "fill", rgbOf(mixRgb(read("sk-pine"), near, 0.2)));
      const lake = mixRgb(read("sk-lake-night"), read("sk-lake-day"), bodies.day);
      css("lake1", "stop-color", rgbOf(mixRgb(lake, low, 0.35)));
      css("lake2", "stop-color", rgbOf(lake));
      // sun
      css("sun", "transform", `translate(${(bodies.sun.x * W).toFixed(1)} ${(bodies.sun.y * 300).toFixed(1)})`);
      css("sun", "opacity", String(bodies.sun.alpha));
      // moon
      css("moon", "transform", `translate(${(bodies.moon.x * W).toFixed(1)} ${(bodies.moon.y * 300).toFixed(1)})`);
      css("moon", "opacity", String(bodies.moon.alpha));
      css("stars", "opacity", String(bodies.stars));
      css("aurora", "opacity", String(bodies.aurora));
      css("window", "opacity", String(Math.max(0.12, bodies.windowLight)));
      css("lanterns", "opacity", String(Math.min(1, bodies.stars * 0.9 + 0.05)));
      css("birds", "opacity", String(bodies.day * 0.85));
      css("boat", "opacity", String(0.35 + bodies.day * 0.65));
      // clouds: white at noon, pink at the golden hour and in the morning, a thin violet haze at night
      const warm = Math.max(0, 1 - Math.abs(minute - 380) / 190);
      const cloud = mixRgb(mixRgb(read("sk0-low"), read("sk-cloud-pink"), Math.min(1, bodies.clouds * 1.5)), read("cloud"), Math.max(0, 1 - warm) * bodies.day);
      css("clouds", "fill", rgbOf(cloud));
      css("clouds", "opacity", String(lerp(0.08, 0.95, bodies.clouds)));
      css("sunrays", "opacity", String(bodies.sun.alpha * (1 - warm * 0.4)));
      return { page, day: bodies.day };
    },
  }));

  return (
    <svg ref={svg} className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}s`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" ref={set("t")} />
          <stop offset="0.55" ref={set("m")} />
          <stop offset="1" ref={set("l")} />
        </linearGradient>
        <linearGradient id={`${uid}w`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" ref={set("lake1")} />
          <stop offset="1" ref={set("lake2")} />
        </linearGradient>
        <radialGradient id={`${uid}g`}>
          <stop offset="0" stopColor="rgb(var(--fx-sun))" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="rgb(var(--fx-sun))" stopOpacity="0.35" />
          <stop offset="1" stopColor="rgb(var(--fx-sun))" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}m`}>
          <stop offset="0" stopColor="rgb(var(--fx-moon))" stopOpacity="0.5" />
          <stop offset="1" stopColor="rgb(var(--fx-moon))" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}a`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="rgb(var(--fx-aurora-a))" stopOpacity="0" />
          <stop offset="0.35" stopColor="rgb(var(--fx-aurora-a))" stopOpacity="0.7" />
          <stop offset="0.75" stopColor="rgb(var(--fx-aurora-b))" stopOpacity="0.45" />
          <stop offset="1" stopColor="rgb(var(--fx-aurora-b))" stopOpacity="0" />
        </linearGradient>
        <filter id={`${uid}b`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`${uid}c`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <mask id={`${uid}k`}>
          <rect x="-40" y="-40" width="80" height="80" fill="white" />
          <circle cx="11" cy="-7" r="23" fill="black" />
        </mask>
      </defs>
      <rect width={W} height={H} fill={`url(#${uid}s)`} />
      <g ref={set("aurora")}>
        <path d="M0 70 C 140 20, 290 120, 470 70 S 760 30, 900 80 L900 150 C 760 110, 600 170, 440 130 S 130 150, 0 130Z" fill={`url(#${uid}a)`} filter={`url(#${uid}b)`} />
      </g>
      <g ref={set("stars")} fill="rgb(var(--fx-star))">
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={0.45 + (i % 3) * 0.25} />
        ))}
        <path d="M820 40 L900 62" stroke="rgb(var(--fx-star))" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      </g>
      <g ref={set("sun")}>
        <circle r="150" fill={`url(#${uid}g)`} />
        <g ref={set("sunrays")} stroke="rgb(var(--fx-sun))" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return <line key={i} x1={Math.cos(a) * 44} y1={Math.sin(a) * 44} x2={Math.cos(a) * (70 + (i % 2) * 26)} y2={Math.sin(a) * (70 + (i % 2) * 26)} />;
          })}
        </g>
        <circle r="38" fill="rgb(var(--fx-sun))" />
        <circle r="38" fill="none" stroke="rgb(var(--fx-cloud))" strokeOpacity="0.55" strokeWidth="4" />
      </g>
      <g ref={set("moon")}>
        <circle r="70" fill={`url(#${uid}m)`} />
        <circle r="26" fill="rgb(var(--fx-moon))" mask={`url(#${uid}k)`} />
        <circle r="26" fill="rgb(var(--fx-moon))" opacity="0.88" />
        <circle cx="-8" cy="6" r="6" fill="rgb(var(--fx-sky-night-low))" opacity="0.22" />
        <circle cx="7" cy="-9" r="4" fill="rgb(var(--fx-sky-night-low))" opacity="0.2" />
      </g>
      <g ref={set("clouds")} filter={`url(#${uid}c)`}>
        {CLOUD.map((c, i) => (
          <ellipse key={i} cx={c.x} cy={c.y} rx={c.rx} ry={c.ry} />
        ))}
      </g>
      <g ref={set("birds")} fill="none" stroke="rgb(var(--fx-hill-near))" strokeWidth="2.4" strokeLinecap="round">
        <path d="M760 66 q7 -8 14 0 q7 -8 14 0" />
        <path d="M885 104 q6 -7 12 0 q6 -7 12 0" />
        <path d="M968 62 q5 -6 10 0 q5 -6 10 0" />
        <path d="M700 40 q5 -6 10 0 q5 -6 10 0" />
      </g>
      <path ref={set("far")} d="M0 262 L70 238 L150 258 L260 205 L330 226 L430 188 L520 214 L610 176 L700 208 L800 192 L900 232 L1000 214 L1080 236 L1080 340 L0 340Z" />
      <path ref={set("near")} d="M0 300 L120 276 L240 298 L380 262 L520 292 L660 270 L800 296 L940 274 L1080 292 L1080 345 L0 345Z" />
      <path ref={set("pines")} d={PINES} />
      <g>
        <path d="M340 298 L360 280 L384 298Z" fill="rgb(var(--fx-sk-cabin))" />
        <rect x="344" y="298" width="36" height="24" fill="rgb(var(--fx-sk-cabin))" />
        <rect ref={set("window")} x="354" y="304" width="14" height="9" fill="rgb(var(--fx-sk-window))" />
        <path d="M373 280 q-9 -22 4 -40 q12 -18 0 -38" fill="none" stroke="rgb(var(--fx-cloud))" strokeOpacity="0.5" strokeWidth="6" strokeLinecap="round" className="fx-smoke" />
      </g>
      <rect y="322" width={W} height={H - 322} fill={`url(#${uid}w)`} />
      <g stroke="rgb(var(--fx-cloud))" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round">
        <path d="M322 340 h70 M334 350 h50 M342 360 h30" />
        <path d="M805 350 h60 M815 360 h40 M825 370 h20" />
        <path d="M150 344 h50 M520 350 h70" />
      </g>
      <g ref={set("boat")} transform="translate(836 330)">
        <path d="M-2 -34 L-2 2 L-26 2Z" fill="rgb(var(--fx-cloud))" />
        <path d="M3 -28 L3 2 L24 2Z" fill="rgb(var(--fx-cloud))" opacity="0.85" />
        <path d="M-28 4 L28 4 L20 12 L-20 12Z" fill="rgb(var(--fx-hill-near))" />
      </g>
      <g ref={set("lanterns")} className="fx-lanterns">
        {LANTERNS.map((l, i) => (
          <g key={i} transform={`translate(${l.x} ${l.y})`}>
            <circle r="9" fill="rgb(var(--fx-sk-window))" opacity="0.3" />
            <circle r="3.2" fill="rgb(var(--fx-sk-window))" />
          </g>
        ))}
      </g>
    </svg>
  );
});
