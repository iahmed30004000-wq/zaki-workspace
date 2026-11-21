/**
 * THE CALL'S SOUNDS, drawn by the browser itself (no sound file): the caller's soft ringback, two incoming-ringtone
 * patterns beside the recorded one, and the short blips of «اتّصلت» and «خلصت». A pattern is a list of notes; the
 * WebAudio code that plays one is the only thing here that needs a browser, so the patterns are plain data.
 */

export interface Note {
  /** seconds after the start of the pattern */
  at: number;
  /** pitch in Hz */
  freq: number;
  /** length in seconds */
  dur: number;
  /** loudness, 0..1 (default `DEFAULT_GAIN`) */
  gain?: number;
  type?: OscillatorType;
}

const DEFAULT_GAIN = 0.15;

/** What the caller hears while the other side rings: two soft notes, a long pause, again. Never the incoming ringtone. */
export const RINGBACK_NOTES: readonly Note[] = [
  { at: 0, freq: 392, dur: 0.7, gain: 0.07, type: "sine" },
  { at: 0.8, freq: 523.25, dur: 0.9, gain: 0.07, type: "sine" },
];
/** A whole ringback round (the notes and the pause after them). */
export const RINGBACK_PERIOD_MS = 3600;

/** The incoming ringtones that are drawn, not recorded: «هادي» (soft chime) and «جرس» (bell). The third choice is the recorded file. */
export const RING_PATTERNS = {
  soft: [
    { at: 0, freq: 659.25, dur: 0.22, gain: 0.2, type: "sine" },
    { at: 0.24, freq: 783.99, dur: 0.22, gain: 0.2, type: "sine" },
    { at: 0.48, freq: 987.77, dur: 0.4, gain: 0.2, type: "sine" },
    { at: 1.1, freq: 659.25, dur: 0.22, gain: 0.2, type: "sine" },
    { at: 1.34, freq: 783.99, dur: 0.22, gain: 0.2, type: "sine" },
    { at: 1.58, freq: 987.77, dur: 0.4, gain: 0.2, type: "sine" },
  ],
  bell: [
    { at: 0, freq: 880, dur: 0.5, gain: 0.22, type: "triangle" },
    { at: 0.18, freq: 1318.5, dur: 0.5, gain: 0.12, type: "sine" },
    { at: 0.6, freq: 880, dur: 0.5, gain: 0.22, type: "triangle" },
    { at: 0.78, freq: 1318.5, dur: 0.5, gain: 0.12, type: "sine" },
  ],
} as const satisfies Record<string, readonly Note[]>;
/** The length of one round of each drawn ringtone (notes plus pause), in ms. */
export const RING_PATTERN_PERIOD_MS = { soft: 2800, bell: 2400 } as const;

/** «اتّصلت»: two short rising notes. */
export const CONNECT_NOTES: readonly Note[] = [
  { at: 0, freq: 587.33, dur: 0.11, gain: 0.12, type: "sine" },
  { at: 0.12, freq: 880, dur: 0.18, gain: 0.12, type: "sine" },
];
/** «خلصت»: two short falling notes. */
export const END_NOTES: readonly Note[] = [
  { at: 0, freq: 659.25, dur: 0.12, gain: 0.12, type: "sine" },
  { at: 0.14, freq: 440, dur: 0.22, gain: 0.12, type: "sine" },
];

type AudioContextCtor = typeof AudioContext;

function contextClass(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
}

/** Plays the notes on a context, starting `from` seconds after its clock now. */
function schedule(audio: AudioContext, notes: readonly Note[], from: number): void {
  for (const n of notes) {
    const start = audio.currentTime + from + n.at;
    const peak = n.gain ?? DEFAULT_GAIN;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.value = n.freq;
    // a soft attack and a long fade: no click at either end
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.04, n.dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + n.dur + 0.02);
  }
}

/** The end of a pattern, in ms. */
export function patternMs(notes: readonly Note[]): number {
  return Math.round(Math.max(0, ...notes.map((n) => n.at + n.dur)) * 1000);
}

/** Plays a pattern once (a blip); the browser's audio is closed when it is over. Never throws. */
export function playOnce(notes: readonly Note[]): void {
  const Ctx = contextClass();
  if (!Ctx) return;
  try {
    const audio = new Ctx();
    // a context made before the person touched the page starts suspended: the blip is simply lost, never an error
    void audio.resume?.().catch(() => undefined);
    schedule(audio, notes, 0);
    setTimeout(() => void audio.close().catch(() => undefined), patternMs(notes) + 300);
  } catch {
    // no audio here: nothing to play
  }
}

/** Plays a pattern again and again, one round every `periodMs`; returns its stop (safe to call twice). */
export function playLoop(notes: readonly Note[], periodMs: number): () => void {
  const Ctx = contextClass();
  if (!Ctx) return () => undefined;
  let audio: AudioContext;
  try {
    audio = new Ctx();
  } catch {
    return () => undefined;
  }
  void audio.resume?.().catch(() => undefined);
  const round = () => schedule(audio, notes, 0);
  round();
  const timer = setInterval(round, periodMs);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    void audio.close().catch(() => undefined);
  };
}

/** The connect blip («اتّصلت») and the end blip («خلصت»). */
export function playConnect(): void {
  playOnce(CONNECT_NOTES);
}
export function playEnd(): void {
  playOnce(END_NOTES);
}
