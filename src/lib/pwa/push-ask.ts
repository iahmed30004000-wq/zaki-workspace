import { isDismissed } from "@/lib/pwa-install";
import type { PushState } from "@/components/calls/push-client";

/**
 * M1a — WHEN the chat asks for the right to send notifications. Pure (no React, no browser globals): the banner, the first-DM moment and the tests read it.
 *
 * Two moments, never a third:
 *   - the FIRST private chat the person opens on this device (the moment a message from a person starts to matter): the browser's own question, once;
 *   - a banner on the chat list «فعّل الإشعارات لتوصلك الرسائل والجهاز مسكّر», for anybody who has not been asked or let the question go: a tap asks, ✕ hides it
 *     for 30 days.
 * A refusal (`denied`) is the browser's own setting and the page cannot undo it: nothing is shown. An iPhone that has not added the site to its home screen
 * gets the note about that instead of a button that could not work (web push there needs the home-screen app, iOS 16.4+).
 */

export const PUSH_BANNER_DISMISS_KEY = "zk-push-banner-dismissed";
/** Set the first time the page asks by itself (the first private chat), so it never asks that way twice. */
export const PUSH_ASKED_KEY = "zk-push-asked";

export type PushBannerMode = "ask" | "ios-home" | "hidden";

export function pushBannerMode(input: { state: PushState; dismissed: boolean }): PushBannerMode {
  if (input.dismissed) return "hidden";
  if (input.state === "default") return "ask";
  if (input.state === "ios_home") return "ios-home";
  return "hidden";
}

/**
 * Ask by itself on the first private chat opened: permission not decided, never asked this way before, the chat is a private one AND the page is still inside
 * the tap that opened it (`activated`: `navigator.userActivation.isActive`). Browsers that require a tap before they ask (Safari, Firefox) refuse a question
 * asked outside one, and a refused question must not use up the one try: without the tap nothing is asked and nothing is remembered, the banner stays.
 */
export function shouldAskOnFirstDm(input: { state: PushState; asked: boolean; kind: string | null | undefined; activated: boolean }): boolean {
  return input.state === "default" && !input.asked && input.kind === "DM" && input.activated;
}

type Reader = Pick<Storage, "getItem"> | null | undefined;
type Writer = Pick<Storage, "setItem"> | null | undefined;

export function bannerDismissed(storage: Reader, now: number): boolean {
  if (!storage) return false;
  try {
    return isDismissed(storage.getItem(PUSH_BANNER_DISMISS_KEY), now);
  } catch {
    return false;
  }
}

export function dismissBanner(storage: Writer, now: number): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PUSH_BANNER_DISMISS_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function alreadyAsked(storage: Reader): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PUSH_ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAsked(storage: Writer): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PUSH_ASKED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
