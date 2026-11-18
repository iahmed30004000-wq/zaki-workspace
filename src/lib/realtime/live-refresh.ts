"use client";

import { useEffect, useRef } from "react";
import { pollMs } from "@/lib/economy";
import { subscribeRealtime, type RealtimeEventPayload } from "@/lib/realtime/use-realtime";

/**
 * C1.3 / F1.5 — the screens that used to poll (the unread badge, the spaces' counts, the people dock, the quick chat) now refetch when
 * a FRAME says their data moved. A frame carries ids only; the screen asks the normal API, where authorization applies again.
 *
 * What is left of the old timers is a safety net: one refetch every five minutes (`safetyRefreshMs`, stretched by «وضع التوفير») for
 * the case where a frame was lost, and react-query's own refetch when the window gets focus after the data went stale.
 */

/** The safety refresh: the only timer a frame-driven screen keeps. */
export const SAFETY_REFRESH_MS = 300_000;

/** The safety refresh's period, read through `pollMs` like every repeated refresh (economy mode stretches it). */
export function safetyRefreshMs(): number {
  return pollMs(SAFETY_REFRESH_MS);
}

/** The react-query options of a frame-driven query: stale after the safety period, and one refetch per period while it is on screen. */
export function frameDrivenQuery(): { refetchInterval: number; staleTime: number } {
  return { refetchInterval: safetyRefreshMs(), staleTime: SAFETY_REFRESH_MS };
}

/**
 * The events that move the spaces' counts (the unread and overdue pills of `/api/workspaces`): a message, a deletion, a door that
 * opened or closed, a refetch signal — and a read mark only when it is MINE (the server marks the reader's own streams `self`).
 */
const MOVES_SPACE_COUNTS = new Set(["message.created", "message.deleted", "membership.changed", "conversation.changed"]);
export function movesSpaceCounts(e: RealtimeEventPayload): boolean {
  if (e.kind === "conversation.read") return e.self === true;
  return MOVES_SPACE_COUNTS.has(e.kind);
}

/**
 * Does this frame concern the conversation a small window shows? Its own frames, except the ones that never change what the window
 * draws (typing, the whiteboard); a refetch signal names no conversation and concerns every window.
 */
export function touchesConversation(e: RealtimeEventPayload, conversationId: string): boolean {
  if (e.kind === "typing" || e.kind === "whiteboard.changed" || e.kind === "presence.changed") return false;
  if (e.synthetic) return true;
  return e.conversationId === conversationId;
}

export interface WatchOptions {
  /** which frames of a screen's stream count (omitted: none — a presence-only watch) */
  matches?: (e: RealtimeEventPayload) => boolean;
  /** also refetch on `presence.changed` and on refetch signals (the people dock, the quick chat's list) */
  presence?: boolean;
  /** a burst of frames refetches once, this long after the first one */
  delayMs: number;
  onRefresh: () => void;
}

/**
 * Refetch once per burst of matching frames. The non-React core of `useFrameRefresh`: it listens to the live line, folds every
 * matching frame of the next `delayMs` into one `onRefresh`, and returns the function that stops listening and cancels what waited.
 */
export function watchFrames(opts: WatchOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) return; // a refresh is already waiting: this frame is part of its burst
    timer = setTimeout(() => {
      timer = null;
      opts.onRefresh();
    }, opts.delayMs);
  };
  const off = subscribeRealtime(
    opts.matches
      ? (e) => {
          if (opts.matches!(e)) fire();
        }
      : null,
    opts.presence ? () => fire() : undefined,
  );
  return () => {
    off();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** `watchFrames` for a component: starts with it, stops with it, and always calls the latest `matches` and `onRefresh`. */
export function useFrameRefresh(opts: { enabled?: boolean; matches?: (e: RealtimeEventPayload) => boolean; presence?: boolean; delayMs: number; onRefresh: () => void }): void {
  const latest = useRef(opts);
  latest.current = opts;
  const { enabled = true, presence = false, delayMs } = opts;
  const hasMatcher = !!opts.matches;
  useEffect(() => {
    if (!enabled) return;
    return watchFrames({
      matches: hasMatcher ? (e) => latest.current.matches?.(e) ?? false : undefined,
      presence,
      delayMs,
      onRefresh: () => latest.current.onRefresh(),
    });
  }, [enabled, hasMatcher, presence, delayMs]);
}
