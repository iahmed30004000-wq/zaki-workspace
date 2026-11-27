import { loadChatSoundPrefs } from "@/lib/chat/chime/prefs";
import { playToneNow } from "@/lib/chat/chime/player";
import { chimeThrottled } from "@/lib/chat/chime/decide";
import { playLoop } from "@/lib/calls/tones";
import type { BuiltinSound } from "./catalog";
import type { SoundEvent } from "./choice";
import { activeSoundChoices } from "./device";
import { resolveSound, type ResolvedSound } from "./resolve";

/**
 * The only part of the library that makes noise. The screens and the old sound code ask by EVENT; what they get back says whether the person's own choice was
 * played, so «nothing chosen» leaves today's code to run exactly as before. Nothing here throws, and a browser that refuses (no touch yet) is silent or falls
 * back to what the caller hands in.
 */

/** The gap between the two sounds of a mention, and between two rounds of an uploaded ringtone. */
const MENTION_GAP_MS = 220;
const FILE_RING_GAP_MS = 1500;
const MESSAGE_FILE_VOLUME = 0.6;
const RING_FILE_VOLUME = 0.8;

let lastThrottledAt: number | null = null;
export function resetSoundThrottle(): void {
  lastThrottledAt = null;
}

/** Plays a file once. `onFail`: the file did not load or the browser refused. */
function playFile(url: string, onFail?: () => void): void {
  if (typeof Audio === "undefined") return onFail?.();
  try {
    const sound = new Audio(url);
    sound.volume = MESSAGE_FILE_VOLUME;
    void Promise.resolve(sound.play()).catch(() => onFail?.());
  } catch {
    onFail?.();
  }
}

/** One message sound, now (a resolved choice that is not «default»). */
export function playResolvedOnce(resolved: ResolvedSound, onFail?: () => void): void {
  if (resolved.type === "file") return playFile(resolved.url, onFail);
  if (resolved.type === "synth" && resolved.sound.play.type === "tone") playToneNow(resolved.sound.play.tone, loadChatSoundPrefs().volume);
}

/**
 * The person's own sound for a message event. `true`: the choice was handled (played, or silence on purpose); `false`: nothing is chosen, play what you
 * always played. `throttle`: the notification of another chat keeps the 600 ms between two sounds. `fallback`: today's sound, for an upload that is gone.
 */
export function playChosenSound(event: SoundEvent, opts: { mention: boolean; throttle?: boolean; now?: number; fallback?: () => void }): boolean {
  const resolved = resolveSound(event, activeSoundChoices());
  if (resolved.type === "default") return false;
  if (resolved.type === "none") return true;
  if (opts.throttle) {
    const now = opts.now ?? Date.now();
    if (chimeThrottled(lastThrottledAt, now)) return true;
    lastThrottledAt = now;
  }
  playResolvedOnce(resolved, opts.fallback);
  if (opts.mention) setTimeout(() => playResolvedOnce(resolved), MENTION_GAP_MS);
  return true;
}

/** An uploaded ringtone, again and again with a pause; `fallback` takes over when it cannot be played (a call never rings silent by accident). */
function loopFile(url: string, fallback: () => () => void): () => void {
  if (typeof Audio === "undefined") return fallback();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let instead: (() => void) | null = null;
  const sound = new Audio(url);
  sound.volume = RING_FILE_VOLUME;
  const play = () => {
    let started: Promise<void> | undefined;
    try {
      started = sound.play();
    } catch {
      started = Promise.reject(new Error("play"));
    }
    void Promise.resolve(started).catch(() => {
      if (!stopped && !instead) instead = fallback();
    });
  };
  sound.onended = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) play();
    }, FILE_RING_GAP_MS);
  };
  play();
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      sound.pause();
    } catch {
      /* already gone */
    }
    sound.onended = null;
    instead?.();
  };
}

const startSynthLoop = (sound: BuiltinSound): (() => void) => (sound.play.type === "loop" ? playLoop(sound.play.notes, sound.play.periodMs) : () => undefined);

/** Starts a resolved ringing sound; returns its stop. */
export function startResolvedLoop(resolved: Exclude<ResolvedSound, { type: "default" }>, fallback: () => () => void): () => void {
  if (resolved.type === "none") return () => undefined;
  if (resolved.type === "synth") return startSynthLoop(resolved.sound);
  return loopFile(resolved.url, fallback);
}

/** The person's own ringing sound for a call event, or null: nothing is chosen, ring as always. */
export function startChosenLoop(event: "ring" | "ringback", fallback: () => () => void = () => () => undefined): (() => void) | null {
  const resolved = resolveSound(event, activeSoundChoices());
  return resolved.type === "default" ? null : startResolvedLoop(resolved, fallback);
}
