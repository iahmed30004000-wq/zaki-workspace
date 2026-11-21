import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { StickyDateChip } from "@/components/chat/v2/pane/floating";
import { MessageMenuV2, type MessageMenuV2Props } from "@/components/chat/v2/menu/message-menu-v2";
import { menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { quickReactionsOf } from "@/lib/chat/v2/menu/quick-reactions";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { ParityActionsContext } from "@/lib/chat/v2/phone/parity-actions";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { DateJumpSheet } from "@/components/chat/v2/pane/date-jump-sheet";
import { ReplyEditBar } from "@/components/chat/v2/composer/reply-edit-bar";
import { SelectionBar } from "@/components/chat/v2/menu/selection-bar";
import { ReplyBlock } from "@/components/chat/v2/bubble/bubble-parts";
import { chatKeys, LATEST, type MessageDto, type MessagesData } from "@/lib/chat/cache";
import { hideInData } from "@/lib/chat/cache/reducers";
import { applySync, hideMessage } from "@/lib/chat/cache/writer";
import { Outbox, sanitizeItem, type OutboxItem, type SendOutcome } from "@/lib/chat/outbox/queue";
import { memoryOutboxStorage } from "@/lib/chat/outbox/storage";
import { startOptimisticSend, type OptimisticDeps } from "@/lib/chat/outbox/optimistic";
import { postChatMessage, sendOutboxItem, type ChatSendPayload } from "@/lib/chat/outbox/send";
import { resetPendingForTests } from "@/lib/chat/cache/pending";
import { QUOTE_MAX, cleanQuote, quoteFromSelection, quoteIsPartOf } from "@/lib/chat/v2/menu/gestures";
import { replyQuoteStore } from "@/lib/chat/v2/phone/reply-quote";
import { dayKeyOf, daysUrl, monthGrid, monthKeyOf, onDateUrl, shiftMonth, WEEK_START } from "@/lib/chat/v2/phone/date-jump";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

const Translations = I18nProvider as unknown as React.FunctionComponent<{ initial: "ar"; children?: React.ReactNode }>;
const draw = (node: React.ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, node));
const src = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const noop = () => undefined;

describe("(d) the quote: what may be quoted and how long", () => {
  it("is cut to 280 characters, whitespace collapsed, empty is nothing", () => {
    expect(QUOTE_MAX).toBe(280);
    expect(cleanQuote("  هاد   \n  نص  ")).toBe("هاد نص");
    expect(cleanQuote("   ")).toBeNull();
    expect(cleanQuote(null)).toBeNull();
    expect(cleanQuote(undefined)).toBeNull();
    expect(cleanQuote("ك".repeat(500))).toHaveLength(280);
    // never cut in the middle of a character made of two code units
    const cut = cleanQuote("😀".repeat(300)) as string;
    expect([...cut]).toHaveLength(280);
    expect(cut.endsWith("\uD83D")).toBe(false);
  });

  it("a quote must be a piece of the words it quotes (the formatted or the plain ones), spaces aside", () => {
    expect(quoteIsPartOf("عشرة الصبح", "الاجتماع الساعة عشرة   الصبح")).toBe(true);
    expect(quoteIsPartOf("مهم جدا", "هاد **مهم جدا** اليوم", "هاد مهم جدا اليوم")).toBe(true);
    expect(quoteIsPartOf("كلام آخر", "الاجتماع الساعة عشرة الصبح")).toBe(false);
    expect(quoteIsPartOf("", "x")).toBe(false);
  });

  it("a selection is a quote only when both of its ends are inside ONE message", () => {
    expect(quoteFromSelection({ text: " عشرة الصبح ", anchorMessageId: "m1", focusMessageId: "m1" })).toEqual({ messageId: "m1", quote: "عشرة الصبح" });
    expect(quoteFromSelection({ text: "x", anchorMessageId: "m1", focusMessageId: "m2" })).toBeNull();
    expect(quoteFromSelection({ text: "x", anchorMessageId: null, focusMessageId: "m2" })).toBeNull();
    expect(quoteFromSelection({ text: "   ", anchorMessageId: "m1", focusMessageId: "m1" })).toBeNull();
  });
});

describe("(d) the quote waits for the reply it belongs to", () => {
  beforeEach(() => replyQuoteStore.clear());

  it("is kept for one (conversation, message) and taken once", () => {
    replyQuoteStore.set("c1", "m1", "  عشرة   الصبح ");
    expect(replyQuoteStore.peek("c1", "m1")).toBe("عشرة الصبح");
    expect(replyQuoteStore.peek("c1", "m2")).toBeNull();
    expect(replyQuoteStore.peek("c2", "m1")).toBeNull();
    expect(replyQuoteStore.take("c1", "m1")).toBe("عشرة الصبح");
    expect(replyQuoteStore.take("c1", "m1")).toBeNull();
  });

  it("the newest quote wins, and the store tells its listeners", () => {
    const seen = vi.fn();
    const off = replyQuoteStore.subscribe(seen);
    replyQuoteStore.set("c1", "m1", "أولى");
    replyQuoteStore.set("c1", "m2", "ثانية");
    expect(replyQuoteStore.peek("c1", "m1")).toBeNull();
    expect(replyQuoteStore.peek("c1", "m2")).toBe("ثانية");
    replyQuoteStore.clear();
    expect(seen).toHaveBeenCalledTimes(3);
    off();
    replyQuoteStore.set("c1", "m3", "x");
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("`keepOnly` drops a quote whose reply is no longer the one being written", () => {
    replyQuoteStore.set("c1", "m1", "نص");
    replyQuoteStore.keepOnly("c1", "m1");
    expect(replyQuoteStore.peek("c1", "m1")).toBe("نص");
    replyQuoteStore.keepOnly("c1", "m9");
    expect(replyQuoteStore.peek("c1", "m1")).toBeNull();
    replyQuoteStore.set("c1", "m1", "نص");
    replyQuoteStore.keepOnly("c1", null);
    expect(replyQuoteStore.peek("c1", "m1")).toBeNull();
  });
});

const CONV = "c1";
const ME = { id: "me", name: "أنا", avatar: null };
const base = (id: string, at: string, over: Partial<MessageDto> = {}): MessageDto => ({ id, kind: "TEXT", body: `نص ${id}`, deleted: false, edited: false, pinned: false, mine: false, authorId: "other", authorName: "سارة", createdAt: at, clientId: null, mentions: [], attachments: [], reactions: [], ...over });
const windowOf = (qc: QueryClient): MessageDto[] => qc.getQueryData<MessagesData>(chatKeys.messages(CONV))!.pages.flatMap((p) => p.messages);

describe("(d) the quote rides with the send, through the outbox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:10.000Z"));
    resetPendingForTests();
    replyQuoteStore.clear();
  });
  afterEach(() => vi.useRealTimers());

  function rig() {
    const qc = new QueryClient();
    qc.setQueryData<MessagesData>(chatKeys.messages(CONV), { pages: [{ messages: [base("m1", "2026-03-01T10:00:00.000Z")], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] }], pageParams: [LATEST] });
    const outbox = new Outbox({ userId: "me", storage: memoryOutboxStorage(), send: async (item: OutboxItem): Promise<SendOutcome> => ({ kind: "sent", message: base(`srv-${item.clientId}`, "2099-01-01T00:00:00.000Z", { mine: true }) }) });
    const post = vi.fn(async (_c: string, _p: ChatSendPayload): Promise<SendOutcome> => ({ kind: "transient" }));
    const deps: OptimisticDeps = { qc, outbox, post: post as unknown as NonNullable<OptimisticDeps["post"]>, online: () => true };
    return { qc, outbox, post, deps };
  }

  it("the quote the person picked is added to the request for the reply it was picked for, and only once", async () => {
    const r = rig();
    replyQuoteStore.set(CONV, "m1", "عشرة الصبح");
    const first = startOptimisticSend(r.deps, { conversationId: CONV, payload: { body: "تمام", attachmentIds: [], mentions: [], clientId: "k1", replyToId: "m1" }, author: ME });
    expect(r.post.mock.calls[0]![1]).toMatchObject({ replyToId: "m1", replyQuote: "عشرة الصبح" });
    if (first.shown) await first.done;
    // the failure is kept WITH its quote, so a retry after a reload still quotes
    const kept = r.outbox.getSnapshot()[0]!;
    expect(kept.replyQuote).toBe("عشرة الصبح");
    // the next reply to the same message has none (taken): it joins the outbox behind the first, with no quote
    startOptimisticSend(r.deps, { conversationId: CONV, payload: { body: "ثاني", attachmentIds: [], mentions: [], clientId: "k2", replyToId: "m1" }, author: ME });
    expect(r.outbox.getSnapshot().find((i) => i.clientId === "k2")?.replyQuote).toBeUndefined();
    expect(r.outbox.getSnapshot().find((i) => i.clientId === "k1")?.replyQuote).toBe("عشرة الصبح");
    expect(replyQuoteStore.peek(CONV, "m1")).toBeNull();
    r.outbox.dispose();
  });

  it("a quote picked for another message is never attached, and a send that is not a reply carries none", () => {
    const r = rig();
    replyQuoteStore.set(CONV, "m9", "نص");
    startOptimisticSend(r.deps, { conversationId: CONV, payload: { body: "تمام", attachmentIds: [], mentions: [], clientId: "k1", replyToId: "m1" }, author: ME });
    startOptimisticSend(r.deps, { conversationId: CONV, payload: { body: "عادي", attachmentIds: [], mentions: [], clientId: "k2" }, author: ME });
    expect(r.post.mock.calls[0]![1].replyQuote).toBeUndefined();
    expect(r.post.mock.calls[1]![1].replyQuote).toBeUndefined();
    expect(windowOf(r.qc).length).toBeGreaterThan(1);
    r.outbox.dispose();
  });

  it("the stored item believes a quote only as text of at most 280 characters, and the request carries it", async () => {
    const item = { clientId: "k", conversationId: CONV, body: "تمام", mentions: [], createdAt: 1, attempts: 1, replyToId: "m1", replyQuote: "عشرة" };
    expect(sanitizeItem(item)?.replyQuote).toBe("عشرة");
    expect(sanitizeItem({ ...item, replyQuote: "ك".repeat(281) })?.replyQuote).toBeUndefined();
    expect(sanitizeItem({ ...item, replyQuote: 5 })?.replyQuote).toBeUndefined();
    expect(sanitizeItem({ ...item, replyToId: undefined })?.replyQuote).toBeUndefined();
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 201, json: async () => base("srv", "2099-01-01T00:00:00.000Z") };
    });
    await postChatMessage(CONV, { body: "تمام", attachmentIds: [], mentions: [], clientId: "k", replyToId: "m1", replyQuote: "عشرة" }, fetchImpl as never, 0);
    expect(sent["replyQuote"]).toBe("عشرة");
    await postChatMessage(CONV, { body: "تمام", attachmentIds: [], mentions: [], clientId: "k", replyToId: "m1" }, fetchImpl as never, 0);
    expect(sent["replyQuote"]).toBeUndefined();
    expect(typeof sendOutboxItem).toBe("function");
  });
});

describe("(a) «حذف عندي» in the cache: the message leaves the person's windows only", () => {
  const data = (): MessagesData => ({
    pages: [{ messages: [base("m1", "2026-03-01T10:00:00.000Z"), base("m2", "2026-03-01T10:01:00.000Z"), base("m3", "2026-03-01T10:02:00.000Z", { replyTo: { id: "m2", preview: "نص m2", authorName: "سارة" } })], hasOlder: true, hasNewer: false, firstUnreadId: "m2", readers: [] }],
    pageParams: [LATEST],
  });

  it("takes the message out of its window (the window keeps its paging flags) and leaves what quotes it alone", () => {
    const next = hideInData(data(), "m2");
    expect(next.pages[0]!.messages.map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(next.pages[0]!.hasOlder).toBe(true);
    expect(next.pages[0]!.messages[1]!.replyTo?.id).toBe("m2");
    // the unread landing never points at a message that is gone
    expect(next.pages[0]!.firstUnreadId).toBeNull();
  });

  it("changes nothing (the very same object) when the message is not in the window", () => {
    const d = data();
    expect(hideInData(d, "nope")).toBe(d);
  });

  it("writes it to the conversation's window and to the pinned bar of its header", () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages(CONV), data());
    qc.setQueryData(chatKeys.header(CONV), { id: CONV, pinnedMessages: [{ id: "m2", authorName: "سارة", preview: "x" }, { id: "m1", authorName: "سارة", preview: "y" }] });
    hideMessage(qc, CONV, "m2");
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", "m3"]);
    expect((qc.getQueryData(chatKeys.header(CONV)) as { pinnedMessages: { id: string }[] }).pinnedMessages.map((p) => p.id)).toEqual(["m1"]);
    // asked without the conversation: found from the windows
    hideMessage(qc, null, "m3");
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1"]);
  });

  it("the sync answer's `hidden` ids do the same (another device of the same person)", () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages(CONV), data());
    applySync(qc, { cursor: "5", messages: [], reads: [], delivered: [], rows: [], removed: [], hidden: ["m1", "m3"] });
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("(c) the date jump: the calendar", () => {
  it("the weeks start on Saturday (the Arabic week) and hold the month's days exactly once", () => {
    expect(WEEK_START).toBe(6);
    const grid = monthGrid(2026, 11); // the 1st of November 2026 is a Sunday
    expect(grid[0]).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat().filter((d): d is number => d !== null)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(monthGrid(2026, 2).flat().filter((d) => d !== null)).toHaveLength(28);
    expect(monthGrid(2028, 2).flat().filter((d) => d !== null)).toHaveLength(29);
  });

  it("moves between months across the year, and names a day and a month", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthKeyOf(2026, 3)).toBe("2026-03");
    expect(dayKeyOf(2026, 3, 9)).toBe("2026-03-09");
  });

  it("asks the server for the days of a month and the first message of a day, in the person's own zone", () => {
    expect(daysUrl("c 1", 2026, 3, "Asia/Amman")).toBe("/api/chat/conversations/c%201/messages?days=2026-03&tz=Asia%2FAmman");
    expect(onDateUrl("c1", "2026-03-09", "Asia/Amman")).toBe("/api/chat/conversations/c1/messages?onDate=2026-03-09&tz=Asia%2FAmman");
    // no zone named: the server uses the company's own clock
    expect(daysUrl("c1", 2026, 11)).toBe("/api/chat/conversations/c1/messages?days=2026-11");
  });
});

describe("(c) the floating date chip opens the sheet", () => {
  it("without a handler it is what it was: hidden from readers, never pressable", () => {
    const html = draw(createElement(StickyDateChip, { label: "أمس", visible: true }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<button");
  });

  it("with a handler it is a real button while it shows, and cannot be pressed while it is faded out", () => {
    const on = draw(createElement(StickyDateChip, { label: "أمس", visible: true, onOpen: noop }));
    expect(on).toContain("<button");
    expect(on).toContain("data-sticky-date-button");
    expect(on).toContain("pointer-events-auto");
    expect(on).not.toContain("aria-hidden");
    const off = draw(createElement(StickyDateChip, { label: "أمس", visible: false, onOpen: noop }));
    expect(off).toContain("pointer-events-none");
    expect(off).toContain("tabindex=\"-1\"");
  });

  it("the sheet draws the month in Arabic with the week's days, every day closed until the server has said which hold messages", () => {
    const html = draw(createElement(DateJumpSheet, { open: true, onOpenChange: noop, conversationId: "c1", initial: new Date(2026, 10, 12), onJump: noop, portal: false }));
    expect(html).toContain("تشرين الثاني");
    expect(html).toContain("2026");
    expect(html).toContain(AR["chatparity.date.title"]);
    expect((html.match(/data-date-day=/g) ?? []).length).toBe(30);
    expect((html.match(/data-date-day="[^"]*"[^>]*disabled/g) ?? []).length).toBe(30);
    expect(html).toContain(AR["chatparity.date.prev"]);
    expect(html).toContain(AR["chatparity.date.next"]);
  });
});

describe("(d) the quote is drawn in the reply bar and in the reply block, as text", () => {
  const reply = base("m1", "2026-03-01T10:00:00.000Z", { body: "الاجتماع الساعة عشرة الصبح", authorName: "سارة" });

  it("the bar shows the quoted piece instead of the whole message, and says it is a quote", () => {
    const html = draw(createElement(ReplyEditBar, { reply, editing: null, quote: "عشرة الصبح", onCancelReply: noop, onCancelEdit: noop }));
    expect(html).toContain("data-reply-bar");
    expect(html).toContain("data-reply-quote");
    expect(html).toContain("عشرة الصبح");
    expect(html).not.toContain("الاجتماع الساعة");
    expect(html).toContain("سارة");
  });

  it("without a quote the bar is as it was", () => {
    const html = draw(createElement(ReplyEditBar, { reply, editing: null, onCancelReply: noop, onCancelEdit: noop }));
    expect(html).not.toContain("data-reply-quote");
    expect(html).toContain("الاجتماع الساعة عشرة الصبح");
  });

  it("a quote is escaped on render, never taken for markup", () => {
    const html = draw(createElement(ReplyEditBar, { reply, editing: null, quote: "<img src=x onerror=alert(1)>", onCancelReply: noop, onCancelEdit: noop }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    const block = draw(createElement(ReplyBlock, { replyTo: { id: "m1", preview: "كل النص", authorName: "سارة", quote: "<script>alert(1)</script>" }, onJump: noop }));
    expect(block).not.toContain("<script");
    expect(block).toContain("&lt;script");
  });

  it("the reply block in the bubble shows the quote, marked, in place of the whole preview", () => {
    const block = draw(createElement(ReplyBlock, { replyTo: { id: "m1", preview: "الاجتماع الساعة عشرة الصبح", authorName: "سارة", quote: "عشرة الصبح" }, onJump: noop }));
    expect(block).toContain("data-reply-quote");
    expect(block).toContain("عشرة الصبح");
    expect(block).not.toContain("الاجتماع الساعة");
    const plain = draw(createElement(ReplyBlock, { replyTo: { id: "m1", preview: "الاجتماع الساعة عشرة الصبح", authorName: "سارة" }, onJump: noop }));
    expect(plain).not.toContain("data-reply-quote");
    expect(plain).toContain("الاجتماع الساعة عشرة الصبح");
  });

  it("a deleted original shows no quote (it is the original's own words)", () => {
    const block = draw(createElement(ReplyBlock, { replyTo: { id: "m1", preview: null, authorName: "سارة", deleted: true, quote: "كلام محذوف" }, onJump: noop }));
    expect(block).not.toContain("كلام محذوف");
  });
});

describe("(a) the selection bar gets «حذف عندي»", () => {
  const bar = (over: Record<string, unknown> = {}) =>
    draw(createElement(SelectionBar, { count: 2, can: { forward: true, copy: true, delete: true, task: true }, onForward: noop, onCopy: noop, onDelete: noop, onTask: noop, onClose: noop, ...over } as never));

  it("draws the button only when it is wired, next to «احذف», and never offers it as the deletion for everybody", () => {
    expect(bar()).not.toContain('data-selection-action="hide"');
    const html = bar({ onHide: noop });
    expect(html).toContain('data-selection-action="hide"');
    expect(html).toContain(AR["chatparity.hide.bar"]);
    expect(html.indexOf('data-selection-action="delete"')).toBeLessThan(html.indexOf('data-selection-action="hide"'));
  });
});

describe("wiring: everything stays behind the new chat screen and is registered", () => {
  it("the pieces are wired where the spec says", () => {
    expect(src("src/components/chat/v2/pane/message-viewport.tsx")).toContain("DateJumpSheet");
    expect(src("src/components/chat/v2/pane/viewport-row.tsx")).toContain("attachReplySwipe");
    expect(src("src/components/chat/v2/menu/message-menu-v2.tsx")).toContain("useParityActions");
    expect(src("src/components/chat/v2/menu/selection-bar.tsx")).toContain("onHide");
    expect(src("src/components/chat/v2/list/chat-row.tsx")).toContain("attachRowSwipe");
    expect(src("src/components/chat/v2/pane/conversation-pane.tsx")).toContain("ParityActionsContext");
    expect(src("src/lib/i18n/dict.ts")).toContain("ar.chat-parity.json");
  });

  it("the hide door is behind chatLayoutV2 and never writes to the archive or to the message", () => {
    const hidden = src("src/server/chat/hidden-messages.ts");
    expect(hidden).toContain('"chatLayoutV2"');
    expect(hidden).not.toMatch(/chatMessage\.(update|delete)/);
    expect(src("src/app/api/chat/messages/[id]/hide/route.ts")).toContain("hideMessageForMe");
  });

  it("the swipe has `touch-action: pan-y` so the page keeps its vertical scroll", () => {
    expect(src("src/components/chat/v2/pane/viewport-row.tsx")).toContain("touch-pan-y");
    expect(src("src/components/chat/v2/list/chat-row.tsx")).toContain("touch-pan-y");
  });

  it("every parity string is Arabic with no Latin letter", () => {
    const dict = JSON.parse(src("src/lib/i18n/ar.chat-parity.json")) as Record<string, string>;
    expect(Object.keys(dict).length).toBeGreaterThan(10);
    for (const [key, value] of Object.entries(dict)) {
      expect(value.replace(/{[^{}]+}/g, " "), key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toMatch(/ـ?ً/); // no «ـاً» tanween
    }
  });
});

describe("(a) «حذف عندي» in the message menu", () => {
  const draw = (parity: boolean, over: Partial<MessageMenuV2Props> = {}) => {
    const context = menuContextV2(makeMessage(), bubbleFactsOf(makeHeader()), { readerCount: 0, askKind: false });
    const props: MessageMenuV2Props = { context, quick: quickReactionsOf(), onAction: noop, onReact: noop, sheetOpen: true, onSheetOpenChange: noop, menuOpen: true, onMenuOpenChange: noop, portal: false, ...over };
    const inner = createElement(QueryClientProvider as unknown as React.FunctionComponent<{ client: QueryClient; children?: React.ReactNode }>, { client: new QueryClient() }, createElement(MessageMenuV2, props));
    return draw2(parity ? createElement(ParityActionsContext.Provider, { value: { hide: async () => ({ ok: 1, total: 1 }) } }, inner) : inner);
  };
  const draw2 = (node: React.ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, node));

  it("the item is drawn in the computer's menu and the phone's sheet only where the pane provides the door, apart from the registry's own «احذف»", () => {
    expect(draw(false)).not.toContain('data-menu-item="hide-for-me"');
    const html = draw(true);
    expect((html.match(/data-menu-item="hide-for-me"/g) ?? []).length).toBe(2); // the menu and the sheet
    expect(html).toContain(AR["chatparity.hide.menu"]);
  });
});
