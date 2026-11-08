import { PARTICLE_CAP, emit, mulberry32, repaintPercent, revealEase, revealPolygon, shardSeeds, stepParticles, mixRgb, parseTriplet, rgbOf, type Particle, type RevealLook, type Rgb } from "@/lib/themes/switch-motion";
import { motionAllowed, revealRadius, type FxGate } from "@/lib/themes/switch-fx";

/**
 * The theme change as a torn-ink reveal that grows from where the person pressed — «repainting NN%».
 *
 * The View Transitions API snapshots the old page, `apply()` repaints the real one underneath, and the NEW page is shown through a
 * clip-path polygon this script re-computes every frame (`--zk-clip` on <html>, read by `::view-transition-new(root)` in globals.css):
 * a spiky torn edge for `shards`, a soft wobbling blot for `ink`. On top, in a layer of its own (`view-transition-name: zk-overlay`,
 * so it stays above both snapshots) one canvas draws what the reference draws: loose shards of the new colour running ahead of the
 * edge, thin trails with a bright head flying outward, expanding rings, and the small «repainting NN%» pill with a progress line.
 *
 * Bounded on purpose: one canvas, at most `PARTICLE_CAP` live particles (and `particleBudget` for the switch in the top bar), about
 * two seconds, only while a change runs. No View Transitions, prefers-reduced-motion, «وضع التوفير» or the feature switched off:
 * `apply()` runs at once and nothing else happens. This file is only fetched when somebody uses the switch.
 */

export interface RevealOptions {
  /** Viewport coordinates the reveal grows from (the pressed knob). */
  origin: { x: number; y: number };
  gate: FxGate;
  /** Varies the torn edge between presses. */
  seed?: number;
  look?: RevealLook;
  /** Going to a dark page (violet sparks, dark shards) or to a light one (amber sparks, light shards). */
  toDark?: boolean;
  /** The words on the pill («إعادة الطلاء 46%»); without it the pill is not drawn. */
  label?: (percent: number) => string;
  /** Overrides the default length (ms). */
  durationMs?: number;
  /** The most particles this reveal may hold (the top bar's switch asks for fewer). */
  particles?: number;
}

const DURATION = { shards: 2000, ink: 1500 } as const;

let cancel: (() => void) | null = null;

/** Remove whatever a running reveal drew (the switch calls it when it unmounts). */
export function cancelReveal(): void {
  cancel?.();
  cancel = null;
}

function token(name: string, fallback: Rgb): Rgb {
  return parseTriplet(getComputedStyle(document.documentElement).getPropertyValue(`--fx-${name}`)) ?? fallback;
}

export async function changeThemeWithReveal(apply: () => void, options: RevealOptions): Promise<void> {
  const { origin, gate } = options;
  const look = options.look ?? "shards";
  const seed = options.seed ?? 1;
  if (!motionAllowed(gate) || typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  cancelReveal();
  const root = document.documentElement;
  const toDark = options.toDark ?? true;
  const duration = options.durationMs ?? DURATION[look];
  const w = window.innerWidth;
  const h = window.innerHeight;
  // the percentage is the share of the way to the farthest corner: 100% is the moment the torn edge has covered it
  const radius = revealRadius(origin.x, origin.y, w, h) * 0.9;
  const accent = token(toDark ? "lm-spark-d" : "lm-spark-l", [255, 176, 32]);
  const ink = token(toDark ? "lm-bg-d" : "lm-bg-l", [15, 16, 23]);
  const rim = mixRgb(accent, [255, 255, 255], 0.35);

  // the overlay exists in the old page too, so it is a named group of its own that is never cross-faded
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.zkOverlay = "";
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "9999", viewTransitionName: "zk-overlay" });
  const canvas = document.createElement("canvas");
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
  layer.appendChild(canvas);
  let pillText: HTMLSpanElement | null = null;
  let pillBar: HTMLElement | null = null;
  if (options.label) {
    const pill = document.createElement("div");
    Object.assign(pill.style, {
      position: "absolute",
      right: "24px",
      bottom: "24px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 18px",
      borderRadius: "9999px",
      font: "600 15px/1 ui-sans-serif, system-ui, sans-serif",
      color: "rgb(var(--fx-lm-ink-d))",
      background: "rgb(var(--fx-lm-panel-d) / 0.92)",
      boxShadow: "0 6px 24px rgb(var(--fx-lm-bg-d) / 0.45)",
    });
    pillText = document.createElement("span");
    const track = document.createElement("span");
    Object.assign(track.style, { display: "block", width: "72px", height: "4px", borderRadius: "2px", background: "rgb(var(--fx-lm-mute-d) / 0.4)", overflow: "hidden" });
    pillBar = document.createElement("span");
    Object.assign(pillBar.style, { display: "block", height: "100%", width: "0%", background: rgbOf(accent) });
    track.appendChild(pillBar);
    pill.append(pillText, track);
    layer.appendChild(pill);
  }
  document.body.appendChild(layer);
  root.classList.add("zk-reveal");

  let applied = false;
  const applyOnce = () => {
    if (applied) return;
    applied = true;
    apply();
  };
  let raf = 0;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    root.classList.remove("zk-reveal");
    root.style.removeProperty("--zk-clip");
    layer.remove();
    applyOnce();
    if (cancel === finish) cancel = null;
  };
  cancel = finish;

  try {
    const transition = document.startViewTransition(applyOnce);
    try {
      await transition.ready;
      const ctx = canvas.getContext("2d");
      const rand = mulberry32(seed ^ 0x9e37);
      const shards = shardSeeds(look === "shards" ? 22 : 0, seed);
      const live: Particle[] = [];
      const cap = Math.min(PARTICLE_CAP, options.particles ?? 110);
      const start = performance.now();
      let last = start;
      const rimColor = rgbOf(rim, 1);
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          if (stopped) return resolve();
          const dt = Math.min(48, now - last);
          last = now;
          const t = Math.min(1, (now - start) / duration);
          const e = revealEase(t, look);
          const r = radius * e;
          root.style.setProperty("--zk-clip", revealPolygon(origin.x, origin.y, r, look, seed + Math.floor(t * 6), look === "shards" ? 96 : 72));
          // the number stays a left-to-right run inside the Arabic words ("36%" must not read "%36")
          if (pillText) pillText.textContent = (options.label?.(repaintPercent(t)) ?? "").replace(/(\d+%)/, "\u2066$1\u2069");
          if (pillBar) pillBar.style.width = `${repaintPercent(t)}%`;
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            // rings
            ctx.lineWidth = 1.2;
            for (let i = 0; i < 3; i++) {
              const rr = r * (0.3 + i * 0.28) + (i === 0 ? 24 : 0);
              ctx.strokeStyle = rgbOf(accent, 0.34 * (1 - t));
              ctx.beginPath();
              ctx.arc(origin.x, origin.y, rr, 0, Math.PI * 2);
              ctx.stroke();
            }
            // the loose shards ahead of the edge
            ctx.fillStyle = rgbOf(ink, 0.96);
            for (const s of shards) {
              if (t < s.born) continue;
              const grow = Math.min(1, (t - s.born) / 0.12);
              const dist = r * s.ride;
              if (dist > radius * 1.1) continue;
              const cx = origin.x + Math.cos(s.angle) * dist;
              const cy = origin.y + Math.sin(s.angle) * dist;
              const size = s.size * grow * (1 - t * 0.5);
              ctx.beginPath();
              for (let k = 0; k < s.sides; k++) {
                const a = s.rotation + (k / s.sides) * Math.PI * 2;
                const rr = size * (0.55 + ((k * 37 + Math.floor(s.angle * 10)) % 10) / 14);
                ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
              }
              ctx.closePath();
              ctx.fill();
            }
            // trails with a bright head
            if (t < 0.88 && cap > 0) {
              const n = look === "ink" ? 2 : 3;
              for (let i = 0; i < n; i++) {
                const a = rand() * Math.PI * 2;
                const sp = 420 + rand() * 900;
                emit(live, { x: origin.x, y: origin.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + rand() * 0.9, max: 1.8, size: 1.5 + rand() * 2.5, kind: rand() < 0.2 ? 1 : 0 }, cap);
              }
            }
            stepParticles(live, dt, 0.9, look === "ink" ? 260 : 0);
            for (const p of live) {
              const k = Math.max(0, p.life / p.max);
              ctx.strokeStyle = rgbOf(accent, 0.55 * k);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(p.x - p.vx * 0.07, p.y - p.vy * 0.07);
              ctx.stroke();
              ctx.fillStyle = look === "ink" ? rgbOf(ink, 0.9 * Math.min(1, k * 2)) : rimColor;
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
              ctx.fill();
              if (p.kind === 1) {
                ctx.strokeStyle = rgbOf(accent, 0.35 * k);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 9 + (1 - k) * 12, 0, Math.PI * 2);
                ctx.stroke();
              }
            }
          }
          if (t >= 1 && live.length === 0) return resolve();
          if (t >= 1.25) return resolve();
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      });
    } catch {
      // a transition the browser skipped (the tab was hidden): the change itself still happens below
    }
    await transition.finished.catch(() => undefined);
  } catch {
    // startViewTransition refused: fall through to a plain change
  } finally {
    finish();
  }
}
