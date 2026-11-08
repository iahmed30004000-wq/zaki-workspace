"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { clamp01, followStep, mixRgb, parseTriplet, settleTarget, springDone, springStep, trackPosition, tripletOf, type Rgb, type Spring } from "@/lib/themes/switch-motion";

/**
 * The shared plumbing of the exact switch variants (gallery and top bar): reading the `--fx-*` illustration tokens, a frame loop
 * that only runs while something moves, and the knob (drag with a short lag, release with a little overshoot).
 * Everything here writes to the DOM directly; React renders each variant once and never per frame.
 */

/** A token of the generated stylesheet as colours: `fx("gl-bg-l")` reads `--fx-gl-bg-l`. Cached per element tree. */
export type FxReader = (name: string) => Rgb;

const FALLBACK: Rgb = [128, 128, 128];

export function makeFxReader(el: HTMLElement): FxReader {
  const style = getComputedStyle(el);
  const cache = new Map<string, Rgb>();
  return (name) => {
    const hit = cache.get(name);
    if (hit) return hit;
    const parsed = parseTriplet(style.getPropertyValue(`--fx-${name}`)) ?? FALLBACK;
    cache.set(name, parsed);
    return parsed;
  };
}

/** The two ends of a pair of tokens (`<name>-l`, `<name>-d`) mixed by `m` (0 = the light scene, 1 = the dark one). */
export function pairMix(read: FxReader, name: string, m: number): Rgb {
  return mixRgb(read(`${name}-l`), read(`${name}-d`), m);
}

/** Write `--s-<name>: R G B` for each pair onto an element (the stylesheet reads them as `rgb(var(--s-name))`); a pair may pass through a third colour `mids[name]` (the muddy brown the reference crosses). */
export function paintPairs(el: HTMLElement, read: FxReader, names: readonly string[], m: number, mids: Readonly<Record<string, string>> = {}): void {
  for (const n of names) {
    const mid = mids[n];
    const c = mid ? (m < 0.5 ? mixRgb(read(`${n}-l`), read(mid), m * 2) : mixRgb(read(mid), read(`${n}-d`), (m - 0.5) * 2)) : pairMix(read, n, m);
    el.style.setProperty(`--s-${n}`, tripletOf(c));
  }
}
export function useFxReader(ref: { current: HTMLElement | null }): () => FxReader | null {
  const reader = useRef<FxReader | null>(null);
  return useCallback(() => {
    if (!reader.current && ref.current) reader.current = makeFxReader(ref.current);
    return reader.current;
  }, [ref]);
}

/** A requestAnimationFrame loop that starts on demand and stops itself when `tick` returns false (or on unmount). */
export function useFrameLoop(tick: (dtMs: number, nowMs: number) => boolean): { start: () => void; stop: () => void } {
  const fn = useRef(tick);
  fn.current = tick;
  const raf = useRef(0);
  const last = useRef(0);
  const run = useRef(false);
  const loop = useCallback((now: number) => {
    raf.current = 0;
    if (!run.current) return;
    const dt = last.current ? Math.min(64, now - last.current) : 16;
    last.current = now;
    if (fn.current(dt, now)) raf.current = requestAnimationFrame(loop);
    else run.current = false;
  }, []);
  const start = useCallback(() => {
    if (run.current) return;
    run.current = true;
    last.current = 0;
    raf.current = requestAnimationFrame(loop);
  }, [loop]);
  const stop = useCallback(() => {
    run.current = false;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);
  useEffect(() => stop, [stop]);
  return { start, stop };
}

export interface KnobOptions {
  /** Where the knob rests first (0..1). */
  initial: number;
  /** Called every frame with the knob's position and the frame's length. Write the DOM here. */
  onFrame: (p: number, dtMs: number) => void;
  /** After a release (or a toggle) has settled on an end, or any release when `snap` is false. */
  onSettled?: (p: number, end: 0 | 1 | null) => void;
  /** Fired when a drag or a toggle starts and when the pointer moves (for particles / pointer light). */
  onPointer?: (e: { x: number; y: number; dragging: boolean }) => void;
  /** Let go on the nearer end (glass, lamp, repaint) or stay where dropped (sky, colour temperature). */
  snap: boolean;
  /** How far the pointer must travel before a press counts as a drag and not a click (px). */
  travel?: number;
  /** The follow lag while dragging (ms). */
  tau?: number;
  /** Disabled (reduced motion keeps the controls, only the flourish goes: positions jump instead of gliding). */
  instant?: boolean;
}

export interface KnobApi {
  /** The current position. */
  get: () => number;
  /** Jump (no animation). */
  set: (p: number) => void;
  /** Glide to an end (Space, the Toggle button, a click). */
  goTo: (end: 0 | 1) => void;
  toggle: () => void;
  /** Pointer handlers for the draggable element; `trackRef` is the element whose box is the track. */
  bind: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  dragging: () => boolean;
}

/**
 * The knob. While dragging it follows the pointer with `followStep` (a short lag, whatever the frame rate); on release it flies
 * to the nearer end on a damped spring (`springStep`, a flick carries it over the middle: `settleTarget`) or stays where it was
 * dropped. A press without travel on the track is a click: it toggles. Positions are 0 at the left edge of `trackRef`, 1 at the right.
 */
export function useKnob(trackRef: { current: HTMLElement | null }, options: KnobOptions): KnobApi {
  const opts = useRef(options);
  opts.current = options;
  const s = useRef({
    p: options.initial,
    target: options.initial,
    spring: { x: options.initial, v: 0 } as Spring,
    mode: "rest" as "rest" | "drag" | "spring",
    rect: { left: 0, width: 1 },
    startX: 0,
    travelled: false,
    lastX: 0,
    lastT: 0,
    vel: 0,
    springTarget: 0 as 0 | 1,
  });

  const loop = useFrameLoop((dt) => {
    const st = s.current;
    const o = opts.current;
    if (st.mode === "drag") {
      st.p = o.instant ? st.target : followStep(st.p, st.target, dt, o.tau ?? 70);
      o.onFrame(st.p, dt);
      return true;
    }
    if (st.mode === "spring") {
      if (o.instant) st.spring = { x: st.springTarget, v: 0 };
      else st.spring = springStep(st.spring, st.springTarget, dt);
      st.p = clamp01(st.spring.x);
      o.onFrame(st.p, dt);
      if (springDone(st.spring, st.springTarget) || o.instant) {
        st.p = st.springTarget;
        st.spring = { x: st.p, v: 0 };
        st.mode = "rest";
        o.onFrame(st.p, dt);
        o.onSettled?.(st.p, st.springTarget);
        return false;
      }
      return true;
    }
    return false;
  });

  const goTo = useCallback(
    (end: 0 | 1) => {
      const st = s.current;
      st.spring = { x: st.p, v: 0 };
      st.springTarget = end;
      st.mode = "spring";
      loop.start();
    },
    [loop],
  );

  const bind = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      const track = trackRef.current;
      if (!track || e.button !== 0) return;
      const r = track.getBoundingClientRect();
      const st = s.current;
      st.rect = { left: r.left, width: r.width };
      st.startX = e.clientX;
      st.lastX = e.clientX;
      st.lastT = performance.now();
      st.vel = 0;
      st.travelled = false;
      st.mode = "drag";
      st.target = trackPosition(e.clientX, r.left, r.width);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      loop.start();
      opts.current.onPointer?.({ x: e.clientX, y: e.clientY, dragging: true });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const st = s.current;
      opts.current.onPointer?.({ x: e.clientX, y: e.clientY, dragging: st.mode === "drag" });
      if (st.mode !== "drag") return;
      const now = performance.now();
      const nextP = trackPosition(e.clientX, st.rect.left, st.rect.width);
      const dt = Math.max(1, now - st.lastT);
      st.vel = st.vel * 0.6 + ((nextP - st.target) / dt) * 1000 * 0.4;
      st.target = nextP;
      st.lastX = e.clientX;
      st.lastT = now;
      if (Math.abs(e.clientX - st.startX) > (opts.current.travel ?? 4)) st.travelled = true;
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const st = s.current;
      if (st.mode !== "drag") return;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      const o = opts.current;
      if (!st.travelled && o.snap) {
        goTo(st.p >= 0.5 ? 0 : 1);
        return;
      }
      if (o.snap) goTo(settleTarget(st.p, st.vel));
      else {
        st.mode = "rest";
        o.onSettled?.(st.p, null);
        loop.stop();
      }
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      const st = s.current;
      if (st.mode !== "drag") return;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (opts.current.snap) goTo(st.p >= 0.5 ? 1 : 0);
      else st.mode = "rest";
    },
  };

  return {
    get: () => s.current.p,
    set: (p) => {
      const st = s.current;
      st.p = clamp01(p);
      st.target = st.p;
      st.spring = { x: st.p, v: 0 };
      st.mode = "rest";
      loop.stop();
      opts.current.onFrame(st.p, 16);
    },
    goTo,
    toggle: () => goTo(s.current.p >= 0.5 ? 0 : 1),
    bind,
    dragging: () => s.current.mode === "drag",
  };
}

/** `prefers-reduced-motion: reduce` read once when asked (the showcase keeps working, only the flourishes and glides stop). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
