import type { QueryClient } from "@tanstack/react-query";
import { economyActive } from "@/lib/economy";
import { headerQueryOptions, messagesQueryOptions } from "@/lib/chat/cache/queries";
import type { ChatRowDto } from "@/lib/chat/cache/types";

/**
 * C1.4 — prefetch, so that opening a chat is a paint, not a load:
 *  - a computer's pointer resting on a row for 150 ms fetches the header and the first window of that conversation;
 *  - at startup, once the list is in, the first window of the 3 most recent chats that have something unread.
 * A prefetch of what is already fresh asks nothing (TanStack Query's staleTime), and none of it runs in «وضع التوفير» or on a
 * connection that asked to save data. Prefetched data is NOT «opened»: it never counts for the device copy's eviction order.
 */

export const HOVER_PREFETCH_MS = 150;
export const STARTUP_PREFETCH_COUNT = 3;

function savingData(): boolean {
  if (economyActive()) return true;
  try {
    return typeof navigator !== "undefined" && (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}

/** Header and first window of one conversation (no request for what the cache already holds fresh). */
export async function prefetchConversation(qc: QueryClient, id: string): Promise<void> {
  if (!id) return;
  await Promise.allSettled([qc.prefetchQuery(headerQueryOptions(id)), qc.prefetchInfiniteQuery({ ...messagesQueryOptions(id), pages: 1 })]);
}

/** The conversations to warm at startup: the chats of the list with something unread, newest first, at most `count`. */
export function startupCandidates(rows: readonly ChatRowDto[], count: number = STARTUP_PREFETCH_COUNT): string[] {
  const found: { id: string; at: number }[] = [];
  for (const row of rows) {
    const at = row.lastMessage ? Date.parse(row.lastMessage.at) : 0;
    if (row.kind === "SPACE") {
      // a forum row: its chips are its most active topics; a chip with something unread is a chat to warm (it is as recent as its space)
      for (const chip of row.topicChips ?? []) if (chip.unread > 0) found.push({ id: chip.id, at });
    } else if (row.unread > 0) {
      found.push({ id: row.id, at });
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => b.at - a.at)
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, count)
    .map((c) => c.id);
}

const startupDone = new WeakSet<QueryClient>();

/** Once per page, when the list first holds data: warm the 3 most recent unread chats. Returns the ids it warmed. */
export function prefetchStartup(qc: QueryClient, rows: readonly ChatRowDto[]): string[] {
  if (startupDone.has(qc) || savingData()) return [];
  const ids = startupCandidates(rows);
  if (!rows.length) return [];
  startupDone.add(qc);
  for (const id of ids) void prefetchConversation(qc, id);
  return ids;
}

/**
 * The hover rule, without React: `enter` (a mouse pointer came onto the row) starts a 150 ms timer, `leave` cancels it. Only a
 * mouse counts: a touch has no hover, and a pen resting on a screen is not «looking at a row».
 */
export function createHoverPrefetch(
  qc: QueryClient,
  id: string,
  deps: { setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (h: unknown) => void; delayMs?: number } = {},
): { enter(pointerType?: string): void; leave(): void } {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  return {
    enter(pointerType = "mouse") {
      if (pointerType !== "mouse" || timer !== null || savingData()) return;
      timer = setTimer(() => {
        timer = null;
        void prefetchConversation(qc, id);
      }, deps.delayMs ?? HOVER_PREFETCH_MS);
    },
    leave() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
