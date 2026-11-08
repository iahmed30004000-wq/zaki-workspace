"use client";

import { useMemo } from "react";
import { darknessOf, midOf, type ScrubLook } from "@/lib/themes/scrub";
import { sliderStep } from "@/lib/themes/switch-fx";
import type { KnobMode } from "../fx/kit";
import { usePageScrub } from "./use-page-scrub";
import type { KeyboardEvent } from "react";

/**
 * What every look shares: the page follows the knob while it moves (`follow`, from the knob's every frame), the theme is committed
 * when the knob rests on an end (`scrub.settle`), the engine's code is fetched when the pointer arrives, and `mid` is the knob
 * position at which a release decides between the two ends (the sky's page is half way a little past the middle of the track).
 */
export function useLook(look: ScrubLook) {
  const scrub = usePageScrub();
  const mid = useMemo(() => midOf(look), [look]);
  const follow = (p: number, mode: KnobMode): void => {
    if (mode !== "rest") scrub.move(darknessOf(look, p));
  };
  return { scrub, mid, follow };
}

/** A slider's keys on a 0..100 track drawn left to right: the arrows step, Home / End are the two ends (those glide and commit at once). */
export function keyOnTrack(e: KeyboardEvent<HTMLElement>, knob: { get: () => number; goTo: (end: 0 | 1) => void; nudge: (d: number) => void }, step: number, big: number): void {
  const cur = Math.round(knob.get() * 100);
  const next = sliderStep(e.key, cur, { min: 0, max: 100, step, big }, "ltr");
  if (next === null) return;
  e.preventDefault();
  if (e.key === "Home") knob.goTo(0);
  else if (e.key === "End") knob.goTo(1);
  else knob.nudge((next - cur) / 100);
}

