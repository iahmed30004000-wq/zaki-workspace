"use client";

import React from "react";

/**
 * C3d — «اعرض بالمحادثة» for the info panel's tabs. The pane that holds the open conversation provides how to scroll it to a message (and closes the panel's sheet when
 * the panel covers it); a panel drawn OUTSIDE the pane (the phone's info screen) finds none and goes to the conversation's address with `?m=` instead. A context, not a
 * prop of `InfoPanel`, because the panel is mounted by two other files (the host and the phone screen) that this package does not own; a portal keeps React context,
 * so the docked column reads it too.
 */
export const InfoJumpContext = React.createContext<((messageId: string) => void) | null>(null);

export function useInfoJump(): ((messageId: string) => void) | null {
  return React.useContext(InfoJumpContext);
}
