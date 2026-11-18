"use client";

import { useSyncExternalStore } from "react";

/**
 * C2.1 — is the screen at least `md` (768 px)? The rail (and so the list column beside it) is drawn from `md`; below it the list is the phone's
 * whole screen. `null` on the server and on the first client render (nobody knows the screen yet), so the two never disagree while hydrating.
 */
const QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const snapshot = (): boolean | null => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : null);
const serverSnapshot = (): boolean | null => null;

export function useIsDesktop(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
