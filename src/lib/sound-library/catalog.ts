import { CHAT_TONES, type ChatTone } from "@/lib/chat/chime/tones";
import { RING_PATTERN_PERIOD_MS, RING_PATTERNS, type Note } from "@/lib/calls/tones";
import type { SoundEvent } from "./choice";

/**
 * OUR OWN SOUNDS. Every one is a handful of notes written here and drawn by the browser (WebAudio): no sound file, no download, nobody else's audio.
 *
 *  - a message sound is played once (`tone`: the same shape and the same player as the five chat tones, `src/lib/chat/chime`);
 *  - a call sound is a round of notes and a pause, again and again (`loop`: the same shape and player as the call's tones, `src/lib/calls/tones.ts`).
 *
 * The caller's list and the incoming list share nothing: the person who calls never hears an incoming ringtone.
 */
export type SoundFamily = "message" | "ringback" | "ring";

export const FAMILY_OF: Readonly<Record<SoundEvent, SoundFamily>> = { sent: "message", received: "message", inChat: "message", ringback: "ringback", ring: "ring" };

export type SoundPlay = { type: "tone"; tone: Pick<ChatTone, "cutoff" | "notes"> } | { type: "loop"; notes: readonly Note[]; periodMs: number };

export interface BuiltinSound {
  id: string;
  family: SoundFamily;
  /** the dictionary key of its Arabic name */
  labelKey: string;
  play: SoundPlay;
}

const message = (id: string, tone: Pick<ChatTone, "cutoff" | "notes">, labelKey = `tgsheets.sound.${id}`): BuiltinSound => ({ id, family: "message", labelKey, play: { type: "tone", tone } });
const loop = (family: "ringback" | "ring", id: string, notes: readonly Note[], periodMs: number, labelKey = `tgsheets.sound.${id}`): BuiltinSound => ({ id, family, labelKey, play: { type: "loop", notes, periodMs } });

export const BUILTIN_SOUNDS: readonly BuiltinSound[] = [
  // a dry little tick: two very short high notes
  message("tick", {
    cutoff: 5000,
    notes: [
      { hz: 1175, at: 0, dur: 0.035, gain: 0.35, wave: "triangle" },
      { hz: 1568, at: 0.045, dur: 0.05, gain: 0.3, wave: "sine" },
    ],
  }),
  // something leaving: one note that climbs
  message("swoosh", { cutoff: 3600, notes: [{ hz: 392, to: 1245, at: 0, dur: 0.17, gain: 0.34, wave: "sine" }] }),
  // a drop of water: a quick fall, then a small ring
  message("drop", {
    cutoff: 4200,
    notes: [
      { hz: 1397, to: 523, at: 0, dur: 0.12, gain: 0.45, wave: "sine" },
      { hz: 1047, at: 0.12, dur: 0.16, gain: 0.2, wave: "sine" },
    ],
  }),
  // the five tones the chat already had
  ...CHAT_TONES.map((tone) => message(tone.id, tone, tone.labelKey)),

  loop(
    "ringback",
    "wait-low",
    [
      { at: 0, freq: 329.63, dur: 0.9, gain: 0.07, type: "sine" },
      { at: 1, freq: 329.63, dur: 0.9, gain: 0.07, type: "sine" },
    ],
    4200,
  ),
  loop(
    "ringback",
    "wait-double",
    [
      { at: 0, freq: 440, dur: 0.35, gain: 0.07, type: "sine" },
      { at: 0.5, freq: 440, dur: 0.35, gain: 0.07, type: "sine" },
    ],
    3000,
  ),
  loop(
    "ringback",
    "wait-chord",
    [
      { at: 0, freq: 261.63, dur: 1.3, gain: 0.05, type: "sine" },
      { at: 0, freq: 329.63, dur: 1.3, gain: 0.045, type: "sine" },
      { at: 0, freq: 392, dur: 1.3, gain: 0.04, type: "sine" },
    ],
    3800,
  ),

  loop("ring", "ring-soft", RING_PATTERNS.soft, RING_PATTERN_PERIOD_MS.soft, "calls.tone.soft"),
  loop("ring", "ring-bell", RING_PATTERNS.bell, RING_PATTERN_PERIOD_MS.bell, "calls.tone.bell"),
  loop(
    "ring",
    "ring-wave",
    [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25].map((freq, i) => ({ at: i * 0.16, freq, dur: 0.3, gain: 0.18, type: "sine" as const })),
    2400,
  ),
  loop(
    "ring",
    "ring-morning",
    [
      { at: 0, freq: 587.33, dur: 0.3, gain: 0.18, type: "triangle" },
      { at: 0.3, freq: 880, dur: 0.3, gain: 0.18, type: "triangle" },
      { at: 0.6, freq: 739.99, dur: 0.55, gain: 0.18, type: "triangle" },
      { at: 1.35, freq: 987.77, dur: 0.5, gain: 0.14, type: "sine" },
    ],
    3000,
  ),
  loop(
    "ring",
    "ring-pulse",
    [0, 0.14, 0.28, 0.7, 0.84, 0.98].map((at) => ({ at, freq: 932.33, dur: 0.09, gain: 0.2, type: "triangle" as const })),
    2200,
  ),
];

export const builtinOf = (id: string): BuiltinSound | undefined => BUILTIN_SOUNDS.find((s) => s.id === id);
export const builtinsFor = (event: SoundEvent): BuiltinSound[] => BUILTIN_SOUNDS.filter((s) => s.family === FAMILY_OF[event]);
