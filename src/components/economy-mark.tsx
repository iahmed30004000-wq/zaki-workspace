"use client";

import { setEconomy } from "@/lib/economy";

/**
 * Tells the browser side that the company is in «وضع التوفير» (src/lib/economy.ts). It sets the flag while rendering, on purpose: it sits
 * before the shell in the layout, so the flag is right before any child's timer reads it (an effect would run after the children's).
 * Drawing nothing, it is safe to render on the server too, where the flag is never read.
 */
export function EconomyMark({ on }: { on: boolean }) {
  setEconomy(on);
  return null;
}
