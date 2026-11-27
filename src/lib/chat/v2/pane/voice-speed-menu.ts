import { DEFAULT_VOICE_SPEED, VOICE_SPEED_CHOICES, type VoiceSpeed } from "@/lib/chat/prefs";

/** «تيليجرام على التلفون»: the names of the speeds in the long press's menu, and the slider's steps over them. Pure. */
export const SPEED_NAME_KEYS: Record<VoiceSpeed, string> = {
  0.5: "tgvoice.speed_slow",
  1: "tgvoice.speed_normal",
  1.2: "tgvoice.speed_medium",
  1.5: "tgvoice.speed_fast",
  1.7: "tgvoice.speed_faster",
  2: "tgvoice.speed_faster",
};

/** A finger that moves more than this during the press of the speed chip is scrolling, not pressing. */
export const SPEED_HOLD_SLOP_PX = 10;

export const stepOfSpeed = (speed: VoiceSpeed): number => Math.max(0, VOICE_SPEED_CHOICES.indexOf(speed));

export const speedAtStep = (step: number): VoiceSpeed => VOICE_SPEED_CHOICES[Math.max(0, Math.min(VOICE_SPEED_CHOICES.length - 1, Math.round(step)))] ?? DEFAULT_VOICE_SPEED;
