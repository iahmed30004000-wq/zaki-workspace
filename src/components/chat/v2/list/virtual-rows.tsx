"use client";

import React, { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ListItem } from "@/lib/chat/list-folders";
import { ct } from "@/lib/chat/text";
import type { RowMenuContext } from "@/components/chat/v2/row-menu";
import { ChatRowItem, ROW_HEIGHT, ROW_HEIGHT_PHONE, SECTION_HEIGHT } from "./chat-row";

/**
 * C2.2 — the rows of the list, VIRTUAL: only the rows on the screen (and eight beyond each edge) exist in the page, so a company with a thousand
 * conversations scrolls like one with ten. Rows are 72 px, 76 px on the phone (fixed, so nothing measures the page while scrolling).
 *
 * `initialRect` is what the virtualizer believes before the browser has measured: it makes the very first paint (and a server render, as in the
 * tests) already hold the first screenful instead of an empty box.
 *
 * Keyboard: with the focus on a row, ↑ and ↓ move to the previous and next row (scrolling it into view), Enter opens it (the row IS a link).
 */
export const OVERSCAN = 8;
const INITIAL_RECT = { width: 360, height: 720 } as const;

export function VirtualRows({
  items,
  tall,
  selectedId,
  userId,
  menu,
  label,
  day,
}: {
  items: readonly ListItem[];
  tall: boolean;
  selectedId: string | null;
  userId: string;
  menu: RowMenuContext;
  label: string;
  /** the local date (`useDayKey`): the rows' time labels roll over at midnight */
  day: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = tall ? ROW_HEIGHT_PHONE : ROW_HEIGHT;
  const sizeOf = useCallback((index: number) => (items[index]?.type === "section" ? SECTION_HEIGHT : rowHeight), [items, rowHeight]);
  const keyOf = useCallback((index: number) => items[index]?.key ?? index, [items]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: sizeOf,
    getItemKey: keyOf,
    overscan: OVERSCAN,
    initialRect: INITIAL_RECT,
  });

  // the sizes are fixed per row height: if it changes while the list is mounted (a screen that crosses the phone's width) the offsets are worked out again
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  // C2.6: a shortcut (Alt+↓) can open a chat that is outside the window: the selected row is brought into view, and only when it is not already
  useEffect(() => {
    if (!selectedId) return;
    const index = items.findIndex((item) => item.type === "row" && item.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
    // the list is scrolled to the selection when the selection moves, not when the rows change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const move = useCallback(
    (from: number, step: 1 | -1) => {
      let next = from + step;
      while (next >= 0 && next < items.length && items[next]!.type !== "row") next += step;
      if (next < 0 || next >= items.length) return;
      virtualizer.scrollToIndex(next);
      // the row may not exist yet (it was outside the window): focus it once it has been drawn
      requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${next}"] [data-row-link]`)?.focus()));
    },
    [items, virtualizer],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    // only from a row's own link: the «⋮» beside it is a menu button, and the arrows belong to its menu
    const target = event.target as HTMLElement;
    if (!target.closest<HTMLElement>("[data-row-link]")) return;
    const holder = target.closest<HTMLElement>("[data-row-index]");
    if (!holder) return;
    event.preventDefault();
    move(Number(holder.dataset["rowIndex"]), event.key === "ArrowDown" ? 1 : -1);
  };

  return (
    <div ref={scrollRef} onKeyDown={onKeyDown} data-chat-rows="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="list" aria-label={label}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const item = items[virtual.index];
          if (!item) return null;
          return (
            <div
              key={virtual.key}
              role="listitem"
              data-row-index={virtual.index}
              className="absolute start-0 top-0 w-full"
              style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
            >
              {item.type === "section" ? (
                <div className="flex h-full items-center border-b border-border/60 px-3 text-xs font-semibold text-fg-muted">{ct("chath.archived", { n: item.count })}</div>
              ) : (
                <ChatRowItem id={item.id} selected={selectedId === item.id} tall={tall} userId={userId} menu={menu} day={day} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
