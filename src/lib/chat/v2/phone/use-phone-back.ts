"use client";

import { useCallback, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { backActionFor, navTrail } from "@/lib/chat/v2/phone/nav-trail";

/**
 * C2.8 — «back» on the phone: `go(target)` pops the history when the screen before this one is the target, and replaces this entry with it otherwise
 * (see `nav-trail.ts`). `onLinkClick(target)` is for an arrow that is also a real link (it keeps its address for a long press or a new tab): a plain click goes
 * through `go`, a click with a modifier key or a middle button is left to the browser.
 */
export function usePhoneBack(): { go: (target: string) => void; onLinkClick: (target: string) => (event: MouseEvent) => void } {
  const router = useRouter();
  const go = useCallback(
    (target: string) => {
      if (backActionFor(navTrail, target) === "back") router.back();
      else router.replace(target, { scroll: false });
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
