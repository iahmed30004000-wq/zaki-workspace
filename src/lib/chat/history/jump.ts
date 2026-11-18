import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { hasMessage, isNotFound, showAround, showNewest } from "@/lib/chat/cache/pages";
import type { MessagesData } from "@/lib/chat/cache/types";

/**
 * C1.6 — jumping to a message (a reply's quote, the pinned bar, a search hit, a `?m=` link) and coming back to the newest.
 *
 * The jump is `around` the message, then paging in both directions from there (the cache's own cursors). The screen is told what to
 * do by SIGNALS — «scroll to this message», «highlight this message for two seconds» — never by styling anything: the bubbles are C2's.
 */

/** How long the target of a jump is highlighted. */
export const HIGHLIGHT_MS = 2000;

/**
 * `here`: the message was already in the cache (no request); `loaded`: its window was fetched; `missing`: it is not there any more;
 * `stale`: the run was overtaken (`current()` said no) and wrote nothing.
 */
export type JumpOutcome = "here" | "loaded" | "missing" | "stale";

export async function jumpToMessage(qc: QueryClient, conversationId: string, messageId: string, current?: () => boolean): Promise<JumpOutcome> {
  if (current && !current()) return "stale";
  if (hasMessage(qc.getQueryData<MessagesData>(chatKeys.messages(conversationId)), messageId)) return "here";
  try {
    return (await showAround(qc, conversationId, messageId, current)) ? "loaded" : "stale";
  } catch (e) {
    if (isNotFound(e)) return "missing";
    throw e;
  }
}

/** «↓ آخر الرسائل»: the newest window replaces the windows of the jump. */
export async function backToNewest(qc: QueryClient, conversationId: string, current?: () => boolean): Promise<boolean> {
  return (await showNewest(qc, conversationId, current)) !== null;
}

export type ScrollTarget = { kind: "message"; id: string; align: "start" | "center" } | { kind: "newest" };

/** «Scroll there». A new `token` every time, so asking for the same place twice is two requests. */
export interface ScrollSignal {
  token: number;
  target: ScrollTarget;
}

export interface JumpState {
  scroll: ScrollSignal | null;
  /** the message to highlight right now (two seconds after a jump), or null */
  highlightId: string | null;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * The state a screen subscribes to (`useSyncExternalStore`-shaped: `subscribe` + `getState`, the state object is the same one until
 * something changes). One per open conversation.
 */
export class JumpSignals {
  private state: JumpState = { scroll: null, highlightId: null };
  private readonly listeners = new Set<() => void>();
  private token = 0;
  private timer: unknown = null;

  constructor(private readonly timers: Timers = browserTimers) {}

  getState = (): JumpState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  /** Scroll to a message; by default it is highlighted for `HIGHLIGHT_MS` (the unread landing is not). */
  scrollToMessage(id: string, align: "start" | "center" = "center", opts: { highlight?: boolean } = {}): void {
    this.cancelTimer();
    const highlight = opts.highlight ?? true;
    this.set({ scroll: { token: ++this.token, target: { kind: "message", id, align } }, highlightId: highlight ? id : null });
    if (highlight) {
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.set({ ...this.state, highlightId: null });
      }, HIGHLIGHT_MS);
    }
  }

  scrollToNewest(): void {
    this.cancelTimer();
    this.set({ scroll: { token: ++this.token, target: { kind: "newest" } }, highlightId: null });
  }

  reset(): void {
    this.cancelTimer();
    if (this.state.scroll === null && this.state.highlightId === null) return;
    this.set({ scroll: null, highlightId: null });
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private set(next: JumpState): void {
    this.state = next;
    for (const fn of [...this.listeners]) fn();
  }
}
