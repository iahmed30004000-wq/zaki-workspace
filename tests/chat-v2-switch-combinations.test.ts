import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const state = vi.hoisted(() => ({
  pathname: "/chat",
  desktop: true as boolean | null,
  features: {} as Record<string, boolean>,
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
vi.mock("@/app/(app)/_access", () => ({
  pageActor: async () => ({ user: { id: "u1" }, actor: { userId: "u1", orgId: "o1", role: "MEMBER", caps: new Set(["calls.edit"]), isOwner: false, isExternal: false } }),
}));
vi.mock("@/server/services/features", () => ({ isFeatureOn: async (_org: string, key: string) => state.features[key] ?? false }));
vi.mock("@/server/services/current-space", () => ({ currentSpace: async () => null, keepInSpace: async () => undefined }));

import ChatLayout from "@/app/(app)/chat/layout";
import ChatPage from "@/app/(app)/chat/page";
import { AppShell } from "@/components/app-shell";
import { ConversationPane } from "@/components/chat/v2/pane/conversation-pane";
import { ToastProvider } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto } from "@/lib/chat/cache/types";
import { audienceOf } from "@/lib/guide/audience";
import { I18nProvider } from "@/lib/i18n";
import { buildNav } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { makeHeader } from "./chat-v2-pane-fixtures.test";

/**
 * C2 — «the four combinations chatLayoutV2 × navV2 each have a render test». The two switches are independent. The chat's layout and page are
 * the REAL server components (their switch reads are mocked, as the database tests prove the real ones); the frame is the real `AppShell`; the list
 * column is the real component over a seeded cache. The column is drawn by the chat's own shell (the frame, app-shell.tsx, is N1's and is not touched), so
 * on the computer it sits in the page area right after the rail (or the old side menu): the frame's own list slot stays empty in all four combinations.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const LIST: ChatListDto = {
  scope: "all",
  spaceId: null,
  canOversee: false,
  rows: [
    { id: "dm1", kind: "DM", title: "أحمد", emoji: null, space: null, lastMessage: null, unread: 2, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false },
  ],
};

async function screen(opts: { chatV2: boolean; navV2: boolean; desktop: boolean; pathname?: string; conversation?: boolean }): Promise<string> {
  state.features = { chatLayoutV2: opts.chatV2, chatRowMenu: true };
  state.desktop = opts.desktop;
  state.pathname = opts.pathname ?? "/chat";
  // C2.4: with `conversation` the page of the pane is the conversation `dm1` (the page itself is tested in chat-v2-pane-switch.test.ts)
  const page = opts.conversation ? (createElement(ConversationPane, { conversationId: "dm1" }) as ReactElement) : ((await ChatPage()) as ReactElement);
  const layout = (await ChatLayout({ children: page })) as ReactElement;
  const client = new QueryClient();
  installChatDefaults(client);
  client.setQueryData(chatKeys.list(), LIST);
  client.setQueryData(chatKeys.header("dm1"), makeHeader({ id: "dm1", kind: "DM", space: null, title: "أحمد", emoji: null, memberCount: 2, audience: { type: "PAIR", count: 2 } }));
  client.setQueryData(["orgs"], { organizations: [{ id: "o", name: "ز", keyPrefix: "Z", role: "MEMBER", canCreateSpaces: false, workspaces: [{ id: "w", name: "مبيعات", slug: "s", holdsProjects: true }] }] });
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  const subject = { role: "MEMBER" as const, caps: [...effectiveCapabilities({ role: "MEMBER" })], navV2: opts.navV2 };
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
            {
              user: { name: "أحمد", username: "ahmad", email: "a@example.test", avatarUrl: null },
              nav: buildNav(subject),
              rank: "MEMBER",
              audience: audienceOf({ isExternal: false, caps: subject.caps }),
              isGuest: false,
              orgName: "شركة",
              navV2: opts.navV2,
            } as unknown as React.ComponentProps<typeof AppShell>,
            layout,
          ),
        ),
      ),
    ),
  );
}

describe("chatLayoutV2 OFF × navV2 OFF — today, exactly", () => {
  it("computer: the old side menu, the old home, no list column, no rail", async () => {
    const html = await screen({ chatV2: false, navV2: false, desktop: true });
    expect(html).toMatch(/<aside[^>]*w-64/);
    expect(html).not.toContain('data-shell="rail"');
    expect(html).not.toContain('data-shell="list-slot"');
    expect(html).not.toContain("data-chat-");
    expect(html).toContain('aria-label="جارٍ التحميل…"'); // the old home's own loading line
    expect(html).toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(html).not.toContain('data-shell="drawer-open"');
  });
});

describe("chatLayoutV2 OFF × navV2 ON — the new menu around the OLD chat", () => {
  it("computer: the rail and the drawer's button, the old home in the page, no list column", async () => {
    const html = await screen({ chatV2: false, navV2: true, desktop: true });
    expect(html).toContain('data-shell="rail"');
    expect(html).toContain('data-shell="drawer-open"');
    expect(html).not.toContain('data-shell="list-slot"');
    expect(html).not.toContain("data-chat-");
    expect(html).toContain('aria-label="جارٍ التحميل…"');
  });
});

describe("chatLayoutV2 ON × navV2 OFF — the new chat beside TODAY's side menu", () => {
  it("computer: the list column sits next to the old side menu; the pane is the empty «اختار محادثة»", async () => {
    const html = await screen({ chatV2: true, navV2: false, desktop: true });
    expect(html).toMatch(/<aside[^>]*w-64/);
    expect(html).not.toContain('data-shell="rail"');
    // the frame's own list slot stays empty: the shell draws the column in the page area, after the side menu
    expect(html).not.toContain('data-shell="list-slot"');
    expect(html.match(/data-chat-slot/g)).toHaveLength(1);
    expect(html.indexOf("<aside")).toBeLessThan(html.indexOf('data-chat-slot'));
    expect(html.indexOf('id="zk-main"')).toBeLessThan(html.indexOf('data-chat-slot'));
    expect(html.match(/data-chat-list="column"/g)).toHaveLength(1);
    expect(html).toContain("<bdi>أحمد</bdi>");
    expect(html).toContain("اختار محادثة");
    expect(html).not.toContain('aria-label="جارٍ التحميل…"');
  });

  it("phone: today's bottom bar stays and there is no «☰»; the list is the screen", async () => {
    const html = await screen({ chatV2: true, navV2: false, desktop: false });
    expect(html).toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(html).not.toContain('data-shell="drawer-open"');
    expect(html).not.toContain('data-shell="list-slot"');
    expect(html).toContain('data-chat-shell="phone"');
    expect(html).toContain('data-chat-list="screen"');
    expect(html).toContain("<bdi>أحمد</bdi>");
  });
});

describe("chatLayoutV2 ON × navV2 ON — the target layout", () => {
  it("computer: the ONE rail, the list column in the page area after it, the empty pane beside", async () => {
    const html = await screen({ chatV2: true, navV2: true, desktop: true });
    expect(html.match(/data-shell="rail"/g)).toHaveLength(1);
    expect(html).not.toContain('data-shell="list-slot"');
    expect(html.match(/data-chat-slot/g)).toHaveLength(1);
    expect(html.indexOf('data-shell="rail"')).toBeLessThan(html.indexOf('data-chat-slot'));
    expect(html.match(/data-chat-list="column"/g)).toHaveLength(1);
    expect(html).toContain("اختار محادثة");
    expect(html).not.toMatch(/<aside[^>]*w-64/);
  });

  it("phone: «☰» opens the one drawer, no bottom bar, the list is the screen with its round button at the end", async () => {
    const html = await screen({ chatV2: true, navV2: true, desktop: false });
    expect(html).toContain('data-shell="drawer-open"');
    expect(html).not.toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(html).toContain('data-chat-list="screen"');
    expect(html).toContain("data-chat-fab");
  });

  it("phone, on a conversation: the conversation is the screen, the list is kept but hidden", async () => {
    const html = await screen({ chatV2: true, navV2: true, desktop: false, pathname: "/chat/dm1" });
    expect(html).toMatch(/<div class="hidden"><section[^>]*data-chat-list="screen"/);
  });
});

describe("C2.4: the conversation pane in each of the four combinations (it is the page of the new chat, so only the ON ones draw it)", () => {
  for (const navV2 of [false, true]) {
    it(`chatLayoutV2 ON × navV2 ${navV2 ? "ON" : "OFF"}, computer: the pane is beside the ONE list column, with its header, log and composer in the pane's root`, async () => {
      const html = await screen({ chatV2: true, navV2, desktop: true, pathname: "/chat/dm1", conversation: true });
      expect(html.match(/data-chat-list="column"/g)).toHaveLength(1);
      expect(html.match(/data-chat-pane-root/g)).toHaveLength(1);
      expect(html.indexOf('data-chat-slot')).toBeLessThan(html.indexOf("data-chat-pane-root"));
      expect(html).toContain("data-pane-header");
      expect(html).toContain('role="log"');
      expect(html).toContain('data-composer-host="composer"');
      expect(html).not.toContain("اختار محادثة");
      expect(html.match(/data-shell="rail"/g)?.length ?? 0).toBe(navV2 ? 1 : 0);
    });

    it(`chatLayoutV2 ON × navV2 ${navV2 ? "ON" : "OFF"}, phone: the conversation is the screen with its back arrow; the list is kept but hidden`, async () => {
      const html = await screen({ chatV2: true, navV2, desktop: false, pathname: "/chat/dm1", conversation: true });
      expect(html).toMatch(/<div class="hidden"><section[^>]*data-chat-list="screen"/);
      expect(html).toContain("data-chat-pane-root");
      expect(html).toContain('href="/chat"');
      expect(html).toContain('data-composer-host="composer"');
    });
  }
});

describe("C2.8: the frame's bars on a phone, in each of the four combinations", () => {
  // the frame hides its own bars with `group-has-*` classes on a marker the chat shell draws (`data-frame-bars`): nothing else of the frame changes
  const TOP = "group-has-[[data-frame-bars]]/frame:max-md:hidden";
  const ALL = "group-has-[[data-frame-bars=hide-all]]/frame:max-md:hidden";

  it("chatLayoutV2 OFF: no marker at all, in both menus — today's phone, exactly (the classes are there, waiting, and match nothing)", async () => {
    for (const navV2 of [false, true]) {
      const html = await screen({ chatV2: false, navV2, desktop: false });
      expect(html).not.toContain('data-frame-bars="');
      expect(html).not.toContain("data-chat-phone-bar");
      expect(html).toContain('class="group/frame relative flex h-dvh overflow-clip bg-surface"');
    }
  });

  it("ON, the list screen: the shell asks the frame to hide ITS top bar; the list draws its own 56 px bar, with «☰» only when the new menu is on", async () => {
    const old = await screen({ chatV2: true, navV2: false, desktop: false });
    expect(old).toContain('data-frame-bars="hide-top"');
    expect(old).toContain('data-chat-screen="list"');
    expect(old).toContain(TOP);
    expect(old).toContain("data-chat-phone-bar");
    // the old bottom bar stays on the list, and there is no «☰» of the chat
    expect(old).toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(old).not.toContain("data-chat-drawer-open");
    const target = await screen({ chatV2: true, navV2: true, desktop: false });
    expect(target).toContain('data-frame-bars="hide-top"');
    expect(target).toContain("data-chat-phone-bar");
    expect(target).toContain("data-chat-drawer-open");
    expect(target).not.toMatch(/<nav[^>]*class="fixed bottom-0/);
    // what the frame's hidden top bar carried rides on the list's bar: the bell in both menus, the account menu only with the old one (the new one has it in the drawer)
    const barOf = (html: string) => /<header data-chat-phone-bar[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(barOf(old)).toContain('data-tour="inbox"');
    expect(barOf(old)).toContain('data-tour="avatar"');
    expect(barOf(target)).toContain('data-tour="inbox"');
    expect(barOf(target)).not.toContain('data-tour="avatar"');
  });

  it("ON, a conversation: the bottom bar, the people row and the content's bottom padding go too (the composer owns the inset)", async () => {
    const old = await screen({ chatV2: true, navV2: false, desktop: false, pathname: "/chat/dm1", conversation: true });
    expect(old).toContain('data-frame-bars="hide-all"');
    expect(old).toContain('data-chat-screen="conversation"');
    // the old bottom bar is still in the tree, with the class that hides it inside a conversation
    expect(old).toMatch(/<nav[^>]*class="fixed bottom-0[^"]*group-has-\[\[data-frame-bars=hide-all\]\]\/frame:max-md:hidden/);
    expect(old).toContain(ALL);
    // the column that pads for the bar is given back by ONE css rule (it finds the column by the `#zk-main` it holds; the frame's class strings are N1's and pinned)
    expect(old).toContain('<main id="zk-main"');
    const css = readFileSync(path.resolve(__dirname, "..", "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/@media not all and \(min-width: 768px\) \{\n  \.group\\\/frame:has\(\[data-frame-bars="hide-all"\]\) div:has\(> #zk-main\) \{\n    padding-bottom: 0;/);
    expect(old).toContain("data-chat-phone-screen");
    // the list is kept (hidden) under the conversation, so its bar is in the tree but not the screen
    expect(old).toMatch(/<div class="hidden"><section[^>]*data-chat-list="screen"/);
    const target = await screen({ chatV2: true, navV2: true, desktop: false, pathname: "/chat/dm1", conversation: true });
    expect(target).toContain('data-frame-bars="hide-all"');
    expect(target).toContain("data-chat-phone-screen");
  });

  it("ON, the info screen is a full screen too (bars hidden), and the computer never hides anything (the classes are all `max-md:`)", async () => {
    const info = await screen({ chatV2: true, navV2: true, desktop: false, pathname: "/chat/dm1/info", conversation: true });
    expect(info).toContain('data-frame-bars="hide-all"');
    expect(info).toContain('data-chat-screen="info"');
    const desk = await screen({ chatV2: true, navV2: true, desktop: true, pathname: "/chat/dm1", conversation: true });
    expect(desk).not.toContain("data-chat-phone-screen");
    expect(desk).not.toContain("data-chat-phone-bar");
    for (const html of [info, desk]) {
      for (const cls of html.match(/group-has-\[\[data-frame-bars[^"\s]*/g) ?? []) expect(cls).toContain(":max-md:");
    }
  });
});
