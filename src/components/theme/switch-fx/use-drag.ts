"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { pFromPointer, type Direction } from "@/lib/themes/switch-fx";

/**
 * A horizontal drag along a track, for every look of the switch.
 *
 * - The track's rectangle and the reading direction are measured ONCE, when the press starts: a move never reads layout.
 * - Moves only store the latest position; `onMove` runs in a requestAnimationFrame, at most once per frame, and only while a
 *   drag is going on. A release or a cancel cancels the pending frame; so does unmounting.
 * - `onEnd` gets the final position and whether the pointer really travelled (a press without travel is a click).
 * - Position 0 is the START of the reading direction (the right edge in this app).
 */
export interface TrackDragHandlers<E extends HTMLElement> {
  onPointerDown: (e: PointerEvent<E>) => void;
  onPointerMove: (e: PointerEvent<E>) => void;
  onPointerUp: (e: PointerEvent<E>) => void;
  onPointerCancel: (e: PointerEvent<E>) => void;
}

export interface TrackDragOptions {
  onStart?: (position: number) => void;
  onMove: (position: number) => void;
  onEnd: (position: number, travelled: boolean) => void;
  disabled?: boolean;
}

const TRAVEL_PX = 4;

export function useTrackDrag<E extends HTMLElement>(options: TrackDragOptions): TrackDragHandlers<E> {
  const opts = useRef(options);
  opts.current = options;
  const state = useRef({ active: false, rect: { left: 0, right: 0, width: 0 }, dir: "rtl" as Direction, latest: 0, startX: 0, travelled: false, raf: 0 });

  useEffect(
    () => () => {
      if (state.current.raf) cancelAnimationFrame(state.current.raf);
    },
    [],
  );

  const finish = useCallback((e: PointerEvent<E>) => {
    const s = state.current;
    if (!s.active) return;
    s.active = false;
    if (e.type === "pointerup") s.latest = pFromPointer(e.clientX, s.rect, s.dir);
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = 0;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    opts.current.onEnd(s.latest, s.travelled);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<E>) => {
    if (opts.current.disabled || e.button !== 0) return;
    const s = state.current;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    s.rect = { left: r.left, right: r.right, width: r.width };
    s.dir = getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
    s.startX = e.clientX;
    s.travelled = false;
    s.active = true;
    s.latest = pFromPointer(e.clientX, s.rect, s.dir);
    el.setPointerCapture?.(e.pointerId);
    opts.current.onStart?.(s.latest);
    opts.current.onMove(s.latest);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<E>) => {
    const s = state.current;
    if (!s.active) return;
    s.latest = pFromPointer(e.clientX, s.rect, s.dir);
    if (Math.abs(e.clientX - s.startX) > TRAVEL_PX) s.travelled = true;
    if (!s.raf) {
      s.raf = requestAnimationFrame(() => {
        s.raf = 0;
        if (s.active) opts.current.onMove(s.latest);
      });
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish };
}
