import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/s/s1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ForumView } from "@/components/chat/v2/forum/forum-view";
import { TgPhoneProvider } from "@/components/shell/tg-phone";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatRowDto, SpaceTopicsDto } from "@/lib/chat/cache/types";
import { fabHiddenAfter, topicColourOf, topicGlyphOf, TOPIC_COLOURS } from "@/lib/chat/v2/topic-icon";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Tg = TgPhoneProvider as unknown as FunctionComponent<{ on: boolean; children?: ReactNode }>;

const topic = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id,
  kind: "TOPIC",
  title: `موضوع ${id}`,
  emoji: "💬",
  space: null,
  lastMessage: { id: `m-${id}`, authorName: "سلمى", preview: `رد في ${id}`, kind: "TEXT", at: "2026-11-17T09:05:00.000Z", mine: false },
  unread: 2,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});

function draw(on: boolean, canCreateTopic: boolean): string {
  const data: SpaceTopicsDto = { space: { id: "s1", name: "مبيعات", emoji: "🛒", canModerate: false, canCreateTopic }, rows: [topic("a"), topic("b", { emoji: "📦" })] };
  const client = new QueryClient();
  installChatDefaults(client);
  client.setQueryData(chatKeys.space("s1"), data);
  const view = createElement(ForumView, { spaceId: "s1", variant: "screen", userId: "u1", guest: false, rowMenu: true, canPurge: false, selectedId: null });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Tg, { on }, view))));
}

describe("a topic's coloured icon", () => {
  it("the colour is worked out from the topic's id: the same every time, one of the theme's categorical tokens", () => {
    expect(topicColourOf("ckabc")).toBe(topicColourOf("ckabc"));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => topicColourOf(`topic-${i}`)));
    for (const colour of seen) {
      expect(TOPIC_COLOURS).toContain(colour);
      expect(colour).toMatch(/^bg-cat-[1-6]$/);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
  it("shows the topic's own emoji; the plain default one gives way to the title's first letter", () => {
    expect(topicGlyphOf({ emoji: "📦", title: "المخزن" })).toBe("📦");
    expect(topicGlyphOf({ emoji: "💬", title: "المخزن" })).toBe("ا");
    expect(topicGlyphOf({ emoji: null, title: "  طلبات" })).toBe("ط");
    expect(topicGlyphOf({ emoji: null, title: "" })).toBe("#");
  });
});

describe("the forum list on a phone", () => {
  it("draws the coloured icon for a phone and keeps the old one for a computer", () => {
    const html = draw(true, false);
    expect(html).toContain("data-tg-forum");
    expect(html.match(/data-topic-icon=/g)).toHaveLength(2);
    expect(html).toMatch(/data-topic-icon="a"[^>]*md:hidden|md:hidden[^>]*data-topic-icon="a"/);
    expect(html).toContain(topicColourOf("a"));
    expect(html).toContain("data-unread-pill");
    expect(html).toContain("<bdi>موضوع a</bdi>");
  });
  it("«موضوع جديد» floats for whoever may open topics, and only for them", () => {
    const may = draw(true, true);
    expect(may).toContain("data-forum-fab");
    expect(may).toContain(`aria-label="${AR["chath.topic.new"]}"`);
    expect(may).toMatch(/data-forum-fab[^>]*md:hidden|md:hidden[^>]*data-forum-fab/);
    expect(draw(true, false)).not.toContain("data-forum-fab");
  });
  it("the switch off: the list of before", () => {
    const html = draw(false, true);
    expect(html).not.toContain("data-tg-forum");
    expect(html).not.toContain("data-topic-icon");
    expect(html).not.toContain("data-forum-fab");
    expect(html).toContain(`aria-label="${AR["chath.topic.new"]}"`);
  });
  it("the floating button steps aside while the list scrolls down and comes back on the way up", () => {
    expect(fabHiddenAfter(100, 140, false)).toBe(true);
    expect(fabHiddenAfter(140, 100, true)).toBe(false);
    expect(fabHiddenAfter(100, 102, false)).toBe(false);
    expect(fabHiddenAfter(100, 98, true)).toBe(true);
    expect(fabHiddenAfter(30, 0, true)).toBe(false);
  });
  it("its slide obeys «الانتقالات السلسة»; the sender's name is coloured on a phone only", () => {
    const css = read("src/components/chat/v2/tg-sheets.css");
    expect(css).toContain('html:not([data-fx-off~="transitions"]) .tg-forum-fab');
    expect(css).toContain("var(--tg-bar-slide-ms");
    expect(css).toMatch(/max-width: 767px[\s\S]*\[data-tg-forum\] \[data-row-preview\] > span:not\(\.text-danger\)/);
  });
});
