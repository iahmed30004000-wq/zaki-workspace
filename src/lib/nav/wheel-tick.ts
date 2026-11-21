/**
 * The wheel's tick: one very short, soft click each time a new tab reaches the middle, drawn by the browser (no sound file), and a tiny buzz where the phone
 * has one. Only ever called when the person turned the sound on (`WheelPrefs.sound`). A browser keeps its audio asleep until a touch, so `primeTick` is called
 * from the first touch on the strip.
 */

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

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

/** Wake the audio from a touch (the browser allows it only then). */
export function primeTick(): void {
  const ctx = audio();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
}

/** One tick: 14 ms of a high, quiet note, and a 5 ms buzz. */
export function tick(): void {
  try {
    navigator.vibrate?.(5);
  } catch {
    // no buzz here
  }
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 1900;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.05, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.014);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.02);
}
