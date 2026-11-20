"use client";

import { useContext, useEffect, useRef } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { openSavedId, type ListWithSaved } from "@/lib/chat/v2/menu/menu-context";
import { shortcutBridge, type ChatListEntry, type ListSource, type PaneSource } from "@/lib/chat/v2/menu/shortcut-bridge";

/**
 * C2.6 — THE KEYBOARD of the new chat screen (computer, from the `md` width). ONE module: the map from a key press to an action (`shortcutOf`, pure), the
 * rules that act on it (`runShortcut`, pure: everything it touches is handed in), and the hook the chat shell mounts once (`useChatShortcuts`).
 *
 *   Alt+↑ / Alt+↓                the previous / next chat of the list
 *   Alt+Shift+↑ / Alt+Shift+↓    the previous / next UNREAD chat
 *   Ctrl+1 … Ctrl+9              folder 1 … 9 of the list
 *   Ctrl+F                       search in the open conversation (the list's search when the list has the focus)
 *   Esc                          close the panel, then the search, then back to the list
 *   Ctrl+Shift+?                 the sheet that lists them
 *
 *   Ctrl+0                       «الرسائل المحفوظة» (C3a.3): opens the person's own saved chat (made on first use). C3w.2 folded it into the map: `shortcutOf` answers
 *                                `{ type: "saved" }` and the sheet lists it (`SHEET_ROWS`: the eight below and this one)
 *
 * NOT here: Ctrl+B / I / U / K, Ctrl+Shift+X / M (formatting) are C3's; «↑ edits my last message» and Esc of a reply or an edit
 * are the composer's (C2.5); Ctrl+K stays the app's palette. The command key (Mac) is never used: a person on a Mac has the browser's own.
 *
 * ⚠️ Esc leaves the conversation only when nothing else wants it: it does nothing while a field has the focus (the composer's Esc cancels a reply or an
 * edit), while a dialog or a menu is open (it closes itself), or when the key was already handled.
 */
export type ShortcutAction =
  | { type: "chat"; step: 1 | -1; unread: boolean }
  | { type: "folder"; index: number }
  | { type: "search" }
  | { type: "escape" }
  | { type: "sheet" }
  | { type: "saved" };

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

const DIGIT = /^(?:Digit|Numpad)([1-9])$/;

/** Which action a key press is, or null. By the PHYSICAL key (`code`) for letters and digits, so an Arabic layout works the same. */
export function shortcutOf(e: KeyEventLike): ShortcutAction | null {
  if (e.metaKey || e.isComposing || e.defaultPrevented) return null;
  if (e.altKey && !e.ctrlKey) {
    if (e.key === "ArrowUp") return { type: "chat", step: -1, unread: e.shiftKey };
    if (e.key === "ArrowDown") return { type: "chat", step: 1, unread: e.shiftKey };
    return null;
  }
  if (e.ctrlKey && !e.altKey) {
    if (e.shiftKey) {
      return e.code === "Slash" || e.key === "?" || e.key === "؟" ? { type: "sheet" } : null;
    }
    if (savedShortcutOf(e)) return { type: "saved" };
    const digit = DIGIT.exec(e.code);
    if (digit) return { type: "folder", index: Number(digit[1]) - 1 };
    if (e.code === "KeyF") return { type: "search" };
    return null;
  }
  if (!e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "Escape") return { type: "escape" };
  return null;
}

/**
 * C3a.3 — Ctrl+0 is «المحفوظة». By the PHYSICAL key (`Digit0` / `Numpad0`), so an Arabic layout works the same; never with Alt, Shift or the command key.
 * Its row for the sheet is `SAVED_SHORTCUT` (the last of `SHEET_ROWS`).
 */
export function savedShortcutOf(e: KeyEventLike): boolean {
  if (e.metaKey || e.isComposing || e.defaultPrevented) return false;
  return e.ctrlKey && !e.altKey && !e.shiftKey && (e.code === "Digit0" || e.code === "Numpad0");
}
export const SAVED_SHORTCUT: ShortcutRow = { id: "saved", keys: ["ctrl", "0"], labelKey: "chatsaved.keys.open" };

/**
 * C4.1 — Ctrl+, (comma) opens «إعداداتي» from anywhere in the app. By the PHYSICAL key (`Comma`), so an Arabic layout works the same; never with Alt, Shift or the
 * command key, and never while an input method is composing. It is NOT a row of the chat sheet (it opens a page, not a chat action): «إعداداتي» lists it in its own «الاختصارات».
 */
export function settingsShortcutOf(e: KeyEventLike): boolean {
  if (e.metaKey || e.isComposing || e.defaultPrevented) return false;
  return e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "Comma";
}
export const SETTINGS_SHORTCUT = { id: "settings", keys: ["ctrl", "comma"], labelKey: "settingsMe.k.settings" } as const;

/** Opens (or makes) the person's saved chat through the dm door and hands its id to `open`. Nothing happens when the door refuses (the switch is off). */
export async function openSavedChat(open: (conversationId: string) => void, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const id = await openSavedId(fetchImpl);
  if (!id) return false;
  open(id);
  return true;
}

/** The chat after / before the open one, or null at the ends (no wrap). With none open (or one not in this list) the first / last row. `unreadOnly` skips what is read. */
export function neighbourChat(entries: readonly ChatListEntry[], currentId: string | null, step: 1 | -1, unreadOnly: boolean): string | null {
  const at = currentId === null ? -1 : entries.findIndex((entry) => entry.id === currentId);
  let i = at < 0 ? (step === 1 ? -1 : entries.length) : at;
  for (i += step; i >= 0 && i < entries.length; i += step) {
    const entry = entries[i]!;
    if (entry.id !== currentId && (!unreadOnly || entry.unread)) return entry.id;
  }
  return null;
}

export function escapeStep(s: { editable: boolean; overlayOpen: boolean; infoOpen: boolean; searchOpen: boolean; conversationOpen: boolean }): "info" | "search" | "list" | null {
  if (s.editable || s.overlayOpen) return null;
  if (s.infoOpen) return "info";
  if (s.searchOpen) return "search";
  return s.conversationOpen ? "list" : null;
}

export interface ShortcutDeps {
  /** the conversation the address says is open */
  currentId: string | null;
  list: ListSource | null;
  pane: PaneSource | null;
  /** the focus is inside the list column */
  listHasFocus: boolean;
  /** the focus is in a text field */
  editable: boolean;
  /** a dialog, a sheet or a menu is open */
  overlayOpen: boolean;
  open: (conversationId: string) => void;
  toList: () => void;
  focusListSearch: () => void;
  openSheet: () => void;
  /** Ctrl+0: opens (or makes) the saved chat; false when the key is not ours to take (the company's switch is off, a guest): the browser keeps it */
  openSaved: () => boolean;
}

/** Does what the action says. True when the key was ours (the caller then stops the browser's own meaning of it). */
export function runShortcut(action: ShortcutAction, d: ShortcutDeps): boolean {
  if (action.type === "sheet") {
    d.openSheet();
    return true;
  }
  if (d.overlayOpen) return false;
  switch (action.type) {
    case "saved":
      return d.openSaved();
    case "chat": {
      if (!d.list) return false;
      const next = neighbourChat(d.list.entries(), d.currentId, action.step, action.unread);
      if (next) d.open(next);
      return true;
    }
    case "folder": {
      if (!d.list || action.index >= d.list.folderCount()) return false;
      d.list.selectFolder(action.index);
      return true;
    }
    case "search": {
      if (d.pane && !d.listHasFocus) d.pane.openSearch();
      else d.focusListSearch();
      return true;
    }
    case "escape": {
      const step = escapeStep({ editable: d.editable, overlayOpen: d.overlayOpen, infoOpen: d.pane?.infoOpen() ?? false, searchOpen: d.pane?.searchOpen() ?? false, conversationOpen: d.currentId !== null });
      if (step === "info") d.pane?.closeInfo();
      else if (step === "search") d.pane?.closeSearch();
      else if (step === "list") d.toList();
      else return false;
      return true;
    }
  }
}

/** The sheet's rows, in the order they are listed: the keys (named for the sheet) and the dictionary key of what they do. C4 lists the same table in the settings. */
export type KeyName = "ctrl" | "alt" | "shift" | "esc" | "up" | "down" | "digits" | "f" | "question" | "0";
export interface ShortcutRow {
  id: string;
  keys: KeyName[];
  labelKey: string;
}
export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  { id: "prev", keys: ["alt", "up"], labelKey: "chatui.keys.prev" },
  { id: "next", keys: ["alt", "down"], labelKey: "chatui.keys.next" },
  { id: "prevUnread", keys: ["alt", "shift", "up"], labelKey: "chatui.keys.prev_unread" },
  { id: "nextUnread", keys: ["alt", "shift", "down"], labelKey: "chatui.keys.next_unread" },
  { id: "folders", keys: ["ctrl", "digits"], labelKey: "chatui.keys.folders" },
  { id: "search", keys: ["ctrl", "f"], labelKey: "chatui.keys.search" },
  { id: "escape", keys: ["esc"], labelKey: "chatui.keys.escape" },
  { id: "sheet", keys: ["ctrl", "shift", "question"], labelKey: "chatui.keys.sheet" },
];

/**
 * What the chat sheet lists: the eight rows of C2.6 and Ctrl+0. `SHORTCUT_ROWS` stays the eight (the table «إعداداتي» lists beside `SAVED_SHORTCUT` and `SETTINGS_SHORTCUT`, which it
 * adds itself); once that screen stops adding the saved row, the row moves into `SHORTCUT_ROWS` and this is the same list.
 */
export const SHEET_ROWS: readonly ShortcutRow[] = [...SHORTCUT_ROWS, SAVED_SHORTCUT];

const isEditable = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable === true || /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};
const overlayIsOpen = (): boolean =>
  document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper]') !== null;

/**
 * Mounted once by the chat shell. `enabled` is false on a phone (no keyboard), so nothing listens there. The handler reads the CURRENT list and pane from
 * the bridge on every key, so it never holds a stale one.
 */
export function useChatShortcuts(opts: { enabled: boolean; currentId: string | null; open: (conversationId: string) => void; toList: () => void; openSheet: () => void }): void {
  const live = useRef(opts);
  live.current = opts;
  const { enabled } = opts;
  // Ctrl+0 reads the company's switch from the cached list (a render with no query client has none: the server decides)
  const queries = useContext(QueryClientContext);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutOf(event);
      if (!action) return;
      const o = live.current;
      const handled = runShortcut(action, {
        currentId: o.currentId,
        list: shortcutBridge.list(),
        pane: shortcutBridge.pane(),
        listHasFocus: (document.activeElement as HTMLElement | null)?.closest?.("[data-chat-list]") != null,
        editable: isEditable(event.target),
        overlayOpen: overlayIsOpen(),
        open: o.open,
        toList: o.toList,
        focusListSearch: () => {
          const field = document.querySelector<HTMLInputElement>('[data-chat-list] input[type="search"]');
          field?.focus();
          field?.select();
        },
        openSheet: o.openSheet,
        // Ctrl+0: a company that switched «المحفوظة» off, or a guest, leaves the browser's own meaning of the key alone (the cached list says `saved: false`); a held key asks once
        openSaved: () => {
          const list = queries?.getQueryData<ListWithSaved>(chatKeys.list());
          if (list && list.saved === false) return false;
          if (!event.repeat) void openSavedChat(o.open);
          return true;
        },
      });
      if (handled) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, queries]);
}
