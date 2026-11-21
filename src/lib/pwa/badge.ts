"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { chatKeys, isChatKey } from "@/lib/chat/cache/keys";
import { summarizeUnread } from "@/lib/chat/cache/unread";
import type { ChatListDto } from "@/lib/chat/cache/types";

/**
 * M1a — the number on the app's icon (Chrome's installed app on Android and desktop, Safari's home-screen app): `navigator.setAppBadge(unread)` while
 * something waits, `clearAppBadge()` when nothing does. The number is the sidebar badge's (`use-chat-unread.ts`); until that has come (a cold start with no
 * network) it is the C1 cache's own: the list's rows the device kept, without the conversations the person muted (a muted chat does not count, as in every
 * messenger). A browser without the Badging API does nothing.
 */

/** The largest number handed to the badge: the icon cannot show more and some browsers refuse a huge value. */
export const BADGE_MAX = 99_999;

export interface BadgeApi {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** The count the badge should show: a whole number from 1, or 0 for «nothing» (negative, NaN or junk clear it). */
export function badgeCount(total: unknown): number {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Math.floor(total), BADGE_MAX);
}

/** Puts the number on the icon (or takes it off). Returns what it did; never throws: a badge is a courtesy. */
export async function applyAppBadge(total: unknown, api: BadgeApi | null = typeof navigator === "undefined" ? null : (navigator as BadgeApi)): Promise<"set" | "cleared" | "unsupported"> {
  if (!api) return "unsupported";
  const count = badgeCount(total);
  try {
    if (count > 0) {
      if (typeof api.setAppBadge !== "function") return "unsupported";
      await api.setAppBadge(count);
      return "set";
    }
    if (typeof api.clearAppBadge === "function") await api.clearAppBadge();
    else if (typeof api.setAppBadge === "function") await api.setAppBadge(0);
    else return "unsupported";
    return "cleared";
  } catch {
    return "unsupported";
  }
}

/** The unread messages of the list the C1 cache holds right now, or null when the list is not in the cache yet. Pure over the client. */
export function cachedUnreadTotal(client: Pick<QueryClient, "getQueryData">): number | null {
  const list = client.getQueryData<ChatListDto>(chatKeys.list());
  if (!list || !Array.isArray(list.rows)) return null;
  return summarizeUnread(list.rows, { includeMuted: false }).total.messages;
}

/** The cache's total as a live value (re-read whenever the list key changes), without importing the cache's screens or starting a fetch. */
export function useCachedChatUnread(): number | null {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === "updated" || event.type === "added" || event.type === "removed") {
          const key = event.query.queryKey;
          if (isChatKey(key) && key[1] === "list") onChange();
        }
      }),
    [client],
  );
  const read = useCallback(() => cachedUnreadTotal(client), [client]);
  return useSyncExternalStore(subscribe, read, () => null);
}

/** Keeps the app icon's number in step with `total`, and takes it off when the shell goes away (sign-out). */
export function useAppBadge(total: number): void {
  useEffect(() => {
    void applyAppBadge(total);
  }, [total]);
  useEffect(() => () => void applyAppBadge(0), []);
}
