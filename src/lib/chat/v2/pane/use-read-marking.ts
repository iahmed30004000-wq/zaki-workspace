"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MessageDto } from "@/server/chat/dto";
import { markConversationRead } from "@/lib/chat/cache/writer";
import { createReadMarker } from "@/lib/chat/read-gate";
import { announceChatRead } from "@/lib/chat/use-chat-unread";
import { newestToConsider } from "@/lib/chat/v2/pane/read-model";

/**
 * C2.4 — the read mark of the open conversation, through C1.8's `createReadMarker`: a mark goes out only while the tab is visible AND focused, only when the
 * newest read message CHANGED, never for the owner's silent reading, never for a pending bubble (`newestToConsider` names the newest CONFIRMED message), and
 * only while the newest message is really on screen. What could not be marked while the tab was hidden waits and is marked once on return. The marker forgets
 * the conversation when the pane closes (a screen opened again marks once more).
 */
export function useReadMarking(s: { conversationId: string; messages: readonly MessageDto[]; atNewest: boolean; atBottom: boolean; silent: boolean }): void {
  const qc = useQueryClient();
  const marker = useMemo(
    () =>
      createReadMarker({
        post: async (id, upTo) => {
          try {
            const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}/read?upTo=${encodeURIComponent(upTo)}`, { method: "POST" });
            return response.ok;
          } catch {
            return false;
          }
        },
        onMarked: (id) => {
          markConversationRead(qc, id);
          announceChatRead();
        },
      }),
    [qc],
  );
  const newest = newestToConsider(s);
  // `anchored`: nothing is on screen to mark (reading older messages, or around a hit) — what waited is dropped, not marked on return
  useEffect(() => {
    marker.consider(s.conversationId, newest, { silent: s.silent, anchored: newest === null });
  }, [marker, s.conversationId, newest, s.silent]);
  useEffect(() => {
    const back = () => marker.resume();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [marker]);
  useEffect(() => {
    const id = s.conversationId;
    return () => marker.forget(id);
  }, [marker, s.conversationId]);
}
