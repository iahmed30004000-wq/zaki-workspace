import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { ToastProvider } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto } from "@/lib/chat/cache/types";
import { audienceOf } from "@/lib/guide/audience";
import { I18nProvider } from "@/lib/i18n";
import { buildNav } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * C2 — «the four combinations chatLayoutV2 × navV2 each have a render test». The two switches are independent. The chat's layout and page are
 * the REAL server components (their switch reads are mocked, as the database tests prove the real ones); the frame is the real `AppShell`; the list
 * column is the real component over a seeded cache. What the column's registration does in the browser (an effect hands it to the frame) is stood
 * in for by giving the frame `listSlot`, which is the same slot that registration fills.
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

async function screen(opts: { chatV2: boolean; navV2: boolean; desktop: boolean; pathname?: string }): Promise<string> {
  state.features = { chatLayoutV2: opts.chatV2, chatRowMenu: true };
  state.desktop = opts.desktop;
  state.pathname = opts.pathname ?? "/chat";
  const page = (await ChatPage()) as ReactElement;
  const layout = (await ChatLayout({ children: page })) as ReactElement;
  const client = new QueryClient();
  installChatDefaults(client);
  client.setQueryData(chatKeys.list(), LIST);
  client.setQueryData(["orgs"], { organizations: [{ id: "o", name: "ز", keyPrefix: "Z", role: "MEMBER", canCreateSpaces: false, workspaces: [{ id: "w", name: "مبيعات", slug: "s", holdsProjects: true }] }] });
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  const subject = { role: "MEMBER" as const, caps: [...effectiveCapabilities({ role: "MEMBER" })], navV2: opts.navV2 };
  // the computer with the new chat: the column is in the frame's slot (what the shell's registration does)
  const column = opts.chatV2 && opts.desktop ? createElement(ChatListColumn, { variant: "column", userId: "u1", guest: false, canMeet: true, rowMenu: true, canPurge: false }) : undefined;
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
              ...(column ? { listSlot: column } : {}),
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
    expect(html.match(/data-shell="list-slot"/g)).toHaveLength(1);
    expect(html.indexOf("<aside")).toBeLessThan(html.indexOf('data-shell="list-slot"'));
    expect(html.indexOf('data-shell="list-slot"')).toBeLessThan(html.indexOf('id="zk-main"'));
    expect(html).toContain('data-chat-list="column"');
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
  it("computer: the ONE rail, the list column in its slot right after it, the empty pane beside", async () => {
    const html = await screen({ chatV2: true, navV2: true, desktop: true });
    expect(html.match(/data-shell="rail"/g)).toHaveLength(1);
    expect(html.match(/data-shell="list-slot"/g)).toHaveLength(1);
    expect(html.indexOf('data-shell="rail"')).toBeLessThan(html.indexOf('data-shell="list-slot"'));
    expect(html).toContain('data-chat-list="column"');
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
