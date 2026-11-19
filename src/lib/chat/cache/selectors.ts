"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { isChatKey, chatKeys } from "@/lib/chat/cache/keys";
import { headerQueryOptions, listQueryOptions, messagesQueryOptions, spaceQueryOptions } from "@/lib/chat/cache/queries";
import { prefetchStartup } from "@/lib/chat/cache/prefetch";
import { markConversationOpened } from "@/lib/chat/cache/persist";
import { messagesOfData } from "@/lib/chat/cache/reducers";
import { filterRows, summarizeUnread, unreadOfRows, type UnreadSummary } from "@/lib/chat/cache/unread";
import { findRow } from "@/lib/chat/cache/writer";
import type { ChatFolder, ChatListDto, ChatListView, ChatRowDto, MessageDto, MessagesData, MessagesPageDto, MessagesParam, ReaderDto, UnreadCount } from "@/lib/chat/cache/types";

/**
 * C1.4 — what the C2 screen reads. Nothing here writes: a screen reads through these hooks and writes through `writer.ts`, so the
 * cache has one truth. Every hook is a subscription to the cache, so a screen that is not on the page costs nothing, and a row that
 * did not change does not render again.
 */

const NO_MESSAGES: MessageDto[] = [];
const NO_READERS: ReaderDto[] = [];

/**
 * The list for one folder (`all · unread · dm · spaces · mentions`): the rows, and the unread numbers of THOSE rows. The server's
 * numbers win: each list refresh replaces what the cache derived. The first time the list is fresh, the three most recent unread
 * chats are warmed (the first window of each).
 */
export function useChatList(folder: ChatFolder = "all") {
  const qc = useQueryClient();
  const select = useCallback(
    (d: ChatListDto): ChatListView => ({ scope: d.scope, spaceId: d.spaceId, canOversee: d.canOversee, rows: filterRows(d.rows, folder), personal: d.personal !== false, archivedRows: d.rows.filter((r) => r.archivedByMe) }),
    [folder],
  );
  const query = useQuery({ ...listQueryOptions(), select });
  const confirmed = query.dataUpdatedAt > 0 && !query.isFetching && query.isSuccess;
  useEffect(() => {
    if (!confirmed) return;
    const all = qc.getQueryData<ChatListDto>(chatKeys.list());
    if (all) prefetchStartup(qc, all.rows);
  }, [confirmed, qc]);
  const rows = query.data?.rows ?? EMPTY_ROWS;
  const unread = useMemo<UnreadCount>(() => unreadOfRows(rows), [rows]);
  return {
    rows,
    scope: query.data?.scope ?? "all",
    spaceId: query.data?.spaceId ?? null,
    canOversee: query.data?.canOversee ?? false,
    personal: query.data?.personal ?? true,
    archivedRows: query.data?.archivedRows ?? EMPTY_ROWS,
    unread,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

const EMPTY_ROWS: ChatRowDto[] = [];

/** The unread numbers of the whole list: per folder (the tabs' badges) and per space (the space switcher), derived from the cache. */
export function useChatUnreadSummary(opts: { enabled?: boolean; includeMuted?: boolean } = {}): UnreadSummary | undefined {
  const includeMuted = opts.includeMuted ?? true;
  const select = useCallback((d: ChatListDto) => summarizeUnread(d.rows, { includeMuted }), [includeMuted]);
  const query = useQuery({ ...listQueryOptions(), select, enabled: opts.enabled ?? true });
  return query.data;
}

/**
 * The company's switch `chatPersonalState` (C3a.1), as the cached list says it: off, no personal item is drawn in a row's menu and no «الأرشيف» tab. It only READS
 * the cache (a row asks it too, so it never fetches); a copy saved before the switch existed has no field and reads as on.
 */
export function useChatPersonalState(): boolean {
  const select = useCallback((d: ChatListDto) => d.personal !== false, []);
  const query = useQuery({ ...listQueryOptions(), select, enabled: false });
  return query.data ?? true;
}

/** The forum view of one space: its topics. */
export function useChatSpace(spaceId: string | null) {
  const query = useQuery({ ...spaceQueryOptions(spaceId ?? ""), enabled: !!spaceId });
  return { space: query.data?.space ?? null, rows: query.data?.rows ?? EMPTY_ROWS, isPending: query.isPending, isError: query.isError, refetch: query.refetch };
}

/**
 * ONE row, by id: a row component subscribes to itself, so a new message re-renders that row and moves it, never the whole list.
 * The row is looked up in the list and in the forum views; the same object comes back while it did not change.
 */
export function useChatRow(id: string | null): ChatRowDto | null {
  const qc = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) =>
      qc.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (event.type === "updated" && isChatKey(key) && (key[1] === "list" || key[1] === "space")) onChange();
      }),
    [qc],
  );
  const get = useCallback(() => (id ? findRow(qc, id) : null), [qc, id]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The header of one conversation (title, my rights here, the pinned bar, the switches). */
export function useChatHeader(id: string | null) {
  const query = useQuery({ ...headerQueryOptions(id ?? ""), enabled: !!id });
  useEffect(() => {
    if (id) markConversationOpened(id);
  }, [id]);
  return query;
}

/**
 * The messages of one conversation, oldest first, across the windows the cache holds. `fetchOlder` / `fetchNewer` load the window
 * before the first / after the last (C1.6 drives them from the scroll). `around` only decides the FIRST window of a conversation the
 * cache has no data for yet.
 */
export function useChatMessages(id: string | null, opts: { around?: string } = {}) {
  const query = useInfiniteQuery<MessagesPageDto, Error, MessagesData, ReturnType<typeof chatKeys.messages>, MessagesParam>({ ...messagesQueryOptions(id ?? "", opts.around ? { around: opts.around } : {}), enabled: !!id });
  useEffect(() => {
    if (id) markConversationOpened(id);
  }, [id]);
  const data = query.data;
  const messages = useMemo(() => (data ? messagesOfData(data) : NO_MESSAGES), [data]);
  const first: MessagesPageDto | undefined = data?.pages[0];
  const last: MessagesPageDto | undefined = data?.pages[data.pages.length - 1];
  const { fetchPreviousPage, fetchNextPage, hasPreviousPage, hasNextPage, isFetchingPreviousPage, isFetchingNextPage } = query;
  const fetchOlder = useCallback(() => (hasPreviousPage && !isFetchingPreviousPage ? fetchPreviousPage().then(() => undefined) : Promise.resolve()), [hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage]);
  const fetchNewer = useCallback(() => (hasNextPage && !isFetchingNextPage ? fetchNextPage().then(() => undefined) : Promise.resolve()), [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return {
    messages,
    hasOlder: first?.hasOlder ?? false,
    hasNewer: last?.hasNewer ?? false,
    /** the oldest unread message as of the first window that was loaded (the server decides it when the conversation is first opened) */
    firstUnreadId: first?.firstUnreadId ?? null,
    readers: last?.readers ?? NO_READERS,
    fetchOlder,
    fetchNewer,
    isFetchingOlder: isFetchingPreviousPage,
    isFetchingNewer: isFetchingNextPage,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

