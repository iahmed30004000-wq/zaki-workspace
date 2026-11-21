/**
 * S5.1 — THE FIVE MESSAGE TONES (the owner, 2026-11-21: sounds for the chats, «متل تيليغرام»). Invented here and drawn by the browser (WebAudio) from the notes below:
 * no sound file, no download, no licence. Each is a handful of soft notes (sine or triangle, a few overtones), shaped by a low-pass filter and an exponential decay,
 * 150 to 450 ms long and quiet; the person's volume is applied by one master gain in `player.ts`. It is plain data, so the tests pin it without a browser.
 */

export type ChatToneId = "bubble" | "bell" | "marimba" | "taps" | "chirp";

/** An overtone of a note: `ratio` times its pitch, at `gain` times its loudness, dying after `decay` times its length (shorter: a brighter start, a softer end). */
export interface ToneOvertone {
  ratio: number;
  gain: number;
  decay: number;
}

export interface ToneNote {
  /** the pitch */
  hz: number;
  /** when it starts, in seconds from the start of the tone */
  at: number;
  /** how long it rings, in seconds */
  dur: number;
  /** its loudness before the person's volume (0..1) */
  gain: number;
  wave: "sine" | "triangle";
  overtones?: readonly ToneOvertone[];
}

export interface ChatTone {
  id: ChatToneId;
  /** the dictionary key of its Arabic name */
  labelKey: string;
  /** the low-pass filter's corner: higher is brighter */
  cutoff: number;
  notes: readonly ToneNote[];
}

export const CHAT_TONES: readonly ChatTone[] = [
  {
    // a soft two-note «pop», like a messenger's: a note, then a higher one, both short and round
    id: "bubble",
    labelKey: "chatsound.tone.bubble",
    cutoff: 3200,
    notes: [
      { hz: 659, at: 0, dur: 0.13, gain: 0.5, wave: "sine" },
      { hz: 988, at: 0.09, dur: 0.2, gain: 0.45, wave: "sine", overtones: [{ ratio: 2, gain: 0.15, decay: 0.6 }] },
    ],
  },
  {
    // a glassy bell: one high note with the uneven overtones of metal, a short ring
    id: "bell",
    labelKey: "chatsound.tone.bell",
    cutoff: 6500,
    notes: [
      {
        hz: 1319,
        at: 0,
        dur: 0.42,
        gain: 0.38,
        wave: "sine",
        overtones: [
          { ratio: 2.76, gain: 0.3, decay: 0.55 },
          { ratio: 5.4, gain: 0.12, decay: 0.3 },
        ],
      },
    ],
  },
  {
    // a marimba-like pluck: a wooden note (triangle with a quick fourth overtone) and a lower answer
    id: "marimba",
    labelKey: "chatsound.tone.marimba",
    cutoff: 4200,
    notes: [
      { hz: 587, at: 0, dur: 0.18, gain: 0.55, wave: "triangle", overtones: [{ ratio: 4, gain: 0.25, decay: 0.25 }] },
      { hz: 440, at: 0.11, dur: 0.26, gain: 0.5, wave: "triangle", overtones: [{ ratio: 4, gain: 0.22, decay: 0.25 }] },
    ],
  },
  {
    // a low warm double tap: two soft thuds, nothing high in it
    id: "taps",
    labelKey: "chatsound.tone.taps",
    cutoff: 1100,
    notes: [
      { hz: 247, at: 0, dur: 0.12, gain: 0.65, wave: "sine", overtones: [{ ratio: 2, gain: 0.18, decay: 0.5 }] },
      { hz: 247, at: 0.15, dur: 0.14, gain: 0.6, wave: "sine", overtones: [{ ratio: 2, gain: 0.18, decay: 0.5 }] },
    ],
  },
  {
    // a quick rising chirp: three small steps up
    id: "chirp",
    labelKey: "chatsound.tone.chirp",
    cutoff: 5200,
    notes: [
      { hz: 784, at: 0, dur: 0.08, gain: 0.4, wave: "triangle" },
      { hz: 1047, at: 0.07, dur: 0.08, gain: 0.42, wave: "triangle" },
      { hz: 1319, at: 0.14, dur: 0.2, gain: 0.42, wave: "sine", overtones: [{ ratio: 2, gain: 0.12, decay: 0.5 }] },
    ],
  },
];

/** The tone a person who never chose one hears: the first. */
export const DEFAULT_CHAT_TONE: ChatToneId = "bubble";

export function isChatToneId(value: unknown): value is ChatToneId {
  return typeof value === "string" && CHAT_TONES.some((t) => t.id === value);
}

/** The tone with this id; an unknown one is the default tone. */
export function toneOf(id: string | null | undefined): ChatTone {
  return CHAT_TONES.find((t) => t.id === id) ?? CHAT_TONES[0]!;
}

/** How long the whole tone rings, in seconds. */
export function toneLength(tone: ChatTone): number {
  return tone.notes.reduce((end, n) => Math.max(end, n.at + n.dur), 0);
}
