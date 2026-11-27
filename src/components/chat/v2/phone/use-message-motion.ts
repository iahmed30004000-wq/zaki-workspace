"use client";

import React from "react";
import "./tg-messages.css";
import { coloursOf, runDust, type DustSource } from "@/components/chat/v2/phone/message-fx";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { isAnnouncedRemoval, onSettleRequest, removalsOf, settleOffset, type Removal } from "@/lib/chat/v2/phone/removals";
import { effectOn } from "@/lib/motion/effects";

/**
 * «تيليجرام على التلفون» — what the log does when messages go, or when a bubble grows: the other messages SLIDE to their new places, and a deleted
 * bubble turns to DUST (then, for a deletion for everybody, its «حُذفت الرسالة» line appears where it was).
 *
 * It looks at the screen BEFORE it changes (while the new list is being rendered the page still shows the old one, the same moment the viewport takes its
 * scroll anchor), so every way a message goes is covered at once: my own delete, a batch, «حذف عندي» and somebody else's deletion arriving live. The rows
 * are placed by the virtual list (their own transform), so what slides is each row's CONTENT, from the old screen position to the new one.
 */

/** A change is followed this long: the list measures a row's new height a frame or two after it changed. */
const FOLLOW_MS = 450;

interface Plan {
  /** where each drawn row stood on the screen, by its key */
  tops: Map<string, number>;
  screenHeight: number;
  durationMs: number;
  until: number;
  dust: (DustSource & { id: string; kind: Removal["kind"] })[];
  /** the offset each row is sliding from now: an unchanged one is not started again */
  sliding: Map<Element, { delta: number; animation: Animation }>;
}

const useBrowserLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;
const rowsIn = (root: Element) => [...root.querySelectorAll<HTMLElement>("[data-row-key]")];
const articleOf = (root: Element, id: string) => root.querySelector<HTMLElement>(`article[data-message-id="${id.replace(/["\\]/g, "\\$&")}"]`);

function look(root: HTMLElement, durationMs: number, gone: readonly Removal[]): Plan {
  const screen = root.getBoundingClientRect();
  const tops = new Map<string, number>();
  for (const row of rowsIn(root)) tops.set(row.dataset.rowKey!, row.getBoundingClientRect().top);
  const dust: Plan["dust"] = [];
  for (const removal of gone) {
    const bubble = articleOf(root, removal.id);
    if (!bubble) continue;
    const rect = bubble.getBoundingClientRect();
    if (rect.bottom <= screen.top || rect.top >= screen.bottom) continue;
    dust.push({ id: removal.id, kind: removal.kind, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }, colours: coloursOf(bubble) });
  }
  return { tops, screenHeight: screen.height, durationMs, until: Date.now() + FOLLOW_MS, dust, sliding: new Map() };
}

function settle(root: HTMLElement, plan: Plan): void {
  if (!effectOn("transitions")) return;
  for (const row of rowsIn(root)) {
    const before = plan.tops.get(row.dataset.rowKey!);
    const content = row.firstElementChild;
    if (before === undefined || !content || typeof (content as HTMLElement).animate !== "function") continue;
    // the row itself is never animated, so its box says where the layout put it, whatever its content is doing
    const delta = settleOffset(before, row.getBoundingClientRect().top, plan.screenHeight);
    const running = plan.sliding.get(content);
    if (running ? Math.abs(running.delta - delta) < 1 : delta === 0) continue;
    running?.animation.cancel();
    const animation = (content as HTMLElement).animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], { duration: plan.durationMs, easing: "ease-out" });
    plan.sliding.set(content, { delta, animation });
  }
}

function disintegrate(root: HTMLElement, plan: Plan): void {
  const dust = plan.dust.splice(0);
  if (dust.length === 0 || !effectOn("dust")) return;
  runDust(dust, TG_MOTION.deleteDustMs);
  for (const item of dust) {
    if (item.kind !== "deleted") continue;
    const bubble = articleOf(root, item.id);
    if (!bubble) continue;
    bubble.setAttribute("data-tg-dusting", "");
    setTimeout(() => {
      bubble.removeAttribute("data-tg-dusting");
      bubble.setAttribute("data-tg-undust", "");
      setTimeout(() => bubble.removeAttribute("data-tg-undust"), TG_MOTION.bubbleGrowMs + 50);
    }, TG_MOTION.deleteDustMs);
  }
}

export function useMessageMotion({ enabled, rootRef, messages, conversationId }: {
  enabled: boolean;
  rootRef: React.RefObject<HTMLElement>;
  messages: readonly { id: string; deleted: boolean }[];
  conversationId: string;
}): void {
  const plan = React.useRef<Plan | null>(null);
  const seen = React.useRef({ messages, conversationId });
  if (seen.current.messages !== messages || seen.current.conversationId !== conversationId) {
    const root = rootRef.current;
    if (enabled && root && seen.current.conversationId === conversationId) {
      const gone = removalsOf(seen.current.messages, messages, isAnnouncedRemoval);
      if (gone.length) plan.current = look(root, TG_MOTION.deleteSettleMs, gone);
    } else plan.current = null;
    seen.current = { messages, conversationId };
  }

  React.useEffect(() => {
    if (!enabled) return;
    return onSettleRequest((durationMs) => {
      if (rootRef.current) plan.current = look(rootRef.current, durationMs, []);
    });
  }, [enabled, rootRef]);

  // a finger or a wheel on the log is the person scrolling: what moves after that is his own doing, and nothing slides it back
  React.useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const stop = () => {
      plan.current = null;
    };
    root.addEventListener("touchstart", stop, { passive: true });
    root.addEventListener("wheel", stop, { passive: true });
    return () => {
      root.removeEventListener("touchstart", stop);
      root.removeEventListener("wheel", stop);
    };
  }, [enabled, rootRef]);

  // after every commit while a change is being followed (the list's own layout effect, with its scroll anchor, has run before this one)
  const follow = () => {
    const current = plan.current;
    const root = rootRef.current;
    if (!current || !root) return;
    if (Date.now() > current.until) {
      plan.current = null;
      return;
    }
    disintegrate(root, current);
    settle(root, current);
  };
  useBrowserLayoutEffect(follow);
}
