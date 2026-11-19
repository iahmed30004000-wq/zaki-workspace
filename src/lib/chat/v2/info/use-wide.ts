"use client";

import { useSyncExternalStore } from "react";

/**
 * C2.7 — is the screen at least 1024 px? From there the info panel is a 360 px column beside the conversation; between 768 and 1023 px it is an overlay
 * sheet from the end side. `null` on the server and on the first client render, so the two never disagree while hydrating.
 */
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const snapshot = (): boolean | null => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : null);

export function useIsWide(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
