import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

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
 * «تيليجرام على التلفون» (`tgPhone`): the same hold, Telegram's way. A slide UP locks as above. It cancels only past `TG_MOTION.recordCancelShare` of the
 * screen's width TOWARD THE CANCEL SIDE: from the microphone toward the words «السحب للإلغاء», which in this right-to-left layout is rightward (the mic sits
 * at the left end of the row). Sliding the other way, or down, is still a hold. Pure; the caller says the width and the direction.
 */
export interface TgDrag {
  outcome: HoldOutcome;
  /** how far the finger went toward the cancel side, as a screen shift (positive rightward in a right-to-left page, negative in a left-to-right one) */
  dx: number;
  /** 0..1 of the way to a cancel */
  cancel: number;
  /** how far up the finger is, in px, up to the lock distance */
  up: number;
  /** 0..1 of the way to the lock */
  lock: number;
}

export const TG_NO_DRAG: TgDrag = { outcome: "hold", dx: 0, cancel: 0, up: 0, lock: 0 };

export function tgHoldDrag(start: Point, now: Point, width: number, rtl: boolean): TgDrag {
  const toward = Math.max(0, rtl ? now.x - start.x : start.x - now.x);
  const rise = Math.max(0, start.y - now.y);
  const cancelAt = Math.max(1, width * TG_MOTION.recordCancelShare);
  const locks = rise > HOLD_LOCK_PX && rise >= Math.abs(now.x - start.x);
  const outcome: HoldOutcome = locks ? "lock" : toward >= cancelAt ? "cancel" : "hold";
  return { outcome, dx: toward === 0 ? 0 : rtl ? toward : -toward, cancel: Math.min(1, toward / cancelAt), up: Math.min(rise, HOLD_LOCK_PX), lock: Math.min(1, rise / HOLD_LOCK_PX) };
}

/** Where the finger is, kept OUTSIDE the composer's state: the recording bar writes it straight onto its own elements, so a move draws nothing again. */
export interface DragStore {
  get(): TgDrag;
  set(next: TgDrag): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createDragStore(): DragStore {
  let value = TG_NO_DRAG;
  const listeners = new Set<() => void>();
  const set = (next: TgDrag) => {
    value = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => value,
    set,
    reset: () => set(TG_NO_DRAG),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
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
