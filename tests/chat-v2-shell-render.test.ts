import * as React from "react";
import { createElement, Fragment, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
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
import { ListSlotProvider, useRegisterListSlot } from "@/components/chat/v2/shell/list-slot";
import { AppShell } from "@/components/app-shell";
import { chatHref, chatRouteOf, isListScreen, selectedConversationId } from "@/lib/chat/v2/routes";
import { LIST_WIDTH_DEFAULT, LIST_WIDTH_KEY, LIST_WIDTH_MAX, LIST_WIDTH_MIN, clampListWidth, readListWidth, saveListWidth, widthFromKey, widthFromPointer } from "@/lib/chat/v2/list-width";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { buildNav } from "@/lib/nav/places";
import { audienceOf } from "@/lib/guide/audience";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
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

describe("the width of the column: 360 px, dragged between 300 and 480, kept on the device", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
  };
  it("the numbers of the spec", () => {
    expect([LIST_WIDTH_DEFAULT, LIST_WIDTH_MIN, LIST_WIDTH_MAX, LIST_WIDTH_KEY]).toEqual([360, 300, 480, "zk-chat-list-w"]);
    expect(clampListWidth(100)).toBe(300);
    expect(clampListWidth(900)).toBe(480);
    expect(clampListWidth(400.4)).toBe(400);
    expect(clampListWidth(Number.NaN)).toBe(360);
  });
  it("saves a clamped width and reads it back; a stranger's or damaged value is the default", () => {
    const s = store();
    saveListWidth(420, s);
    expect(s.data.get("zk-chat-list-w")).toBe("420");
    expect(readListWidth(s)).toBe(420);
    saveListWidth(9999, s);
    expect(readListWidth(s)).toBe(480);
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
    expect(widthFromPointer(180, rect, false)).toBe(300); // left-to-right: 180 - 100 = 80 → clamped
    expect(widthFromPointer(560, rect, false)).toBe(460);
    expect(widthFromPointer(0, rect, true)).toBe(480);
  });
  it("the keyboard: the arrow pointing away from the start edge widens, Home and End go to the ends", () => {
    expect(widthFromKey(360, "ArrowLeft", true)).toBe(376);
    expect(widthFromKey(360, "ArrowRight", true)).toBe(344);
    expect(widthFromKey(360, "ArrowRight", false)).toBe(376);
    expect(widthFromKey(300, "ArrowRight", true)).toBe(300);
    expect(widthFromKey(360, "Home", true)).toBe(300);
    expect(widthFromKey(360, "End", true)).toBe(480);
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

  it("the computer: the column is handed to the frame's rail, so the shell itself draws the pane only", () => {
    const html = shell("/chat/c1", true);
    expect(html).toContain('data-chat-shell="desktop"');
    expect(html).toContain("محتوى الصفحة");
    expect(html).not.toContain("data-chat-list");
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
    expect(html).toMatch(/<div class="h-full min-h-0"><p>محتوى الصفحة<\/p><\/div>/);
  });

  it("registers its column with the frame's rail ONLY on the computer, and takes it away when it leaves", () => {
    const src = read("src/components/chat/v2/shell/chat-shell.tsx");
    expect(src).toContain("useRegisterListSlot()");
    expect(src).toMatch(/if \(desktop !== true \|\| !register\) return;/);
    expect(src).toContain("register(column);");
    expect(src).toContain("return () => register(null);");
    // the frame's own rail and drawer are used: the shell builds neither
    expect(src).not.toMatch(/from "@\/components\/shell\/(rail|drawer)"/);
  });
});

describe("the frame lends its ONE rail (and the old side menu) to the column", () => {
  const USER = { name: "أحمد", username: "ahmad", email: "a@example.test", avatarUrl: null };
  const frame = (extra: Record<string, unknown>, child: ReactNode = createElement("p", null, "الصفحة")): string => {
    state.pathname = "/chat";
    const subject = { role: "MEMBER" as const, caps: [...effectiveCapabilities({ role: "MEMBER" })], navV2: extra["navV2"] === true };
    const client = new QueryClient();
    client.setQueryData(["orgs"], { organizations: [{ id: "o", name: "ز", keyPrefix: "Z", role: "MEMBER", canCreateSpaces: false, workspaces: [{ id: "w", name: "مبيعات", slug: "s", holdsProjects: true }] }] });
    client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
    return renderToStaticMarkup(
      createElement(
        Translations,
        { initial: "ar" },
        createElement(
          Queries,
          { client },
          createElement(
            Toasts,
            null,
            createElement(
              AppShell,
              { user: USER, nav: buildNav(subject), rank: "MEMBER", audience: audienceOf({ isExternal: false, caps: subject.caps }), isGuest: false, orgName: "شركة", ...extra } as unknown as React.ComponentProps<typeof AppShell>,
              child,
            ),
          ),
        ),
      ),
    );
  };
  const slot = createElement("div", { "data-chat-list": "column" }, "عمود المحادثات");

  it("navV2 ON: the column is the rail's own list slot, right after the rail", () => {
    const html = frame({ navV2: true, listSlot: slot });
    expect(html).toContain('data-shell="rail"');
    expect(html.match(/data-shell="list-slot"/g)).toHaveLength(1);
    expect(html.indexOf('data-shell="rail"')).toBeLessThan(html.indexOf('data-shell="list-slot"'));
    expect(html).toContain("عمود المحادثات");
    // the drawer's «☰» is there: the new map's phone
    expect(html).toContain('data-shell="drawer-open"');
  });

  it("navV2 OFF: the column sits next to TODAY's side menu, and the phone keeps today's bottom bar with no «☰»", () => {
    const html = frame({ navV2: false, listSlot: slot });
    expect(html).not.toContain('data-shell="rail"');
    expect(html).toMatch(/<aside[^>]*w-64/);
    expect(html.match(/data-shell="list-slot"/g)).toHaveLength(1);
    expect(html.indexOf("<aside")).toBeLessThan(html.indexOf('data-shell="list-slot"'));
    expect(html).toContain("عمود المحادثات");
    expect(html).toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(html).not.toContain('data-shell="drawer-open"');
  });

  it("no column, no slot: either frame is exactly what it was", () => {
    expect(frame({ navV2: true })).not.toContain('data-shell="list-slot"');
    expect(frame({ navV2: false })).not.toContain('data-shell="list-slot"');
  });

  it("the setter reaches the shell through a context: outside the frame the hook is null and registering does nothing", () => {
    let seen: unknown = "unset";
    const Probe = () => {
      seen = useRegisterListSlot();
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    expect(seen).toBeNull();
    let inside: unknown = "unset";
    const setter = () => undefined;
    const Inner = () => {
      inside = useRegisterListSlot();
      return null;
    };
    renderToStaticMarkup(createElement(ListSlotProvider, { value: setter }, createElement(Inner)));
    expect(inside).toBe(setter);
  });

  it("app-shell.tsx: one provider, one slot variable for BOTH menus, and the drawer is not given the chat's column", () => {
    const src = read("src/components/app-shell.tsx").replace(/\r\n/g, "\n");
    expect(src).toContain("<ListSlotProvider value={setChatColumn}>");
    expect(src).toContain("const columnSlot = listSlot ?? chatColumn;");
    expect(src).toMatch(/<Rail[\s\S]*?listSlot=\{columnSlot\}/);
    expect(src).toMatch(/\{!navV2 && columnSlot \? \(/);
    // the phone's list is the page's own screen: the drawer keeps what the server layout gave it (nothing today)
    expect(src).toMatch(/<Drawer[\s\S]*?listSlot=\{listSlot\}/);
    // never a second pair
    expect((src.match(/<Rail\b/g) ?? []).length).toBe(1);
    expect((src.match(/<Drawer\b/g) ?? []).length).toBe(1);
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
