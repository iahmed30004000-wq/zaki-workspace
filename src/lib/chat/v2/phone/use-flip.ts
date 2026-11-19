"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { FLIP_MS, flipMoves, prefersReducedMotion } from "@/lib/chat/v2/phone/motion";

// a layout effect in the browser (the slide must start before the first paint of the new place), a plain one where there is no browser (no warning on the server)
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * C2.8 — FLIP for the list's rows: when a new message moves its row to the top, the row (and the ones it passes) SLIDE 150 ms to their new place instead of
 * jumping. The virtual list already writes every row's offset into its `transform`; after each render this compares the offsets with the render before and,
 * for the rows drawn in both whose offset changed, plays a Web Animation from the old offset to the new one (the inline style already holds the new one,
 * so when the animation ends nothing moves).
 *
 *  - `starts`      key → offset of every row drawn now (a scroll changes WHICH rows are drawn, never a row's offset, so a scroll slides nothing)
 *  - `elementOf`   the row's element for a key (asked only for the rows that moved, so a scroll costs one small map and nothing else)
 *  - `resetKey`    a value that changes when the offsets all change for another reason (the row height at a screen change): that render slides nothing
 *
 * Nothing under `prefers-reduced-motion`, nothing without Web Animations, nothing when the drawn window changed too much (a folder switch or a search is a new
 * list, not a row finding its place: `flipMoves`).
 */
export function useFlipRows(starts: ReadonlyMap<string | number, number>, elementOf: (key: string | number) => HTMLElement | null | undefined, resetKey: unknown): void {
  const before = useRef<ReadonlyMap<string | number, number> | null>(null);
  const lastReset = useRef(resetKey);
  useIsomorphicLayoutEffect(() => {
    const prev = before.current;
    before.current = starts;
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      return;
    }
    if (!prev || prefersReducedMotion()) return;
    for (const move of flipMoves(prev, starts)) {
      const el = elementOf(move.key);
      if (el && typeof el.animate === "function") el.animate([{ transform: `translateY(${move.from}px)` }, { transform: `translateY(${move.to}px)` }], { duration: FLIP_MS, easing: "ease-out" });
    }
  });
}
