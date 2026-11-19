"use client";

import { useEffect } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHAT_GC_MS } from "@/lib/chat/cache/constants";
import { chatKeys, convIdOfKey, isMessagesKey } from "@/lib/chat/cache/keys";
import { messagesOfData } from "@/lib/chat/cache/reducers";
import type { MessagesData } from "@/lib/chat/cache/types";
import { mediaCountsUrl, mediaPageUrl, TAB_KIND, workUrl, type PagedTab } from "@/lib/chat/v2/info/info-tabs";
import type { ConversationWorkDto, MediaCountsDto, MediaPageDto } from "@/server/chat/media";

/**
 * C3d — what the info panel's tabs ask for, each through the doors of `src/server/chat/media.ts` (nothing else): the counts (which tabs exist), the work (tasks and
 * tickets made from this conversation) and one tab's pages. They live under the conversation's own key of the chat cache (`["chat","conv",id,…]`), so the cache's
 * wipe and removal reach them, and persistence (headers and messages only) never writes them to the device. A refusal or a failure is «nothing to show»: a tab that
 * could not be known is simply not drawn.
 */
const STALE_MS = 30_000;

/**
 * What changes in the tabs when the conversation moves: a message arrives (a picture, a file, a link) or one is deleted (its file must leave the lists at once, not
 * after the 30 seconds of the cache). The signature is the number of settled messages and how many of them are deleted, as the chat cache's windows hold them.
 */
export function messagesSignature(messages: readonly { deleted?: boolean; pending?: unknown }[]): string {
  let settled = 0;
  let deleted = 0;
  for (const m of messages) {
    if (m.pending) continue;
    settled += 1;
    if (m.deleted) deleted += 1;
  }
  return `${settled}:${deleted}`;
}

/** Quiet period before the tabs ask again, so a burst of messages is one refresh. */
export const TABS_REFRESH_MS = 600;

/**
 * Keeps the tabs honest while the panel is open: when the signature of the conversation's cached messages changes, the counts, the work and the lists are marked
 * stale (the ones on screen ask again; the others the next time their tab is shown). A message deleted that no cached window holds is not seen here; it is out of the
 * lists at the next ask (the cache's 30 seconds, or the next opening) — the server never lists it.
 */
export function useRefreshOnMessages(conversationId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    const read = (): string => {
      const data = qc.getQueryData<MessagesData>(chatKeys.messages(conversationId));
      return data ? messagesSignature(messagesOfData(data)) : "";
    };
    let last = read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || !isMessagesKey(event.query.queryKey) || convIdOfKey(event.query.queryKey) !== conversationId) return;
      const now = read();
      if (now === last) return;
      last = now;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: mediaCountsKey(conversationId), exact: true });
        void qc.invalidateQueries({ queryKey: workKey(conversationId), exact: true });
        void qc.invalidateQueries({ queryKey: [...chatKeys.conv(conversationId), "media"] });
      }, TABS_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [qc, conversationId]);
}

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
