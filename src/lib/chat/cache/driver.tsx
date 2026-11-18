"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { deviceHoldsCache } from "@/lib/chat/cache/device-store";

/**
 * C1.4 + C1.5 — mounted once by `Providers`. It renders nothing and, on a device that has never kept a chat, does nothing but one
 * cheap question («does this browser hold a start cache?»). On a device that does, it boots the cache at page load: the list
 * paints from the device copy while the feed catches up — and when nobody is signed in (the sign-in page after a sign-out, the stream's
 * «signed_out»), a different person is, or the account is an external partner's, the copy is wiped instead (`wipeChatCache`).
 *
 * The cache code is loaded only then (and by the chat screens themselves): the sign-in page does not carry it.
 */
export function ChatCacheDriver(): null {
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await deviceHoldsCache()) || cancelled) return;
        const { chatRuntimeOf } = await import("@/lib/chat/cache/runtime");
        if (!cancelled) await chatRuntimeOf(qc).bootIfDeviceHolds();
      } catch {
        /* the cache is an accelerator: a failure here leaves the chat working as it did */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qc]);
  return null;
}
