import { previewChime, previewTone } from "@/lib/chat/chime/player";
import { loadChatSoundPrefs } from "@/lib/chat/chime/prefs";
import { chatSoundsActive } from "@/lib/chat/chime/active";
import { CHAT_SOUND_URLS } from "@/lib/chat/sounds";
import { startRing } from "@/lib/calls/ring-sound";
import { loadRingTone } from "@/lib/calls/ring-prefs";
import { RINGBACK_NOTES, RINGBACK_PERIOD_MS, playLoop } from "@/lib/calls/tones";
import { FAMILY_OF } from "./catalog";
import type { SoundEvent } from "./choice";
import { playResolvedOnce, startResolvedLoop } from "./play";
import { resolveSound } from "./resolve";

/**
 * «Choose it and hear it»: what the radio list plays the moment a row is tapped. `choice` null is «افتراضي»: the very sound the event makes when nothing is
 * chosen. A ringing sound plays for a few seconds; `stop` ends it earlier (the next tap, or leaving the page).
 */
export const PREVIEW_RING_MS = 3500;

const nothing = () => undefined;

function playFileOnce(url: string): () => void {
  if (typeof Audio === "undefined") return nothing;
  try {
    const sound = new Audio(url);
    sound.volume = 0.6;
    void Promise.resolve(sound.play()).catch(nothing);
    return () => sound.pause();
  } catch {
    return nothing;
  }
}

function previewDefault(event: SoundEvent): () => void {
  if (event === "ring") return startRing({ tone: loadRingTone() });
  if (event === "ringback") return playLoop(RINGBACK_NOTES, RINGBACK_PERIOD_MS);
  const prefs = loadChatSoundPrefs();
  // as the app plays it today: the other chats (and, with the company's `chatSounds` on, the open one) use the chosen chat tone; the rest are the two pops
  if (event === "inChat" || (event === "received" && chatSoundsActive())) {
    void previewChime({ tone: prefs.tone, volume: prefs.volume });
    return nothing;
  }
  return playFileOnce(CHAT_SOUND_URLS[event === "sent" ? "sent" : "received"]);
}

/** Plays the choice for this event now; returns its stop. */
export function previewSound(event: SoundEvent, choice: string | null): () => void {
  const resolved = choice === null ? ({ type: "default" } as const) : resolveSound(event, { [event]: choice });
  const ringing = FAMILY_OF[event] !== "message";
  let stop: () => void = nothing;
  if (resolved.type === "default") stop = previewDefault(event);
  else if (resolved.type === "none") return nothing;
  else if (ringing) stop = startResolvedLoop(resolved, () => nothing);
  else if (resolved.type === "synth" && resolved.sound.play.type === "tone") void previewTone(resolved.sound.play.tone, loadChatSoundPrefs().volume);
  else playResolvedOnce(resolved);
  if (!ringing) return stop;
  const timer = setTimeout(stop, PREVIEW_RING_MS);
  return () => {
    clearTimeout(timer);
    stop();
  };
}
