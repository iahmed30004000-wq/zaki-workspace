import { mulberry32 } from "@/lib/themes/switch-motion";

/** The hard cap of the dust of a thrown-away recording. */
export const VOICE_DUST_CAP = 90;
/** The bin's middle is this far in from its end of the row (px): the row's padding and half of the bin's 44px button. */
export const VOICE_BIN_INSET = 26;
/** The mouth of the bin sits a little above the row's middle, under the open lid (px). */
const MOUTH_ABOVE = 5;

export interface DustInput {
  width: number;
  height: number;
  /** the bin is at the right end of the row */
  toRight: boolean;
  /** how long the whole effect lives */
  ms: number;
  count: number;
  seed: number;
}

/** One speck: where it starts, where the bin's mouth is, when it leaves and when it is inside (both in ms from the start). */
export interface DustSpeck {
  x: number;
  y: number;
  binX: number;
  binY: number;
  start: number;
  end: number;
  /** how high it rises on the way (px) */
  lift: number;
  size: number;
}

/**
 * The particles of the waveform falling apart INTO the bin: spread over the row (never past the cap), each on its own arc that ends in the bin's mouth.
 * A path and not a speed, so a speck can never fly past the bin or away from it. Pure (a seed, no `Math.random`).
 */
export function dustBurst({ width, height, toRight, ms, count, seed }: DustInput): DustSpeck[] {
  const rand = mulberry32(seed);
  const n = Math.max(0, Math.min(VOICE_DUST_CAP, Math.floor(count)));
  const length = Math.max(50, ms);
  const binX = toRight ? width - VOICE_BIN_INSET : VOICE_BIN_INSET;
  const binY = height / 2 - MOUTH_ABOVE;
  const out: DustSpeck[] = [];
  for (let i = 0; i < n; i++) {
    // from the part of the row that is not the bin itself
    const x = toRight ? rand() * Math.max(1, width - VOICE_BIN_INSET * 3) : VOICE_BIN_INSET * 3 + rand() * Math.max(1, width - VOICE_BIN_INSET * 3);
    const y = height / 2 + (rand() - 0.5) * Math.min(36, height);
    const start = rand() * length * 0.2;
    const end = start + length * (0.55 + rand() * 0.25);
    out.push({ x, y, binX, binY, start, end: Math.min(length, end), lift: 4 + rand() * 14, size: 1 + rand() * 2.2 });
  }
  return out;
}

/** Where a speck is `atMs` into the effect, or null once it is inside the bin. It leaves slowly and is pulled in faster. */
export function dustAt(speck: DustSpeck, atMs: number): { x: number; y: number; size: number; alpha: number } | null {
  if (atMs >= speck.end) return null;
  const t = Math.max(0, Math.min(1, (atMs - speck.start) / Math.max(1, speck.end - speck.start)));
  const pull = t * t;
  return {
    x: speck.x + (speck.binX - speck.x) * pull,
    y: speck.y + (speck.binY - speck.y) * pull - Math.sin(Math.PI * t) * speck.lift,
    // it shrinks as it drops in, and stays visible until it does
    size: speck.size * (1 - 0.5 * pull),
    alpha: t < 0.9 ? 1 : (1 - t) * 10,
  };
}
