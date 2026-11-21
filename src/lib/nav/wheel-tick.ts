/**
 * The wheel's tick: one very short, soft click each time a new tab reaches the middle, drawn by the browser (no sound file), and a tiny buzz where the phone
 * has one. Only called while the person has the sound on (`WheelPrefs.sound`, on from the start). A browser keeps its audio asleep until a touch, so `primeTick` is called
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

/** One tick: a short, clear picker click (a high note with a soft body under it, 22 ms), and a 5 ms buzz. */
export function tick(): void {
  try {
    navigator.vibrate?.(5);
  } catch {
    // no buzz here
  }
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  const at = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.11, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.022);
  gain.connect(ctx.destination);
  // the click (high) and its body (lower), so it sounds like a wheel stop and not a beep
  for (const hz of [2300, 980]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 0.03);
  }
}
