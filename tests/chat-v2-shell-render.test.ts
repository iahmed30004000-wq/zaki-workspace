import * as React from "react";
import { createElement, Fragment, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const state = vi.hoisted(() => ({
  pathname: "/chat",
  desktop: null as boolean | null,
  features: {} as Record<string, boolean>,
  actor: { userId: "u1", orgId: "o1", role: "MEMBER", caps: new Set(["calls.edit"]), isOwner: false, isExternal: false } as Record<string, unknown>,
  space: null as { layout?: string } | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/chat/v2/use-media", () => ({ useIsDesktop: () => state.desktop }));
vi.mock("@/app/(app)/_access", () => ({ pageActor: async () => ({ user: { id: "u1" }, actor: state.actor }) }));
vi.mock("@/server/services/features", () => ({ isFeatureOn: async (_org: string, key: string) => state.features[key] ?? false }));
vi.mock("@/server/services/current-space", () => ({ currentSpace: async () => state.space, keepInSpace: async () => undefined }));

import ChatLayout from "@/app/(app)/chat/layout";
import ChatPage from "@/app/(app)/chat/page";
import ChatForumPage from "@/app/(app)/chat/s/[spaceId]/page";
import { ChatHomeClient } from "@/components/chat/home/chat-home-client";
import { EmptyState } from "@/components/chat/v2/empty-state";
import { ChatShell, type ChatShellProps } from "@/components/chat/v2/shell/chat-shell";
import { chatHref, chatRouteOf, isListScreen, selectedConversationId } from "@/lib/chat/v2/routes";
import { LIST_WIDTH_DEFAULT, LIST_WIDTH_KEY, LIST_WIDTH_MAX, LIST_WIDTH_MIN, clampListWidth, readListWidth, saveListWidth, widthFromKey, widthFromPointer } from "@/lib/chat/v2/list-width";
import { I18nProvider } from "@/lib/i18n";
import { textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: ReactElement): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, node)));

describe("the addresses of the chat", () => {
  it("/chat is the list, /chat/s/<id> the forum view, /chat/<id> a conversation, anything else is not the chat", () => {
    expect(chatRouteOf("/chat")).toEqual({ kind: "list" });
    expect(chatRouteOf("/chat/")).toEqual({ kind: "list" });
    expect(chatRouteOf("/chat/s/sp1")).toEqual({ kind: "forum", spaceId: "sp1" });
    expect(chatRouteOf("/chat/c1")).toEqual({ kind: "conversation", id: "c1" });
    expect(chatRouteOf("/chat/c1/whiteboard")).toEqual({ kind: "conversation", id: "c1" });
    expect(chatRouteOf("/chat/c1?m=x")).toEqual({ kind: "conversation", id: "c1" });
    expect(chatRouteOf("/chat/s")).toEqual({ kind: "other" });
    expect(chatRouteOf("/chat/s/a/b")).toEqual({ kind: "other" });
    expect(chatRouteOf("/tasks/1")).toEqual({ kind: "other" });
    expect(chatRouteOf(null)).toEqual({ kind: "other" });
    expect(chatRouteOf("/chat/%E0%A4%A")).toEqual({ kind: "other" });
  });
  it("the phone shows the list column on the list and the forum, the page on a conversation", () => {
    expect(isListScreen(chatRouteOf("/chat"))).toBe(true);
    expect(isListScreen(chatRouteOf("/chat/s/x"))).toBe(true);
    expect(isListScreen(chatRouteOf("/chat/c1"))).toBe(false);
    expect(selectedConversationId(chatRouteOf("/chat/c1"))).toBe("c1");
    expect(selectedConversationId(chatRouteOf("/chat/s/x"))).toBeNull();
  });
  it("hrefs encode their ids", () => {
    expect(chatHref.conversation("a b")).toBe("/chat/a%20b");
    expect(chatHref.forum("s/1")).toBe("/chat/s/s%2F1");
    expect(chatHref.list).toBe("/chat");
  });
});

describe("the width of the column: 360 px, dragged between 300 and 720 (Telegram-wide), a rail of 72 below that, kept on the device", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
  };
  it("the numbers of the spec", () => {
    expect([LIST_WIDTH_DEFAULT, LIST_WIDTH_MIN, LIST_WIDTH_MAX, LIST_WIDTH_KEY]).toEqual([360, 300, 720, "zk-chat-list-w"]);
    expect(clampListWidth(100)).toBe(72); // narrower than a list can be: the rail (2026-11-22)
    expect(clampListWidth(250)).toBe(300);
    expect(clampListWidth(900)).toBe(720);
    expect(clampListWidth(400.4)).toBe(400);
    expect(clampListWidth(Number.NaN)).toBe(360);
  });
  it("saves a clamped width and reads it back; a stranger's or damaged value is the default", () => {
    const s = store();
    saveListWidth(420, s);
    expect(s.data.get("zk-chat-list-w")).toBe("420");
    expect(readListWidth(s)).toBe(420);
    saveListWidth(9999, s);
    expect(readListWidth(s)).toBe(720);
    s.data.set("zk-chat-list-w", "wide");
    expect(readListWidth(s)).toBe(360);
    s.data.set("zk-chat-list-w", "99999");
    expect(readListWidth(s)).toBe(360);
    expect(readListWidth(null)).toBe(360);
  });
  it("storage that throws changes nothing", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => undefined };
    expect(readListWidth(broken)).toBe(360);
    expect(() => saveListWidth(400, broken)).not.toThrow();
  });
  it("a drag: the pointer's distance from the column's START edge is the width, either direction of the page", () => {
    const rect = { left: 100, right: 500 };
    expect(widthFromPointer(180, rect, true)).toBe(320); // right-to-left: start edge is the right (500)
    expect(widthFromPointer(180, rect, false)).toBe(72); // left-to-right: 180 - 100 = 80 → the rail
    expect(widthFromPointer(560, rect, false)).toBe(460);
    expect(widthFromPointer(0, rect, true)).toBe(500);
  });
  it("the keyboard: the arrow pointing away from the start edge widens, Home and End go to the ends", () => {
    expect(widthFromKey(360, "ArrowLeft", true)).toBe(376);
    expect(widthFromKey(360, "ArrowRight", true)).toBe(344);
    expect(widthFromKey(360, "ArrowRight", false)).toBe(376);
    expect(widthFromKey(300, "ArrowRight", true)).toBe(72); // the narrowest list folds to the rail
    expect(widthFromKey(360, "Home", true)).toBe(72);
    expect(widthFromKey(360, "End", true)).toBe(720);
    expect(widthFromKey(360, "a", true)).toBeNull();
  });
});

describe("the shell (switch ON): the same pane on every screen, the column where the screen puts it", () => {
  const pane = createElement("p", null, "محتوى الصفحة");
  const shell = (pathname: string, desktop: boolean | null) => {
    state.pathname = pathname;
    state.desktop = desktop;
    return render(createElement(ChatShell as FunctionComponent<Omit<ChatShellProps, "children">>, { userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false }, pane));
  };

  it("before the screen size is known (the server, the first client render) only the pane is drawn", () => {
    const html = shell("/chat", null);
    expect(html).toContain('data-chat-shell="pending"');
    expect(html).toContain("محتوى الصفحة");
    expect(html).not.toContain("data-chat-list");
  });

  it("the computer: the shell draws the column ITSELF, in its own box before the pane (it does not touch the frame), and the pane fills the rest", () => {
    for (const where of ["/chat", "/chat/c1", "/chat/s/sp1"]) {
      const html = shell(where, true);
      expect(html).toContain('data-chat-shell="desktop"');
      expect(html.match(/data-chat-list="column"/g)).toHaveLength(1);
      expect(html).not.toContain('data-chat-list="screen"');
      expect(html).toMatch(/<div data-chat-shell="desktop" data-chat-screen="[a-z]+" data-frame-bars="hide-(?:top|all)" class="flex h-full min-h-0">/);
      expect(html).toMatch(/<div data-chat-slot="" class="hidden h-full min-h-0 shrink-0 border-e border-border bg-surface md:flex"><section[^>]*data-chat-list="column"/);
      expect(html.indexOf('data-chat-list="column"')).toBeLessThan(html.indexOf("محتوى الصفحة"));
      expect(html).toMatch(/<div data-chat-pane="" class="min-w-0 flex-1"><p>محتوى الصفحة<\/p><\/div>/);
    }
  });

  it("before the size is known the pane sits in the same box as on the computer, so it is not remounted when the column appears", () => {
    expect(shell("/chat/c1", null)).toMatch(/<div data-chat-shell="pending" data-chat-screen="conversation" data-frame-bars="hide-all" class="flex h-full min-h-0"><div data-chat-pane="" class="min-w-0 flex-1"><p>/);
    // a list route is kept off a phone meanwhile (the list is its screen)
    expect(shell("/chat", null)).toMatch(/<div data-chat-shell="pending" data-chat-screen="list" data-frame-bars="hide-top" class="flex h-full min-h-0 max-md:hidden">/);
  });

  it("the phone, on /chat: the list IS the screen; the page's content is hidden", () => {
    const html = shell("/chat", false);
    expect(html).toContain('data-chat-shell="phone"');
    expect(html).toContain('data-chat-list="screen"');
    expect(html).toMatch(/<div class="h-full"><section[^>]*data-chat-list="screen"/);
    expect(html).toMatch(/<div class="hidden"><p>محتوى الصفحة<\/p><\/div>/);
  });

  it("the phone, on /chat/s/<id>: still the list column (the forum view is drawn inside it)", () => {
    const html = shell("/chat/s/sp1", false);
    expect(html).toMatch(/<div class="h-full"><section[^>]*data-chat-list="screen"/);
    expect(html).toMatch(/<div class="hidden"><p>/);
  });

  it("the phone, on a conversation: the conversation is the screen and the list stays mounted but hidden (back finds it where it was)", () => {
    const html = shell("/chat/c1", false);
    expect(html).toMatch(/<div class="hidden"><section[^>]*data-chat-list="screen"/);
    // C2.8: the page is the whole screen in the phone box (it slides in, follows a swipe from the start edge, rides above the keyboard)
    expect(html).toMatch(/<div class="group\/phone h-full min-h-0 touch-pan-y overflow-x-clip animate-slide-in-start motion-reduce:animate-none" data-chat-phone-screen="" data-keyboard="closed"><p>محتوى الصفحة<\/p><\/div>/);
  });

  it("the shell is self-contained: no hook into the frame (app-shell.tsx belongs to N1), and it builds neither a rail nor a drawer", () => {
    const src = read("src/components/chat/v2/shell/chat-shell.tsx");
    expect(src).not.toMatch(/ListSlot|register\(/);
    expect(src).not.toMatch(/from "@\/components\/(app-shell|shell\/(rail|drawer))"/);
    expect(existsSync(path.join(ROOT, "src/components/chat/v2/shell/list-slot.tsx"))).toBe(false);
  });
});

describe("the frame is N1's and stays as it is: the chat does not touch app-shell.tsx", () => {
  it("app-shell.tsx carries no chat import and no list-slot hook (C2.1 draws its column inside its own layout)", () => {
    const src = read("src/components/app-shell.tsx");
    expect(src).not.toMatch(/components\/chat\/v2/);
    expect(src).not.toMatch(/ListSlotProvider|setChatColumn|columnSlot/);
    // still the one pair
    expect((src.match(/<Rail\b/g) ?? []).length).toBe(1);
    expect((src.match(/<Drawer\b/g) ?? []).length).toBe(1);
  });
});

describe("the row's menu and the column's handle (review fixes)", () => {
  const menu = read("src/components/chat/v2/row-menu.tsx");
  const virtual = read("src/components/chat/v2/list/virtual-rows.tsx");
  const column = read("src/components/chat/v2/list/chat-list-column.tsx");

  it("the «⋮» trigger always has a box (never display:none), so a long press on the phone anchors the menu at the row; only a pointer on the computer sees it", () => {
    const trigger = /className=\{cn\(\s*"([^"]*)"/.exec(menu.slice(menu.indexOf("<DropdownMenuTrigger")))?.[1] ?? "";
    expect(trigger).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(trigger).toContain("absolute");
    expect(trigger).toContain("pointer-events-none");
    expect(trigger).toContain("md:pointer-events-auto");
    expect(trigger).toContain("md:static");
  });

  it("the resize handle sits above the forum view (which covers the column)", () => {
    const z = (re: RegExp, src: string) => Number(re.exec(src)?.[1]);
    const forum = z(/data-chat-forum=""[^>]*className="absolute inset-0 z-(\d+)/, read("src/components/chat/v2/forum/forum-view.tsx"));
    const handle = z(/className="absolute inset-y-0 end-0 z-(\d+) w-1\.5 cursor-col-resize/, column);
    expect(forum).toBeGreaterThan(0);
    expect(handle).toBeGreaterThan(forum);
  });

  it("the arrow keys move between rows only from a row's own link, never from the menu button beside it", () => {
    expect(virtual).toContain('closest<HTMLElement>("[data-row-link]")');
  });

  it("the column does not subscribe to the forum's whole list: it asks one yes / no question of the cache", () => {
    expect(column).toContain("useForumHolds(");
    expect(column).not.toMatch(/useChatSpace\(forumSpace\)/);
  });

  it("the list shows a failed refresh even while it holds rows, and the virtualizer re-measures when the row height changes", () => {
    expect(column).toMatch(/list\.isError && list\.rows\.length > 0/);
    expect(virtual).toContain("virtualizer.measure()");
  });
});

describe("the empty pane", () => {
  it("«اختار محادثة», a new-message button and the meeting button for whoever may meet", () => {
    const html = render(createElement(EmptyState, { guest: false, canMeet: true }));
    expect(textOf(html)).toContain("اختار محادثة");
    expect(html).toContain("اختار محادثة من القائمة، أو ابدأ وحدة جديدة");
    expect(html).toMatch(/<button[^>]*>رسالة جديدة<\/button>/);
    expect(html).toContain("اجتماع جديد");
  });
  it("a guest: no new message, no meeting", () => {
    const html = render(createElement(EmptyState, { guest: true, canMeet: false }));
    expect(html).toContain("اختار موضوع من القائمة");
    expect(html).not.toContain("رسالة جديدة");
    expect(html).not.toContain("اجتماع جديد");
  });
});

describe("the switch: OFF renders today's screens unchanged", () => {
  const children = createElement("p", null, "الصفحة");

  it("the layout draws NOTHING of its own while the switch is off (a fragment around the page)", async () => {
    state.features = {};
    const out = (await ChatLayout({ children })) as ReactElement<{ children: ReactNode }>;
    expect(out.type).toBe(Fragment);
    expect(out.props.children).toBe(children);
  });

  it("ON: the chat shell around the page, with only the facts the shell draws", async () => {
    state.features = { chatLayoutV2: true, chatRowMenu: true };
    state.actor = { ...state.actor, isOwner: true, isExternal: false };
    const out = (await ChatLayout({ children })) as ReactElement<Record<string, unknown>>;
    expect(out.type).toBe(ChatShell);
    expect(out.props).toMatchObject({ userId: "u1", guest: false, canMeet: true, rowMenu: true, canPurge: true });
    expect(out.props["children"]).toBe(children);
  });

  it("the owner's «حذف نهائي» needs the company's «قائمة المحادثة» switch too, and is the owner rank's alone", async () => {
    state.features = { chatLayoutV2: true, chatRowMenu: false };
    state.actor = { ...state.actor, isOwner: true };
    expect(((await ChatLayout({ children })) as ReactElement<Record<string, unknown>>).props).toMatchObject({ rowMenu: false, canPurge: false });
    state.features = { chatLayoutV2: true, chatRowMenu: true };
    state.actor = { ...state.actor, isOwner: false };
    expect(((await ChatLayout({ children })) as ReactElement<Record<string, unknown>>).props).toMatchObject({ rowMenu: true, canPurge: false });
  });

  it("a guest: the shell is told so (no private chats, no meeting)", async () => {
    state.features = { chatLayoutV2: true };
    state.actor = { ...state.actor, isExternal: true, isOwner: false, caps: new Set() };
    expect(((await ChatLayout({ children })) as ReactElement<Record<string, unknown>>).props).toMatchObject({ guest: true, canMeet: false });
  });

  it("/chat: OFF → today's ChatHomeClient with the same props; ON → the empty pane", async () => {
    state.actor = { userId: "u1", orgId: "o1", role: "MEMBER", caps: new Set(["calls.edit"]), isOwner: false, isExternal: false };
    state.space = null;
    state.features = {};
    const off = (await ChatPage()) as ReactElement<Record<string, unknown>>;
    expect(off.type).toBe(ChatHomeClient);
    expect(off.props).toEqual({ guest: false, canMeet: true });
    state.features = { chatLayoutV2: true };
    const on = (await ChatPage()) as ReactElement<Record<string, unknown>>;
    expect(on.type).toBe(EmptyState);
    expect(on.props).toEqual({ guest: false, canMeet: true });
  });

  it("OFF: /chat renders the old home's markup (its loading skeleton), nothing of the new screen", async () => {
    state.features = {};
    const html = render((await ChatPage()) as ReactElement);
    expect(html).toContain('aria-label="جارٍ التحميل…"');
    expect(html).not.toContain("data-chat-");
  });

  it("a space of «لوحات» still opens on its cards, with the switch on or off", async () => {
    state.space = { layout: "CARDS" };
    for (const features of [{}, { chatLayoutV2: true }] as Record<string, boolean>[]) {
      state.features = features;
      await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT:/cards");
    }
    state.space = null;
  });

  it("/chat/s/<id>: OFF there is no forum view — it goes to /chat; ON it is the empty pane beside the forum", async () => {
    state.features = {};
    await expect(ChatForumPage()).rejects.toThrow("NEXT_REDIRECT:/chat");
    state.features = { chatLayoutV2: true };
    const on = (await ChatForumPage()) as ReactElement<Record<string, unknown>>;
    expect(on.type).toBe(EmptyState);
  });

  it("the conversation page is not touched by this package (keepInSpace stays, and with navV2 ON it shows the banner instead of switching)", () => {
    const page = read("src/app/(app)/chat/[id]/page.tsx").replace(/\r\n/g, "\n");
    expect(page).toContain("await keepInSpace(actor, topic.spaceId, back);");
    expect(page).toContain("<ConversationPageClient conversationId={params.id} focusMessageId={searchParams.m} />");
    expect(page).not.toContain("chatLayoutV2");
  });

  it("loading.tsx is the app's own skeleton, so OFF looks as before; ON it keeps the layout (and the list) mounted while a page loads", () => {
    const src = read("src/app/(app)/chat/loading.tsx");
    expect(src).toContain('export { default } from "@/app/(app)/loading";');
  });
});

describe("the old components stay in the tree", () => {
  it("the old home, its list, its topics and its menu are still there and still used by the old screen", () => {
    for (const file of ["chat-home-client.tsx", "chat-home.tsx", "dm-list.tsx", "space-topics.tsx", "row-menu.tsx", "new-dm-dialog.tsx", "new-topic-dialog.tsx"]) {
      expect(() => read(`src/components/chat/home/${file}`), file).not.toThrow();
    }
    expect(read("src/components/chat/home/chat-home.tsx")).toContain('from "./space-topics"');
  });
});
