/**
 * Which incoming ringtone this DEVICE rings (the owner picks, 2026-11-21; five more of our own on 2026-11-27): the recorded one (public/sounds/ring.mp3) and
 * the ones drawn by the browser itself (src/lib/calls/tones.ts). Kept in localStorage, so each phone and each computer has its own, and never sent anywhere.
 */
export const RING_TONES = ["file", "soft", "bell", "marimba", "breeze", "pearl", "hop", "sunset"] as const;
export type RingTone = (typeof RING_TONES)[number];

export const DEFAULT_RING_TONE: RingTone = "file";

const KEY = "zk-ring-tone";

/** The dictionary key of each tone's name (src/lib/i18n/ar.calls.json). */
export const RING_TONE_LABEL: Record<RingTone, string> = {
  file: "calls.tone.file",
  soft: "calls.tone.soft",
  bell: "calls.tone.bell",
  marimba: "calls.tone.marimba",
  breeze: "calls.tone.breeze",
  pearl: "calls.tone.pearl",
  hop: "calls.tone.hop",
  sunset: "calls.tone.sunset",
};

export function parseRingTone(value: unknown): RingTone | null {
  return typeof value === "string" && (RING_TONES as readonly string[]).includes(value) ? (value as RingTone) : null;
}

/** The tone chosen on this device; the recorded one when nothing was chosen or storage is blocked. */
export function loadRingTone(): RingTone {
  try {
    return parseRingTone(localStorage.getItem(KEY)) ?? DEFAULT_RING_TONE;
  } catch {
    return DEFAULT_RING_TONE;
  }
}

export function saveRingTone(tone: RingTone): void {
  try {
    localStorage.setItem(KEY, tone);
  } catch {
    // storage blocked: the choice lasts until the page closes, no longer
  }
}
