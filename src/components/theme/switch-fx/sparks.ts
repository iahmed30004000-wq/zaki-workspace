import { MAX_PARTICLES, sparkSeeds } from "@/lib/themes/switch-fx";

/**
 * A burst of sparks where the reveal starts: one small canvas (260 x 260 px, never the whole screen) for 700 ms, drawn with
 * requestAnimationFrame only while it lasts, at most `MAX_PARTICLES` (60) dots. Colour from the theme's `--fx-spark` variable.
 * A second burst cancels the first; `stopSparks()` removes everything at once (the switch calls it when it unmounts).
 */

const SIZE = 260;
const DURATION_MS = 700;

let active: { raf: number; canvas: HTMLCanvasElement } | null = null;

export function stopSparks(): void {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  active.canvas.remove();
  active = null;
}

export function burstSparks({ x, y, count, seed }: { x: number; y: number; count: number; seed: number }): void {
  if (typeof document === "undefined") return;
  stopSparks();
  const seeds = sparkSeeds(Math.min(count, MAX_PARTICLES), seed);
  if (seeds.length === 0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", left: `${x - SIZE / 2}px`, top: `${y - SIZE / 2}px`, width: `${SIZE}px`, height: `${SIZE}px`, pointerEvents: "none", zIndex: "9999" });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const triplet = getComputedStyle(document.documentElement).getPropertyValue("--fx-spark").trim() || "255 200 100";
  document.body.appendChild(canvas);
  const start = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION_MS);
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (const s of seeds) {
      const life = t / s.life;
      if (life >= 1) continue;
      const eased = 1 - (1 - life) * (1 - life);
      const dist = s.speed * (SIZE / 2 - 8) * eased;
      ctx.fillStyle = `rgb(${triplet} / ${(1 - life).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(SIZE / 2 + Math.cos(s.angle) * dist, SIZE / 2 + Math.sin(s.angle) * dist, s.size * (1 - life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    if (t < 1 && active) active.raf = requestAnimationFrame(frame);
    else stopSparks();
  };
  active = { raf: requestAnimationFrame(frame), canvas };
}
