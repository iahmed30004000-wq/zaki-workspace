"use client";

import React from "react";

/**
 * C2.7 — the column beside the conversation where the info panel is drawn on a wide screen. The chat shell draws the (empty) column and provides its
 * element here; the info host, which lives INSIDE the conversation pane, portals the panel into it. So the panel pushes the conversation aside instead of
 * covering it, without a single change to the pane's own layout. `null`: there is no column (a phone, a test, the shell not mounted) and the host
 * falls back to the overlay sheet.
 */
export const InfoSlotContext = React.createContext<HTMLElement | null>(null);

export function useInfoSlot(): HTMLElement | null {
  return React.useContext(InfoSlotContext);
}
