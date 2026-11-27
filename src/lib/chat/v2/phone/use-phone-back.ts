"use client";

import { useCallback, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { backActionFor, navTrail } from "@/lib/chat/v2/phone/nav-trail";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { effectOn } from "@/lib/motion/effects";
import { tgPhoneNow } from "@/components/shell/tg-phone";

let dragged = false;
/** The screen was dragged away by the finger: the next way back fades nothing. */
export function markDragged(): void {
  dragged = true;
}

/** «تيليجرام»: the screen on top fades away before the address changes (180 ms), so the list under it shows through. False: there is nothing to fade. */
function fadeAway(done: () => void): boolean {
  if (!tgPhoneNow() || !effectOn("transitions")) return false;
  const screen = document.querySelector<HTMLElement>("[data-chat-phone-screen]");
  if (!screen) return false;
  screen.classList.add("zk-tg-leaving");
  window.setTimeout(() => {
    done();
    // the same box shows the next screen when the way back leads to one (a page of information to its conversation)
    window.setTimeout(() => screen.classList.remove("zk-tg-leaving"), 80);
  }, TG_MOTION.backMs);
  return true;
}

/**
 * C2.8 — «back» on the phone: `go(target)` pops the history when the screen before this one is the target, and replaces this entry with it otherwise
 * (see `nav-trail.ts`). `onLinkClick(target)` is for an arrow that is also a real link (it keeps its address for a long press or a new tab): a plain click goes
 * through `go`, a click with a modifier key or a middle button is left to the browser.
 */
export function usePhoneBack(): { go: (target: string) => void; onLinkClick: (target: string) => (event: MouseEvent) => void } {
  const router = useRouter();
  const go = useCallback(
    (target: string) => {
      const leave = () => {
        if (backActionFor(navTrail, target) === "back") router.back();
        else router.replace(target, { scroll: false });
      };
      const byFinger = dragged;
      dragged = false;
      if (byFinger || !fadeAway(leave)) leave();
    },
    [router],
  );
  const onLinkClick = useCallback(
    (target: string) => (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(target);
    },
    [go],
  );
  return { go, onLinkClick };
}
