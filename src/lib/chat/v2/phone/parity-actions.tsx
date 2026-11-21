"use client";

import React from "react";

/**
 * S5.7 — what the message menu and the selection bar of the new pane call for «حذف عندي». The pane provides it (`conversation-pane.tsx`: it owns the doors, the cache
 * write and the toast); the menu and the bar only read it and draw nothing when there is none (a read-only embed, a test). It is a separate context from the pane's
 * `usePaneCommands` on purpose: the seam of the pane stays as C2.4 wrote it, and this package adds its one command beside it.
 */
export interface ParityActions {
  /** hide these messages for the person ONLY (nothing is deleted for anybody); says how many went. A message that is not on the server yet is left out. */
  hide: (messageIds: readonly string[]) => Promise<{ ok: number; total: number }>;
}

export const ParityActionsContext = React.createContext<ParityActions | null>(null);

export function useParityActions(): ParityActions | null {
  return React.useContext(ParityActionsContext);
}
