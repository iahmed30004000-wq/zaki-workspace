"use client";

import React from "react";
import { onChatWipe } from "@/lib/chat/cache/registry";
import type { CrossSnapshot } from "@/lib/chat/cross-reply";

/**
 * «الرد في محادثة أخرى» on the screen: the message the person is about to answer from ANOTHER conversation, held for the TARGET conversation until it is sent or
 * dropped. In memory only (never on the device: the words are another conversation's), and emptied when the chat's cache is wiped (sign-out, another person).
 */
export interface PendingCrossReply {
  /** the source message */
  messageId: string;
  /** what the others will read, built by the same function the server uses */
  snapshot: CrossSnapshot;
}

const held = new Map<string, PendingCrossReply>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const crossReplyStore = {
  get: (conversationId: string): PendingCrossReply | null => held.get(conversationId) ?? null,
  set(conversationId: string, pending: PendingCrossReply): void {
    held.set(conversationId, pending);
    emit();
  },
  clear(conversationId: string): void {
    if (held.delete(conversationId)) emit();
  },
  clearAll(): void {
    if (held.size === 0) return;
    held.clear();
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

onChatWipe(() => crossReplyStore.clearAll());

export function useCrossReply(conversationId: string): PendingCrossReply | null {
  return React.useSyncExternalStore(
    crossReplyStore.subscribe,
    () => crossReplyStore.get(conversationId),
    () => null,
  );
}
