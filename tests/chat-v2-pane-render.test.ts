import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CallBarView } from "@/components/chat/v2/pane/call-bar";
import { ConversationPane, PaneUnavailable } from "@/components/chat/v2/pane/conversation-pane";
import { JumpButtons, StickyDateChip } from "@/components/chat/v2/pane/floating";
import { PaneActionsProvider } from "@/components/chat/v2/pane/pane-actions";
import { PaneHeader } from "@/components/chat/v2/pane/pane-header";
import { PinnedBar } from "@/components/chat/v2/pane/pinned-bar";
import { ComposerHost } from "@/components/chat/v2/pane/seams/composer-host";
import { MenuHost } from "@/components/chat/v2/pane/seams/menu-host";
import { ViewportRow, rowPadding, type RowEnv } from "@/components/chat/v2/pane/viewport-row";
import { ApiError } from "@/lib/api-client";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import { ctCount } from "@/lib/chat/text";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { jumpButtonsOf, mentionsButtonOf } from "@/lib/chat/v2/pane/jump-model";
import { buildRows, type Row } from "@/lib/chat/viewport/rows";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { makeConversation } from "./chat-history-model.test";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C2.4 — the pane's parts, drawn on the server. The virtual list draws no row on the server (there is nothing to measure), so the rows are tested through
 * `ViewportRow`, and the pane itself through its frame: the header, the bars, the seams and where each of them sits in the root.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Actions = PaneActionsProvider as unknown as FunctionComponent<{ conversationId: string; jumpTo: () => void; toNewest: () => void; children?: ReactNode }>;
const Menus = MenuHost as unknown as FunctionComponent<{ header: ConversationHeaderDto; members: never[]; children?: ReactNode }>;
const noop = () => undefined;

function inPane(header: ConversationHeaderDto, node: ReactElement, client = new QueryClient()): string {
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client }, createElement(Actions, { conversationId: header.id, jumpTo: noop, toNewest: noop }, createElement(Menus, { header, members: [] }, node))),
    ),
  );
}

describe("the rows of the log", () => {
  const header = makeHeader();
  const env = (over: Partial<RowEnv> = {}): RowEnv => ({
    conversationId: "c1",
    facts: bubbleFactsOf(header),
    messages: [],
    mentionNames: [],
    readersByMessage: new Map(),
    menu: () => createElement("i", { "data-menu-slot": "" }),
    pending: { retry: noop, discard: noop, copy: noop, edit: noop },
    ...over,
  });
  const row = (rows: Row[], type: Row["type"], at = 0): Row => rows.filter((r) => r.type === type)[at]!;
  const draw = (r: Row, e: RowEnv, highlightId: string | null = null) => inPane(header, createElement(ViewportRow, { row: r, env: e, highlightId }));
  const call = (k: "call_started" | "call_ended"): Partial<MessageDto> => ({ kind: "SYSTEM", body: null, system: { k } });

  it("a day is the quiet chip «اليوم / أمس / التاريخ»", () => {
    const messages = makeConversation(2);
    const html = draw(row(buildRows(messages), "day"), env({ messages }));
    expect(html).toContain("data-day-separator");
  });

  it("the unread line says «رسائل غير مقروءة» and is a separator", () => {
    const messages = makeConversation(3);
    const html = draw(row(buildRows(messages, { unreadBeforeId: messages[1]!.id }), "unread"), env({ messages }));
    expect(html).toContain("data-unread-line");
    expect(html).toContain('role="separator"');
    expect(html).toContain("رسائل غير مقروءة");
  });

  it("a dozen call lines are ONE chip «6 مكالمات» (a button that opens the list), never twelve lines", () => {
    const messages = makeConversation(14, 1, (i) => (i >= 1 && i <= 12 ? call(i % 2 === 1 ? "call_started" : "call_ended") : {}));
    const rows = buildRows(messages, { foldCalls: true });
    const html = draw(row(rows, "calls"), env({ messages }));
    expect(html).toContain("data-calls-chip");
    expect(html).toContain("6 مكالمات");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain(AR["chatc.sys.call_ended"]);
  });

  it("a system line is a quiet sentence made from its key — never the JSON, never an empty bubble", () => {
    const messages = makeConversation(1, 1, () => ({ kind: "SYSTEM", body: JSON.stringify({ k: "join" }), authorName: "سلمى", system: { k: "join" } }));
    const html = draw(row(buildRows(messages), "message"), env({ messages }));
    expect(html).toContain("data-service-line=\"join\"");
    expect(html).toContain("انضمام سلمى إلى المحادثة");
    expect(html).not.toContain("{&quot;k&quot;");
    expect(html).not.toContain("data-message-id");
  });

  it("a message of mine the server does not have yet is the PENDING bubble (retry, delete) — never a bubble with a menu", () => {
    const messages = makeConversation(1, 1, () => ({ id: "pending:abc", clientId: "abc", mine: true, body: "عم بتبعت", pending: { state: "sending" } }));
    const html = draw(row(buildRows(messages), "message"), env({ messages }));
    expect(html).toContain('data-pending-message="abc"');
    expect(html).toContain('data-outbox-state="pending"');
    expect(html).toContain(AR["outbox.retry"]);
    expect(html).not.toContain("data-menu-slot");
    expect(html).not.toContain("data-message-id");
    const failed = makeConversation(1, 1, () => ({ id: "pending:abc", clientId: "abc", mine: true, body: "x", pending: { state: "failed", reason: "outbox.reason.other" } }));
    const bad = draw(row(buildRows(failed), "message"), env({ messages: failed }));
    expect(bad).toContain('data-outbox-state="failed"');
    expect(bad).toContain("data-outbox-bang");
  });

  it("a person's message is a bubble with its menu; the target of a jump has the ring", () => {
    const messages = makeConversation(3);
    const rows = buildRows(messages);
    const html = draw(row(rows, "message", 1), env({ messages }), messages[1]!.id);
    expect(html).toContain(`data-message-id="${messages[1]!.id}"`);
    expect(html).toContain("data-menu-slot");
    expect(html).toContain("ring-accent");
    expect(draw(row(rows, "message", 0), env({ messages }), messages[1]!.id)).not.toContain("ring-accent");
  });

  it("the run's last bubble leaves a gap and the ones inside it sit close", () => {
    const messages = makeConversation(3);
    const rows = buildRows(messages);
    expect(rowPadding(row(rows, "message", 0), messages)).toBe("pb-0.5 pt-0.5");
    expect(rowPadding(row(rows, "message", 2), messages)).toBe("pb-2 pt-0.5");
    expect(rowPadding(row(rows, "day"), messages)).toBe("py-2");
  });
});

describe("the header", () => {
  const draw = (header: ConversationHeaderDto, people = null as never) => inPane(header, createElement(PaneHeader, { header, people, watch: true, system: false }));

  it("a topic: its emoji, its title, «المبيعات · 42 عضوًا», the search, the call button and the ⋮; the title is a button that only toggles the info", () => {
    const html = draw(makeHeader());
    expect(html).toContain("طلبات اليوم");
    expect(html).toContain(`المبيعات · ${ctCount("chatc.members", 42)}`);
    expect(html).toContain("📦");
    expect(html).toMatch(/<button[^>]*data-header-title[^>]*aria-expanded="false"/);
    expect(html).toContain("data-header-search");
    expect(html).toContain(AR["calls.menu_label"]);
    expect(html).toContain("data-header-menu");
    expect(html).not.toContain("data-privacy");
  });

  it("a topic for named people: «🔒 خاص · 4 أشخاص» — a count and never a name", () => {
    const html = draw(makeHeader({ restricted: true, memberCount: 4, audience: { type: "PEOPLE", count: 4 } }));
    expect(html).toContain("data-privacy");
    expect(html).toContain("🔒 خاص · 4 أشخاص");
  });

  it("a private chat: «🔒 بينكم بس» and the other person's last seen; no emoji circle", () => {
    const html = draw(makeHeader({ kind: "DM", space: null, title: "أحمد", emoji: null, peer: { id: "u2", name: "أحمد" }, peerLastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(), timeZone: "UTC", audience: { type: "PAIR", count: 2 }, memberCount: 2 }));
    expect(html).toContain("🔒 بينكم بس");
    expect(html).toContain("آخر ظهور");
  });

  it("the call button only where the header says the person may call, and the assistant's ring for his own assistant chat", () => {
    expect(draw(makeHeader({ me: { canCall: false } }))).not.toContain(AR["calls.menu_label"]);
    expect(draw(makeHeader({ calls: false }))).not.toContain(AR["calls.menu_label"]);
    expect(draw(makeHeader({ assistantCall: true }))).not.toContain(AR["calls.menu_label"]);
  });

  it("the back arrow is for the phone only and goes to the list", () => {
    const html = draw(makeHeader());
    const back = /<a\b[^>]*>/.exec(html)![0];
    expect(back).toContain('href="/chat"');
    expect(back).toMatch(/class="[^"]*\bmd:hidden\b/);
  });

  it("«اكتم الإشعارات» is not drawn anywhere (no per-person door before C3a)", () => {
    expect(draw(makeHeader({ me: { canModerate: true } }))).not.toContain("اكتم الإشعارات");
  });
});

describe("the bars", () => {
  it("the pinned bar shows the newest pin and where it is among the others; nothing when nothing is pinned", () => {
    const pins = [
      { id: "p1", authorName: "ليلى", preview: "موعد التسليم" },
      { id: "p2", authorName: "سلمى", preview: null },
    ];
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(PinnedBar, { pins, onJump: noop })));
    expect(html).toContain("data-pinned-bar");
    expect(html).toContain("ليلى: موعد التسليم");
    expect(html).toContain("1 من 2");
    expect(renderToStaticMarkup(createElement(PinnedBar, { pins: [], onJump: noop }))).toBe("");
  });

  it("the call bar says «مكالمة جارية · انضم» and is one button", () => {
    const html = renderToStaticMarkup(createElement(CallBarView, { onJoin: noop }));
    expect(html).toContain("data-call-bar");
    expect(html).toContain("مكالمة جارية · انضم");
  });
});

describe("what floats over the log", () => {
  const draw = (s: Parameters<typeof jumpButtonsOf>[0], mentions: { mentionsUnread: number; targets: string[]; visited: string[] }) =>
    renderToStaticMarkup(createElement(JumpButtons, { down: jumpButtonsOf(s).down, mentions: mentionsButtonOf(mentions), onDown: noop, onMention: noop }));

  it("«↓» with the unread counter, at the bottom END", () => {
    const html = draw({ atBottom: false, atNewest: true, unread: 12, newBelow: 0 }, { mentionsUnread: 0, targets: [], visited: [] });
    expect(html).toContain('data-jump-down="unread"');
    expect(html).toContain(">12<");
    expect(html).toContain("bottom-3 end-3");
    expect(html).not.toContain("data-jump-mentions");
  });

  it("«آخر الرسائل» when only the windows do not reach the newest message", () => {
    const html = draw({ atBottom: true, atNewest: false, unread: 0, newBelow: 0 }, { mentionsUnread: 0, targets: [], visited: [] });
    expect(html).toContain('data-jump-down="newest"');
    expect(html).toContain("آخر الرسائل");
  });

  it("«@» with the unread mentions; both buttons together; none when there is nothing to go to", () => {
    const both = draw({ atBottom: false, atNewest: true, unread: 3, newBelow: 0 }, { mentionsUnread: 2, targets: ["a", "b"], visited: [] });
    expect(both).toContain("data-jump-mentions");
    expect(both).toContain("رسالتين بتذكرك");
    expect(both).toContain("data-jump-down");
    expect(draw({ atBottom: true, atNewest: true, unread: 0, newBelow: 0 }, { mentionsUnread: 0, targets: [], visited: [] })).toBe("");
  });

  it("the sticky date is hidden from screen readers and fades in and out", () => {
    const on = renderToStaticMarkup(createElement(StickyDateChip, { label: "أمس", visible: true }));
    expect(on).toContain('aria-hidden="true"');
    expect(on).toContain("opacity-100");
    expect(renderToStaticMarkup(createElement(StickyDateChip, { label: "أمس", visible: false }))).toContain("opacity-0");
    expect(renderToStaticMarkup(createElement(StickyDateChip, { label: null, visible: true }))).toBe("");
  });
});

describe("the composer seam", () => {
  const draw = (header: ConversationHeaderDto) => inPane(header, createElement(ComposerHost, { header, people: null }));

  it("renders today's composer working end to end when the person may post", () => {
    const html = draw(makeHeader());
    expect(html).toContain('data-composer-host="composer"');
    expect(html).toContain("<textarea");
  });

  it("the owner in oversight gets «شارك بالمحادثة» where he may join, and the reason line elsewhere", () => {
    const join = draw(makeHeader({ me: { canPost: false, canJoin: true, oversight: true } }));
    expect(join).toContain('data-composer-host="join"');
    expect(join).toContain(AR["chatc.join"]);
    expect(join).not.toContain("<textarea");
    expect(draw(makeHeader({ me: { canPost: false, oversight: true } }))).toContain(AR["chatc.bar.oversight"]);
    expect(draw(makeHeader({ closed: true, me: { canPost: false } }))).toContain(AR["chatc.bar.closed"]);
    expect(draw(makeHeader({ me: { canPost: false, muted: true } }))).toContain(AR["chatc.bar.muted"]);
    expect(draw(makeHeader({ topicType: "ANNOUNCEMENTS", me: { canPost: false } }))).toContain(AR["chatc.bar.announcements"]);
    expect(draw(makeHeader({ me: { canPost: false } }))).toContain(AR["chatc.bar.denied"]);
  });
});

/** The children of the first element that carries `marker`: a tiny walk over the markup (it has no script and no unclosed tags but the void ones). */
function directChildren(html: string, marker: string): string[] {
  const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "source"]);
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let depth = 0;
  let rootDepth = -1;
  const out: string[] = [];
  for (const m of html.matchAll(tag)) {
    const [whole, closing, name, rest, selfClose] = m;
    if (closing) {
      depth -= 1;
      if (rootDepth >= 0 && depth < rootDepth) break;
      continue;
    }
    if (rootDepth < 0 && whole!.includes(marker)) rootDepth = depth + 1;
    else if (rootDepth >= 0 && depth === rootDepth) out.push(`${name}${rest}`);
    if (!selfClose && !VOID.has(name!.toLowerCase())) depth += 1;
  }
  return out;
}

describe("the pane's frame", () => {
  const draw = (header?: ConversationHeaderDto, client = new QueryClient()) => {
    installChatDefaults(client);
    if (header) client.setQueryData(chatKeys.header(header.id), header);
    return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(ConversationPane, { conversationId: "c1", watch: true }))));
  };

  it("the root is `relative` with data-chat-pane-root, and the composer host is its DIRECT child (C2.5 lays a drop overlay over the pane from there)", () => {
    const html = draw(makeHeader());
    expect(html).toMatch(/<section[^>]*data-chat-pane-root[^>]*class="[^"]*\brelative\b/);
    const kids = directChildren(html, "data-chat-pane-root");
    expect(kids.some((k) => k.startsWith("header"))).toBe(true);
    expect(kids.some((k) => k.startsWith("footer") && k.includes('data-composer-host="composer"'))).toBe(true);
    expect(kids.some((k) => k.startsWith("div") && k.includes("data-message-viewport"))).toBe(true);
  });

  it("the info seam draws nothing yet, and the header's title is what toggles it", () => {
    const html = draw(makeHeader());
    expect(html).not.toContain("data-info");
    expect(html).toContain("data-header-title");
  });

  it("the log is a `log` named «الرسائل», and a conversation that is still opening says so", () => {
    const html = draw(makeHeader());
    expect(html).toContain('role="log"');
    expect(html).toContain('data-conversation-id="c1"');
    expect(html).toContain(AR["chatc.loading"]);
  });

  it("the owner's silent reading says so under the header, and an external partner is told", () => {
    expect(draw(makeHeader({ me: { oversight: true, canPost: false } }))).toContain(AR["chatc.oversight_banner"]);
    expect(draw(makeHeader({ space: { id: "s1", name: "المبيعات", hasExternal: true } }))).toContain(AR["chatc.external"]);
  });

  it("before the header is known: a loading frame in the same box (no header, no composer)", () => {
    const html = draw();
    expect(html).toContain('data-pane-state="loading"');
    expect(html).not.toContain("data-composer-host");
  });

  it("a conversation the server will not open says so and offers the way back; a fault offers a retry", () => {
    const failed = (status: number) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(PaneUnavailable, { error: new ApiError("not_found", status), retry: noop })));
    const gone = failed(404);
    expect(gone).toContain('data-pane-state="gone"');
    expect(gone).toContain(AR["chatui.pane.not_found"]);
    expect(gone).toContain('href="/chat"');
    const down = failed(500);
    expect(down).toContain('data-pane-state="error"');
    expect(down).toContain(AR["chatui.pane.retry"]);
  });
});
