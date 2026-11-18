"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { frameDrivenQuery, useFrameRefresh } from "@/lib/realtime/live-refresh";
import type { RealtimeEventPayload } from "@/lib/realtime/use-realtime";

export const CHAT_UNREAD_KEY = ["chat-unread"] as const;

/** What the badge shows: nothing at 0, the number up to 9, then «9+» (like the bell). */
export function badgeText(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return total > 9 ? "9+" : String(Math.floor(total));
}

/** The events that can move the number: a new message anywhere, my read mark, a door that opened or closed. */
export const MOVES_UNREAD = new Set(["message.created", "message.deleted", "conversation.read", "membership.changed", "conversation.changed"]);

/**
 * Does this frame move MY number? A read mark moves it only when it is mine (the server marks the reader's own streams `self`): somebody
 * else reading a conversation changes nothing here, and a busy chat made that a refetch every second.
 */
export function movesUnread(e: RealtimeEventPayload): boolean {
  if (!MOVES_UNREAD.has(e.kind)) return false;
  return e.kind !== "conversation.read" || e.self === true;
}

/**
 * "I just read something": the conversation screen says so right after it records a read mark. The
 * OWNER's reading is silent (no `conversation.read` event reaches anybody, him included), so without
 * this his own number would wait for the 30-second refresh.
 */
const CHAT_READ_EVENT = "zk:chat-read";

export function announceChatRead(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_READ_EVENT));
}

export function onChatRead(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHAT_READ_EVENT, handler);
  return () => window.removeEventListener(CHAT_READ_EVENT, handler);
}

/**
 * The unread total behind «الدردشة»: fetched once, then moved by FRAMES — a realtime event that can move it refetches it (folded into
 * one request per 400 ms), and so does this tab's own read mark. The 30 s poll is gone (C1.3 / F1.5): what is left is the safety net,
 * one refetch every five minutes and one when the window gets focus after the number went that stale.
 */
export function useChatUnread(enabled = true): number {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: CHAT_UNREAD_KEY,
    queryFn: async () => {
      const r = await fetch("/api/chat/unread", { cache: "no-store" });
      if (!r.ok) throw new Error("chat-unread");
      return (await r.json()) as { total: number };
    },
    ...frameDrivenQuery(),
    enabled,
  });
  useFrameRefresh({ enabled, matches: movesUnread, delayMs: 400, onRefresh: () => void qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY }) });
  useEffect(() => onChatRead(() => void qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY })), [qc]);
  return query.data?.total ?? 0;
}
