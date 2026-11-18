"use client";

import { useEffect } from "react";
import { economyActive } from "@/lib/economy";
import { holdDecorEconomy, syncDecorEconomy, watchDecorVisibility } from "@/lib/themes/decor";

/**
 * Stops the slow motion of the `full` decoration level while nobody is looking, and switches the layers off while «وضع التوفير» is on.
 *
 * A CSS animation in a hidden tab can still composite on some platforms, and «some platforms» means a phone with
 * eleven tabs open. While the tab is hidden <html> carries `data-decor-hidden`, and one rule of `decor.css`
 * pauses every layer on it. It renders nothing; every layer mounts one, and `watchDecorVisibility` makes them
 * share a single listener (the last one to unmount removes it).
 *
 * «وضع التوفير» is the company's switch: the shell tells `src/lib/economy.ts` while it renders, and this leaf copies it onto
 * <html> as `data-decor-economy` after every render of the layer (a layout that re-renders with the switch changed
 * reaches it through the sidebar's layer), where one more rule of `decor.css` hides the layers and the pictures of the art slots (as the
 * level «off» does). The last layer to unmount takes the mark off again. Known limit: the mark is written after hydration, so the first
 * frame of a visit in economy mode still draws the decoration (the server does not write it into <html> yet).
 */
export function DecorVisibility(): null {
  useEffect(() => watchDecorVisibility(document), []);
  // the last layer to go takes the mark off <html> (the shell's economy must not outlive its layers)
  useEffect(() => holdDecorEconomy(document.documentElement), []);
  useEffect(() => {
    syncDecorEconomy(document.documentElement, economyActive());
  });
  return null;
}
