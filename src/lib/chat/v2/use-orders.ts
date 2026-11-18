"use client";

import { useQuery } from "@tanstack/react-query";
import type { SavedOrders } from "@/lib/chat/list-folders";

/**
 * C2.2 — the person's OWN saved order of the chat list (`GET /api/chat/order`, the old home's «ترتيب», nobody else's), read once and kept for five
 * minutes. It is not part of the chat cache (the cache owns only the list, the space views, the headers and the messages): it is a small setting, and
 * a failed read just leaves the server's order (the newest first). The key does not start with "chat", so no cache code touches it.
 */
const EMPTY: SavedOrders = {};

export const CHAT_ORDERS_KEY = ["chat-order", "mine"] as const;

export async function fetchChatOrders(signal?: AbortSignal): Promise<SavedOrders> {
  const res = await fetch("/api/chat/order", { cache: "no-store", credentials: "same-origin", ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error("order");
  const body = (await res.json()) as { orders?: Record<string, string[]> };
  return body.orders ?? EMPTY;
}

export function useChatOrders(enabled = true): SavedOrders {
  const query = useQuery({ queryKey: CHAT_ORDERS_KEY, queryFn: ({ signal }) => fetchChatOrders(signal), staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false, enabled });
  return query.data ?? EMPTY;
}
