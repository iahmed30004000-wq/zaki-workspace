import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { EDGE_PX } from "@/lib/chat/v2/phone/edge-swipe";

/**
 * «تبويبات المجلدات» — SWIPE THE LIST to switch folder (Telegram's): a finger that travels sideways across the list goes to the next or the previous tab.
 * Toward the START edge of the page is NEXT, toward the END edge is PREVIOUS (so in this right-to-left page a finger moving right goes to the folder on the left of the strip).
 * It leaves alone what already belongs to a finger there: a touch that begins in the thin strip of the swipe BACK, anything while a row is open (a swipe closes it), and the
 * start-edge direction on a row that has its own swipe actions (pin, mute, archive). A mostly vertical move is a scroll. Pure rules here, a small hook under them.
 */
export const SWIPE_MIN_PX = 64;
export const SWIPE_RATIO = 1.8;
export const SWIPE_MAX_MS = 900;

export interface SwipeFacts {
  /** horizontal travel of the finger (positive: to the right on the screen) */
  dx: number;
  dy: number;
  ms: number;
  rtl: boolean;
  /** the touch began on a row that has swipe actions */
  onActionRow: boolean;
  /** some row of the list is open (its buttons are uncovered) */
  rowOpen: boolean;
  /** the touch began in the strip of the swipe back */
  fromStartEdge: boolean;
}

export function folderSwipe(f: SwipeFacts): "next" | "prev" | null {
  if (f.fromStartEdge || f.rowOpen) return null;
  if (f.ms > SWIPE_MAX_MS || Math.abs(f.dx) < SWIPE_MIN_PX || Math.abs(f.dx) < SWIPE_RATIO * Math.abs(f.dy)) return null;
  const towardStart = f.rtl ? f.dx > 0 : f.dx < 0;
  if (towardStart) return f.onActionRow ? null : "next";
  return "prev";
}

/** The tab after / before the active one, or null at the ends (and for a key that is not among them). */
export function nextTab<T extends { key: string }>(tabs: readonly T[], active: string, way: "next" | "prev"): T | null {
  const at = tabs.findIndex((t) => t.key === active);
  if (at < 0) return null;
  return tabs[way === "next" ? at + 1 : at - 1] ?? null;
}

/** The handlers to spread on the element that holds the list: a finger (never a mouse or a pen) is followed from its first touch to its last. */
export function useFolderSwipe(onSwipe: (way: "next" | "prev") => void, enabled = true) {
  const start = useRef<{ x: number; y: number; t: number; onActionRow: boolean; fromStartEdge: boolean } | null>(null);
  const live = useRef(onSwipe);
  live.current = onSwipe;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType !== "touch" || !event.isPrimary) return;
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const width = window.innerWidth;
      const fromStartEdge = rtl ? event.clientX >= width - EDGE_PX : event.clientX <= EDGE_PX;
      start.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, onActionRow: !!(event.target as Element).closest?.("[data-row-swipe]"), fromStartEdge };
    },
    [enabled],
  );
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || event.pointerType !== "touch") return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const way = folderSwipe({
      dx: event.clientX - s.x,
      dy: event.clientY - s.y,
      ms: event.timeStamp - s.t,
      rtl,
      onActionRow: s.onActionRow,
      rowOpen: document.querySelector('[data-row-swipe-open="true"]') !== null,
      fromStartEdge: s.fromStartEdge,
    });
    if (way) live.current(way);
  }, []);
  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);
  return { onPointerDown, onPointerUp, onPointerCancel };
}
