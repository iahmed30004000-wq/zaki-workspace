import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { fetchChatJson } from "@/lib/chat/cache/http";
import { chatKeys } from "@/lib/chat/cache/keys";
import { messagesRequestUrl } from "@/lib/chat/cache/queries";
import { normalizePage } from "@/lib/chat/cache/reducers";
import { chatRuntimeOf, ensureChatCache } from "@/lib/chat/cache/runtime";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { MessagesData, MessagesPageDto, MessagesParam } from "@/lib/chat/cache/types";
import { LATEST } from "@/lib/chat/cache/types";

/**
 * C1.6 — the windows of one conversation as a MODEL, and the two moves that replace them as a whole.
 *
 * `useChatMessages` already pages (`fetchPreviousPage` / `fetchNextPage` add a window at one end, keeping `hasOlder` / `hasNewer`
 * honest). What it cannot do is show a window that is NOT next to the ones it holds: the conversation opened at its first unread
 * message, a jump to a reply's quote, a search hit, «آخر الرسائل». Those replace the windows with one new window — the cursors then
 * page from it in both directions, and the windows of before are not kept, because nothing proves they touch it.
 *
 * Like `writer.ts`, this file is inside `src/lib/chat/cache/`: it is one of the only places allowed to write a chat key.
 */

// ───────────────────────────────────────── the model (pure) ─────────────────────────────────────────

/** A 404 from the server: «that message is not in this conversation any more». The one predicate of the opening and the jump. */
export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/** Which window (0-based, oldest first) holds this message, or -1. */
export function pageIndexOf(data: MessagesData, messageId: string): number {
  return data.pages.findIndex((p) => p.messages.some((m) => m.id === messageId));
}

export function hasMessage(data: MessagesData | undefined, messageId: string): boolean {
  return !!data && pageIndexOf(data, messageId) >= 0;
}

/** Does the last window reach the newest message of the conversation? (Then new messages are appended to it.) */
export function reachesNewest(data: MessagesData | undefined): boolean {
  const last = data?.pages[data.pages.length - 1];
  return !!last && !last.hasNewer;
}

/** Does the first window reach the very first message of the conversation? */
export function reachesOldest(data: MessagesData | undefined): boolean {
  const first = data?.pages[0];
  return !!first && !first.hasOlder;
}

/** The data of a query that holds exactly one window. */
export function singleWindow(page: MessagesPageDto, param: MessagesParam): MessagesData {
  return { pages: [page], pageParams: [param] };
}

// ───────────────────────────────────────── fetching and replacing a window ─────────────────────────────────────────

/** Where the sync feed was when each fetched window's request started: the replay must start there, once the window is shown. */
const startedAt = new WeakMap<MessagesPageDto, string | null>();

/**
 * One window from the server. Like every chat fetch (`queries.ts`) the runtime is started first. The feed's cursor at the start of the
 * request is remembered with the answer: when the window is SHOWN (`showWindow`), the engine goes back to it and asks again — what
 * happened while the request was in the air is not in the window and must land on it, not on the windows it replaces. A window that
 * is fetched and never shown asks for no replay.
 * Throws what `fetchChatJson` throws (an `ApiError` carries the status: 404 is «that message is gone»).
 */
export async function fetchWindow(qc: QueryClient, conversationId: string, param: MessagesParam, signal?: AbortSignal): Promise<MessagesPageDto> {
  await ensureChatCache(qc);
  const before = chatRuntimeOf(qc).engine.cursor;
  const page = normalizePage(await fetchChatJson<MessagesPageDto>(messagesRequestUrl(conversationId, param), signal));
  startedAt.set(page, before);
  return page;
}

/**
 * Replace everything the conversation's messages query holds with ONE window. A page request in the air is cancelled first (its
 * answer was built on the windows being replaced and would put them back). `current` says whether the run that wants this is still
 * the latest one (the person did not go to another conversation, ask for another message, or reopen it): a run that was overtaken
 * writes nothing, so a late answer can never replace the window a newer run chose. Returns whether the window was written.
 */
export async function showWindow(qc: QueryClient, conversationId: string, page: MessagesPageDto, param: MessagesParam, current?: () => boolean): Promise<boolean> {
  if (current && !current()) return false;
  installChatDefaults(qc);
  const key = chatKeys.messages(conversationId);
  await qc.cancelQueries({ queryKey: key, exact: true });
  if (current && !current()) return false;
  qc.setQueryData<MessagesData>(key, singleWindow(normalizePage(page), param));
  const from = startedAt.get(page);
  if (from) chatRuntimeOf(qc).engine.rewindTo(from);
  return true;
}

/** «آخر الرسائل»: the newest window replaces whatever the conversation holds. `null`: the run was overtaken and wrote nothing. */
export async function showNewest(qc: QueryClient, conversationId: string, current?: () => boolean): Promise<MessagesPageDto | null> {
  const page = await fetchWindow(qc, conversationId, LATEST);
  return (await showWindow(qc, conversationId, page, LATEST, current)) ? page : null;
}

/** The window around a message replaces whatever the conversation holds. Throws like `fetchWindow` (404: the message is not there); `null`: overtaken. */
export async function showAround(qc: QueryClient, conversationId: string, messageId: string, current?: () => boolean): Promise<MessagesPageDto | null> {
  const param: MessagesParam = { kind: "around", id: messageId };
  const page = await fetchWindow(qc, conversationId, param);
  return (await showWindow(qc, conversationId, page, param, current)) ? page : null;
}
