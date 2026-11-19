"use client";

import React from "react";
import { useEdgeSwipeBack } from "@/lib/chat/v2/phone/use-edge-swipe";
import { useKeyboardInset } from "@/lib/chat/v2/phone/use-keyboard-inset";
import { usePhoneBack } from "@/lib/chat/v2/phone/use-phone-back";
import { cn } from "@/lib/utils";

/**
 * C2.8 — THE PHONE'S SCREEN BOX around everything that is not the list (a conversation, its info screen; the whiteboard page is in the box too but keeps the frame's bars): the page's content, full screen.
 * It is ALWAYS in the tree (the list screen shows it as `hidden`, so the page and the list keep their state when the person goes back and forth), and what it
 * does, it does only while `active`:
 *
 *  - it SLIDES in 200 ms from the START edge each time it appears (a `hidden` box that is shown again plays its animation again), and not at all under
 *    reduced motion (`motion-reduce:animate-none`);
 *  - a swipe that begins at the START edge goes `back` (pointer events, `touch-pan-y` so vertical scrolling stays the browser's); the box follows the finger;
 *  - the composer sits ABOVE the keyboard: where the browser slides the keyboard over the page (Safari on an iPhone) the box pads its bottom by the keyboard's
 *    height (`useKeyboardInset`); where the browser resizes the page itself (`interactiveWidget: resizes-content`) there is nothing to add;
 *  - `data-keyboard` tells the composer's footer to drop its home-indicator padding while the keyboard covers that corner.
 *
 * `overflow-x-clip` keeps the sliding box from ever making the page scroll sideways.
 */
export function PhoneScreenFrame({ active, back, children }: { active: boolean; back: string | null; children: React.ReactNode }) {
  const { go } = usePhoneBack();
  const inset = useKeyboardInset(active);
  // back POPS the history when the screen before is the target, and replaces this entry otherwise (nav-trail.ts): the hardware back button never bounces between two screens
  const ref = useEdgeSwipeBack<HTMLDivElement>(active && back !== null, () => {
    if (back) go(back);
  });
  return (
    <div
      ref={ref}
      className={cn(active ? "group/phone h-full min-h-0 touch-pan-y overflow-x-clip animate-slide-in-start motion-reduce:animate-none" : "hidden")}
      {...(active ? { "data-chat-phone-screen": "", "data-keyboard": inset > 0 ? "open" : "closed" } : {})}
      style={active && inset > 0 ? { paddingBottom: inset } : undefined}
    >
      {children}
    </div>
  );
}
