import { createContext, useContext, type ReactNode } from "react";

/**
 * C2.8 — what the app's frame (`src/components/app-shell.tsx`, N1's) hands to the phone's chat screens, because the frame's own top bar is hidden on them:
 *
 *  - `openDrawer`  the way to open the frame's drawer: ONLY while the new menu (`navV2`) is on; with it off it is null, so the list screen draws no «☰» and the old
 *                  bottom bar stays the way around;
 *  - `trailing`    what the hidden top bar carried that a person still needs on the phone: the notifications bell (both menus) and, with the old menu (which has no
 *                  drawer to hold it), the account menu. The list screen's bar draws it at its end.
 *
 * The frame does not import anything of the chat: the chat reads this tiny context, and that is all that crosses. No frame at all (a test): null.
 */
export interface FrameBridge {
  openDrawer: (() => void) | null;
  trailing?: ReactNode;
}

export const FrameBridgeContext = createContext<FrameBridge | null>(null);

export function useFrameBridge(): FrameBridge | null {
  return useContext(FrameBridgeContext);
}
