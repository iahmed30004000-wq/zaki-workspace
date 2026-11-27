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

/** Wooden strikes one after another: each note a triangle with a faint sine an octave up. */
function struck(freqs: readonly number[], step: number, dur: number, gain: number, from = 0): Note[] {
  return freqs.flatMap((freq, i): Note[] => [
    { at: round3(from + i * step), freq, dur, gain, type: "triangle" },
    { at: round3(from + i * step), freq: freq * 2, dur: dur * 0.5, gain: gain * 0.25, type: "sine" },
  ]);
}

/** Glassy drops: a sine with a short, quiet overtone that is not an octave (what makes it sound like glass). */
function glass(freqs: readonly number[], step: number, dur: number, from = 0): Note[] {
  return freqs.flatMap((freq, i): Note[] => [
    { at: round3(from + i * step), freq, dur, gain: 0.16, type: "sine" },
    { at: round3(from + i * step), freq: freq * 2.76, dur: dur * 0.3, gain: 0.04, type: "sine" },
  ]);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The incoming ringtones that are drawn, not recorded (the one other choice is the recorded file). */
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
  // the five of 2026-11-27 («نغمات الرنين الجديدة»): our own melodies, written here
  // «ماريمبا»: a quick wooden run up and back, each note with a faint octave over it
  marimba: [
    ...struck([523.25, 659.25, 783.99, 880, 783.99, 1046.5], 0.14, 0.32, 0.18),
    ...struck([783.99, 880, 1046.5], 0.14, 0.4, 0.18, 1.12),
  ],
  // «نسيم»: four long soft notes that lean on each other, the last one stays
  breeze: [
    { at: 0, freq: 349.23, dur: 1.1, gain: 0.1, type: "sine" },
    { at: 0.3, freq: 440, dur: 1.1, gain: 0.1, type: "sine" },
    { at: 0.6, freq: 523.25, dur: 1.2, gain: 0.1, type: "sine" },
    { at: 0.9, freq: 659.25, dur: 1.5, gain: 0.11, type: "sine" },
  ],
  // «لؤلؤ»: small high drops with a glassy overtone
  pearl: [
    ...glass([1174.66, 987.77, 783.99], 0.22, 0.45),
    ...glass([1318.51, 1174.66], 0.22, 0.6, 0.95),
  ],
  // «نطّة»: a jump of five steps, three times, each a step higher
  hop: [
    { at: 0, freq: 392, dur: 0.12, gain: 0.17, type: "triangle" },
    { at: 0.14, freq: 587.33, dur: 0.2, gain: 0.19, type: "triangle" },
    { at: 0.46, freq: 440, dur: 0.12, gain: 0.17, type: "triangle" },
    { at: 0.6, freq: 659.25, dur: 0.2, gain: 0.19, type: "triangle" },
    { at: 0.92, freq: 493.88, dur: 0.12, gain: 0.17, type: "triangle" },
    { at: 1.06, freq: 739.99, dur: 0.38, gain: 0.19, type: "triangle" },
  ],
  // «غروب»: comes down gently and turns up at the end
  sunset: [
    { at: 0, freq: 880, dur: 0.45, gain: 0.15, type: "sine" },
    { at: 0.28, freq: 739.99, dur: 0.45, gain: 0.15, type: "sine" },
    { at: 0.56, freq: 587.33, dur: 0.45, gain: 0.15, type: "sine" },
    { at: 0.84, freq: 440, dur: 0.6, gain: 0.15, type: "sine" },
    { at: 1.34, freq: 554.37, dur: 0.3, gain: 0.13, type: "sine" },
    { at: 1.56, freq: 659.25, dur: 0.7, gain: 0.15, type: "sine" },
  ],
} satisfies Record<string, readonly Note[]>;
/** The length of one round of each drawn ringtone (notes plus pause), in ms. */
export const RING_PATTERN_PERIOD_MS: Readonly<Record<keyof typeof RING_PATTERNS, number>> = { soft: 2800, bell: 2400, marimba: 2600, breeze: 3600, pearl: 2800, hop: 2500, sunset: 3300 };

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
