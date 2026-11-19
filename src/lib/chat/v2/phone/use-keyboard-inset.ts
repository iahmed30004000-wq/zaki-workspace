"use client";

import { useEffect, useState } from "react";
import { keyboardInsetOf } from "@/lib/chat/v2/phone/keyboard";

/**
 * C2.8 — the height of the on-screen keyboard where the browser slides it OVER the page (0 where it resizes the page itself: nothing to add). The phone's
 * conversation screen pads its bottom by it, so the composer sits above the keyboard. Reads `visualViewport` (resize and scroll), one frame at a time;
 * not listening at all while `enabled` is false (a computer, a screen that is not a conversation).
 */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !viewport) {
      setInset(0);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      setInset(keyboardInsetOf({ layoutHeight: window.innerHeight, viewportHeight: viewport.height, viewportTop: viewport.offsetTop }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return inset;
}
