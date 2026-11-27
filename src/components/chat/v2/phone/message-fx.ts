import { MAX_DUST_PARTICLES, dustFrame, dustParticles, type DustParticle } from "@/lib/chat/v2/phone/dust";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { flightPoint, sparksOf } from "@/lib/chat/v2/phone/reaction-flight";
import { effectOn } from "@/lib/motion/effects";
import { zakiIdOfCode, zakiSrc } from "@/lib/chat/zaki-emoji";

/**
 * «تيليجرام على التلفون» — the drawing that no style rule can stop, so each of these asks `effectOn` itself: the dust of a deleted bubble (a canvas), a
 * reaction's flight into its pill and the burst of sparks around it. Each makes its own element on <body>, never takes a touch, and removes itself. The
 * colours are read from the elements on screen (the theme's own), never written here.
 */

export interface DustSource {
  rect: { top: number; left: number; width: number; height: number };
  /** the bubble's own colour and the colour of its words, as the browser computed them */
  colours: readonly [string, string];
}

/** A background that paints nothing says nothing: the words' colour stands in for it. */
const CLEAR = /^(?:transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/;

export function coloursOf(el: Element): [string, string] {
  const style = getComputedStyle(el);
  const words = style.color;
  return [CLEAR.test(style.backgroundColor) ? words : style.backgroundColor, words];
}

function screenCanvas(): { ctx: CanvasRenderingContext2D; remove: () => void; clear: () => void } | null {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-tg-canvas", "");
  canvas.className = "pointer-events-none fixed inset-0 z-[80] h-full w-full";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  document.body.appendChild(canvas);
  return { ctx, remove: () => canvas.remove(), clear: () => ctx.clearRect(0, 0, width, height) };
}

/** Runs `draw(ms)` on every frame until `durationMs`, then `done`; a hidden page that stops giving frames is cleared by the timer. */
function frames(durationMs: number, draw: (atMs: number) => void, done: () => void): void {
  let start: number | null = null;
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    clearTimeout(guard);
    done();
  };
  const guard = setTimeout(finish, durationMs + 400);
  const step = (now: number) => {
    if (over) return;
    start ??= now;
    const at = now - start;
    if (at >= durationMs) return finish();
    draw(at);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function runDust(sources: readonly DustSource[], durationMs: number = TG_MOTION.deleteDustMs): void {
  if (sources.length === 0 || !effectOn("dust")) return;
  const canvas = screenCanvas();
  if (!canvas) return;
  const share = Math.floor(MAX_DUST_PARTICLES / sources.length);
  const clouds: { particles: DustParticle[]; colours: readonly [string, string] }[] = sources.map((s) => ({ colours: s.colours, particles: dustParticles(s.rect, { durationMs, cap: share }) }));
  frames(
    durationMs,
    (at) => {
      canvas.clear();
      for (const cloud of clouds) {
        for (const tone of [0, 1] as const) {
          canvas.ctx.fillStyle = cloud.colours[tone];
          for (const p of cloud.particles) {
            if (p.tone !== tone) continue;
            const f = dustFrame(p, at);
            if (!f) continue;
            canvas.ctx.globalAlpha = f.alpha;
            canvas.ctx.fillRect(f.x, f.y, p.size, p.size);
          }
        }
      }
    },
    canvas.remove,
  );
}

function runSparks(at: { x: number; y: number }, colour: string): void {
  if (!effectOn("particles")) return;
  const canvas = screenCanvas();
  if (!canvas) return;
  const sparks = sparksOf();
  const duration = TG_MOTION.reactionBurstMs;
  frames(
    duration,
    (now) => {
      canvas.clear();
      canvas.ctx.fillStyle = colour;
      const t = now / duration;
      for (const s of sparks) {
        const p = t / s.life;
        if (p >= 1) continue;
        const eased = 1 - (1 - p) * (1 - p);
        canvas.ctx.globalAlpha = 1 - p * p;
        canvas.ctx.beginPath();
        canvas.ctx.arc(at.x + s.dx * eased, at.y + s.dy * eased, s.size * (1 - p * 0.5), 0, Math.PI * 2);
        canvas.ctx.fill();
      }
    },
    canvas.remove,
  );
}

/** The emoji (or the sticker of a Zaki code) as one element, centred on the point it is given by its transform. */
function glyphElement(emoji: string): HTMLElement {
  const el = document.createElement("span");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-tg-flight", "");
  el.className = "pointer-events-none fixed z-[81] flex size-10 items-center justify-center text-3xl leading-none";
  el.style.top = "0";
  el.style.left = "0";
  const zaki = zakiIdOfCode(emoji);
  if (zaki === null) el.textContent = emoji;
  else {
    const picture = document.createElement("img");
    picture.src = zakiSrc(zaki);
    picture.alt = "";
    picture.className = "size-9 object-contain";
    el.appendChild(picture);
  }
  return el;
}

const place = (el: HTMLElement, x: number, y: number, scale: number) => {
  el.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0) scale(${scale})`;
};

/** The burst of a reaction that has landed: the emoji swells over its pill and fades while the sparks go out (about a second). */
function runBurst(emoji: string, pill: HTMLElement): void {
  const rect = pill.getBoundingClientRect();
  const at = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  runSparks(at, getComputedStyle(pill).color);
  if (!effectOn("emoji")) return;
  const big = glyphElement(emoji);
  place(big, at.x, at.y, 0.7);
  document.body.appendChild(big);
  if (typeof big.animate !== "function") return big.remove();
  const base = `translate3d(${at.x - 20}px, ${at.y - 20}px, 0)`;
  const play = big.animate(
    [
      { transform: `${base} scale(0.7)`, opacity: 1 },
      { transform: `${base} scale(1.9)`, opacity: 1, offset: 0.35 },
      { transform: `${base} scale(1.5)`, opacity: 0 },
    ],
    { duration: TG_MOTION.reactionBurstMs, easing: "ease-out" },
  );
  play.onfinish = () => big.remove();
  play.oncancel = () => big.remove();
}

/**
 * The picked emoji flies from `from` into its pill and bursts there. The pill is looked for on every frame: it appears a frame after the pick, and it moves
 * while its bubble grows. Its own face is held back until the emoji lands in it. With the effects off nothing is drawn and the pill is simply there.
 */
export function flyReaction(emoji: string, from: { top: number; left: number; width: number; height: number }, pill: () => HTMLElement | null): void {
  if (!effectOn("emoji") || !effectOn("transitions")) {
    requestAnimationFrame(() => {
      const target = pill();
      if (target) runBurst(emoji, target);
    });
    return;
  }
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const flying = glyphElement(emoji);
  place(flying, start.x, start.y, 1.4);
  document.body.appendChild(flying);
  let last = start;
  const faceOf = (target: HTMLElement | null) => (target?.firstElementChild as HTMLElement | null) ?? null;
  frames(
    TG_MOTION.reactionFlyMs,
    (at) => {
      const target = pill();
      const face = faceOf(target);
      if (face) face.style.visibility = "hidden";
      const rect = target?.getBoundingClientRect();
      if (rect) last = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const point = flightPoint(start, last, at / TG_MOTION.reactionFlyMs);
      place(flying, point.x, point.y, point.scale);
    },
    () => {
      flying.remove();
      const target = pill();
      const face = faceOf(target);
      if (face) face.style.visibility = "";
      if (target) runBurst(emoji, target);
    },
  );
}
