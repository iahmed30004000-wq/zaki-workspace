import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AssistantLine } from "@/components/chat/message/assistant-line";
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { ShortcutsSheet } from "@/components/chat/v2/menu/shortcuts-sheet";
import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { PaneActionsProvider } from "@/components/chat/v2/pane/pane-actions";
import { PaneHeader } from "@/components/chat/v2/pane/pane-header";
import { chatKeys } from "@/lib/chat/cache/keys";
import { CHAT_PREFS_KEY, type ChatPrefsDto } from "@/lib/chat/cache/queries";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto, ChatRowDto } from "@/lib/chat/cache/types";
import { SAVED_SHORTCUT, SHEET_ROWS, SHORTCUT_ROWS, runShortcut, shortcutOf, type KeyEventLike, type ShortcutDeps } from "@/lib/chat/shortcuts";
import { soundOfArrival } from "@/lib/chat/sounds";
import { bubbleFactsOf, sameFacts } from "@/lib/chat/v2/pane/bubble-facts";
import { subtitleOf } from "@/lib/chat/v2/pane/header-model";
import { doubleTapReactionOf } from "@/lib/chat/v2/menu/quick-reactions";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { textOf } from "./ui-render";

/**
 * C3w.2 — the wiring on the screen that C1 to C4 built and did not connect: the «@» walk, the header's switches into the bubble and the composer, the phone's
 * double tap, the saved chat's header, Ctrl+0 in the sheet, the assistant's line, the person's folders on the list, and the old screen's silent sound.
 * The things a server render cannot see (a gesture, an effect) are pinned by reading the source, the way `chat-v2-pane-seams` does.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Actions = PaneActionsProvider as unknown as FunctionComponent<{ conversationId: string; jumpTo: () => void; toNewest: () => void; children?: ReactNode }>;
const noop = () => undefined;
const inApp = (node: ReactElement, qc = new QueryClient()) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, node)));

describe("«@» walks the unread mentions (C3b.6): the viewport calls the hook", () => {
  const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");

  it("builds the walk with useMentionsWalk and gives its two results to the jump buttons", () => {
    expect(viewport).toContain("useMentionsWalk({");
    expect(viewport).toContain("conversationId, unread: unreadMentions, loaded: targets");
    expect(viewport).toContain("mentions={walk.mentions}");
    expect(viewport).toContain("onMention={walk.onMention}");
  });

  it("has no visited state of its own any more (the hook keeps it WITH its conversation)", () => {
    expect(viewport).not.toContain("setVisited");
    expect(viewport).not.toContain("mentionsButtonOf(");
  });

  it("the loaded mentions are still the fallback walk", () => {
    expect(viewport).toContain("mentionTargetsOf(history.messages, facts.meId, unreadMentions)");
  });
});

describe("the media viewer sits above the list (C3b.3, C3d)", () => {
  it("the pane mounts the provider with the messages, the conversation (so it reads the /media route) and the jump", () => {
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    expect(pane).toContain("<MediaViewerProvider messages={history.messages} conversationId={header.id} onShowInChat={commands.jumpTo}>");
    expect(read("src/components/chat/v2/media-viewer.tsx")).toContain("/media");
  });
});

describe("the header's switches reach the bubble (C3b.1, C3b.3)", () => {
  it("bubbleFactsOf: formatting and albums are ON unless the header says false", () => {
    expect(bubbleFactsOf(makeHeader()).formatting).toBe(true);
    expect(bubbleFactsOf(makeHeader()).albums).toBe(true);
    expect(bubbleFactsOf(makeHeader({ chatFormatting: false })).formatting).toBe(false);
    expect(bubbleFactsOf(makeHeader({ chatAlbums: false })).albums).toBe(false);
  });

  it("the facts differ (so the bubbles draw again) when a switch flips, and not for a change they do not read", () => {
    expect(sameFacts(bubbleFactsOf(makeHeader()), bubbleFactsOf(makeHeader({ chatFormatting: false })))).toBe(false);
    expect(sameFacts(bubbleFactsOf(makeHeader()), bubbleFactsOf(makeHeader({ chatAlbums: false })))).toBe(false);
    expect(sameFacts(bubbleFactsOf(makeHeader()), bubbleFactsOf(makeHeader({ title: "اسم تاني" })))).toBe(true);
  });

  const draw = (message: MessageDto, header: ConversationHeaderDto = makeHeader()) => {
    const props: MessageBubbleProps = { message, conversationId: "c1", facts: bubbleFactsOf(header), start: true, end: true, mentionNames: [], onReact: noop, onJump: noop };
    return inApp(createElement(MessageBubble, props));
  };
  const pic = (id: string) => ({ id, kind: "IMAGE" as const, name: `${id}.png`, mime: "image/png", size: 10, url: `/api/chat/attachments/${id}`, width: 400, height: 300 });

  it("formatting on: **bold** is bold; switched off in the header: the markers stay as typed", () => {
    const message = makeMessage({ body: "**مهم** جدا" });
    expect(draw(message)).toContain("<strong>مهم</strong>");
    const off = draw(message, makeHeader({ chatFormatting: false }));
    expect(off).not.toContain("<strong>");
    expect(off).toContain("**مهم**");
  });

  it("albums on: two pictures are ONE mosaic; switched off in the header: one box each", () => {
    const message = makeMessage({ kind: "TEXT", body: null, attachments: [pic("a1"), pic("a2")] });
    expect(draw(message)).toContain("data-album");
    expect(draw(message, makeHeader({ chatAlbums: false }))).not.toContain("data-album");
  });
});

describe("the phone's double tap is the quick reaction (C4.1, C2.6)", () => {
  const bubble = read("src/components/chat/v2/message-bubble.tsx");
  const host = read("src/components/chat/v2/pane/seams/menu-host.tsx");

  it("doubleTapReactionOf: the person's emoji, once; never when none is chosen, when mine is already there, or when they may not post", () => {
    expect(doubleTapReactionOf({ preference: "🔥", reactions: [], canPost: true })).toBe("🔥");
    expect(doubleTapReactionOf({ preference: "🔥", reactions: [{ emoji: "🔥", mine: false }], canPost: true })).toBe("🔥");
    expect(doubleTapReactionOf({ preference: "🔥", reactions: [{ emoji: "🔥", mine: true }], canPost: true })).toBeNull();
    expect(doubleTapReactionOf({ preference: undefined, reactions: [], canPost: true })).toBeNull();
    expect(doubleTapReactionOf({ preference: "ok", reactions: [], canPost: true })).toBeNull();
    expect(doubleTapReactionOf({ preference: "🔥", reactions: [], canPost: false })).toBeNull();
  });

  it("the bubble tracks the finger's taps with touchTap and asks the host's gesture, only where it may act", () => {
    expect(bubble).toContain("touchTap(");
    expect(bubble).toContain("gestures.quickReact?.(message, facts)");
    expect(bubble).toMatch(/onPointerUp=\{\(e\) => \{[\s\S]*touchTap\([\s\S]*longPress\.onPointerUp\(\)/);
    expect(bubble).toMatch(/if \(canAct && gestures && tap\.double\)/);
  });

  it("the host gives the bubbles a quickReact that reads the device's copy of the choice at the moment of the tap and reacts through the pane's command", () => {
    expect(host).toContain("quickReact: (message, facts) =>");
    expect(host).toContain("doubleTapReactionOf({ preference: readDevicePrefs().mirror?.doubleTap");
    expect(host).toContain("void commands.react(message, emoji)");
  });

  it("the person's own six are read when a menu opens, not once at module load", () => {
    expect(host).not.toContain("const QUICK = quickReactionsOf()");
    expect(host).toMatch(/React\.useMemo\(\(\) => quickReactionsOf\(\), \[asked\]\)/);
    expect(host).toContain("const asked = menuOpen || sheetOpen;");
  });
});

describe("the saved chat's header and bubble (C3a.3)", () => {
  const savedHeader = makeHeader({ id: "sv1", kind: "DM", title: AR["chatsaved.title"]!, emoji: null, space: null, me: { id: "u1", canPost: true, canCall: true } });
  const plainDm = makeHeader({ kind: "DM", title: "سلمى", emoji: null, space: null, peer: { id: "u2", name: "سلمى", avatarUrl: null } });
  const header = (h: ConversationHeaderDto) => inApp(createElement(Actions, { conversationId: h.id, jumpTo: noop, toNewest: noop }, createElement(PaneHeader, { header: h, people: null, watch: false, system: false })));

  it("bubbleFactsOf knows the saved chat, and an ordinary private chat is not", () => {
    expect(bubbleFactsOf(savedHeader).saved).toBe(true);
    expect(bubbleFactsOf(plainDm).saved).toBe(false);
    expect(bubbleFactsOf(makeHeader()).saved).toBe(false);
  });

  it("no call button in the saved chat; the ordinary private chat still has one", () => {
    expect(header(savedHeader)).not.toContain(AR["calls.menu_label"]!);
    expect(header(plainDm)).toContain(AR["calls.menu_label"]!);
  });

  it("no typing line in the saved chat (the line stays for everybody else)", () => {
    expect(subtitleOf(savedHeader, { typingNames: ["سلمى"], saved: true }).typing).toBe(false);
    expect(subtitleOf(plainDm, { typingNames: ["سلمى"] }).typing).toBe(true);
    expect(read("src/components/chat/v2/pane/pane-header.tsx")).toContain("typingNames: saved ? [] : typingNames");
  });

  it("the old sound toggle is not in the header any more (it is in «إعداداتي»)", () => {
    const src = read("src/components/chat/v2/pane/pane-header.tsx");
    expect(src).not.toContain("setSoundsEnabled");
    expect(src).not.toContain("chatc.sounds");
    expect(read("src/components/settings-me/notifications-section.tsx")).toContain("setSoundsEnabled(next)");
  });

  it("my own message in the saved chat has the single ✓, whatever status it carries; elsewhere a read message has two", () => {
    const mine = makeMessage({ mine: true, status: "read" });
    const draw = (facts: ReturnType<typeof bubbleFactsOf>) => inApp(createElement(MessageBubble, { message: mine, conversationId: "c1", facts, start: true, end: true, mentionNames: [], onReact: noop, onJump: noop }));
    expect(draw(bubbleFactsOf(savedHeader))).toContain('data-ticks="sent"');
    expect(draw(bubbleFactsOf(plainDm))).toContain('data-ticks="read"');
  });

  it("the composer sends no typing notice in the saved chat", () => {
    expect(read("src/lib/chat/v2/composer/use-composer.ts")).toMatch(/if \(!editing && text\.trim\(\) && !isSavedHeader\(detail\)\) notifyTyping\(\)/);
  });
});

describe("Ctrl+0 is a shortcut of the table and the sheet (C3a.3)", () => {
  const key = (over: Partial<KeyEventLike>): KeyEventLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

  it("shortcutOf: Ctrl+0 (any layout, the numpad too) is «saved»; with Alt, Shift or the command key it is not; Ctrl+1 is still a folder", () => {
    expect(shortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true }))).toEqual({ type: "saved" });
    expect(shortcutOf(key({ code: "Digit0", key: "٠", ctrlKey: true }))).toEqual({ type: "saved" });
    expect(shortcutOf(key({ code: "Numpad0", key: "0", ctrlKey: true }))).toEqual({ type: "saved" });
    expect(shortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutOf(key({ code: "Digit0", key: "0", metaKey: true }))).toBeNull();
    expect(shortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, isComposing: true }))).toBeNull();
    expect(shortcutOf(key({ code: "Digit1", key: "1", ctrlKey: true }))).toEqual({ type: "folder", index: 0 });
  });

  const deps = (over: Partial<ShortcutDeps> = {}): { d: ShortcutDeps; openSaved: ReturnType<typeof vi.fn> } => {
    const openSaved = vi.fn(() => true);
    return { openSaved, d: { currentId: null, list: null, pane: null, listHasFocus: false, editable: false, overlayOpen: false, open: noop, toList: noop, focusListSearch: noop, openSheet: noop, openSaved, ...over } };
  };

  it("runShortcut opens the saved chat (from a field too: Ctrl+0 has no text meaning); a dialog or menu that is open keeps the key; a refusal leaves the browser's own key", () => {
    const a = deps();
    expect(runShortcut({ type: "saved" }, a.d)).toBe(true);
    expect(a.openSaved).toHaveBeenCalledTimes(1);
    const b = deps({ editable: true });
    expect(runShortcut({ type: "saved" }, b.d)).toBe(true);
    const c = deps({ overlayOpen: true });
    expect(runShortcut({ type: "saved" }, c.d)).toBe(false);
    expect(c.openSaved).not.toHaveBeenCalled();
    const d = deps();
    d.openSaved.mockReturnValue(false);
    expect(runShortcut({ type: "saved" }, d.d)).toBe(false);
  });

  it("the sheet lists the saved row after the eight of C2.6, with its words; `SHORTCUT_ROWS` itself is the table «إعداداتي» lists beside the saved row", () => {
    expect(SHORTCUT_ROWS).toHaveLength(8);
    expect(SHEET_ROWS).toHaveLength(9);
    expect(SHEET_ROWS.at(-1)).toBe(SAVED_SHORTCUT);
    expect(SAVED_SHORTCUT.keys).toEqual(["ctrl", "0"]);
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ShortcutsSheet, { open: true, onOpenChange: noop, portal: false })));
    expect(html).toContain(AR["chatsaved.keys.open"]!);
    expect(textOf(html)).toContain("Ctrl + 0");
    const latin = textOf(html).replace(/\bCtrl\b/g, " ").replace(/\bEsc\b/g, " ").match(/[A-Za-z]{2,}/g) ?? [];
    expect(latin).toEqual([]);
  });

  it("the hook folds the old special case into runShortcut: it reads the company's switch from the cached list and holds a repeated key", () => {
    const src = read("src/lib/chat/shortcuts.ts");
    expect(src).toContain("openSaved: () => {");
    expect(src).toContain("list.saved === false");
    expect(src).toContain("event.repeat");
  });
});

describe("the assistant's line draws the formatting of its answer (C3b.1)", () => {
  it("only where it is asked to: the old screen gives it no switch, so its answer stays as plain as today (the review's finding: the company's switch must not be ignored there)", () => {
    const html = inApp(createElement(AssistantLine, { meta: { k: "assistant", p: { text: "**مهم** جدا" } } as never, time: "10:00", createdAt: "2026-11-01T08:30:00.000Z" }));
    expect(html).not.toContain("<strong>");
    expect(html).toContain("**مهم**");
    expect(read("src/components/chat/message/message-item.tsx")).toContain("<AssistantLine meta={message.system} time={fmtTime(message.createdAt)} createdAt={message.createdAt}/>");
  });
  const meta = { k: "assistant", p: { text: "**مهم** وبعدين `كود` ورابط https://example.com/a", first: 0 } } as never;
  it("bold, code and a link are elements, not markers", () => {
    const html = inApp(createElement(AssistantLine, { meta, time: "10:00", createdAt: "2026-11-01T08:30:00.000Z", formatting: true }));
    expect(html).toContain("<strong>مهم</strong>");
    expect(html).toContain("<code");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).not.toContain("**");
  });
  it("switched off (the pane passes the header's switch): the text stays as written", () => {
    const html = inApp(createElement(AssistantLine, { meta, time: "10:00", createdAt: "2026-11-01T08:30:00.000Z", formatting: false } as never));
    expect(html).not.toContain("<strong>");
    expect(html).toContain("**مهم**");
  });
  it("the pane's service row hands it the header's switch (on unless the header says off)", () => {
    expect(read("src/components/chat/v2/pane/service-rows.tsx")).toContain("formatting={formatting}");
    expect(read("src/components/chat/v2/pane/viewport-row.tsx")).toContain("formatting={env.facts.formatting}");
  });
});

describe("the old screen's arrival sound skips a silent message (C3c.2)", () => {
  it("soundOfArrival: silent means none (a mention included); the same message loud still sounds", () => {
    expect(soundOfArrival({ mine: false, opening: false, mentionsMe: true, kind: "TEXT", silent: true })).toBeNull();
    expect(soundOfArrival({ mine: false, opening: false, mentionsMe: false, kind: "TEXT", silent: true })).toBeNull();
    expect(soundOfArrival({ mine: false, opening: false, mentionsMe: true, kind: "TEXT" })).toBe("mention");
    expect(soundOfArrival({ mine: false, opening: false, mentionsMe: false, kind: "TEXT", silent: false })).toBe("received");
  });
  it("conversation-screen passes the message's flag (that one place only)", () => {
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).toContain("kind:newest.kind,silent:newest.silent===true})");
  });
});

describe("the old chat screen keeps working with chatLayoutV2 OFF", () => {
  it("renders as it did (its own log, none of the new pane), and the only change in its file is the silent flag of the arrival sound", async () => {
    const { ConversationScreen } = await import("@/components/chat/conversation/conversation-screen");
    const html = renderToStaticMarkup(createElement(ConversationScreen, { conversationId: "c1", onBack() {} }));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('role="log"');
    expect(html).not.toContain("data-chat-pane-root");
    expect(html).not.toContain("data-pane-header");
    const src = read("src/components/chat/conversation/conversation-screen.tsx");
    expect(src).not.toContain("components/chat/v2/");
    expect(src).toContain("soundOfArrival({mine:Boolean(newest.mine),opening:openingRef.current&&first,mentionsMe:");
  }, 60_000);
});

describe("the person's folders are drawn on the list (C3a.2)", () => {
  const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over });
  const props = { variant: "column" as const, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false };
  const seeded = (prefs: ChatPrefsDto | null, rows: ChatRowDto[] = [row("d1", { unread: 2 })]) => {
    const qc = new QueryClient();
    installChatDefaults(qc);
    qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows } satisfies ChatListDto);
    if (prefs) qc.setQueryData(CHAT_PREFS_KEY, prefs);
    return qc;
  };
  const folder = { id: "f-aaaaaa", name: "الشغل", emoji: "💼", include: { dms: true, conversationIds: [], spaceIds: [] }, exclude: {} };

  it("a person's own folder is a tab after the built-in ones, with its emoji; a built-in tab they hid is gone", () => {
    const html = inApp(createElement(ChatListColumn, props), seeded({ prefs: { folders: { org1: [folder] }, tabs: { hidden: ["mentions"] } }, orgId: "org1", foldersOn: true }));
    expect(html).toContain("data-folder-custom");
    expect(html).toContain('data-folder="f:f-aaaaaa"');
    expect(textOf(html)).toContain("الشغل");
    expect(html).not.toContain('data-folder="mentions"');
    expect(html.indexOf('data-folder="spaces"')).toBeLessThan(html.indexOf('data-folder="f:f-aaaaaa"'));
  });

  it("with no prefs (not loaded, or the switch off) the strip is the five tabs of today", () => {
    for (const prefs of [null, { prefs: {}, orgId: "org1", foldersOn: false } satisfies ChatPrefsDto]) {
      const html = inApp(createElement(ChatListColumn, props), seeded(prefs));
      expect(html).not.toContain("data-folder-custom");
      for (const key of ["all", "unread", "dm", "spaces", "mentions"]) expect(html).toContain(`data-folder="${key}"`);
    }
  });

  it("the column filters through folderRows and counts through folderBadge for a custom tab, and the keyboard's folders are the same tabs", () => {
    const src = read("src/components/chat/v2/list/chat-list-column.tsx");
    expect(src).toContain("const prefs = useChatPrefs()");
    // the tab of the space's topics is called «المواضيع» when the list is of ONE space (batch 0), so the call also says so
    expect(src).toContain('tabsOf({ canOversee: list.canOversee, guest, archived, folders: prefs.folders, hidden: prefs.hidden, oneSpace: list.scope === "space" })');
    expect(src).toContain("folderRows(folderSource, custom,");
    expect(src).toContain("customFolderBadge(folderSource, def)");
    expect(src).toContain("tabKeyOf(folderKey, folders)");
  });
});
