import React from "react";
import { cleanQuote } from "@/lib/chat/v2/menu/gestures";

/**
 * S5.7 (d) — the quote waiting for its reply. «رد بالاقتباس» starts an ordinary reply (the pane's `startReply`) and leaves the picked piece here, kept for ONE
 * (conversation, message): the composer bar draws it, and the send takes it exactly once (`takeReplyQuote`, called by `startOptimisticSend`) — a quote picked for
 * another message, or one whose reply was cancelled, is never attached (`keepOnly` drops it as soon as the reply being written is not its own).
 *
 * It is a small module-level store, not React state, because the sender (the outbox) is not a component; it holds at most one quote and never touches the network.
 */
interface Held {
  conversationId: string;
  messageId: string;
  quote: string;
}

let held: Held | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const replyQuoteStore = {
  /** keep the quote of this message (the newest wins); a quote that cleans to nothing clears */
  set(conversationId: string, messageId: string, text: string): void {
    const quote = cleanQuote(text);
    held = quote ? { conversationId, messageId, quote } : null;
    emit();
  },
  peek(conversationId: string, messageId: string | null | undefined): string | null {
    return held && messageId && held.conversationId === conversationId && held.messageId === messageId ? held.quote : null;
  },
  /** the quote of this message, once: it is forgotten after it is taken */
  take(conversationId: string, messageId: string | null | undefined): string | null {
    const quote = replyQuoteStore.peek(conversationId, messageId);
    if (quote !== null) {
      held = null;
      emit();
    }
    return quote;
  },
  /** the reply being written is `messageId` (or none): a quote that belongs to anything else goes */
  keepOnly(conversationId: string, messageId: string | null | undefined): void {
    if (held && held.conversationId === conversationId && held.messageId !== messageId) {
      held = null;
      emit();
    }
  },
  clear(): void {
    held = null;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** The quote waiting for this reply, as a hook (the composer's bar draws it). */
export function useReplyQuote(conversationId: string, messageId: string | null | undefined): string | null {
  return React.useSyncExternalStore(
    replyQuoteStore.subscribe,
    () => replyQuoteStore.peek(conversationId, messageId),
    () => null,
  );
}
