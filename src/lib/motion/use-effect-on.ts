"use client";

import { useSyncExternalStore } from "react";
import { EFFECTS_EVENT, effectOn, type EffectKey } from "@/lib/motion/effects";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EFFECTS_EVENT, onChange);
  const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  query?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener(EFFECTS_EVENT, onChange);
    query?.removeEventListener?.("change", onChange);
  };
}

/** `effectOn` that follows the person's switches live. The server draws with everything on; the first client paint corrects it. */
export function useEffectOn(key: EffectKey): boolean {
  return useSyncExternalStore(
    subscribe,
    () => effectOn(key),
    () => true,
  );
}
