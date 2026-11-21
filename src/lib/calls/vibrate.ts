/**
 * The phone shakes while a call rings, where the browser has `navigator.vibrate` (an Android browser; an iPhone's has none and just rings). One burst
 * every `RING_VIBRATION_PERIOD_MS`, the way the ringtone repeats; `0` stops it the moment the ring stops.
 */
export const RING_VIBRATION: number[] = [600, 300, 600, 300, 600];
const RING_VIBRATION_PERIOD_MS = 3000;

/** Starts vibrating with the ring; returns its stop (safe to call twice, and a no-op where there is no vibration). */
export function startVibration(): () => void {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (!nav || typeof nav.vibrate !== "function") return () => undefined;
  const burst = () => {
    try {
      nav.vibrate(RING_VIBRATION);
    } catch {
      // the browser wants a tap on the page first: no shaking, the sound still rings
    }
  };
  burst();
  const timer = setInterval(burst, RING_VIBRATION_PERIOD_MS);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      nav.vibrate(0);
    } catch {
      // nothing to stop
    }
  };
}
