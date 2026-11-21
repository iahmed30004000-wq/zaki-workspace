import { SLOPE, atStartEdge, inwardOf, swipeIntent } from "@/lib/chat/v2/phone/edge-swipe";
import { isOwnThing } from "@/lib/chat/v2/menu/gestures";

/**
 * S5.7 (b) — SWIPE A MESSAGE TO REPLY (the phone), as pure rules plus a listener with no React in it (so a test can drive it with a plain event target, like
 * `edge-swipe-controller.ts`, whose rules it shares).
 *
 * The finger goes from the inline START side toward the inline END (leftwards in this right-to-left layout; `rtl` is read at the moment of the touch, so the same rules
 * mirror in a left-to-right page). The bubble follows the finger up to `REPLY_MAX_PX` with a little resistance past the trigger; at `REPLY_COMMIT_PX` the phone buzzes once
 * (feature-detected `navigator.vibrate`); lifting the finger past the trigger starts the reply, lifting it before — or the browser taking the gesture — only settles the
 * bubble back. What it NEVER fights:
 *  - the page's vertical scroll: the first decided move must be mostly sideways (`swipeIntent`), otherwise the gesture is given up for good;
 *  - the swipe back, which begins in the thin strip along the START edge: a touch that begins there is not ours;
 *  - the bubble's own things (a link, a button, a player, a field): `isOwnThing`;
 *  - the long press, the selected text and the multi-select: `enabled()` is false while messages are picked, and a selection of text is left alone.
 *  - a mouse or a pen: only a finger swipes (the computer replies by a double click).
 */

/** The pull at which the reply is armed (and the buzz comes). */
export const REPLY_COMMIT_PX = 64;
/** The bubble never follows the finger further than this. */
export const REPLY_MAX_PX = 96;
/** The share of the finger's travel past the trigger that the bubble still follows. */
const RESISTANCE = 0.3;

/** How far the bubble follows a finger that has travelled `inward` pixels toward the end. */
export function replyPullOf(inward: number): number {
  if (!(inward > 0)) return 0;
  if (inward <= REPLY_COMMIT_PX) return inward;
  return Math.min(REPLY_COMMIT_PX + (inward - REPLY_COMMIT_PX) * RESISTANCE, REPLY_MAX_PX);
}

/** Does lifting the finger here start the reply? A long, straight pull toward the end: not a short one, not a diagonal one, not one the wrong way. */
export function commitsReply({ inward, dy }: { inward: number; dy: number }): boolean {
  return inward >= REPLY_COMMIT_PX && inward > Math.abs(dy) * SLOPE;
}

/** A short buzz where the phone has one; says whether it buzzed. Never throws (a blocked or missing `vibrate` is simply silence). */
export function hapticTick(ms = 12): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    return navigator.vibrate(ms) !== false;
  } catch {
    return false;
  }
}

export interface ReplyBox {
  addEventListener: (type: string, listener: (event: never) => void) => void;
  removeEventListener: (type: string, listener: (event: never) => void) => void;
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
}

export interface ReplyEnv {
  /** is the page right-to-left (read at the moment of a touch) */
  rtl: () => boolean;
  /** the width of the window (the swipe back's edge strip is measured against it) */
  width: () => number;
  /** false while messages are being picked, on a deleted message, in silent oversight: nothing starts */
  enabled: () => boolean;
  /** is there selected text on the page (a long press that began a selection is not a swipe) */
  hasSelection: () => boolean;
  /** the bubble follows the finger: `px` toward the end; `0` is the settle back (the caller animates it unless motion is reduced) */
  onPull: (px: number, settle: boolean) => void;
  /** the pull was long enough and the finger lifted */
  onReply: () => void;
  /** the pull has just reached the trigger */
  haptic: () => void;
}

/** The pointer fields the controller reads (a real PointerEvent has them all). */
interface Touch {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

export function attachReplySwipe(box: ReplyBox, env: ReplyEnv): () => void {
  let start: { id: number; x: number; y: number } | null = null;
  let dragging = false;
  let armed = false;

  const end = (event: Touch, cancelled: boolean) => {
    if (!start || event.pointerId !== start.id) return;
    const from = start;
    start = null;
    if (!dragging) return;
    dragging = false;
    const wasArmed = armed;
    armed = false;
    try {
      box.releasePointerCapture(event.pointerId);
    } catch {
      /* the capture is already gone */
    }
    const inward = inwardOf(from.x, event.clientX, env.rtl());
    const commit = !cancelled && wasArmed && commitsReply({ inward, dy: event.clientY - from.y });
    env.onPull(0, true);
    if (commit) env.onReply();
  };

  const down = (event: Touch) => {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    if (!env.enabled() || env.hasSelection()) return;
    // the swipe back is the strip along the start edge; and what does its own thing keeps its own gesture
    if (atStartEdge(event.clientX, env.width(), env.rtl()) || isOwnThing(event.target)) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dragging = false;
    armed = false;
  };
  const move = (event: Touch) => {
    if (!start || event.pointerId !== start.id) return;
    const inward = inwardOf(start.x, event.clientX, env.rtl());
    if (!dragging) {
      const intent = swipeIntent(inward, event.clientY - start.y);
      if (intent === "undecided") return;
      if (intent === "scroll") {
        start = null;
        return;
      }
      dragging = true;
      try {
        box.setPointerCapture(event.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
    }
    env.onPull(replyPullOf(inward), false);
    // armed when the finger has travelled to the trigger; coming back below it disarms (and the next arrival buzzes again)
    if (!armed && inward >= REPLY_COMMIT_PX) {
      armed = true;
      env.haptic();
    } else if (armed && inward < REPLY_COMMIT_PX) armed = false;
  };

  const listeners: [string, (event: never) => void][] = [
    ["pointerdown", down as (event: never) => void],
    ["pointermove", move as (event: never) => void],
    ["pointerup", ((event: Touch) => end(event, false)) as (event: never) => void],
    ["pointercancel", ((event: Touch) => end(event, true)) as (event: never) => void],
  ];
  for (const [type, listener] of listeners) box.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of listeners) box.removeEventListener(type, listener);
  };
}
