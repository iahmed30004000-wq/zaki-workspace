"use client";

import React, { useCallback, useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;

/**
 * The gestures that open a menu on a row or a tab: a right click, or a finger held for half a second (the click that follows a long press is swallowed so the
 * row does not open under the menu). Moved here from `row-menu.tsx` (which still exports it) so the folder strip can use it without importing the row's menu.
 */
export function useRowMenuGestures(onOpen: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallow = useRef(false);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  if (!enabled) return {};
  return {
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      onOpen();
    },
    onTouchStart: () => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        swallow.current = true;
        onOpen();
      }, LONG_PRESS_MS);
    },
    onTouchMove: clear,
    onTouchEnd: () => {
      clear();
      // the click of a long press comes right after the finger lifts; if none comes (the browser sent a context menu instead) the next real click must not be swallowed
      if (swallow.current) setTimeout(() => (swallow.current = false), 400);
    },
    onTouchCancel: clear,
    onClickCapture: (event: React.MouseEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
