import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
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

import { ArrangeRows } from "@/components/chat/v2/list/group-arrange";
import { GroupRowItem } from "@/components/chat/v2/list/group-row";
import { ROW_HEIGHT, ROW_HEIGHT_PHONE } from "@/components/chat/v2/list/chat-row";
import { I18nProvider } from "@/lib/i18n";
import type { GroupRowModel } from "@/lib/chat/v2/groups";

/**
 * «مجموعات المواضيع»: the row of a group (name, picture, newest message, the unread of its topics added up), the dragging list, and where the screens use them.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: React.ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, node)));

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const NOW = new Date("2026-11-17T15:00:00");

const model = (over: Partial<GroupRowModel> = {}): GroupRowModel => ({
  key: "group:g1",
  id: "g1",
  name: "الإدارة",
  emoji: "🧭",
  restricted: false,
  topicCount: 3,
  unread: 5,
  mentions: 0,
  last: { id: "m1", authorName: "سارة", preview: "جاهزة التقارير", kind: "TEXT", at: new Date("2026-11-17T14:30:00").toISOString(), mine: false } as GroupRowModel["last"],
  muted: false,
  ...over,
});

describe("the group row", () => {
  it("draws the picture, the name, who wrote last, what, the time and the unread total", () => {
    const html = render(createElement(GroupRowItem, { group: model(), tall: false, now: NOW, onOpen: () => {} }));
    expect(html).toContain("data-group-row=\"g1\"");
    expect(html).toContain("🧭");
    expect(html).toContain("الإدارة");
    expect(html).toContain("سارة");
    expect(html).toContain("جاهزة التقارير");
    expect(html).toContain("14:30");
    expect(html).toMatch(/data-unread-pill[^>]*>5</);
    expect(html).toContain(`height:${ROW_HEIGHT}px`);
  });

  it("is a tall row on the phone, says a lock for a restricted group, and the number of topics when nothing was written yet", () => {
    const html = render(createElement(GroupRowItem, { group: model({ restricted: true, last: null, unread: 0 }), tall: true, now: NOW, onOpen: () => {} }));
    expect(html).toContain(`height:${ROW_HEIGHT_PHONE}px`);
    expect(html).toContain("مجموعة مقيّدة");
    expect(html).toContain("3 مواضيع");
    expect(html).not.toContain("data-unread-pill");
  });

  it("«عام» has its own picture and no lock", () => {
    const html = render(createElement(GroupRowItem, { group: model({ id: null, key: "group:general", name: "عام", emoji: null, restricted: false }), tall: false, now: NOW, onOpen: () => {} }));
    expect(html).toContain("data-group-row=\"general\"");
    expect(html).toContain("🗂️");
  });
});

describe("arranging", () => {
  it("lists each entry with a grip the keyboard can lift", () => {
    const html = render(createElement(ArrangeRows, { listId: "t", entries: [{ id: "a", label: "الإدارة", emoji: "🧭" }, { id: "b", label: "التسويق", emoji: null }], onReorder: () => {} }));
    expect(html).toContain("data-arrange-id=\"a\"");
    expect(html).toContain("data-arrange-id=\"b\"");
    expect((html.match(/data-arrange-grip/g) ?? []).length).toBe(2);
    expect(html).toContain("اسحب من المقبض");
  });
});

describe("where the screens use them", () => {
  it("the list groups only inside ONE space, never a search, the archive or the company's screen", () => {
    const list = read("src/components/chat/v2/list/chat-list-column.tsx");
    expect(list).toContain('list.scope === "space" ? list.spaceId : null');
    expect(list).toMatch(/const groupable = groupSpaceId !== null && !words && !company && builtin !== "archived";/);
    expect(list).toContain("groupItems(rows, groups");
  });

  it("the forum view groups its topics, a search stays flat, and the row menu offers «نقل إلى مجموعة» only to a manager of a grouped space", () => {
    const forum = read("src/components/chat/v2/forum/forum-view.tsx");
    expect(forum).toContain("const groupMode = groups.length > 0 && !words;");
    expect(forum).toContain("onMoveToGroup");
    const menu = read("src/components/chat/v2/row-menu.tsx");
    expect(menu).toContain('row.kind === "TOPIC" && ctx.onMoveToGroup !== undefined && ctx.canModerate');
  });

  it("every word of the new screens is in the Arabic dictionary", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    const files = ["group-row", "group-arrange", "group-dialogs", "group-topics-pane"].map((f) => read(`src/components/chat/v2/list/${f}.tsx`)).join("\n") + read("src/components/chat/v2/list/chat-list-column.tsx") + read("src/components/chat/v2/forum/forum-view.tsx") + read("src/components/chat/v2/row-menu.tsx");
    const keys = [...files.matchAll(/ct(?:Count)?\("(chatgrp\.[a-z_]+)"/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of new Set(keys)) expect(AR[key], key).toBeTruthy();
  });
});
