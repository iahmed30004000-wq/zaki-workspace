"use client";

import { createContext, useContext } from "react";
import { useIsDesktop } from "@/lib/chat/v2/use-media";

/**
 * The company's switch `tgPhone` (Telegram's look and motion on a phone), handed down from the app's layout. Without a provider it is OFF, so a screen
 * drawn on its own is the previous one.
 */
const TgPhoneContext = createContext(false);

export function TgPhoneProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <TgPhoneContext.Provider value={on}>{children}</TgPhoneContext.Provider>;
}

/** The switch alone: for markup the server draws too (pair it with `max-md:` classes or the CSS scope `[data-tg-phone]`). */
export const useTgPhoneOn = (): boolean => useContext(TgPhoneContext);

/** The switch AND a phone-wide screen: for behaviour that only a browser runs (gestures, overlays in portals). False while the server draws. */
export function useTgPhone(): boolean {
  const on = useContext(TgPhoneContext);
  const desktop = useIsDesktop();
  return on && desktop === false;
}
