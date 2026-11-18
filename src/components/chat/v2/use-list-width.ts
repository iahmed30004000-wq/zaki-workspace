"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LIST_WIDTH_DEFAULT, LIST_WIDTH_MAX, LIST_WIDTH_MIN, readListWidth, saveListWidth, widthFromKey, widthFromPointer } from "@/lib/chat/v2/list-width";

/**
 * C2.1 — the width of the list column: 360 px, dragged between 300 and 480 by its END edge (the keyboard works too: the arrow keys, Home and End), kept
 * on this device. The first render uses the default so server and browser agree; the saved width is read right after.
 */
export function useListWidth(): {
  width: number;
  columnRef: React.RefObject<HTMLElement>;
  handle: {
    role: "separator";
    "aria-orientation": "vertical";
    "aria-valuemin": number;
    "aria-valuemax": number;
    "aria-valuenow": number;
    tabIndex: 0;
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
} {
  const [width, setWidth] = useState(LIST_WIDTH_DEFAULT);
  const columnRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const latest = useRef(width);
  latest.current = width;

  useEffect(() => setWidth(readListWidth()), []);

  const isRtl = useCallback(() => (columnRef.current ? getComputedStyle(columnRef.current).direction === "rtl" : true), []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!dragging.current || !columnRef.current) return;
      setWidth(widthFromPointer(event.clientX, columnRef.current.getBoundingClientRect(), isRtl()));
    },
    [isRtl],
  );
  const finish = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    saveListWidth(latest.current);
  }, []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const next = widthFromKey(latest.current, event.key, isRtl());
      if (next === null) return;
      event.preventDefault();
      setWidth(next);
      saveListWidth(next);
    },
    [isRtl],
  );

  return {
    width,
    columnRef,
    handle: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-valuemin": LIST_WIDTH_MIN,
      "aria-valuemax": LIST_WIDTH_MAX,
      "aria-valuenow": width,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onKeyDown,
    },
  };
}
