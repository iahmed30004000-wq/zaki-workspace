/**
 * «تيليجرام على التلفون» — a tap on one big emoji plays it over the whole screen: copies of it fly up and spin, and a laughing face brings the laugh in
 * Arabic words. Our own drawing (the emoji the phone already draws, moved by CSS); these are only the numbers of each piece.
 */

export const MAX_EFFECT_PIECES = 22;
const COPIES = 16;

const LAUGHS = new Set(["😂", "🤣", "😆", "😹", "😄", "😁"]);
const LAUGH_WORDS = ["tgmsg.effect.laugh_long", "tgmsg.effect.laugh_short"] as const;

/** The dictionary keys of the words that fly with this emoji (none for most). */
export function effectWordKeys(glyph: string): readonly string[] {
  return LAUGHS.has(glyph) ? LAUGH_WORDS : [];
}

export interface EffectPiece {
  /** where it starts, in per cent of the screen's width and height */
  x: number;
  y: number;
  /** how far it drifts, in per cent of the screen */
  driftX: number;
  driftY: number;
  scale: number;
  spinDeg: number;
  delayMs: number;
  durationMs: number;
  /** which word it is (an index into `effectWordKeys`), or null for a copy of the emoji */
  word: number | null;
}

export function effectPieces(opts: { totalMs: number; random?: () => number; words: number }): EffectPiece[] {
  const random = opts.random ?? Math.random;
  const wordPieces = opts.words > 0 ? Math.min(opts.words * 3, MAX_EFFECT_PIECES - COPIES) : 0;
  return Array.from({ length: COPIES + wordPieces }, (_, i) => {
    const word = i >= COPIES ? (i - COPIES) % opts.words : null;
    const delayMs = Math.floor(random() * opts.totalMs * 0.4);
    return {
      x: Math.round(8 + random() * 78),
      y: Math.round(35 + random() * 50),
      driftX: Math.round(random() * 30 - 15),
      driftY: -Math.round(18 + random() * 34),
      scale: Math.round((word === null ? 0.5 + random() * 0.9 : 0.8 + random() * 0.5) * 100) / 100,
      spinDeg: Math.round(random() * 60 - 30),
      delayMs,
      durationMs: Math.floor((opts.totalMs - delayMs) * (0.75 + random() * 0.25)),
      word,
    };
  });
}
