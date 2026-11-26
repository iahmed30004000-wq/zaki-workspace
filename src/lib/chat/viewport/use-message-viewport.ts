"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { isAtBottom } from "@/lib/chat/conversation/client";
import type { ScrollMetrics } from "@/lib/chat/history/edges";
import type { ScrollSignal } from "@/lib/chat/history/jump";
import { captureAnchor, restoredScrollTop, shouldRestore, type Anchor } from "@/lib/chat/viewport/anchor";
import { detectArrival } from "@/lib/chat/viewport/arrival";
import { smoothJumpAllowed } from "@/lib/chat/v2/phone/jump-scroll";
import { OVERSCAN, pendingExpired } from "@/lib/chat/viewport/config";
import { firstMessageIdFrom, messagesOfRow, rowIndexOfMessage, scrollRowIndex, type Row } from "@/lib/chat/viewport/rows";
import { estimateRowHeight } from "@/lib/chat/viewport/sizes";

/**
 * C1.7 — the virtualized message viewport, as a hook (the screen that draws it is C2.4).
 *
 *   const v = useMessageViewport({ rows, hasNewer, scroll, onViewport });
 *   <div ref={v.scrollRef} style={{ overflowY: "auto" }}>
 *     <div style={{ height: v.totalSize, position: "relative" }}>
 *       {v.items.map((item) => <div key={item.key} data-index={item.index} ref={v.measureElement} style={{ position: "absolute", top: 0, insetInline: 0, transform: `translateY(${item.start}px)` }}>…</div>)}
 *
 * - `@tanstack/react-virtual`: dynamic heights (`measureElement`), `overscan: 10`, `getItemKey` = the row's key (the message id).
 * - Older rows put above (a page arrives, or far pages are dropped by the cap): the first visible MESSAGE row is recorded BEFORE the
 *   change and put back at the same distance from the top once the new layout is known, in a layout effect (before paint). The rows
 *   that were estimated and are measured later shift the scroll by what they changed (the virtualizer does that for rows above the fold).
 * - Where a new newest message leaves the view is today's rule (`onNewest()` / `isAtBottom()` of conversation/client.ts).
 * - `scroll` is the history hook's signal («scroll to this message» / «to the newest»); it waits until the row exists (and is dropped
 *   after `PENDING_SCROLL_MS` if it never does, so it can never hold paging back for good).
 * - `scrollRef` is a callback ref: the scroller may mount after the hook (a loading screen first), the listener follows it.
 */

/** a layout effect where there is a layout (the browser); on the server it is a plain effect, which never runs (no warning) */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface MessageViewportOptions {
  /** memoized by the caller on the messages (`buildRows`): its identity is what says «the rows changed» */
  rows: Row[];
  /** the windows do NOT reach the newest message (a new message is not appended: it never counts as an arrival) */
  hasNewer: boolean;
  scroll: ScrollSignal | null;
  /** the conversation shown: when it changes, what the hook remembers about the last one (the counter, the bottom, the anchor) is forgotten */
  resetKey?: string | null;
  /** «تيليجرام على التلفون»: a jump to a row that is already drawn slides to it (absent: every jump is instant, as before) */
  smoothNear?: boolean;
  /** the scroll moved, or the rows changed: the message id of the first row in view, and the scroll metrics (the history hook asks for pages from this) */
  onViewport?: (firstVisibleMessageId: string | null, metrics: ScrollMetrics) => void;
}

export interface MessageViewport {
  /** `ref={v.scrollRef}` on the element that scrolls */
  scrollRef: (el: HTMLDivElement | null) => void;
  virtualizer: Virtualizer<HTMLDivElement, HTMLElement>;
  items: VirtualItem[];
  totalSize: number;
  /** `ref={v.measureElement}` on each row, with `data-index` */
  measureElement: (el: HTMLElement | null) => void;
  /** within `STICK_PX` of the bottom */
  atBottom: boolean;
  /** how many messages arrived while the person was reading older ones: the «↓ رسائل جديدة» counter */
  newBelow: number;
  scrollToBottom: (smooth?: boolean) => void;
}

export function useMessageViewport(opts: MessageViewportOptions): MessageViewport {
  const { rows, hasNewer, scroll, onViewport, resetKey = null } = opts;
  const smoothRef = useRef(false);
  smoothRef.current = opts.smoothNear === true;
  const elRef = useRef<HTMLDivElement | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setEl(node);
  }, []);
  const rowsRef = useRef(rows);
  const virtRef = useRef<Virtualizer<HTMLDivElement, HTMLElement> | null>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);

  // a signal from the history hook waits here until what it points at can be scrolled to; taken in the render so that the layout
  // effects of the SAME render already know a landing is on its way (they must not scroll to the bottom first)
  const pendingScroll = useRef<{ signal: ScrollSignal; since: number } | null>(null);
  const takenSignal = useRef<ScrollSignal | null>(null);
  if (takenSignal.current !== scroll) {
    takenSignal.current = scroll;
    pendingScroll.current = scroll ? { signal: scroll, since: Date.now() } : null;
  }
  const hasPending = (): boolean => {
    const p = pendingScroll.current;
    if (p && pendingExpired(p.since, Date.now())) pendingScroll.current = null;
    return pendingScroll.current !== null;
  };

  // BEFORE the layout changes: record the first visible message row of the layout that is still on screen (once per `rows`, even if
  // React renders twice). Day and unread rows are never the anchor: their keys come and go with the pages.
  const anchorRef = useRef<Anchor | null>(null);
  const capturedFor = useRef<Row[] | null>(null);
  if (capturedFor.current !== rows) {
    capturedFor.current = rows;
    const v = virtRef.current;
    const node = elRef.current;
    const old = rowsRef.current;
    anchorRef.current = v && node ? captureAnchor(v.getVirtualItems(), node.scrollTop, (i) => old[i.index]?.type === "message" || old[i.index]?.type === "calls") : null;
  }
  rowsRef.current = rows;

  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
  const estimateSize = useCallback((index: number) => (rows[index] ? estimateRowHeight(rows[index]!) : 0), [rows]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: rows.length,
    getScrollElement: () => elRef.current,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
  });
  virtRef.current = virtualizer;
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const scrollToBottom = useCallback((smooth = false) => {
    const v = virtRef.current;
    const n = rowsRef.current.length;
    stickRef.current = true;
    setAtBottom(true);
    setNewBelow(0);
    if (v && n > 0) v.scrollToIndex(n - 1, { align: "end", behavior: smooth ? "smooth" : "auto" });
  }, []);

  const applyScroll = useCallback(() => {
    const p = pendingScroll.current;
    const v = virtRef.current;
    if (!p || !v || !elRef.current) return;
    const target = p.signal.target;
    if (target.kind === "newest") {
      if (rowsRef.current.length === 0) return; // nothing to scroll to yet: tried again when the rows come
      pendingScroll.current = null;
      scrollToBottom();
      return;
    }
    const at = scrollRowIndex(rowsRef.current, target.id, target.align);
    if (at < 0) return; // not in the rows yet: tried again when they change
    pendingScroll.current = null;
    stickRef.current = false;
    // a slide is asked of the element itself, only for a measured row (the virtual list's own smooth scroll is not made for measured heights)
    const near = smoothJumpAllowed({ wanted: smoothRef.current, targetIndex: at, drawn: smoothRef.current ? v.getVirtualItems().map((i) => i.index) : [] }) ? v.getOffsetForIndex(at, target.align) : undefined;
    if (near) elRef.current.scrollTo({ top: near[0], behavior: "smooth" });
    else v.scrollToIndex(at, { align: target.align });
  }, [scrollToBottom]);

  const reportViewport = useCallback(() => {
    const node = elRef.current;
    const v = virtRef.current;
    if (!node || !v || !onViewport || hasPending()) return; // not while a landing is still on its way
    const first = v.getVirtualItems().find((i) => i.end > node.scrollTop);
    // nothing laid out yet (or scrolled past everything): no message is reported, never «the oldest one»
    const firstMessage = first ? firstMessageIdFrom(rowsRef.current, first.index) : null;
    onViewport(firstMessage, { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
  }, [onViewport]);
  const reportRef = useRef(reportViewport);
  reportRef.current = reportViewport;

  // the scroll: where «the bottom» is, the counter, and what page to ask for
  useEffect(() => {
    if (!el) return;
    const onScroll = () => {
      const at = isAtBottom(el);
      stickRef.current = at;
      setAtBottom((was) => (was === at ? was : at));
      if (at) setNewBelow(0);
      reportRef.current();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [el]);

  // after the rows changed, before paint: put the anchor back, follow the bottom, answer a pending signal
  const committedRows = useRef<Row[] | null>(null);
  const newestRef = useRef<{ id: string | null; hasNewer: boolean }>({ id: null, hasNewer });
  const lastTotal = useRef(0);
  const frame = useRef<number | null>(null);
  const shownKey = useRef<string | null>(resetKey);
  useIsoLayoutEffect(() => {
    const v = virtRef.current;
    if (shownKey.current !== resetKey) {
      // another conversation: nothing the last one left (the counter, the bottom, the anchor, the newest message) is this one's
      shownKey.current = resetKey;
      stickRef.current = true;
      lastTotal.current = 0;
      anchorRef.current = null;
      newestRef.current = { id: null, hasNewer };
      setNewBelow(0);
      setAtBottom(true);
    }
    const changed = committedRows.current !== rows;
    committedRows.current = rows;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    let restored = false;
    if (v && anchor && changed) {
      let at = rows.findIndex((r) => r.key === anchor.key);
      // a message row that an older page folded into a run of calls is found by the message it was (the chip's row)
      if (at < 0) at = rowIndexOfMessage(rows, String(anchor.key));
      const start = at >= 0 ? v.measurementsCache[at]?.start : undefined;
      if (shouldRestore(anchor, at) && start !== undefined && !hasPending()) {
        v.scrollToOffset(restoredScrollTop(anchor, start));
        restored = true;
      }
    }
    // a message that arrived at the end of a window that already reached the newest message: today's rule
    const was = newestRef.current;
    let arrived = false;
    if (changed || was.hasNewer !== hasNewer) {
      const messages = rows.flatMap(messagesOfRow);
      newestRef.current = { id: messages.at(-1)?.id ?? null, hasNewer };
      const arrival = detectArrival({ previous: was, messages, hasNewer, atBottom: stickRef.current });
      arrived = arrival.action !== "none";
      if (arrival.action === "bottom") scrollToBottom();
      else if (arrival.action === "badge") setNewBelow((n) => n + arrival.count);
    }
    if (!arrived && !restored && v && stickRef.current && !hasNewer && !hasPending() && v.getTotalSize() !== lastTotal.current) {
      // pictures and voice notes grow after they load: keep following the bottom while that is where the person is
      v.scrollToOffset(Math.max(0, v.getTotalSize() - (elRef.current?.clientHeight ?? 0)));
    }
    lastTotal.current = v?.getTotalSize() ?? 0;
    applyScroll();
    // new rows are on screen: if the person is still within a screen of an edge (a page shorter than a screen arrived, a short
    // conversation) no scroll event will say so, so the edge is looked at again once the frame is laid out
    if (changed) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        reportRef.current();
      });
    }
  });
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // the history hook's signal: answered at once when its row is already there, else when the rows change; then the edge is looked at
  useIsoLayoutEffect(() => {
    if (!scroll) return;
    applyScroll();
    const t = requestAnimationFrame(() => reportRef.current());
    return () => cancelAnimationFrame(t);
  }, [scroll, applyScroll]);

  return { scrollRef, virtualizer, items, totalSize, measureElement: virtualizer.measureElement, atBottom, newBelow, scrollToBottom };
}
