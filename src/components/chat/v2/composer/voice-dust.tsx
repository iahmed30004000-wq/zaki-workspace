"use client";

import React from "react";
import { effectOn } from "@/lib/motion/effects";
import { dustBurst, VOICE_DUST_CAP } from "@/lib/chat/v2/composer/voice-dust-model";
import { stepParticles } from "@/lib/themes/switch-motion";

/**
 * The blue dust a thrown-away recording falls into (`tgPhone`): one canvas over the row, our own particles flying toward the bin, at most
 * `VOICE_DUST_CAP` of them, gone after `ms`. «غبار الحذف» off (or less motion asked for): nothing is drawn at all. The colour is the canvas's own text
 * colour (the theme's accent).
 */
export function VoiceDust({ ms, toRight }: { ms: number; /** the bin is at the right end of the row (a right-to-left page) */ toRight: boolean }) {
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
    const colour = getComputedStyle(canvas).color;
    const particles = dustBurst({ width, height, toRight, ms, count: VOICE_DUST_CAP, seed: Date.now() % 100_000 });
    let last = performance.now();
    const began = last;
    let frame = requestAnimationFrame(function draw(now) {
      stepParticles(particles, now - last, 1.1, 0);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colour;
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (now - began < ms && particles.length > 0) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, width, height);
    });
    return () => cancelAnimationFrame(frame);
  }, [ms, toRight]);
  return <canvas ref={ref} data-voice-dust aria-hidden="true" className="pointer-events-none absolute inset-0 size-full text-accent" />;
}
