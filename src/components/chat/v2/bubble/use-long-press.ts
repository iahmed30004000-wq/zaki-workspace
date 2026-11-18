"use client";

import React from "react";
import { LONG_PRESS_MS } from "@/components/chat/message/message-menu";

/**
 * A press this long on a phone opens the message's menu sheet (the same `LONG_PRESS_MS` as today); moving the finger more than 10 px (a scroll) or lifting
 * early is no press, and a mouse never long-presses (it has the right button and the hover trigger).
 */
export function useLongPress(enabled: boolean, open: () => void) {
  const press = React.useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const end = React.useCallback(() => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  }, []);
  React.useEffect(() => end, [end]);
  return {
    pressing: () => press.current !== null,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" || !enabled) return;
      const { clientX: x, clientY: y } = e;
      press.current = {
        x,
        y,
        timer: setTimeout(() => {
          press.current = null;
          open();
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) end();
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}
