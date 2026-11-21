"use client";

import React from "react";
import { useOptionalToast } from "@/components/ui/toast";
import { useOpenChat } from "@/components/chat/v2/forward/use-open-chat";
import { ct } from "@/lib/chat/text";

/**
 * S5.2 — the tap on a forwarded message's «محوّلة من» header: ask the server where the original is (`GET /api/chat/messages/[id]/forward`: only when the viewer may read both
 * the copy and the original), then jump to it — inside this conversation when it is the same one, by the address (`?m=`) when it is another. A «not found» (the original is gone,
 * or not theirs to read) is one calm toast and nothing else: the screen never says which of the two it was.
 */
export function useOpenForwardSource(here: string, jumpHere: (messageId: string) => void): (copyId: string) => void {
  const openChat = useOpenChat();
  const toast = useOptionalToast();
  return React.useCallback(
    (copyId: string) => {
      void (async () => {
        try {
          const res = await fetch(`/api/chat/messages/${encodeURIComponent(copyId)}/forward`, { cache: "no-store" });
          if (!res.ok) throw new Error("source");
          const source = (await res.json()) as { conversationId?: unknown; messageId?: unknown };
          if (typeof source.conversationId !== "string" || typeof source.messageId !== "string") throw new Error("source");
          if (source.conversationId === here) jumpHere(source.messageId);
          else openChat(source.conversationId, source.messageId);
        } catch {
          toast?.toast(ct("chatfwd.source_gone"), "info");
        }
      })();
    },
    [here, jumpHere, openChat, toast],
  );
}
