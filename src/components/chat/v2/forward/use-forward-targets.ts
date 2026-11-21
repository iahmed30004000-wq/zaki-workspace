"use client";

import React from "react";
import type { ForwardTargetsDto } from "@/lib/chat/forward";

export type ForwardTargetsState = { status: "loading" } | { status: "error" } | { status: "ready"; data: ForwardTargetsDto };

/**
 * S5.2 — the sheet's list from `GET /api/chat/forward-targets`, asked fresh each time the sheet opens (a topic made a minute ago, a chat that was archived, the saved chat that
 * was just made). `reload` asks again after a failure. The server's list is a hint: every target is decided again on send.
 */
export function useForwardTargets(open: boolean): { state: ForwardTargetsState; reload: () => void } {
  const [state, setState] = React.useState<ForwardTargetsState>({ status: "loading" });
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    setState({ status: "loading" });
    let alive = true;
    void fetch("/api/chat/forward-targets", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ForwardTargetsDto>) : Promise.reject(new Error("targets"))))
      .then((data) => alive && setState({ status: "ready", data }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [open, round]);
  const reload = React.useCallback(() => setRound((n) => n + 1), []);
  return { state, reload };
}
