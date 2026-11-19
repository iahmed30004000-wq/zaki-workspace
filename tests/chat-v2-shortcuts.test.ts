import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { ShortcutsSheet } from "@/components/chat/v2/menu/shortcuts-sheet";
import {
  SHORTCUT_ROWS,
  escapeStep,
  neighbourChat,
  runShortcut,
  shortcutOf,
  type KeyEventLike,
  type ShortcutDeps,
} from "@/lib/chat/shortcuts";
import { shortcutBridge } from "@/lib/chat/v2/menu/shortcut-bridge";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

/**
 * C2.6 — the keyboard of the new chat screen: ONE module (`src/lib/chat/shortcuts.ts`: a pure map, the rules that act on it, and the hook the shell mounts).
 * Alt+↑/↓ the previous / next chat, Alt+Shift+↑/↓ the previous / next UNREAD chat, Ctrl+1…9 the folders, Ctrl+F search (the open conversation, or the list when the
 * list has the focus), Esc closes the panel or goes back to the list, Ctrl+Shift+? the sheet that lists them. Ctrl+0 (saved messages) and Ctrl+B/I/U/K
 * (formatting) are C3: NOT registered. The ↑ that edits my last message and Esc of a reply or an edit are the composer's (C2.5).
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const key = (over: Partial<KeyEventLike>): KeyEventLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

describe("the map: which key is which action", () => {
  it("Alt+↑ / Alt+↓ are the previous / next chat; with Shift the previous / next UNREAD one", () => {
    expect(shortcutOf(key({ key: "ArrowUp", altKey: true }))).toEqual({ type: "chat", step: -1, unread: false });
    expect(shortcutOf(key({ key: "ArrowDown", altKey: true }))).toEqual({ type: "chat", step: 1, unread: false });
    expect(shortcutOf(key({ key: "ArrowUp", altKey: true, shiftKey: true }))).toEqual({ type: "chat", step: -1, unread: true });
    expect(shortcutOf(key({ key: "ArrowDown", altKey: true, shiftKey: true }))).toEqual({ type: "chat", step: 1, unread: true });
  });

  it("Ctrl+1 … Ctrl+9 are the folders (by the physical key, so an Arabic keyboard works), Ctrl+0 is not (saved messages are C3)", () => {
    for (let n = 1; n <= 9; n++) expect(shortcutOf(key({ code: `Digit${n}`, key: String(n), ctrlKey: true }))).toEqual({ type: "folder", index: n - 1 });
    expect(shortcutOf(key({ code: "Digit1", key: "١", ctrlKey: true }))).toEqual({ type: "folder", index: 0 });
    expect(shortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true }))).toBeNull();
  });

  it("Ctrl+F is the search (on any keyboard layout); Ctrl+Shift+F is not", () => {
    expect(shortcutOf(key({ code: "KeyF", key: "f", ctrlKey: true }))).toEqual({ type: "search" });
    expect(shortcutOf(key({ code: "KeyF", key: "ب", ctrlKey: true }))).toEqual({ type: "search" });
    expect(shortcutOf(key({ code: "KeyF", key: "F", ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("Esc alone is the escape; Ctrl+Shift+? (any layout) opens the sheet", () => {
    expect(shortcutOf(key({ key: "Escape", code: "Escape" }))).toEqual({ type: "escape" });
    expect(shortcutOf(key({ key: "Escape", shiftKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }))).toEqual({ type: "sheet" });
    expect(shortcutOf(key({ key: "؟", code: "KeyZ", ctrlKey: true, shiftKey: true }))).toEqual({ type: "sheet" });
    expect(shortcutOf(key({ key: "/", code: "Slash", ctrlKey: true }))).toBeNull();
  });

  it("Ctrl+B / I / U / K and Ctrl+Shift+X / M are C3's: NOT registered here (Ctrl+K stays the app's palette)", () => {
    for (const letter of ["B", "I", "U", "K"]) expect(shortcutOf(key({ code: `Key${letter}`, key: letter.toLowerCase(), ctrlKey: true })), letter).toBeNull();
    for (const letter of ["X", "M"]) expect(shortcutOf(key({ code: `Key${letter}`, key: letter, ctrlKey: true, shiftKey: true })), letter).toBeNull();
  });

  it("the command key (Mac), a combined Ctrl+Alt, a key being composed, and plain arrows are never shortcuts", () => {
    expect(shortcutOf(key({ code: "KeyF", key: "f", metaKey: true }))).toBeNull();
    expect(shortcutOf(key({ code: "Digit1", key: "1", metaKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "ArrowDown", altKey: true, ctrlKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "ArrowDown", altKey: true, isComposing: true }))).toBeNull();
    expect(shortcutOf(key({ key: "ArrowDown" }))).toBeNull();
    expect(shortcutOf(key({ key: "ArrowUp" }))).toBeNull();
  });

  it("a key somebody else already handled is left alone", () => {
    expect(shortcutOf(key({ key: "Escape", defaultPrevented: true }))).toBeNull();
  });
});

describe("the neighbour of the open chat", () => {
  const list = [
    { id: "a", unread: false },
    { id: "b", unread: true },
    { id: "c", unread: false },
    { id: "d", unread: true },
  ];

  it("next / previous move one row and stop at the ends (no wrap)", () => {
    expect(neighbourChat(list, "b", 1, false)).toBe("c");
    expect(neighbourChat(list, "b", -1, false)).toBe("a");
    expect(neighbourChat(list, "d", 1, false)).toBeNull();
    expect(neighbourChat(list, "a", -1, false)).toBeNull();
  });

  it("with no chat open (or one that is not in this list) the first / last row opens", () => {
    expect(neighbourChat(list, null, 1, false)).toBe("a");
    expect(neighbourChat(list, null, -1, false)).toBe("d");
    expect(neighbourChat(list, "zzz", 1, false)).toBe("a");
  });

  it("the unread ones skip what is read, in both directions, and never answer with the chat that is open", () => {
    expect(neighbourChat(list, "a", 1, true)).toBe("b");
    expect(neighbourChat(list, "b", 1, true)).toBe("d");
    expect(neighbourChat(list, "d", -1, true)).toBe("b");
    expect(neighbourChat(list, "d", 1, true)).toBeNull();
    expect(neighbourChat(list, "c", -1, true)).toBe("b");
    expect(neighbourChat(list, null, 1, true)).toBe("b");
  });

  it("an empty list has no neighbour", () => {
    expect(neighbourChat([], null, 1, false)).toBeNull();
    expect(neighbourChat([{ id: "a", unread: false }], "a", 1, true)).toBeNull();
  });
});

describe("Esc: close the panel, then the search, then go back to the list — never from inside a field or a dialog", () => {
  const base = { editable: false, overlayOpen: false, infoOpen: false, searchOpen: false, conversationOpen: true };
  it("closes the info panel first", () => expect(escapeStep({ ...base, infoOpen: true, searchOpen: true })).toBe("info"));
  it("then the search under the header", () => expect(escapeStep({ ...base, searchOpen: true })).toBe("search"));
  it("then goes back to the list, when a conversation is open", () => {
    expect(escapeStep(base)).toBe("list");
    expect(escapeStep({ ...base, conversationOpen: false })).toBeNull();
  });
  it("does nothing while a field has the focus (the composer's Esc is C2.5's: cancel the reply or the edit)", () => {
    expect(escapeStep({ ...base, editable: true, infoOpen: true })).toBeNull();
  });
  it("does nothing while a dialog or a menu is open (it closes itself)", () => {
    expect(escapeStep({ ...base, overlayOpen: true, infoOpen: true })).toBeNull();
  });
});

describe("running a shortcut", () => {
  const entries = [
    { id: "a", unread: false },
    { id: "b", unread: true },
    { id: "c", unread: false },
  ];
  function setup(over: Partial<ShortcutDeps> = {}) {
    const calls = { open: vi.fn(), toList: vi.fn(), focusListSearch: vi.fn(), openSheet: vi.fn(), selectFolder: vi.fn(), openSearch: vi.fn(), closeInfo: vi.fn(), closeSearch: vi.fn() };
    const deps: ShortcutDeps = {
      currentId: "a",
      list: { entries: () => entries, folderCount: () => 5, selectFolder: calls.selectFolder },
      pane: { conversationId: "a", openSearch: calls.openSearch, closeInfo: calls.closeInfo, closeSearch: calls.closeSearch, infoOpen: () => false, searchOpen: () => false },
      listHasFocus: false,
      editable: false,
      overlayOpen: false,
      open: calls.open,
      toList: calls.toList,
      focusListSearch: calls.focusListSearch,
      openSheet: calls.openSheet,
      ...over,
    };
    return { deps, calls };
  }

  it("Alt+↓ opens the next chat of the list; Alt+Shift+↓ the next unread one", () => {
    const { deps, calls } = setup();
    expect(runShortcut({ type: "chat", step: 1, unread: false }, deps)).toBe(true);
    expect(calls.open).toHaveBeenLastCalledWith("b");
    expect(runShortcut({ type: "chat", step: 1, unread: true }, deps)).toBe(true);
    expect(calls.open).toHaveBeenLastCalledWith("b");
  });

  it("at the end of the list it is still handled (the key is ours) but opens nothing", () => {
    const { deps, calls } = setup({ currentId: "c" });
    expect(runShortcut({ type: "chat", step: 1, unread: false }, deps)).toBe(true);
    expect(calls.open).not.toHaveBeenCalled();
  });

  it("without a list (the shell has none mounted) a chat key is not ours", () => {
    const { deps } = setup({ list: null });
    expect(runShortcut({ type: "chat", step: 1, unread: false }, deps)).toBe(false);
  });

  it("Ctrl+3 selects the third folder when there is one; Ctrl+9 with five folders does nothing", () => {
    const { deps, calls } = setup();
    expect(runShortcut({ type: "folder", index: 2 }, deps)).toBe(true);
    expect(calls.selectFolder).toHaveBeenCalledWith(2);
    expect(runShortcut({ type: "folder", index: 8 }, deps)).toBe(false);
    expect(calls.selectFolder).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+F searches the OPEN conversation (through the pane's openSearch), and the list when the list has the focus or no conversation is open", () => {
    const a = setup();
    expect(runShortcut({ type: "search" }, a.deps)).toBe(true);
    expect(a.calls.openSearch).toHaveBeenCalledTimes(1);
    expect(a.calls.focusListSearch).not.toHaveBeenCalled();
    const b = setup({ listHasFocus: true });
    runShortcut({ type: "search" }, b.deps);
    expect(b.calls.focusListSearch).toHaveBeenCalledTimes(1);
    expect(b.calls.openSearch).not.toHaveBeenCalled();
    const c = setup({ pane: null });
    runShortcut({ type: "search" }, c.deps);
    expect(c.calls.focusListSearch).toHaveBeenCalledTimes(1);
  });

  it("Esc closes the panel, else the search, else goes back to the list", () => {
    const a = setup({ pane: { conversationId: "a", openSearch: vi.fn(), closeInfo: vi.fn(), closeSearch: vi.fn(), infoOpen: () => true, searchOpen: () => false } });
    expect(runShortcut({ type: "escape" }, a.deps)).toBe(true);
    expect(a.deps.pane!.closeInfo).toHaveBeenCalledTimes(1);
    const b = setup({ pane: { conversationId: "a", openSearch: vi.fn(), closeInfo: vi.fn(), closeSearch: vi.fn(), infoOpen: () => false, searchOpen: () => true } });
    runShortcut({ type: "escape" }, b.deps);
    expect(b.deps.pane!.closeSearch).toHaveBeenCalledTimes(1);
    const c = setup();
    expect(runShortcut({ type: "escape" }, c.deps)).toBe(true);
    expect(c.calls.toList).toHaveBeenCalledTimes(1);
    const d = setup({ editable: true });
    expect(runShortcut({ type: "escape" }, d.deps)).toBe(false);
    expect(d.calls.toList).not.toHaveBeenCalled();
  });

  it("the sheet opens from anywhere; while a dialog is open nothing else is ours", () => {
    const { deps, calls } = setup({ overlayOpen: true });
    expect(runShortcut({ type: "chat", step: 1, unread: false }, deps)).toBe(false);
    expect(runShortcut({ type: "search" }, deps)).toBe(false);
    expect(runShortcut({ type: "sheet" }, deps)).toBe(true);
    expect(calls.openSheet).toHaveBeenCalledTimes(1);
  });
});

describe("the bridge: the list and the pane tell the shell what they hold", () => {
  it("a source is there while registered and gone after its own unregister; a later source is not removed by an older one's cleanup", () => {
    const first = { entries: () => [], folderCount: () => 1, selectFolder: () => undefined };
    const second = { entries: () => [{ id: "x", unread: false }], folderCount: () => 2, selectFolder: () => undefined };
    const offFirst = shortcutBridge.setList(first);
    expect(shortcutBridge.list()).toBe(first);
    const offSecond = shortcutBridge.setList(second);
    offFirst();
    expect(shortcutBridge.list()).toBe(second);
    offSecond();
    expect(shortcutBridge.list()).toBeNull();
  });
});

describe("the sheet that lists them", () => {
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ShortcutsSheet, { open: true, onOpenChange: () => undefined, portal: false })));

  it("lists every registered shortcut with its words from the dictionary", () => {
    expect(SHORTCUT_ROWS.length).toBe(8);
    for (const row of SHORTCUT_ROWS) {
      expect(AR[row.labelKey], row.labelKey).toMatch(/[؀-ۿ]/);
      expect(html).toContain(AR[row.labelKey]!);
    }
    expect(html).toContain(AR["chatui.keys.title"]!);
  });

  it("only «Ctrl» and «Esc» are Latin: Alt, Shift and Enter are written «ألت», «شيفت», «إنتر» and the arrows are ↑ ↓", () => {
    const text = html.replace(/<[^>]*>/g, " ");
    const latin = text.replace(/\bCtrl\b/g, " ").replace(/\bEsc\b/g, " ").match(/[A-Za-z]{2,}/g) ?? [];
    expect(latin).toEqual([]);
    expect(html).toContain("Ctrl");
    expect(html).toContain("Esc");
    expect(html).toContain(AR["chatui.keys.alt"]!);
    expect(html).toContain(AR["chatui.keys.shift"]!);
    expect(AR["chatui.keys.alt"]).toBe("ألت");
    expect(AR["chatui.keys.shift"]).toBe("شيفت");
    expect(html).toContain("↑");
    expect(html).toContain("↓");
    expect(text).not.toMatch(/\b(?:Alt|Shift|Enter|Return|Del|Tab)\b/);
  });

  it("is drawn with theme tokens and logical sides only", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    expect(html).not.toMatch(/\b(?:ml|mr|pl|pr|text-left|text-right)-/);
  });

  it("does not list what is not registered (saved messages, formatting)", () => {
    expect(html).not.toContain("Ctrl + 0");
    expect(html).not.toMatch(/\bB\b|\bI\b|\bU\b|\bK\b/);
  });
});

describe("the hook is mounted once, from the shell, and the on-screen rules hold in the source", () => {
  it("the shell mounts the hook and the sheet; nothing else registers a document-level key listener for the chat", () => {
    const shell = read("src/components/chat/v2/shell/chat-shell.tsx");
    expect(shell).toContain("useChatShortcuts(");
    expect(shell).toContain("<ShortcutsSheet");
    const hook = read("src/lib/chat/shortcuts.ts");
    expect(hook).toContain('document.addEventListener("keydown"');
    expect(hook).toContain('document.removeEventListener("keydown"');
  });

  it("the keys are registered only on the computer (from the `md` width), never on the phone", () => {
    expect(read("src/components/chat/v2/shell/chat-shell.tsx")).toMatch(/useChatShortcuts\(\{[^}]*enabled: desktop === true/);
  });

  it("the list and the pane register themselves (the list column for the order and the folders, the menu host for the search and the panel)", () => {
    expect(read("src/components/chat/v2/list/chat-list-column.tsx")).toContain("shortcutBridge.setList(");
    expect(read("src/components/chat/v2/pane/seams/menu-host.tsx")).toContain("<ShortcutPane");
    expect(read("src/components/chat/v2/menu/shortcut-pane.tsx")).toContain("shortcutBridge.setPane(");
  });

  it("the selected row scrolls into view when another shortcut moves the selection", () => {
    expect(read("src/components/chat/v2/list/virtual-rows.tsx")).toMatch(/scrollToIndex\(index, \{ align: "auto" \}\)/);
  });
});
