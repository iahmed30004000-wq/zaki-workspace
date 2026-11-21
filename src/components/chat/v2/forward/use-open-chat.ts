"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { chatHref } from "@/lib/chat/v2/routes";

/**
 * S5.2 — «افتح»: go to a conversation (and to one message in it), from the toast and from the «محوّلة من» header. The app router when there is one; where a part is drawn
 * on its own (a server-render test, a screen outside the app router) there is none and `open` does nothing: a bubble must be drawable without a router around it, and
 * `useRouter()` throws when there is none (after it has read its context, so the order of the hooks stays the same either way).
 */
function useMaybeRouter(): ReturnType<typeof useRouter> | null {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function useOpenChat(): (conversationId: string, messageId?: string) => void {
  const router = useMaybeRouter();
  return React.useCallback(
    (conversationId, messageId) => {
      const href = messageId ? `${chatHref.conversation(conversationId)}?m=${encodeURIComponent(messageId)}` : chatHref.conversation(conversationId);
      router?.push(href);
    },
    [router],
  );
}
