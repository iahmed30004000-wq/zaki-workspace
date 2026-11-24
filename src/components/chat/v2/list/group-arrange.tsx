"use client";

import React from "react";
import { Grip, SortableItem, SortableList } from "@/components/shell/nav-sort";
import { ct } from "@/lib/chat/text";
import { GroupFace } from "./group-face";

/**
 * «ترتيب» — dragging the groups of a space, or the topics inside one group: a plain sortable list (the grip, or the keyboard: Space lifts, the arrows move) with the picture and
 * the name of each. It draws no unread and no preview: it is the arrangement, not the chat. `onReorder` hands back the ids in their new order; the caller saves them.
 */
export interface ArrangeEntry {
  id: string;
  label: string;
  emoji: string | null;
  imageUrl?: string | null;
}

export function ArrangeRows({ listId, entries, onReorder }: { listId: string; entries: readonly ArrangeEntry[]; onReorder: (ids: string[]) => void }) {
  return (
    <div data-arrange-rows="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <p className="px-4 py-2 text-xs text-fg-muted">{ct("chatgrp.arrange_hint")}</p>
      <SortableList id={listId} entries={entries.map((e) => ({ id: e.id, label: e.label }))} axis="vertical" onReorder={onReorder}>
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <SortableItem key={entry.id} id={entry.id} className="list-none border-b border-border/60 bg-surface">
              {({ props }) => (
                <div data-arrange-id={entry.id} className="flex min-h-14 items-center gap-2 px-2">
                  <Grip handle={{ ...props, "data-arrange-grip": "" }} label={entry.label} />
                  <GroupFace emoji={entry.emoji} imageUrl={entry.imageUrl ?? null} fallback="📁" className="size-10 text-lg" />
                  <span className="min-w-0 flex-1 truncate text-base font-medium text-fg">
                    <bdi>{entry.label}</bdi>
                  </span>
                </div>
              )}
            </SortableItem>
          ))}
        </ul>
      </SortableList>
    </div>
  );
}
