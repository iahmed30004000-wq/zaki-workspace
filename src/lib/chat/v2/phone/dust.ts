/**
 * «تيليجرام على التلفون» — the dust of a deleted bubble, OUR OWN particles: a grid of small squares over the bubble's box that let go from one side to the
 * other and drift up and to the right while they fade. Pure numbers; the canvas that draws them is `components/chat/v2/phone/message-fx.ts`.
 */

/** The hard cap for one deletion, however big the bubble or how many bubbles go together. */
export const MAX_DUST_PARTICLES = 600;
/** One particle for about this many square pixels of bubble. */
const AREA_PER_PARTICLE = 36;

export interface DustParticle {
  x: number;
  y: number;
  /** where it has drifted to at the end of its life, from its start */
  dx: number;
  dy: number;
  size: number;
  delayMs: number;
  lifeMs: number;
  /** 0: the bubble's colour, 1: the colour of its words */
  tone: 0 | 1;
}

export function dustParticles(
  rect: { top: number; left: number; width: number; height: number },
  opts: { durationMs: number; random?: () => number; cap?: number },
): DustParticle[] {
  const random = opts.random ?? Math.random;
  const cap = Math.max(0, Math.min(opts.cap ?? MAX_DUST_PARTICLES, MAX_DUST_PARTICLES));
  const count = Math.min(cap, Math.max(Math.round((rect.width * rect.height) / AREA_PER_PARTICLE), 12));
  if (count === 0 || rect.width <= 0 || rect.height <= 0) return [];
  const columns = Math.max(1, Math.round(Math.sqrt((count * rect.width) / rect.height)));
  const rows = Math.max(1, Math.floor(count / columns));
  const out: DustParticle[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns && out.length < count; column += 1) {
      const across = (column + random()) / columns;
      // the sweep: the left side lets go first, so the bubble comes apart from one side to the other
      const delayMs = Math.floor((across * 0.35 + random() * 0.05) * opts.durationMs);
      out.push({
        x: rect.left + across * rect.width,
        y: rect.top + ((row + random()) / rows) * rect.height,
        dx: 12 + random() * 46,
        dy: -(10 + random() * 54),
        size: 1.5 + random() * 2,
        delayMs,
        lifeMs: Math.floor((opts.durationMs - delayMs) * (0.7 + random() * 0.3)),
        tone: random() < 0.25 ? 1 : 0,
      });
    }
  }
  return out;
}

/** Where a particle is `atMs` after the start, and how solid; null once it is gone. */
export function dustFrame(p: DustParticle, atMs: number): { x: number; y: number; alpha: number } | null {
  const age = atMs - p.delayMs;
  if (age <= 0) return { x: p.x, y: p.y, alpha: 1 };
  if (age >= p.lifeMs) return null;
  const t = age / p.lifeMs;
  const eased = 1 - (1 - t) * (1 - t);
  return { x: p.x + p.dx * eased, y: p.y + p.dy * eased, alpha: 1 - t * t };
}
