"use client";

import { useEffect, useRef, type RefObject } from "react";
import { attachEdgeSwipe } from "@/lib/chat/v2/phone/edge-swipe-controller";
import { prefersReducedMotion } from "@/lib/chat/v2/phone/motion";

/**
 * C2.8 — «swipe from the start edge goes back», with POINTER events (a finger or a pen; a mouse never swipes). The element follows the finger inward while
 * it is dragged; on release the rules in `edge-swipe.ts` decide: go back (`onBack`), or slide to where it was (`edge-swipe-controller.ts` does the listening,
 * so a test can drive it). The element's `touch-action` must be `pan-y` (a class on the element) so the browser keeps vertical scrolling and leaves the
 * sideways movement to us. Under `prefers-reduced-motion` the snap-back is instant (the drag itself is the finger's, not an animation).
 *
 * Nothing happens unless the finger began inside the strip along the START edge: a swipe in the middle of the page is a table or a picture scrolling.
 */
export function useEdgeSwipeBack<T extends HTMLElement>(enabled: boolean, onBack: () => void, commitShare?: number): RefObject<T> {
  const ref = useRef<T>(null);
  const live = useRef(onBack);
  live.current = onBack;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    return attachEdgeSwipe(el as unknown as Parameters<typeof attachEdgeSwipe>[0], {
      rtl: () => getComputedStyle(el).direction === "rtl",
      width: () => window.innerWidth,
      reducedMotion: prefersReducedMotion,
      onBack: () => live.current(),
      ...(commitShare === undefined ? {} : { commitShare }),
    });
  }, [enabled, commitShare]);

  return ref;
}
