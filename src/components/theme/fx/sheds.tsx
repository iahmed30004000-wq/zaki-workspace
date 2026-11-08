"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { emit, mulberry32, rgbOf, stepParticles, type Particle, type Rgb } from "@/lib/themes/switch-motion";
import { useFrameLoop } from "./kit";

/**
 * The little things a moving knob sheds: dots, ticks, four-point sparkles toward the moon, square dots toward the sun. One small
 * canvas laid over the control (never the page), a bounded pool (`cap`, from `particleBudget`), a frame loop that only runs while
 * something is alive. `cap` 0 draws nothing at all (reduced motion, «وضع التوفير», the feature switch off).
 */
export type ShedKind = "dot" | "tick" | "star" | "square";
export interface ShedsHandle {
  puff: (x: number, y: number, dir: number, kind: ShedKind, color: Rgb) => void;
}

const KINDS: Record<ShedKind, number> = { dot: 0, tick: 1, star: 2, square: 3 };

export const Sheds = forwardRef<ShedsHandle, { width: number; height: number; cap: number; className?: string }>(function Sheds({ width, height, cap, className }, handle) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const list = useRef<Particle[]>([]);
  const colors = useRef<Rgb[]>([]);
  const rand = useRef(mulberry32(9));
  const loop = useFrameLoop((dt) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return false;
    ctx.clearRect(0, 0, el.width, el.height);
    stepParticles(list.current, dt, 1.5, 24);
    list.current.forEach((p, i) => {
      const k = Math.max(0, p.life / p.max);
      ctx.globalAlpha = k;
      ctx.fillStyle = rgbOf(colors.current[i % Math.max(1, colors.current.length)] ?? [255, 255, 255]);
      const s = p.size * (0.6 + k * 0.5);
      if (p.kind === KINDS.dot) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === KINDS.tick) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-s * 1.4, -1, s * 2.8, 2);
        ctx.restore();
      } else if (p.kind === KINDS.star) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.8);
        ctx.quadraticCurveTo(p.x, p.y, p.x + s * 1.8, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s * 1.8);
        ctx.quadraticCurveTo(p.x, p.y, p.x - s * 1.8, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s * 1.8);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    });
    ctx.globalAlpha = 1;
    return list.current.length > 0;
  });

  useImperativeHandle(handle, () => ({
    puff: (x, y, dir, kind, color) => {
      if (cap <= 0) return;
      const r = rand.current;
      emit(list.current, { x, y, vx: dir * (18 + r() * 60), vy: (r() - 0.5) * 50, life: 0.5 + r() * 0.7, max: 1.2, size: 1.2 + r() * 1.8, kind: KINDS[kind] }, cap);
      colors.current = [color];
      loop.start();
    },
  }));

  if (cap <= 0) return null;
  return <canvas ref={canvas} width={width} height={height} aria-hidden="true" className={className} style={{ width, height }} />;
});
