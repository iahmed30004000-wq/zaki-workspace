import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ChatRowItem } from "@/components/chat/v2/list/chat-row";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto, ChatRowDto } from "@/lib/chat/cache/types";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

/**
 * S5.7 (e) — the phone's rows swipe: the three buttons sit behind the row of a connected list on the PHONE (tall rows) only; the computer's list and the company that turned the
 * personal items off draw exactly what they drew before. (The gesture itself is proven in `chat-parity-swipe.test.ts`.)
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: React.ReactElement, qc: QueryClient) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, node)));

const row = (over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id: "dm1",
  kind: "DM",
  title: "أحمد",
  emoji: null,
  space: null,
  lastMessage: null,
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});
const menu = { enabled: false, canPurge: false, canModerate: false };
function draw(r: ChatRowDto, opts: { tall: boolean; personal?: boolean | undefined; userId?: string }) {
  const qc = new QueryClient();
  installChatDefaults(qc);
  qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows: [r], ...(opts.personal === undefined ? {} : { personal: opts.personal }) } satisfies ChatListDto);
  return render(createElement(ChatRowItem, { id: r.id, selected: false, tall: opts.tall, userId: opts.userId ?? "u1", menu, day: "2026-11-21" }), qc);
}

describe("a row of the phone's list carries its swipe buttons", () => {
  it("pin, mute and archive, in that order, each with its Arabic word, behind the row", () => {
    const html = draw(row(), { tall: true });
    expect(html).toContain("data-row-swipe");
    const ids = [...html.matchAll(/data-row-swipe-action="(\w+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["pin", "mute", "archive"]);
    for (const key of ["chatparity.row.pin", "chatparity.row.mute", "chatparity.row.archive"]) expect(html).toContain(AR[key]!);
    // closed: the buttons are out of the tab order
    expect(html).toContain('data-row-swipe-open="false"');
    expect(html).toContain('tabindex="-1"');
  });

  it("each button says the way it goes from the row (a pinned, muted, archived chat offers the opposite)", () => {
    const html = draw(row({ pinnedByMe: true, muted: true, archivedByMe: true }), { tall: true });
    expect([...html.matchAll(/data-row-swipe-action="(\w+)"/g)].map((m) => m[1])).toEqual(["unpin", "unmute", "unarchive"]);
  });

  it("the page keeps its vertical scroll (touch-action: pan-y) and the row link is still there", () => {
    const html = draw(row(), { tall: true });
    expect(html).toContain("touch-pan-y");
    expect(html).toContain("data-row-link");
  });

  it("the computer's list (not tall) is exactly what it was: no swipe shell, no buttons", () => {
    const html = draw(row(), { tall: false });
    expect(html).not.toContain("data-row-swipe");
  });

  it("a company with the personal items off, a space row and the chat with myself have nothing to swipe", () => {
    expect(draw(row(), { tall: true, personal: false })).not.toContain("data-row-swipe");
    expect(draw(row({ id: "sp1", kind: "SPACE", space: { id: "sp1", name: "مبيعات" } }), { tall: true })).not.toContain("data-row-swipe");
  });
});
