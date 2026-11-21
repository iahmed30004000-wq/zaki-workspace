import { FLICK_PX, FLICK_PX_PER_MS, SLOPE, SLOP_PX, atStartEdge } from "@/lib/chat/v2/phone/edge-swipe";
import { MUTE_PRESETS, mutedUntilOf } from "@/lib/chat/row-preview";

/**
 * S5.7 (e) — SWIPE A ROW of the phone's chat list to pin, mute or archive it, as pure rules plus a listener with no React in it (the shape of
 * `edge-swipe-controller.ts`, driven in tests with a plain event target).
 *
 * The row slides toward the inline START edge (rightwards in this right-to-left layout — the mirror of the usual left-handed list swipe, and the opposite of the swipe
 * BACK, which pulls inward from the start edge: a touch that begins in that thin strip is not ours) and uncovers three buttons behind it. It settles open when it was
 * pulled past half of them or flicked, and closed otherwise; an open row closes by the same swipe back the other way, by a tap, or when another row opens. A vertical
 * move is the list's own scroll and ends the gesture for good. The buttons are the person's OWN items — the very same door as the row's menu (`PUT …/me`, switch
 * `chatPersonalState`) — so a swipe can never do what the menu would not.
 */

export const ROW_ACTION_PX = 72;

export type RowSwipeActionId = "pin" | "unpin" | "mute" | "unmute" | "archive" | "unarchive";
export interface RowSwipeAction {
  id: RowSwipeActionId;
  labelKey: string;
}

/** What `PUT /api/chat/conversations/[id]/me` takes for one swipe button. */
export type RowSwipeChange = { pinned: boolean } | { archived: boolean } | { mutedUntil: string | null };

const LABEL: Record<RowSwipeActionId, string> = {
  pin: "chatparity.row.pin",
  unpin: "chatparity.row.unpin",
  mute: "chatparity.row.mute",
  unmute: "chatparity.row.unmute",
  archive: "chatparity.row.archive",
  unarchive: "chatparity.row.unarchive",
};

/** The three buttons of a row, in order: pin, mute, archive — each going the way the row says. A space row (a forum) has none; nor has a company with the personal items off. */
export function rowSwipeActionsOf(row: { kind: string; pinnedByMe: boolean; archivedByMe: boolean; muted: boolean }, opts: { personal?: boolean } = {}): RowSwipeAction[] {
  if (row.kind === "SPACE" || opts.personal === false) return [];
  const ids: RowSwipeActionId[] = [row.pinnedByMe ? "unpin" : "pin", row.muted ? "unmute" : "mute", row.archivedByMe ? "unarchive" : "archive"];
  return ids.map((id) => ({ id, labelKey: LABEL[id] }));
}

/** The change a button asks the personal door for. A mute from a swipe is «for good» (the menu's presets stay the way to choose a time). */
export function rowSwipeChange(id: RowSwipeActionId, now: Date = new Date()): RowSwipeChange {
  switch (id) {
    case "pin":
      return { pinned: true };
    case "unpin":
      return { pinned: false };
    case "archive":
      return { archived: true };
    case "unarchive":
      return { archived: false };
    case "unmute":
      return { mutedUntil: null };
    case "mute":
      return { mutedUntil: mutedUntilOf(MUTE_PRESETS[MUTE_PRESETS.length - 1]!, now) };
  }
}

/** Does the row settle open on release? A quick flick decides by its direction; otherwise past half of the buttons. */
export function settlesOpen({ offset, reveal, delta, ms }: { offset: number; reveal: number; delta: number; ms: number }): boolean {
  if (Math.abs(delta) >= FLICK_PX && Math.abs(delta) / Math.max(ms, 1) >= FLICK_PX_PER_MS) return delta > 0;
  return offset >= reveal / 2;
}

export interface RowSwipeBox {
  addEventListener: (type: string, listener: (event: never) => void) => void;
  removeEventListener: (type: string, listener: (event: never) => void) => void;
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
}

export interface RowSwipeEnv {
  rtl: () => boolean;
  width: () => number;
  /** the width of the buttons (0: none, nothing swipes) */
  reveal: () => number;
  enabled: () => boolean;
  /** the row's offset toward the start edge; `animate` on the settle (the caller skips it under reduced motion) */
  onOffset: (px: number, animate: boolean) => void;
  /** the row settled open or closed (only when that changed) */
  onOpenChange: (open: boolean) => void;
}

interface Touch {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export function attachRowSwipe(box: RowSwipeBox, env: RowSwipeEnv): { detach: () => void; close: () => void } {
  let open = false;
  let offset = 0;
  let start: { id: number; x: number; y: number; at: number; from: number } | null = null;
  let dragging = false;

  const settle = (next: boolean) => {
    const changed = next !== open;
    open = next;
    offset = next ? env.reveal() : 0;
    env.onOffset(offset, true);
    if (changed) env.onOpenChange(open);
  };

  const down = (event: Touch) => {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    if (!env.enabled() || env.reveal() <= 0) return;
    // the swipe back begins in the strip along the start edge
    if (atStartEdge(event.clientX, env.width(), env.rtl())) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, from: offset };
    dragging = false;
  };
  /** how far the finger went toward the START edge (negative: back toward the end) */
  const towardStart = (x: number, from: number): number => (env.rtl() ? x - from : from - x);

  const move = (event: Touch) => {
    if (!start || event.pointerId !== start.id) return;
    const delta = towardStart(event.clientX, start.x);
    if (!dragging) {
      const dy = Math.abs(event.clientY - start.y);
      if (Math.max(Math.abs(delta), dy) < SLOP_PX) return;
      // mostly sideways, and — while closed — toward the buttons: anything else is the list's own gesture
      if (!(Math.abs(delta) > dy * SLOPE) || (start.from === 0 && delta < 0)) {
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
    offset = Math.min(Math.max(start.from + delta, 0), env.reveal());
    env.onOffset(offset, false);
  };
  const end = (event: Touch, cancelled: boolean) => {
    if (!start || event.pointerId !== start.id) return;
    const from = start;
    start = null;
    if (!dragging) return;
    dragging = false;
    try {
      box.releasePointerCapture(event.pointerId);
    } catch {
      /* the capture is already gone */
    }
    if (cancelled) return settle(open);
    settle(settlesOpen({ offset, reveal: env.reveal(), delta: towardStart(event.clientX, from.x), ms: event.timeStamp - from.at }));
  };

  const listeners: [string, (event: never) => void][] = [
    ["pointerdown", down as (event: never) => void],
    ["pointermove", move as (event: never) => void],
    ["pointerup", ((event: Touch) => end(event, false)) as (event: never) => void],
    ["pointercancel", ((event: Touch) => end(event, true)) as (event: never) => void],
  ];
  for (const [type, listener] of listeners) box.addEventListener(type, listener);
  return {
    detach: () => {
      for (const [type, listener] of listeners) box.removeEventListener(type, listener);
    },
    close: () => {
      if (offset !== 0 || open) settle(false);
    },
  };
}

/** Only ONE row is open at a time: a row that opens closes the one that was. */
let openRow: (() => void) | null = null;
export function claimOpenRow(close: () => void): void {
  if (openRow && openRow !== close) openRow();
  openRow = close;
}
export function releaseOpenRow(close: () => void): void {
  if (openRow === close) openRow = null;
}
