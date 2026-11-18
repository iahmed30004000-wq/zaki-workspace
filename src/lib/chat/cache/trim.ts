import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { pageIndexOf } from "@/lib/chat/cache/pages";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { MessagesData } from "@/lib/chat/cache/types";

/**
 * C1.6 — the memory cap: a conversation keeps at most ten windows (500 messages) in the cache; the windows FAR from the screen go.
 *
 * Pure part (`trimPages`) and the one move that writes the cut (`trimMessages`). The cut end of what is left says honestly that there
 * is more beyond it (`hasOlder` / `hasNewer` true), so the cursors of `useChatMessages` page across the cut again when the person
 * scrolls back, and a message that arrives while the newest window is cut off is not appended to a window that does not touch it.
 */

export const MAX_PAGES = 10;

export interface Trimmed {
  data: MessagesData;
  /** how many windows were dropped at the OLD end / the NEW end */
  droppedOlder: number;
  droppedNewer: number;
}

/**
 * Keep `max` windows, dropping the end that is farther from the viewport window one at a time (a tie loses the newer end: the older
 * history is what a person scrolled up for). With `max` windows or fewer the very same data comes back.
 */
export function trimPages(data: MessagesData, viewportPage: number, max: number = MAX_PAGES): Trimmed {
  const n = data.pages.length;
  const keep = Math.max(1, max);
  if (n <= keep) return { data, droppedOlder: 0, droppedNewer: 0 };
  const v = Math.min(Math.max(viewportPage, 0), n - 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo + 1 > keep) {
    if (v - lo > hi - v) lo++;
    else hi--;
  }
  const pages = data.pages.slice(lo, hi + 1);
  const pageParams = data.pageParams.slice(lo, hi + 1);
  if (lo > 0) pages[0] = { ...pages[0]!, hasOlder: true };
  if (hi < n - 1) pages[pages.length - 1] = { ...pages[pages.length - 1]!, hasNewer: true };
  return { data: { pages, pageParams }, droppedOlder: lo, droppedNewer: n - 1 - hi };
}

/**
 * The window the screen is on: the window of the message at the top of the screen, or -1 when that is not known (nothing reported
 * yet, or an id from before a jump that is not in the windows any more). Nothing is cut around a guess: the windows under the screen
 * must never be the ones that go.
 */
export function viewportPageOf(data: MessagesData, messageId: string | null): number {
  return messageId ? pageIndexOf(data, messageId) : -1;
}

/**
 * Cut the conversation's windows to the cap, around the window the screen is on. Does nothing (returns null) when there is nothing
 * to cut, when the window the screen is on is not known, and while a page request is in the air: its answer is built on the windows being cut and would put them back; the caller
 * tries again when the request has settled. The freshness of the data is kept: a cut is not a refetch.
 */
export function trimMessages(qc: QueryClient, conversationId: string, viewportMessageId: string | null, max: number = MAX_PAGES): Trimmed | null {
  const key = chatKeys.messages(conversationId);
  const state = qc.getQueryState<MessagesData>(key);
  const data = state?.data;
  if (!state || !data || data.pages.length <= max) return null;
  if (state.fetchStatus === "fetching") return null;
  const viewport = viewportPageOf(data, viewportMessageId);
  if (viewport < 0) return null;
  const out = trimPages(data, viewport, max);
  if (out.data === data) return null;
  installChatDefaults(qc);
  qc.setQueryData<MessagesData>(key, out.data, { updatedAt: state.dataUpdatedAt });
  if (state.isInvalidated) void qc.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  return out;
}
