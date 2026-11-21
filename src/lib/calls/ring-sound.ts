/**
 * THE RING. The person being rung hears the ringtone on the incoming card. The person who rang a PRIVATE call hears a
 * different, softer ringback in the call room until somebody joins (or the same 30 seconds are over), the way a
 * messenger rings the caller too (the owner, 2026-10-30) — but never the incoming ringtone itself (2026-11-21: «برن علي
 * ع حالي»), and never in a topic call or a meeting.
 *
 * The sound is a file (public/sounds/ring.mp3, CC0, credited in public/brand/CREDITS.md) that plays, waits a
 * moment and plays again. A browser may refuse to play before the person has touched the page; then the
 * built-in two-beat tone (the one the card always had) takes over, so a call never rings silent by accident.
 */
import { playLoop, RINGBACK_NOTES, RINGBACK_PERIOD_MS } from "./tones";

export const RING_SOUND_URL = "/sounds/ring.mp3";
/** The pause between two rings. */
export const RING_GAP_MS = 1500;

/** How much longer the caller's ring runs: nothing when somebody else is in the call, or the call is older than `forMs`. */
export function ringbackMsLeft(opts: { alone: boolean; startedAt: string; now: number; forMs: number }): number {
  if (!opts.alone) return 0;
  const started = Date.parse(opts.startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, opts.forMs - (opts.now - started));
}

/**
 * How long the CALLER's ringback runs (the owner, 2026-11-21: «برن علي ع حالي» — the incoming ringtone must never play to the
 * person who is calling). Only a private call, and only while somebody was really rung: a topic call, a meeting, and a call
 * the person joined (nobody was rung for them) have no ringback. `view` is the call as its page read it; `null` while it loads.
 */
export function ringbackFor(opts: {
  view: { kind: string; rangCount: number; startedAt: string } | null;
  alone: boolean;
  now: number;
  forMs: number;
}): number {
  const { view } = opts;
  if (!view || view.kind !== "DM" || view.rangCount < 1) return 0;
  return ringbackMsLeft({ alone: opts.alone, startedAt: view.startedAt, now: opts.now, forMs: opts.forMs });
}

/** The caller's own soft two-note ringback (see `RINGBACK_NOTES`); returns its stop. It is never the incoming ringtone. */
export function startRingback(): () => void {
  return playLoop(RINGBACK_NOTES, RINGBACK_PERIOD_MS);
}

/** A soft two-beat ring drawn by the browser itself (no sound file); returns its stop. */
function startBeeps(): () => void {
  const Ctx = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return () => undefined;
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctx();
  } catch {
    return () => undefined;
  }
  const audio = ctx;
  const beep = () => {
    for (const at of [0, 0.4]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 480;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + at + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.32);
    }
  };
  beep();
  const timer = setInterval(beep, 2500);
  return () => {
    clearInterval(timer);
    void audio.close().catch(() => undefined);
  };
}

/** Starts the ring; returns its stop (safe to call twice). */
export function startRing(): () => void {
  if (typeof Audio === "undefined") return startBeeps();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fallback: (() => void) | null = null;
  const sound = new Audio(RING_SOUND_URL);
  sound.volume = 0.8;

  const again = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) play();
    }, RING_GAP_MS);
  };
  function play(): void {
    let started: Promise<void> | undefined;
    try {
      started = sound.play();
    } catch {
      started = Promise.reject(new Error("play"));
    }
    void Promise.resolve(started).catch(() => {
      // refused (no gesture yet) or the file did not load: the built-in beep keeps the call from ringing silent
      if (!stopped && !fallback) fallback = startBeeps();
    });
  }
  sound.onended = again;
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
    fallback?.();
  };
}
