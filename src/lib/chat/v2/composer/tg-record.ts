import { formatDuration } from "@/lib/chat/waveform";
import type { VoiceState } from "@/lib/chat/v2/composer/types";

/** «تيليجرام على التلفون»: what the phone's recording bar draws, as pure rules. */
export type TgRecordPhase = "hold" | "locked" | "paused" | "review" | "cancelling";

/** A recording no finger holds (slid up, or started with a click or the keyboard) is drawn locked: its own cancel, pause and send. */
export function tgPhaseOf(voice: Exclude<VoiceState, { mode: "idle" }>): TgRecordPhase {
  if (voice.mode === "recording") return voice.hold ? "hold" : "locked";
  return voice.mode;
}

/** «0:05,4»: minutes, seconds and the tenth (cut, never rounded up). */
export function formatRecordTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  return `${formatDuration(Math.floor(safe / 1000) * 1000)},${Math.floor(safe / 100) % 10}`;
}

/** How big the halo around the microphone is for a level of 0..100. */
export const levelScale = (level: number): number => 1.12 + (Math.max(0, Math.min(100, level)) / 100) * 0.55;

/** The words of a take in the preview. */
export type TakeWords =
  | { kind: "off" }
  | { kind: "ask" }
  | { kind: "busy" }
  | { kind: "done"; text: string }
  | { kind: "none" }
  | { kind: "error"; key: string };
