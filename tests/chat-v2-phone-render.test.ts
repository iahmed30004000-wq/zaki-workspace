import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const state = vi.hoisted(() => ({
  pathname: "/chat",
  desktop: false as boolean | null,
  features: {} as Record<string, boolean>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/chat/v2/use-media", () => ({ useIsDesktop: () => state.desktop }));
vi.mock("@/app/(app)/_access", () => ({
  pageActor: async () => ({ user: { id: "u1" }, actor: { userId: "u1", orgId: "o1", role: "MEMBER", caps: new Set<string>(), isOwner: false, isExternal: false } }),
}));
vi.mock("@/server/services/features", () => ({ isFeatureOn: async (_org: string, key: string) => state.features[key] ?? false }));

import ChatInfoPage from "@/app/(app)/chat/[id]/info/page";
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { PhoneInfoScreen } from "@/components/chat/v2/phone/info-screen";
import { PhoneListBar } from "@/components/chat/v2/phone/list-bar";
import { ReactionPop } from "@/components/chat/v2/phone/reaction-pop";
import { PhoneScreenFrame } from "@/components/chat/v2/phone/screen-frame";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto } from "@/lib/chat/cache/types";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { FrameBridgeContext } from "@/lib/chat/v2/phone/frame-bridge";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { classTokens } from "./ui-render";

/**
 * C2.8 — the phone's screens, drawn on the server: the list screen's 56 px bar (with «☰» only where the frame hands over a drawer), the round button at the
 * bottom END, the conversation screen's box (slide, swipe, keyboard), the info screen and its route, and the motion classes of the bubble and the reactions.
 * The feel of the slide, the swipe and the keyboard is the owner's check on a real phone; here the MARKUP and the SOURCE rules are pinned.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Bridge = FrameBridgeContext.Provider as unknown as FunctionComponent<{ value: { openDrawer: () => void } | null; children?: ReactNode }>;
const Frame = PhoneScreenFrame as unknown as FunctionComponent<{ active: boolean; back: string | null; children?: ReactNode }>;
const Pop = ReactionPop as unknown as FunctionComponent<{ reactions: readonly { emoji: string; count: number; mine: boolean }[]; children?: ReactNode }>;
const noop = () => undefined;

const wrap = (node: ReactElement, client = new QueryClient()): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, node)));

describe("the list screen's bar", () => {
  const bar = (props: { title?: string; query?: string } = {}, drawer = false) =>
    wrap(
      createElement(
        Bridge,
        { value: drawer ? { openDrawer: noop } : null },
        createElement(PhoneListBar, { title: props.title ?? "زاكي", query: props.query ?? "", onQuery: noop, searchId: "s1" }),
      ),
    );

  it("is 56 px under the notch, with the title and a search icon; every control is a 44 px target", () => {
    const html = bar();
    expect(html).toContain("data-chat-phone-bar");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["h-14", "pt-[env(safe-area-inset-top)]", "size-11"]));
    expect(html).toContain("زاكي");
    expect(html).toContain("data-chat-phone-search-open");
    expect(html).toContain(AR["chatui.phone.search.open"]!);
    expect(html).toContain('data-chat-phone-search="closed"');
    expect(html).not.toContain('type="search"');
  });

  it("draws «☰» ONLY where the frame hands over a drawer (the new menu); with the old bottom bar there is none", () => {
    expect(bar({}, true)).toContain("data-chat-drawer-open");
    expect(bar({}, true)).toContain(AR["chatui.phone.menu"]!);
    expect(bar({}, false)).not.toContain("data-chat-drawer-open");
    expect(bar({}, false)).not.toContain("lucide-menu");
    expect(bar({}, true)).toContain("lucide-menu");
    // no frame at all (a test, a page outside it) is the same as the old bar
    expect(wrap(createElement(PhoneListBar, { title: "زاكي", query: "", onQuery: noop, searchId: "s1" }))).not.toContain("data-chat-drawer-open");
  });

  it("the title is whatever it is given (the folder's name, or «زاكي» for «الكل»)", () => {
    expect(bar({ title: AR["chatui.folder.unread"]! })).toContain(AR["chatui.folder.unread"]!);
  });

  it("a search that holds words is EXPANDED to a full-width field, with a way to fold it back and to clear it", () => {
    const html = bar({ query: "أحمد" }, true);
    expect(html).toContain('data-chat-phone-search="open"');
    expect(html).toContain('type="search"');
    expect(html).toContain('value="أحمد"');
    expect(html).toContain(AR["chatui.phone.search.close"]!);
    expect(html).toContain(AR["chatui.search.clear"]!);
    expect(html).not.toContain("data-chat-drawer-open");
    expect(classTokens(html)).toContain("flex-1");
  });

  it("uses logical sides only", () => {
    const src = read("src/components/chat/v2/phone/list-bar.tsx");
    expect(src).not.toMatch(/(?<![\w-])(?:ml|mr|pl|pr|left|right)-\d/);
    expect(src).toMatch(/\bps-3\b/);
  });
});

describe("the list column on the phone", () => {
  const LIST: ChatListDto = {
    scope: "all",
    spaceId: null,
    canOversee: false,
    rows: [{ id: "dm1", kind: "DM", title: "أحمد", emoji: null, space: null, lastMessage: null, unread: 2, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false }],
  };
  const column = (variant: "screen" | "column", drawer = false) => {
    const client = new QueryClient();
    installChatDefaults(client);
    client.setQueryData(chatKeys.list(), LIST);
    return wrap(
      createElement(Bridge, { value: drawer ? { openDrawer: noop } : null }, createElement(ChatListColumn as unknown as FunctionComponent<Record<string, unknown>>, { variant, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false })),
      client,
    );
  };

  it("the screen has the 56 px bar (title «زاكي» in «الكل»), the folders, 76 px rows and NO header field", () => {
    const html = column("screen", true);
    expect(html).toContain("data-chat-phone-bar");
    expect(html).toContain(`>${AR["chatui.phone.title"]}</h1>`);
    expect(html).toContain("data-chat-folders");
    expect(html).toContain("<bdi>أحمد</bdi>");
    expect(html).toContain("data-chat-drawer-open");
    expect(html).not.toContain("md:grid"); // the computer's pencil is not drawn
    expect(html).toMatch(/height:76px/);
  });

  it("the computer's column keeps its header field and has no phone bar", () => {
    const html = column("column");
    expect(html).not.toContain("data-chat-phone-bar");
    expect(html).toContain('type="search"');
  });

  it("the new-message button is at the bottom END (the left in this right-to-left layout): `end-4`, never a physical side", () => {
    const html = column("screen");
    const fab = /<button[^>]*data-chat-fab[^>]*>/.exec(html)?.[0] ?? "";
    expect(fab).not.toBe("");
    const tokens = (/class="([^"]*)"/.exec(fab)?.[1] ?? "").split(/\s+/);
    expect(tokens).toEqual(expect.arrayContaining(["end-4", "md:hidden", "size-14"]));
    expect(tokens.some((t) => /^(?:-?left|-?right|start)-/.test(t))).toBe(false);
    expect(tokens.find((t) => t.startsWith("bottom-"))).toContain("env(safe-area-inset-bottom)");
    const src = read("src/components/chat/v2/list/new-message-fab.tsx");
    expect(src).toContain("end-4");
    expect(/className="([^"]*)"/.exec(src)?.[1] ?? "").not.toMatch(/(?<![\w-])(?:left|right)-/);
  });

  it("«اجتماع جديد» lives in the pencil button's menu, not in a full-width strip under the folders", () => {
    const list = read("src/components/chat/v2/list/chat-list-column.tsx");
    expect(list).not.toContain("<MeetingButton");
    expect(list).not.toContain("border-border/60 px-3 py-2");
    expect(list).toMatch(/<NewMessageFab [^\n]*canMeet=\{canMeet\}/);
    const fab = read("src/components/chat/v2/list/new-message-fab.tsx");
    expect(fab).toContain('ct("chath.new_dm")');
    expect(fab).toContain('ct("calls.meeting_new")');
    expect(fab).toContain("DropdownMenuItem");
    expect(fab).toContain("/api/calls");
  });

  it("the pencil is a menu for everybody who is not a guest (a message, a group); «اجتماع جديد» is in it only for who may open meetings", () => {
    const withMeet = (canMeet: boolean) => {
      const client = new QueryClient();
      installChatDefaults(client);
      client.setQueryData(chatKeys.list(), LIST);
      return wrap(createElement(ChatListColumn as unknown as FunctionComponent<Record<string, unknown>>, { variant: "screen", userId: "u1", guest: false, canMeet, rowMenu: true, canPurge: false }), client);
    };
    const noMeet = /<button[^>]*data-chat-fab[^>]*>/.exec(withMeet(false))?.[0] ?? "";
    expect(noMeet).not.toBe("");
    expect(noMeet).toContain("aria-haspopup");
    const menu = withMeet(true);
    const fab = /<button[^>]*data-chat-fab[^>]*>/.exec(menu)?.[0] ?? "";
    expect(fab).toContain('aria-haspopup="menu"');
    expect(fab).toContain("end-4");
    // closed: the strip's words are nowhere on the screen
    expect(menu).not.toContain("اجتماع جديد");
  });
});

describe("the conversation screen's box", () => {
  const frame = (active: boolean, back: string | null) => wrap(createElement(Frame, { active, back }, createElement("p", null, "صفحة")));

  it("active: the whole screen, sliding in from the START edge in 200 ms, vertical scroll left to the browser, never a horizontal scroll", () => {
    const html = frame(true, "/chat");
    const tokens = classTokens(html);
    expect(tokens).toEqual(expect.arrayContaining(["h-full", "min-h-0", "touch-pan-y", "overflow-x-clip", "animate-slide-in-start", "motion-reduce:animate-none", "group/phone"]));
    expect(html).toContain("data-chat-phone-screen");
    expect(html).toContain('data-keyboard="closed"');
    expect(html).toContain("<p>صفحة</p>");
  });

  it("not active (the list is the screen): hidden, with the page kept inside it, and none of the screen's marks", () => {
    expect(frame(false, null)).toBe('<div class="hidden"><p>صفحة</p></div>');
  });

  it("the swipe and the keyboard are wired with the right rules (read from the source)", () => {
    const src = read("src/components/chat/v2/phone/screen-frame.tsx");
    expect(src).toMatch(/useEdgeSwipeBack<HTMLDivElement>\(active && back !== null/);
    expect(src).toMatch(/useKeyboardInset\(active\)/);
    expect(src).toMatch(/paddingBottom: inset/);
    expect(read("src/lib/chat/v2/phone/use-edge-swipe.ts")).toContain("attachEdgeSwipe(");
    const controller = read("src/lib/chat/v2/phone/edge-swipe-controller.ts");
    expect(controller).toContain('["pointerdown"');
    expect(controller).toMatch(/event\.pointerType === "mouse"/);
    expect(controller).not.toMatch(/touchstart|touchmove/);
    expect(read("src/lib/chat/v2/phone/use-keyboard-inset.ts")).toMatch(/visualViewport/);
  });

  it("the composer owns the home-indicator inset and drops it while the keyboard covers that corner; the header owns the notch", () => {
    const host = read("src/components/chat/v2/pane/seams/composer-host.tsx");
    expect(host).toContain("pb-[calc(0.75rem+env(safe-area-inset-bottom))] group-data-[keyboard=open]/phone:pb-3 md:pb-3");
    expect(host.match(/className=\{FOOTER_CLASS/g)?.length).toBe(2);
    const header = read("src/components/chat/v2/pane/pane-header.tsx");
    expect(header).toContain("pt-[env(safe-area-inset-top)] md:px-3 md:pt-0");
    // safe areas only on the header and the composer of the conversation (the info screen's bar and the list bar are headers too)
    for (const file of ["src/components/chat/v2/pane/message-viewport.tsx", "src/components/chat/v2/pane/viewport-row.tsx", "src/components/chat/v2/message-bubble.tsx"]) expect(read(file)).not.toContain("safe-area-inset");
  });

  it("the page itself still resizes with the keyboard where the browser can (the viewport meta says so)", () => {
    expect(read("src/app/layout.tsx")).toContain('interactiveWidget: "resizes-content"');
  });
});

describe("the info screen /chat/<id>/info", () => {
  const seeded = () => {
    const client = new QueryClient();
    installChatDefaults(client);
    client.setQueryData(chatKeys.header("c1"), makeHeader({ id: "c1", title: "مبيعات الشام" }));
    return client;
  };

  it("on a phone it mounts the panel body of C2.7 under its own 56 px bar, with a back arrow to the conversation", () => {
    state.desktop = false;
    const html = wrap(createElement(PhoneInfoScreen, { conversationId: "c1" }), seeded());
    expect(html).toContain('data-chat-info-screen="ready"');
    expect(html).toContain("data-chat-info-bar");
    expect(html).toContain("data-info-panel");
    expect(html).toContain("مبيعات الشام");
    expect(html).toContain('href="/chat/c1"');
    expect(html).toContain(AR["chatc.back"]!);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["h-14", "pt-[env(safe-area-inset-top)]", "size-11"]));
    // the panel draws no header of its own here (the bar is the header): no close button
    expect(html).not.toContain("data-info-close");
  });

  it("before the cache has the header it shows the bar and the loading line", () => {
    state.desktop = false;
    const html = wrap(createElement(PhoneInfoScreen, { conversationId: "c9" }));
    expect(html).toContain('data-chat-info-screen="loading"');
    expect(html).toContain(AR["chatc.loading"]!);
  });

  it("a computer has no such screen, and nothing is drawn until the screen size is known", () => {
    state.desktop = true;
    expect(wrap(createElement(PhoneInfoScreen, { conversationId: "c1" }), seeded())).toBe("");
    state.desktop = null;
    expect(wrap(createElement(PhoneInfoScreen, { conversationId: "c1" }), seeded())).toBe("");
    state.desktop = false;
  });

  it("the route: with the switch OFF the address goes to today's conversation page; ON it is the screen", async () => {
    state.features = { chatLayoutV2: false };
    await expect(ChatInfoPage({ params: { id: "c 1" } })).rejects.toThrow("NEXT_REDIRECT:/chat/c%201");
    state.features = { chatLayoutV2: true };
    const element = (await ChatInfoPage({ params: { id: "c1" } })) as ReactElement<{ conversationId: string }>;
    expect(element.type).toBe(PhoneInfoScreen);
    expect(element.props.conversationId).toBe("c1");
  });

  it("the pane's info host sends a phone to the screen instead of opening a sheet (read from the source)", () => {
    const host = read("src/components/chat/v2/pane/seams/info-host.tsx");
    expect(host).toMatch(/const toScreen = a\.infoOpen && desktop === false/);
    expect(host).toContain("router.push(chatHref.info(header.id))");
    expect(host).toContain("if (!a.infoOpen) return null;");
  });
});

describe("motion on the bubble and the reactions", () => {
  const facts = bubbleFactsOf(makeHeader());
  const bubble = (over: Partial<MessageBubbleProps["message"]>) => {
    const props: MessageBubbleProps = { message: makeMessage(over), conversationId: "c1", facts, start: true, end: true, mentionNames: [], onReact: noop, onJump: noop };
    return renderToStaticMarkup(createElement(Queries, { client: new QueryClient() }, createElement(MessageBubble, props) as ReactElement));
  };

  it("a message written a moment ago fades up (120 ms), and it is off under reduced motion; an old one never moves", () => {
    const fresh = classTokens(bubble({ createdAt: new Date().toISOString() }));
    expect(fresh).toEqual(expect.arrayContaining(["animate-fade-up", "motion-reduce:animate-none"]));
    expect(classTokens(bubble({ createdAt: "2026-11-01T08:30:00.000Z" }))).not.toContain("animate-fade-up");
  });

  it("the reactions are wrapped to pop (150 ms, off under reduced motion) and draw nothing when there are none", () => {
    const chips = createElement("span", null, "👍 1");
    const html = wrap(createElement(Pop, { reactions: [{ emoji: "👍", count: 1, mine: false }] }, chips));
    expect(html).toBe('<div data-reaction-pop="off"><span>👍 1</span></div>');
    expect(wrap(createElement(Pop, { reactions: [] }, chips))).toBe("");
    // inside the bubble: the chips are in the wrapper
    expect(bubble({ reactions: [{ emoji: "👍", count: 2, mine: true }] })).toMatch(/data-reaction-pop="off"[^>]*><div data-reactions/);
  });
});

describe("the phone list's rows slide to their place", () => {
  it("the virtual list runs FLIP after every render, finding the element of a row that MOVED by its place in the window (no ref callback per row: a scroll re-attaches nothing)", () => {
    const src = read("src/components/chat/v2/list/virtual-rows.tsx");
    expect(src).toContain("useFlipRows(");
    expect(src).toContain('querySelector<HTMLElement>(`[data-row-index="${at.index}"]`)');
    expect(src).not.toMatch(/\bref=\{\(el\)/);
    expect(src).toMatch(/transform: `translateY\(\$\{virtual\.start\}px\)`/);
  });
});

describe("what the frame's hidden top bar carried, on the phone's list bar (review)", () => {
  const TRAILING = createElement("span", { "data-test-trailing": "" }, "x");
  const bar = (value: { openDrawer: (() => void) | null; trailing?: ReactNode } | null, query = "") =>
    wrap(createElement(Bridge, { value: value as { openDrawer: () => void } | null }, createElement(PhoneListBar, { title: "زاكي", query, onQuery: noop, searchId: "s1" })));

  it("the bell (and, with the old menu, the account menu) the frame hands over are drawn at the END of the bar; «☰» only when a drawer is handed over", () => {
    const oldMenu = bar({ openDrawer: null, trailing: TRAILING });
    expect(oldMenu).toContain("data-chat-phone-trailing");
    expect(oldMenu).toContain("data-test-trailing");
    expect(oldMenu).not.toContain("data-chat-drawer-open");
    const newMenu = bar({ openDrawer: noop, trailing: TRAILING });
    expect(newMenu).toContain("data-chat-drawer-open");
    expect(newMenu).toContain("data-test-trailing");
    expect(newMenu.indexOf("data-chat-drawer-open")).toBeLessThan(newMenu.indexOf("data-chat-phone-search-open"));
    expect(newMenu.indexOf("data-chat-phone-search-open")).toBeLessThan(newMenu.indexOf("data-test-trailing"));
    // nothing handed over, nothing drawn
    expect(bar({ openDrawer: null })).not.toContain("data-chat-phone-trailing");
    // an expanded search is a full-width field: nothing beside it
    expect(bar({ openDrawer: noop, trailing: TRAILING }, "أحمد")).not.toContain("data-test-trailing");
  });

  it("the frame hands over the bell with the new menu and the bell plus the account menu with the old one (read from the source)", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("openDrawer: navV2 ? () => setDrawerOpen(true) : null,");
    expect(shell).toContain("<NotificationBell />\n          {navV2 ? null : <AvatarMenu user={user} rank={rank} variant=\"bar\" />}");
  });
});

describe("the forum view on the phone starts below the notch (review)", () => {
  const LIST: ChatListDto = { scope: "all", spaceId: null, canOversee: false, rows: [] };
  const column = (variant: "screen" | "column", pathname: string) => {
    state.pathname = pathname;
    const client = new QueryClient();
    installChatDefaults(client);
    client.setQueryData(chatKeys.list(), LIST);
    const html = wrap(createElement(ChatListColumn as unknown as FunctionComponent<Record<string, unknown>>, { variant, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false }), client);
    state.pathname = "/chat";
    return html;
  };

  it("on the phone the forum view sits in a box whose top is the safe-area inset (the frame's top bar, which owned the notch, is hidden there); on the computer it is as it was", () => {
    const phone = column("screen", "/chat/s/sp1");
    expect(phone).toContain("data-chat-forum-screen");
    expect(phone).toContain("data-chat-forum");
    const box = /<div data-chat-forum-screen="" class="([^"]*)"/.exec(phone)?.[1] ?? "";
    expect(box.split(/\s+/)).toEqual(expect.arrayContaining(["absolute", "inset-x-0", "bottom-0", "top-[env(safe-area-inset-top)]", "z-40"]));
    const desk = column("column", "/chat/s/sp1");
    expect(desk).toContain("data-chat-forum");
    expect(desk).not.toContain("data-chat-forum-screen");
    // no forum open: no box
    expect(column("screen", "/chat")).not.toContain("data-chat-forum-screen");
  });

  it("the whiteboard of a conversation is not a phone chat screen: the frame keeps its bars (and its notch padding) there", () => {
    state.pathname = "/chat/c1/whiteboard";
    state.desktop = false;
    const html = wrap(createElement(Frame, { active: true, back: null }, createElement("p", null, "سبورة")));
    expect(html).toContain("سبورة");
    expect(read("src/components/chat/v2/shell/chat-shell.tsx")).toContain('screen === "other" ? {}');
    state.pathname = "/chat";
  });
});
