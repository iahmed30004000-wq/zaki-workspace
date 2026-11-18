"use client";

import { useEffect, useState } from "react";
import { loadComposerDraft } from "@/lib/chat/composer-draft";

/**
 * C2.2 — the unsent draft of a conversation, for the row's «مسودة: …». It is read from the composer's own store (`composer-draft.ts`, localStorage, one
 * entry per person per conversation: only words, never a file or a name). The open conversation shows no draft in its row (the person is writing it right
 * now); it appears the moment they leave. `enabled` is false for a row that is not a conversation (a space).
 */
export function useRowDraft(userId: string, conversationId: string, opts: { selected: boolean; enabled: boolean }): string | null {
  const [draft, setDraft] = useState<string | null>(null);
  const { selected, enabled } = opts;
  useEffect(() => {
    if (!enabled || selected || !userId) {
      setDraft(null);
      return;
    }
    const read = () => setDraft(loadComposerDraft(userId, conversationId)?.body ?? null);
    read();
    // another tab of the same person wrote a draft
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [userId, conversationId, selected, enabled]);
  return draft;
}
