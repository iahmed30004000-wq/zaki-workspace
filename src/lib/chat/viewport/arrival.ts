import { onNewest } from "@/lib/chat/conversation/client";

/**
 * C1.7 — a new newest message and where it leaves the view. The rules are TODAY's, owner-approved, and live in
 * `onNewest()` / `isAtBottom()` of `conversation/client.ts` (own message / at the bottom stays at the bottom; reading old messages
 * shows the «↓ رسائل جديدة» counter; around a hit stays): this only applies them to «did the newest message change?».
 */
export function newestArrival(state: {
  previousNewestId: string | null;
  newestId: string | null;
  opening: boolean;
  mine: boolean;
  atBottom: boolean;
  aroundHit: boolean;
}): "none" | "bottom" | "badge" | "stay" {
  if (!state.newestId || state.newestId === state.previousNewestId) return "none";
  return onNewest({ opening: state.opening && state.previousNewestId === null, mine: state.mine, atBottom: state.atBottom, aroundHit: state.aroundHit });
}

/**
 * Did a NEW message arrive at the end of the list? Only when the windows reached the newest message both before and after (a page of
 * history added at the end is paging, not an arrival), the newest message changed, and the one that was newest is still in the list
 * (otherwise the windows were replaced as a whole: the landing signal places the view, nothing «arrived»).
 * `count` is how many messages are now below the one that was newest (the «↓ رسائل جديدة» counter adds it).
 */
export function detectArrival(state: {
  previous: { id: string | null; hasNewer: boolean };
  messages: readonly { id: string; mine: boolean }[];
  hasNewer: boolean;
  atBottom: boolean;
}): { action: "none" | "bottom" | "badge" | "stay"; count: number } {
  const newest = state.messages.at(-1);
  const wasId = state.previous.id;
  if (!newest || wasId === null || newest.id === wasId || state.previous.hasNewer || state.hasNewer) return { action: "none", count: 0 };
  const wasAt = state.messages.findIndex((m) => m.id === wasId);
  if (wasAt < 0) return { action: "none", count: 0 };
  const action = newestArrival({ previousNewestId: wasId, newestId: newest.id, opening: false, mine: newest.mine, atBottom: state.atBottom, aroundHit: false });
  return { action, count: state.messages.length - 1 - wasAt };
}
