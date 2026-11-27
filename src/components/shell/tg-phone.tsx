"use client";

import { createContext, useContext, useEffect } from "react";
import { useIsDesktop } from "@/lib/chat/v2/use-media";
import { effectOn } from "@/lib/motion/effects";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

/**
 * The company's switch `tgPhone` (Telegram's look and motion on a phone), handed down from the app's layout. Without a provider it is OFF, so a screen
 * drawn on its own is the previous one.
 */
const TgPhoneContext = createContext(false);

/** What answers a finger with Telegram's grey ripple: a chat row, a row of the settings, a card of an info page. */
export const TG_RIPPLE_TARGETS = "[data-chat-row], [data-archived-entry], [data-saved-entry], a[data-section], [data-tg-ripple]";

function ripple(event: PointerEvent): void {
  const from = event.target instanceof Element ? event.target.closest<HTMLElement>(TG_RIPPLE_TARGETS) : null;
  if (!from || !from.closest("[data-tg-phone]") || !effectOn("transitions") || window.innerWidth >= 768) return;
  const box = from.getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "zk-tg-ripple";
  dot.setAttribute("aria-hidden", "true");
  dot.style.left = `${event.clientX - box.left}px`;
  dot.style.top = `${event.clientY - box.top}px`;
  if (getComputedStyle(from).position === "static") from.style.position = "relative";
  from.style.overflow = "hidden";
  from.appendChild(dot);
  window.setTimeout(() => dot.remove(), TG_MOTION.rippleMs + 50);
}

export function TgPhoneProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!on) return;
    // menus and toasts are drawn outside the frame: the page itself says the switch is on for them
    document.documentElement.setAttribute("data-tg-doc", "");
    document.addEventListener("pointerdown", ripple, { passive: true });
    return () => {
      document.documentElement.removeAttribute("data-tg-doc");
      document.removeEventListener("pointerdown", ripple);
    };
  }, [on]);
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

/** For code outside React's tree (a toast's clock): is Telegram's phone look in force on this page right now? */
export function tgPhoneNow(): boolean {
  return typeof document !== "undefined" && document.documentElement?.hasAttribute("data-tg-doc") === true && typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 768px)").matches;
}
