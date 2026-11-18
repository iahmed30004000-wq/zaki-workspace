import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/chat/s/s1" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { ForumView } from "@/components/chat/v2/forum/forum-view";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto, ChatRowDto, SpaceTopicsDto } from "@/lib/chat/cache/types";
import { chatRouteOf, forumShown, nextForumSpace } from "@/lib/chat/v2/routes";
import { I18nProvider } from "@/lib/i18n";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens } from "./ui-render";

/**
 * C2.3 — the forum view of one space, inside the list column: header, topics, privacy, and how it comes and goes with the address.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: React.ReactElement, qc: QueryClient) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, node)));

const iso = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00`).toISOString();
const topic = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id,
  kind: "TOPIC",
  title: `موضوع ${id}`,
  emoji: "💬",
  space: null,
  lastMessage: { id: `m-${id}`, authorName: "سلمى", preview: `رد في ${id}`, kind: "TEXT", at: iso("09:05"), mine: false },
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});
const forum = (over: Partial<SpaceTopicsDto["space"]> = {}, rows: ChatRowDto[] = [topic("a"), topic("b", { unread: 2 })]): SpaceTopicsDto => ({
  space: { id: "s1", name: "مبيعات", emoji: "🛒", canModerate: false, canCreateTopic: false, ...over },
  rows,
});
const seeded = (data: SpaceTopicsDto | null, list?: ChatListDto) => {
  const qc = new QueryClient();
  installChatDefaults(qc);
  if (data) qc.setQueryData(chatKeys.space("s1"), data);
  if (list) qc.setQueryData(chatKeys.list(), list);
  return qc;
};
const props = { spaceId: "s1", variant: "column" as const, userId: "u1", guest: false, rowMenu: true, canPurge: false, selectedId: null };

describe("the forum view's header", () => {
  const html = render(createElement(ForumView, props), seeded(forum()));
  it("a back arrow to the list, the space's picture and name, and how many topics", () => {
    expect(html).toContain('data-chat-forum=""');
    expect(html).toMatch(/<a[^>]*aria-label="رجوع للمحادثات"[^>]*href="\/chat"|<a[^>]*href="\/chat"[^>]*aria-label="رجوع للمحادثات"/);
    expect(html).toContain("🛒");
    expect(html).toContain("<bdi>مبيعات</bdi>");
    expect(html).toContain("موضوعان");
  });
  it("the back arrow points to the start side (right, in this layout): it is an arrow-right icon", () => {
    expect(html).toContain("lucide-arrow-right");
  });
  it("«موضوع جديد» only for whoever the server says may open topics", () => {
    expect(html).not.toContain('aria-label="موضوع جديد"');
    expect(render(createElement(ForumView, props), seeded(forum({ canCreateTopic: true })))).toContain('aria-label="موضوع جديد"');
  });
  it("uses the same row as the list: the topic's emoji, its unread pill, a link to the topic", () => {
    expect(html).toContain('href="/chat/a"');
    expect(html).toContain('href="/chat/b"');
    expect(html).toContain("data-unread-pill");
    expect(html).toContain("<bdi>موضوع a</bdi>");
  });
  it("logical sides, theme tokens only", () => {
    const tokens = classTokens(html);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t))).toEqual([]);
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t))).toEqual([]);
  });
});

describe("the topics", () => {
  it("a private topic the person is IN is drawn with a lock; one they are outside of is simply not in the answer, so it is never named", () => {
    const inside = topic("in", { title: "الرواتب", restricted: true });
    const html = render(createElement(ForumView, props), seeded(forum({}, [topic("a"), inside])));
    expect(html).toContain("<bdi>الرواتب</bdi>");
    expect(html).toContain('aria-label="خاص"');
    // the same space as an outsider gets it: no such row
    const outsider = render(createElement(ForumView, props), seeded(forum({}, [topic("a")])));
    expect(outsider).not.toContain("الرواتب");
  });
  it("the archived topics (the managers receive them) are folded under «المؤرشفة (n)» after the live ones", () => {
    const html = render(createElement(ForumView, props), seeded(forum({ canModerate: true }, [topic("a"), topic("z", { archived: true }), topic("y", { archived: true })])));
    expect(html).toContain("المؤرشفة (2)");
    expect(html.indexOf("موضوع a")).toBeLessThan(html.indexOf("المؤرشفة (2)"));
    expect(html.indexOf("المؤرشفة (2)")).toBeLessThan(html.indexOf("موضوع z"));
  });
  it("no topics: «لا مواضيع بعد»; before the answer: a skeleton, never the empty sentence", () => {
    expect(render(createElement(ForumView, props), seeded(forum({}, [])))).toContain("لا مواضيع بعد");
    const pending = render(createElement(ForumView, props), seeded(null));
    expect(pending).toContain("data-chat-loading");
    expect(pending).not.toContain("لا مواضيع بعد");
  });
  it("the open topic's row is selected", () => {
    const html = render(createElement(ForumView, { ...props, selectedId: "b" }), seeded(forum()));
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
  });
});

describe("in the column: the forum opens over the list, the list stays under it", () => {
  const list: ChatListDto = { scope: "all", spaceId: null, canOversee: false, rows: [{ ...topic("sp"), id: "s1", kind: "SPACE", title: "مبيعات" }] };
  const column = { variant: "column" as const, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false };

  it("on /chat/s/<id> the column draws the forum and keeps the list beneath it, hidden from the keyboard and from screen readers", () => {
    where.pathname = "/chat/s/s1";
    const html = render(createElement(ChatListColumn, column), seeded(forum(), list));
    expect(html).toContain('data-chat-forum=""');
    expect(html).toContain('aria-hidden="true" inert=""');
    expect(html).toContain('data-chat-rows=""');
  });
  it("on /chat there is no forum and the list is live", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, column), seeded(forum(), list));
    expect(html).not.toContain("data-chat-forum");
    expect(html).not.toContain("inert");
  });
  it("a space row of the list opens the forum view", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, column), seeded(null, list));
    expect(html).toContain('href="/chat/s/s1"');
  });
  it("opening a topic of the forum keeps the forum (the topics are the column, the topic is the pane)", () => {
    where.pathname = "/chat/a";
    // the effect that remembers the forum does not run on the server; the rule it applies is the pure one below, and a conversation with no forum kept draws the list
    const html = render(createElement(ChatListColumn, column), seeded(forum(), list));
    expect(html).not.toContain("data-chat-forum");
    where.pathname = "/chat";
  });
});

describe("how the forum comes and goes with the address (pure)", () => {
  const forumRoute = chatRouteOf("/chat/s/s1");
  const topicRoute = chatRouteOf("/chat/a");
  const ids = ["a", "b"];
  it("/chat/s/<id> opens it, whatever was kept", () => {
    expect(nextForumSpace(forumRoute, null, [])).toBe("s1");
    expect(nextForumSpace(forumRoute, "s9", ids)).toBe("s1");
  });
  it("a topic of the forum keeps it", () => {
    expect(nextForumSpace(topicRoute, "s1", ids)).toBe("s1");
  });
  it("a conversation that is NOT one of its topics closes it (once the topics are known); before they are known it is kept", () => {
    expect(nextForumSpace(chatRouteOf("/chat/zzz"), "s1", ids)).toBeNull();
    expect(nextForumSpace(chatRouteOf("/chat/zzz"), "s1", [])).toBe("s1");
    expect(nextForumSpace(topicRoute, null, ids)).toBeNull();
  });
  it("the list (and any other page) closes it", () => {
    expect(nextForumSpace(chatRouteOf("/chat"), "s1", ids)).toBeNull();
    expect(nextForumSpace(chatRouteOf("/tasks"), "s1", ids)).toBeNull();
  });
  it("what is drawn: the address on a forum page, the kept one on a conversation, none on the list", () => {
    expect(forumShown(forumRoute, null)).toBe("s1");
    expect(forumShown(topicRoute, "s1")).toBe("s1");
    expect(forumShown(chatRouteOf("/chat"), "s1")).toBeNull();
  });
});
