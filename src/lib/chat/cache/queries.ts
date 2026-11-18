import type { QueryClient } from "@tanstack/react-query";
import { chatRetry, fetchChatJson } from "@/lib/chat/cache/http";
import { chatListUrl, conversationHeaderUrl, conversationMessagesUrl, spaceTopicsUrl } from "@/lib/chat/conversation/client";
import { CHAT_GC_MS, CHAT_STALE_MS } from "@/lib/chat/cache/constants";
import { shareChatData } from "@/lib/chat/cache/share";
import { chatKeys } from "@/lib/chat/cache/keys";
import { normalizePage, PAGE_SIZE } from "@/lib/chat/cache/reducers";
import { LATEST, type ChatListDto, type ConversationHeaderDto, type MessagesData, type MessagesPageDto, type MessagesParam, type SpaceTopicsDto } from "@/lib/chat/cache/types";
import { chatRuntimeOf, ensureChatCache } from "@/lib/chat/cache/runtime";

/**
 * C1.4 — the queries of the chat cache: what each key fetches, and how long it is believed.
 *
 * The data is kept fresh by the sync feed (`scheduleSync`), not by timers: a query is stale after five minutes (the safety period of
 * the live line), never refetches on a window focus (the sync does that: a focus after a long sleep asks the feed), and a failed
 * request is retried once, never when the server said no (a conversation that answers 404 is gone for this person).
 */
export { CHAT_STALE_MS, CHAT_GC_MS };

export { fetchChatJson, chatRetry };

/**
 * Every chat fetch goes through here: the runtime is started first, and when the fetch settles after the feed moved on (events were
 * applied while the request was in the air) the engine goes back to where the request started and asks again — the answer was read
 * before those events and may have overwritten them.
 */
async function settled<T>(client: QueryClient, run: () => Promise<T>): Promise<T> {
  await ensureChatCache(client);
  const engine = chatRuntimeOf(client).engine;
  const before = engine.cursor;
  const out = await run();
  if (before !== null) engine.rewindTo(before);
  return out;
}

const common = {
  staleTime: CHAT_STALE_MS,
  gcTime: CHAT_GC_MS,
  structuralSharing: shareChatData,
  retry: chatRetry,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function listQueryOptions() {
  return {
    ...common,
    queryKey: chatKeys.list(),
    queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }): Promise<ChatListDto> => {
      // the cursor of the feed is taken BEFORE the list is read, so nothing that happens in between is lost (a replay is harmless)
      return settled(client, () => fetchChatJson<ChatListDto>(chatListUrl(), signal));
    },
  };
}

export function spaceQueryOptions(spaceId: string) {
  return {
    ...common,
    queryKey: chatKeys.space(spaceId),
    queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }): Promise<SpaceTopicsDto> => {
      return settled(client, () => fetchChatJson<SpaceTopicsDto>(spaceTopicsUrl(spaceId), signal));
    },
  };
}

export function headerQueryOptions(id: string) {
  return {
    ...common,
    queryKey: chatKeys.header(id),
    queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }): Promise<ConversationHeaderDto> => {
      return settled(client, () => fetchChatJson<ConversationHeaderDto>(conversationHeaderUrl(id), signal));
    },
  };
}

/** The request of one window of a conversation. */
export function messagesRequestUrl(id: string, param: MessagesParam): string {
  switch (param.kind) {
    case "latest":
      return conversationMessagesUrl(id, { limit: PAGE_SIZE });
    case "before":
      return conversationMessagesUrl(id, { before: param.id, limit: PAGE_SIZE });
    case "after":
      return conversationMessagesUrl(id, { after: param.id, limit: PAGE_SIZE });
    case "around":
      return conversationMessagesUrl(id, { around: param.id, limit: PAGE_SIZE });
  }
}

/**
 * The messages of one conversation: an infinite query whose pages are windows of 50, oldest first.
 * `getPreviousPageParam` is the older cursor (the first message of the first window), `getNextPageParam` the newer one when the last
 * window does not reach the newest message (a conversation opened around a message). `around` is only the FIRST window of a query
 * that has no data yet (C1.6: the unread landing and the jump).
 */
export function messagesQueryOptions(id: string, opts: { around?: string } = {}) {
  const initialPageParam: MessagesParam = opts.around ? { kind: "around", id: opts.around } : LATEST;
  return {
    ...common,
    queryKey: chatKeys.messages(id),
    initialPageParam,
    queryFn: async ({ client, signal, pageParam }: { client: QueryClient; signal: AbortSignal; pageParam: MessagesParam }): Promise<MessagesPageDto> => {
      return settled(client, async () => normalizePage(await fetchChatJson<MessagesPageDto>(messagesRequestUrl(id, pageParam), signal)));
    },
    getPreviousPageParam: (first: MessagesPageDto): MessagesParam | undefined => (first.hasOlder && first.messages.length ? { kind: "before", id: first.messages[0]!.id } : undefined),
    getNextPageParam: (last: MessagesPageDto): MessagesParam | undefined => (last.hasNewer && last.messages.length ? { kind: "after", id: last.messages[last.messages.length - 1]!.id } : undefined),
  };
}

export type { MessagesData };
