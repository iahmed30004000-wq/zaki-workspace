"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PIXEL_GRID, pixelFrame } from "@/lib/themes/switch-motion";

/**
 * The pixel sun / moon of the knobs: a 15 x 15 grid of small rounded squares drawn on a canvas in the element's own text colour
 * (`color`, a theme variable). `setMorph(0)` is the sun, `setMorph(1)` the moon; in between the cells scatter and re-gather
 * (the dissolve the reference shows while the knob travels). One small canvas, drawn only when the morph changes.
 */
export interface PixelIconHandle {
  setMorph: (m: number) => void;
}

export const PixelIcon = forwardRef<PixelIconHandle, { size: number; morph?: number; className?: string }>(function PixelIcon({ size, morph = 0, className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef(-1);
  const current = useRef(morph);

  const draw = (m: number) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (el.width !== px) {
      el.width = px;
      el.height = px;
    }
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = getComputedStyle(el).color;
    const cell = px / (PIXEL_GRID + 2);
    const pad = cell;
    const body = cell * 0.86;
    const radius = body * 0.18;
    for (const c of pixelFrame(m)) {
      ctx.globalAlpha = c.alpha;
      const x = pad + (c.x + c.dx) * cell + (cell - body) / 2;
      const y = pad + (c.y + c.dy) * cell + (cell - body) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, body, body, radius);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  useImperativeHandle(ref, () => ({
    setMorph: (m) => {
      const q = Math.round(Math.min(1, Math.max(0, m)) * 60) / 60;
      current.current = q;
      if (q === last.current) return;
      last.current = q;
      draw(q);
    },
  }));

  useEffect(() => {
    last.current = -1;
    draw(current.current);
    // the colour may change with the theme: redraw once the page has applied it
    const t = setTimeout(() => draw(current.current), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return <canvas ref={canvas} aria-hidden="true" className={className} style={{ width: size, height: size }} />;
});
