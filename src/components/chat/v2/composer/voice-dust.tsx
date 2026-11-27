"use client";

import React from "react";
import { effectOn } from "@/lib/motion/effects";
import { dustAt, dustBurst, VOICE_DUST_CAP } from "@/lib/chat/v2/composer/voice-dust-model";

/**
 * The blue dust a thrown-away recording falls into (`tgPhone`): one canvas over the row, our own particles pulled into the bin, at most
 * `VOICE_DUST_CAP` of them, all inside it by `ms`. «غبار الحذف» off (or less motion asked for): nothing is drawn at all. The colour is the canvas's own
 * text colour (the theme's accent).
 *
 * The bin is the row's FIRST item, so which end it sits at is the row's own direction, asked of the browser: the phone look runs the recording row left to
 * right (the bin on the left) inside a right-to-left page, and a side written down here once sent the dust the opposite way.
 */
export function VoiceDust({ ms }: { ms: number }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !effectOn("dust")) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!ctx || width === 0 || height === 0) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(canvas);
    const colour = style.color;
    const toRight = style.direction === "rtl";
    const specks = dustBurst({ width, height, toRight, ms, count: VOICE_DUST_CAP, seed: Date.now() % 100_000 });
    const began = performance.now();
    let frame = requestAnimationFrame(function draw(now) {
      const at = now - began;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colour;
      for (const speck of specks) {
        const p = dustAt(speck, at);
        if (!p) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (at < ms) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, width, height);
    });
    return () => cancelAnimationFrame(frame);
  }, [ms]);
  return <canvas ref={ref} data-voice-dust aria-hidden="true" className="pointer-events-none absolute inset-0 size-full text-accent" />;
}
