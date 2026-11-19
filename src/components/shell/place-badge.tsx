"use client";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { badgeText } from "@/lib/chat/use-chat-unread";
import type { PlaceKey } from "@/lib/nav/places";
import { useSpaces } from "./space-switcher";

/**
 * The number on a place: «الدردشة» wears its unread messages, «الشغل» (W1.4) the count of «بانتظاري» in «الطلبات». It is the bell's own look
 * (danger pill, «9+»). The pill is decoration; the link gets the number in words for a screen reader, the words of the place it is on
 * (`place`; left out, the old words: unread messages).
 */
export function PlaceBadge({ count, className, place }: { count: number | undefined; className?: string; place?: PlaceKey }) {
  const { t } = useI18n();
  const text = badgeText(count ?? 0);
  if (!text) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-badge
        className={cn("flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold leading-none text-danger-fg", className)}
      >
        {text}
      </span>
      <span className="sr-only">{t(place === "work" ? "shell.place_waiting" : "shell.place_unread", { count: count ?? 0 })}</span>
    </>
  );
}

/**
 * The number on «الشغل»: what `/api/workspaces` says is waiting for THIS person in «الطلبات» (`waiting`, 0 while the company's switch `workRequests` is
 * off and for an external partner). Pure: a broken or missing value is no number.
 */
export function workWaitingOf(answer: { waiting?: unknown } | null | undefined): number {
  const n = answer?.waiting;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The shell asks for it with `badges = { chat, work: useWorkWaiting() }`. It READS the shell's one spaces query (the same key as the space switcher: no second
 * request); the answer is refetched after an action in «الطلبات» (which invalidates that key) and after each navigation.
 */
export function useWorkWaiting(): number {
  const { data } = useSpaces();
  // (`OrgsResponse` is the space switcher's type and does not name `waiting` yet)
  return workWaitingOf(data as { waiting?: unknown } | undefined);
}
