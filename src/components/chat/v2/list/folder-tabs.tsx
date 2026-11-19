"use client";

import React, { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chatPrefsQueryOptions, saveChatPrefs, type ChatPrefsDto } from "@/lib/chat/cache/queries";
import { foldersOfOrg, resolveChatPrefs, type BuiltinTab, type ChatFolderDef, type ChatPrefsPatch } from "@/lib/chat/prefs";
import { customIdOf } from "@/lib/chat/folders";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * A tab of the strip: a built-in folder (its words are a key of the dictionary) or one of the person's own (`label` is the name they typed, `emoji` their
 * picture). Both are plain text on screen.
 */
export interface TabItem<K extends string = string> {
  key: K;
  labelKey?: string;
  label?: string;
  emoji?: string | null;
}

/**
 * C2.2 — the folders on top of the list: «الكل · غير مقروء · خاص · المساحات · ذكروني» (and «كل الشركة» for the people who hold the silent oversight), each
 * with the number of chats waiting in it. C3a.2: the person's own folders follow the built-in ones (a built-in tab they hid is simply not in `folders`).
 * A strip you can scroll sideways when the column is narrow; the folder you are in is underlined with the accent. The tabs themselves are pure functions
 * (`src/lib/chat/list-folders.ts`, `src/lib/chat/folders.ts`), this only draws them.
 */
export function FolderTabs<K extends string>({
  folders,
  active,
  badges,
  onChange,
}: {
  folders: readonly TabItem<K>[];
  active: K;
  badges: Partial<Record<K, number>>;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" aria-label={ct("chatui.folders.label")} data-chat-folders="" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2">
      {folders.map((folder) => {
        const on = folder.key === active;
        const badge = badges[folder.key] ?? 0;
        const custom = customIdOf(folder.key) !== null;
        return (
          <button
            key={folder.key}
            type="button"
            role="tab"
            aria-selected={on}
            data-folder={folder.key}
            {...(custom ? { "data-folder-custom": "" } : {})}
            onClick={() => onChange(folder.key)}
            className={cn(
              "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              on ? "font-semibold text-accent after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-fg-muted hover:text-fg",
            )}
          >
            {folder.emoji ? <span aria-hidden="true">{folder.emoji}</span> : null}
            <span className={cn(custom && "max-w-32 truncate")}>{folder.label ?? (folder.labelKey ? ct(folder.labelKey) : folder.key)}</span>
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

// ───────────────────────────────────────── the person's prefs ─────────────────────────────────────────

const NO_FOLDERS: ChatFolderDef[] = [];
const NO_HIDDEN: BuiltinTab[] = [];

/**
 * C3a.2 — the person's own folders and hidden tabs (`GET /api/me/chat-prefs`, kept five minutes like the saved order of the list). Until it has answered, and
 * while the company's switch `chatFolders` is off, there are no folders and no hidden tab: the strip is the five built-in tabs of today, and a failed read
 * leaves it so. `orgId` is the company the folders are keyed by (the editor saves under it).
 */
export function useChatPrefs(enabled = true) {
  const query = useQuery({ ...chatPrefsQueryOptions(), enabled });
  const data: ChatPrefsDto | undefined = query.data;
  return useMemo(() => {
    if (!data || !data.foldersOn) return { loaded: !!data, foldersOn: false, orgId: data?.orgId ?? null, folders: NO_FOLDERS, hidden: NO_HIDDEN };
    const resolved = resolveChatPrefs(data.prefs);
    return { loaded: true, foldersOn: true, orgId: data.orgId, folders: foldersOfOrg(data.prefs, data.orgId), hidden: resolved.tabs.hidden };
  }, [data]);
}

/** The one place the screen saves a patch of the prefs; it throws an `ApiError` when the server said no. */
export function useSaveChatPrefs(): (patch: ChatPrefsPatch) => Promise<ChatPrefsDto> {
  const qc = useQueryClient();
  return useCallback((patch) => saveChatPrefs(qc, patch), [qc]);
}
