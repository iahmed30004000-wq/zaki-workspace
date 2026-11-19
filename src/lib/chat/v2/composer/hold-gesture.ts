/**
 * C2.5 — the hold on the microphone, on a phone (a mouse clicks to start and clicks to stop; that has no gesture).
 *
 *   hold          the finger stays near where it went down: the take is sent when it lifts
 *   cancel        it slid sideways far enough: the take is thrown away
 *   lock          it slid UP far enough: the take goes on without the finger (the bar shows its own cancel and send)
 *
 * Pure: the composer reads the pointer and asks. The distances are the old composer's (80 px).
 */
export const HOLD_CANCEL_PX = 80;
export const HOLD_LOCK_PX = 80;

export type HoldOutcome = "hold" | "cancel" | "lock";

export interface Point {
  x: number;
  y: number;
}

export function holdOutcome(start: Point, now: Point): HoldOutcome {
  const dx = Math.abs(now.x - start.x);
  const up = start.y - now.y;
  const down = now.y - start.y;
  // the dominant direction wins, so a diagonal slide never does both: up beyond the lock distance (and not mostly sideways) locks
  if (up > HOLD_LOCK_PX && up >= dx) return "lock";
  // anywhere else far from the mic (sideways, or down and away) is «not a message»
  if (Math.hypot(dx, Math.max(down, 0)) > HOLD_CANCEL_PX) return "cancel";
  return "hold";
}

/**
 * C3c.2 — the long press on the SEND button, on a phone: it opens the send menu («ابعت بدون صوت»). A press this long (the finger within `SEND_HOLD_SLOP_PX` of where
 * it went down: more is a scroll) is a long press; lifting earlier is an ordinary tap that sends. A mouse has the right button instead (`contextmenu`).
 */
export const SEND_HOLD_MS = 500;
export const SEND_HOLD_SLOP_PX = 10;

export function sendHoldOpensMenu(start: Point, now: Point, elapsedMs: number): boolean {
  return elapsedMs >= SEND_HOLD_MS && Math.hypot(now.x - start.x, now.y - start.y) <= SEND_HOLD_SLOP_PX;
}
