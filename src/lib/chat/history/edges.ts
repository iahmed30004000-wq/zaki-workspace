/**
 * C1.6 — when does the scroll ask for another page? Pure.
 *
 * Within ONE screen of the top → the page before the first message; within one screen of the bottom (when the windows do not reach
 * the newest message) → the page after the last. One page request at a time; a conversation shorter than a screen asks for the older
 * page first, then the newer.
 */
export const EDGE_SCREENS = 1;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface EdgeState {
  hasOlder: boolean;
  hasNewer: boolean;
  fetchingOlder: boolean;
  fetchingNewer: boolean;
}

export function nextLoad(view: ScrollMetrics, state: EdgeState, screens: number = EDGE_SCREENS): "older" | "newer" | null {
  if (state.fetchingOlder || state.fetchingNewer) return null;
  const reach = view.clientHeight * screens;
  if (state.hasOlder && view.scrollTop <= reach) return "older";
  const below = view.scrollHeight - view.scrollTop - view.clientHeight;
  if (state.hasNewer && below <= reach) return "newer";
  return null;
}
