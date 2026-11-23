"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chatPrefsQueryOptions, saveChatPrefs, type ChatPrefsDto } from "@/lib/chat/cache/queries";
import { foldersOfOrg, resolveChatPrefs, type BuiltinTab, type ChatFolderDef, type ChatPrefsPatch } from "@/lib/chat/prefs";
import { customIdOf } from "@/lib/chat/folders";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { Archive, AtSign, Building2, Folder, MailOpen, MessagesSquare, Plus, User, Users, type LucideIcon } from "lucide-react";
import { useRowMenuGestures } from "./long-press";

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
 * S5.3 — what the strip and the column need to make folders from inside the chat. `onAdd` draws a «+» AFTER the last tab (the company's switch `chatFolders` and
 * the prefs decide whether the screen passes it; without it the strip is exactly what it was); `onManage` is asked for one of the person's OWN tabs when it is
 * long-pressed (a finger held half a second) or right-clicked, with the tab's box so the menu can sit under it. The built-in tabs have no menu.
 */
export interface FolderStripExtras<K extends string> {
  onAdd?: () => void;
  /** the ten folders are used up: the «+» is drawn off and says why */
  addDisabled?: boolean;
  onManage?: (key: K, anchor: DOMRect) => void;
}

/** The gestures of one tab: only a tab of the person's own folders answers a long press or a right click, and only when the screen asked for it. */
function useTabGestures<K extends string>(key: K, custom: boolean, onManage: FolderStripExtras<K>["onManage"]) {
  const ref = useRef<HTMLButtonElement>(null);
  const open = () => {
    if (ref.current && onManage) onManage(key, ref.current.getBoundingClientRect());
  };
  const gestures = useRowMenuGestures(open, custom && !!onManage);
  return { ref, gestures };
}

function AddTab({ onAdd, disabled, rail }: { onAdd: () => void; disabled: boolean | undefined; rail: boolean }) {
  return (
    <button
      type="button"
      data-folder-add-tab=""
      aria-label={ct("chatfolders.add_tab")}
      title={ct(disabled ? "chatfolders.add_full" : "chatfolders.add_tab")}
      disabled={disabled === true}
      onClick={onAdd}
      className={cn(
        "grid shrink-0 place-items-center text-fg-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        rail ? "mx-auto my-1 size-11 rounded-xl hover:bg-surface-2" : "min-h-11 min-w-11 px-2",
      )}
    >
      <Plus aria-hidden="true" className="size-5" />
    </button>
  );
}

function StripTab<K extends string>({ folder, on, badge, onChange, onManage }: { folder: TabItem<K>; on: boolean; badge: number; onChange: (key: K) => void; onManage: FolderStripExtras<K>["onManage"] }) {
  const custom = customIdOf(folder.key) !== null;
  const { ref, gestures } = useTabGestures(folder.key, custom, onManage);
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={on}
      data-folder={folder.key}
      {...(custom ? { "data-folder-custom": "" } : {})}
      onClick={() => onChange(folder.key)}
      {...gestures}
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
}

/**
 * C2.2 — the folders on top of the list: «الكل · غير مقروء · خاص · المساحات · ذكروني» (and «كل الشركة» for the people who hold the silent oversight), each
 * with the number of chats waiting in it. C3a.2: the person's own folders follow the built-in ones (a built-in tab they hid is not in `folders`).
 * A strip you can scroll sideways when the column is narrow; the folder you are in is underlined with the accent. The tabs themselves are pure functions
 * (`src/lib/chat/list-folders.ts`, `src/lib/chat/folders.ts`), this only draws them. S5.3: with `onAdd` a «+» ends the strip.
 */
export function FolderTabs<K extends string>({
  folders,
  active,
  badges,
  onChange,
  onAdd,
  addDisabled,
  onManage,
}: {
  folders: readonly TabItem<K>[];
  active: K;
  badges: Partial<Record<K, number>>;
  onChange: (key: K) => void;
} & FolderStripExtras<K>) {
  // the tab you are in is brought into view when the strip is longer than the screen (a folder of your own sits at the far end)
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [active]);
  const strip = (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={ct("chatui.folders.label")}
      data-chat-folders=""
      className={cn("flex gap-1 overflow-x-auto px-2", onAdd ? "min-w-0 flex-1" : "shrink-0 border-b border-border")}
    >
      {folders.map((folder) => (
        <StripTab key={folder.key} folder={folder} on={folder.key === active} badge={badges[folder.key] ?? 0} onChange={onChange} onManage={onManage} />
      ))}
    </div>
  );
  if (!onAdd) return strip;
  return (
    <div data-chat-folders-bar="" className="flex shrink-0 items-stretch border-b border-border">
      {strip}
      <AddTab onAdd={onAdd} disabled={addDisabled} rail={false} />
    </div>
  );
}

/** The picture of a built-in folder in the rail (a folder of the person's own shows its emoji, or a plain folder). */
const RAIL_ICONS: Record<string, LucideIcon> = { all: MessagesSquare, unread: MailOpen, dm: User, spaces: Users, mentions: AtSign, archived: Archive, company: Building2 };

function RailTab<K extends string>({ folder, on, badge, onChange, onManage }: { folder: TabItem<K>; on: boolean; badge: number; onChange: (key: K) => void; onManage: FolderStripExtras<K>["onManage"] }) {
  const custom = customIdOf(folder.key) !== null;
  const { ref, gestures } = useTabGestures(folder.key, custom, onManage);
  const Icon = RAIL_ICONS[folder.key] ?? Folder;
  const name = folder.label ?? (folder.labelKey ? ct(folder.labelKey) : folder.key);
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={on}
      aria-label={name}
      data-folder={folder.key}
      {...(custom ? { "data-folder-custom": "" } : {})}
      onClick={() => onChange(folder.key)}
      {...gestures}
      className={cn(
        "relative flex w-16 shrink-0 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-xs font-semibold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        on ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {folder.emoji ? <span aria-hidden="true" className="flex size-7 items-center justify-center text-2xl leading-none">{folder.emoji}</span> : <Icon aria-hidden="true" className="size-7" strokeWidth={1.75} />}
      <span className="max-w-full truncate">{name}</span>
      {badge > 0 ? (
        <span data-folder-badge="" className="absolute end-1.5 top-1 min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 tabular-nums text-accent-fg">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The folders as a column beside the list (the desktop; the phone keeps the strip on top): the picture of the folder over its name, the number of chats
 * waiting in a round badge, the folder you are in tinted with the accent. The same folders, badges and `onChange` as the strip; with `onAdd` a «+» ends the column.
 */
export function FolderRail<K extends string>({
  folders,
  active,
  badges,
  onChange,
  onAdd,
  addDisabled,
  onManage,
}: {
  folders: readonly TabItem<K>[];
  active: K;
  badges: Partial<Record<K, number>>;
  onChange: (key: K) => void;
} & FolderStripExtras<K>) {
  const column = (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={ct("chatui.folders.label")}
      data-chat-folder-rail=""
      className={cn("flex w-[72px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto bg-surface-1 py-2", onAdd ? "min-h-0 flex-1" : "border-e border-border")}
    >
      {folders.map((folder) => (
        <RailTab key={folder.key} folder={folder} on={folder.key === active} badge={badges[folder.key] ?? 0} onChange={onChange} onManage={onManage} />
      ))}
    </div>
  );
  if (!onAdd) return column;
  return (
    <div data-chat-folder-rail-bar="" className="flex w-[72px] shrink-0 flex-col border-e border-border bg-surface-1">
      {column}
      <AddTab onAdd={onAdd} disabled={addDisabled} rail />
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
