"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CHAT_GC_MS } from "@/lib/chat/cache/constants";
import { chatKeys } from "@/lib/chat/cache/keys";
import { mediaCountsUrl, mediaPageUrl, TAB_KIND, workUrl, type PagedTab } from "@/lib/chat/v2/info/info-tabs";
import type { ConversationWorkDto, MediaCountsDto, MediaPageDto } from "@/server/chat/media";

/**
 * C3d — what the info panel's tabs ask for, each through the doors of `src/server/chat/media.ts` (nothing else): the counts (which tabs exist), the work (tasks and
 * tickets made from this conversation) and one tab's pages. They live under the conversation's own key of the chat cache (`["chat","conv",id,…]`), so the cache's
 * wipe and removal reach them, and persistence (headers and messages only) never writes them to the device. A refusal or a failure is «nothing to show»: a tab that
 * could not be known is simply not drawn.
 */
const STALE_MS = 30_000;

export const mediaCountsKey = (conversationId: string) => [...chatKeys.conv(conversationId), "media-counts"] as const;
export const workKey = (conversationId: string) => [...chatKeys.conv(conversationId), "work"] as const;
export const mediaPagesKey = (conversationId: string, tab: PagedTab) => [...chatKeys.conv(conversationId), "media", tab] as const;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export function useMediaCounts(conversationId: string, enabled = true): MediaCountsDto["counts"] | null {
  const query = useQuery({
    queryKey: mediaCountsKey(conversationId),
    enabled,
    staleTime: STALE_MS,
    gcTime: CHAT_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => (await getJson<MediaCountsDto>(mediaCountsUrl(conversationId), signal)).counts,
  });
  return query.data ?? null;
}

export function useConversationWork(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: workKey(conversationId),
    enabled,
    staleTime: STALE_MS,
    gcTime: CHAT_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getJson<ConversationWorkDto>(workUrl(conversationId), signal),
  });
}

/** One tab's pages, newest first; `fetchNextPage` follows the server's cursor. Asked for only while the tab is the one shown. */
export function useMediaPages(conversationId: string, tab: PagedTab, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: mediaPagesKey(conversationId, tab),
    enabled,
    staleTime: STALE_MS,
    gcTime: CHAT_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => getJson<MediaPageDto>(mediaPageUrl(conversationId, TAB_KIND[tab], pageParam), signal),
    getNextPageParam: (last) => last.next ?? undefined,
  });
}
