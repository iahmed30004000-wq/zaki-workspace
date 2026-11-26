import { mulberry32, type Particle } from "@/lib/themes/switch-motion";

/** The hard cap of the dust of a thrown-away recording. */
export const VOICE_DUST_CAP = 90;
/** The bin is this far in from its end of the row (px). */
const BIN_INSET = 26;

export interface DustInput {
  width: number;
  height: number;
  /** the bin is at the right end of the row */
  toRight: boolean;
  /** how long the dust lives */
  ms: number;
  count: number;
  seed: number;
}

/**
 * The particles of the waveform falling apart into the bin: spread over the row (never past the cap), each flying toward the bin's end with a little
 * lift and scatter, alive for at most the effect's length. Pure (a seed, no `Math.random`).
 */
export function dustBurst({ width, height, toRight, ms, count, seed }: DustInput): Particle[] {
  const rand = mulberry32(seed);
  const n = Math.max(0, Math.min(VOICE_DUST_CAP, Math.floor(count)));
  const seconds = Math.max(0.05, ms / 1000);
  const binX = toRight ? width - BIN_INSET : BIN_INSET;
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    // from the part of the row that is not the bin itself
    const x = toRight ? rand() * Math.max(1, width - BIN_INSET * 3) : BIN_INSET * 3 + rand() * Math.max(1, width - BIN_INSET * 3);
    const y = height / 2 + (rand() - 0.5) * Math.min(36, height);
    const life = seconds * (0.6 + rand() * 0.4);
    out.push({ x, y, vx: ((binX - x) / life) * (0.9 + rand() * 0.5), vy: (rand() - 0.65) * 90, life, max: life, size: 1 + rand() * 2.2, kind: 0 });
  }
  return out;
}
