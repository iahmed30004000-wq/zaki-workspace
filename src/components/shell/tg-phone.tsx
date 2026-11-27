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

/**
 * The mark the stylesheet looks for (`[data-tg-phone]`), with `data-tg-bar` while the floating bar is drawn. A box that takes no room (`contents`), and none
 * at all while the switch is off, so the previous screen's markup is exactly what it was.
 */
export function TgPhoneScope({ on, bar, children }: { on: boolean; bar: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="contents" data-tg-phone="" {...(bar ? { "data-tg-bar": "" } : {})}>
      {children}
    </div>
  );
}

/** The switch alone: for markup the server draws too (pair it with `max-md:` classes or the CSS scope `[data-tg-phone]`). */
export const useTgPhoneOn = (): boolean => useContext(TgPhoneContext);

/** The switch AND a phone-wide screen: for behaviour that only a browser runs (gestures, overlays in portals). False while the server draws. */
export function useTgPhone(): boolean {
  const on = useContext(TgPhoneContext);
  const desktop = useIsDesktop();
  return on && desktop === false;
}
