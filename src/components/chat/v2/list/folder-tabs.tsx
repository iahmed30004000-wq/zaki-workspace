"use client";

import React from "react";
import type { ListFolder, ListFolderKey } from "@/lib/chat/list-folders";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * C2.2 — the folders on top of the list: «الكل · غير مقروء · خاص · المساحات · ذكروني» (and «كل الشركة» for the people who hold the silent oversight), each
 * with the number of chats waiting in it. A strip you can scroll sideways when the column is narrow; the folder you are in is underlined with the
 * accent. The folders themselves are a pure function (`src/lib/chat/list-folders.ts`), this only draws them.
 */
export function FolderTabs({
  folders,
  active,
  badges,
  onChange,
}: {
  folders: readonly ListFolder[];
  active: ListFolderKey;
  badges: Partial<Record<ListFolderKey, number>>;
  onChange: (key: ListFolderKey) => void;
}) {
  return (
    <div role="tablist" aria-label={ct("chatui.folders.label")} data-chat-folders="" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2">
      {folders.map((folder) => {
        const on = folder.key === active;
        const badge = badges[folder.key] ?? 0;
        return (
          <button
            key={folder.key}
            type="button"
            role="tab"
            aria-selected={on}
            data-folder={folder.key}
            onClick={() => onChange(folder.key)}
            className={cn(
              "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              on ? "font-semibold text-accent after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-fg-muted hover:text-fg",
            )}
          >
            {ct(folder.labelKey)}
            {badge > 0 ? (
              <span data-folder-badge="" className={cn("min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5 tabular-nums", on ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted")}>
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
