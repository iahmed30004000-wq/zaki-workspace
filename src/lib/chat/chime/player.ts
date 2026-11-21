import { chimeThrottled } from "@/lib/chat/chime/decide";
import { toneOf, type ChatTone, type ChatToneId } from "@/lib/chat/chime/tones";

/**
 * S5.1 — draws a message tone with WebAudio (no sound file). The approach is the wheel's tick (`src/lib/nav/wheel-tick.ts`): one `AudioContext`, kept asleep by every browser
 * until a touch, so `primeChime` is called from the first touch / click / key (an iPhone's Safari allows `resume()` only from a gesture). Before that nothing plays and nothing
 * throws. Two sounds are never played within 600 ms (`chimeThrottled`), except the person's own «جرّب الصوت» (`force`).
 */

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;
let lastPlayedAt: number | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor: AudioContextCtor | undefined = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** Wake the audio from a touch (the browser allows it only then). The first call also plays one silent sample: Safari wants a sound started inside the gesture. */
export function primeChime(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // a browser that cannot do that still wakes with `resume()`
  }
}

/** Draw one tone at `startAt` (the context's clock) with the person's volume as the master gain. */
export function playTone(ctx: AudioContext, tone: ChatTone, volume: number, startAt: number): void {
  const level = Math.min(1, Math.max(0, volume));
  if (level <= 0) return;
  const master = ctx.createGain();
  master.gain.value = level;
  master.connect(ctx.destination);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tone.cutoff;
  filter.Q.value = 0.7;
  filter.connect(master);
  for (const note of tone.notes) {
    const t0 = startAt + note.at;
    voice(ctx, filter, note.hz, note.wave, note.gain, t0, note.dur);
    for (const over of note.overtones ?? []) {
      voice(ctx, filter, note.hz * over.ratio, "sine", note.gain * over.gain, t0, note.dur * over.decay);
    }
  }
}

/** One oscillator with a soft attack and an exponential fall to silence. */
function voice(ctx: AudioContext, to: AudioNode, hz: number, wave: OscillatorType, peak: number, t0: number, dur: number): void {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, 0.02));
  env.connect(to);
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.value = hz;
  osc.connect(env);
  osc.start(t0);
  osc.stop(t0 + Math.max(dur, 0.02) + 0.03);
}

/** The gap between the two tones of a mention. */
const MENTION_GAP_S = 0.2;

/** Play the tone now. false: nothing was played (no audio, still asleep, or too soon after the last one). */
export function playChime(o: { tone: ChatToneId; volume: number; mention: boolean; force?: boolean }): boolean {
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state !== "running") {
    void ctx.resume().catch(() => undefined);
    return false;
  }
  const now = Date.now();
  if (o.force !== true && chimeThrottled(lastPlayedAt, now)) return false;
  const tone = toneOf(o.tone);
  try {
    playTone(ctx, tone, o.volume, ctx.currentTime);
    if (o.mention) playTone(ctx, tone, o.volume, ctx.currentTime + MENTION_GAP_S);
  } catch {
    return false;
  }
  lastPlayedAt = now;
  return true;
}

/** Test hook: forget the last sound. */
export function resetChimeThrottle(): void {
  lastPlayedAt = null;
}

/**
 * «جرّب الصوت»: called from the person's tap, so the audio can be woken first (an iPhone's Safari wakes it only inside a gesture); then the tone plays at the chosen volume,
 * whatever the last sound was (the 600 ms gap is for messages, not for a person who is trying a tone). false: this browser has no audio.
 */
export async function previewChime(o: { tone: ChatToneId; volume: number; mention?: boolean }): Promise<boolean> {
  const ctx = audio();
  if (!ctx) return false;
  primeChime();
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return playChime({ tone: o.tone, volume: o.volume, mention: o.mention === true, force: true });
}
