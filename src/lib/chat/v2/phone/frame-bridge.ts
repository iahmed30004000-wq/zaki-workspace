import { createContext, useContext } from "react";

/**
 * C2.8 — what the app's frame (`src/components/app-shell.tsx`, N1's) hands to the phone's chat screens. ONE thing: the way to open the frame's drawer.
 * The frame offers it ONLY while the new menu (`navV2`) is on; with it off the context is null, so the list screen draws no «☰» and the old bottom bar
 * stays the way around. The frame does not import anything of the chat: the chat reads this tiny context, and that is all that crosses.
 */
export interface FrameBridge {
  openDrawer: () => void;
}

export const FrameBridgeContext = createContext<FrameBridge | null>(null);

export function useFrameBridge(): FrameBridge | null {
  return useContext(FrameBridgeContext);
}
