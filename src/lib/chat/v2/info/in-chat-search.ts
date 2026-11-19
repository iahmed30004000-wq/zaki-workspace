/**
 * C3d — the search INSIDE one conversation, the pure half: the address, the date jump, the step between hits. The component (`conversation-search.tsx`, also used by
 * the old screen) keeps its old behaviour unless it is told `enhanced`.
 */

/** The in-chat search's question: words, a person («من:»), a day (the jump). One of the three at least. */
export interface InChatQuery {
  q: string;
  from: string | null;
  /** the local midnight of the day picked, as an instant (ISO) */
  since: string | null;
}

/** Is there anything to ask? (the words need two letters, like every search here; a person or a day need nothing else) */
export function isAskable(query: InChatQuery): boolean {
  return query.q.trim().length >= 2 || query.from !== null || query.since !== null;
}

export function inChatSearchUrl(conversationId: string, query: InChatQuery): string {
  const params = new URLSearchParams({ scope: "chat", conversationId });
  const words = query.q.trim();
  // a day is a jump: the words are not part of it
  if (words.length >= 2 && !query.since) params.set("q", words);
  if (query.from) params.set("from", query.from);
  if (query.since) params.set("since", query.since);
  return `/api/search?${params.toString()}`;
}

/** The instant a picked day starts at on THIS person's clock (`<input type="date">` gives `YYYY-MM-DD`); null for anything else. */
export function dayStartOf(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(y, mo - 1, d);
  // a day that does not exist (31 February) rolls over: refuse it
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) return null;
  return at.toISOString();
}

/**
 * One step between the hits. They are listed NEWEST first, so «↑» (`older`) is the next one in the list and «↓» (`newer`) the one before. With nothing chosen yet the
 * first step lands on the newest hit whichever way it goes. The ends stop (no wrapping).
 */
export function stepHit(active: number | null, direction: "older" | "newer", count: number): number | null {
  if (count <= 0) return null;
  if (active === null) return 0;
  return Math.min(count - 1, Math.max(0, active + (direction === "older" ? 1 : -1)));
}

/** The key that steps: ↑ older, ↓ newer, Enter older (Shift+Enter newer). Anything else: null. */
export function stepOfSearchKey(key: string, shift: boolean): "older" | "newer" | null {
  if (key === "ArrowUp") return "older";
  if (key === "ArrowDown") return "newer";
  if (key === "Enter") return shift ? "newer" : "older";
  return null;
}
