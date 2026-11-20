"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withTaskParam } from "./board-cache";

/**
 * The card open in the side panel of a board (`?task=<id>`, W1.5): the board stays on screen, the address says which card is open (so a link, the back button
 * and a refresh land on the same state) and Esc / «close» go back to the board alone. `enabled: false` (the old board) does nothing at all.
 *
 * The address is read AFTER the first paint (never during it): the server drew the board with no panel, and a panel that opened on the first client render
 * would not match it.
 */
export function useOpenTask(enabled: boolean): readonly [string | null, (id: string | null) => void] {
  const [taskId, setTaskId] = useState<string | null>(null);
  // the step we pushed to open a card: closing steps back over it (a second «back» then leaves the board, not a copy of it)
  const pushed = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      pushed.current = false;
      setTaskId(new URL(window.location.href).searchParams.get("task") || null);
    };
    read();
    const onPop = () => {
      // the step we pushed is gone (the back button took it) or we are somewhere else in the history: nothing of ours is on top any more
      pushed.current = false;
      setTaskId(new URL(window.location.href).searchParams.get("task") || null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);

  const open = useCallback((id: string | null) => {
    if (id === null && pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    setTaskId(id);
    const href = withTaskParam(`${window.location.pathname}${window.location.search}${window.location.hash}`, id);
    if (id) {
      window.history[pushed.current ? "replaceState" : "pushState"](null, "", href);
      pushed.current = true;
    } else {
      window.history.replaceState(null, "", href);
    }
  }, []);

  return [enabled ? taskId : null, open] as const;
}
