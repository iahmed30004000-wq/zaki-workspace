import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { MessageMenuV2, type MessageMenuV2Props } from "@/components/chat/v2/menu/message-menu-v2";
import { ReactionBar } from "@/components/chat/v2/menu/reaction-bar";
import { MessageBubble } from "@/components/chat/v2/message-bubble";
import { PaneActionsProvider } from "@/components/chat/v2/pane/pane-actions";
import { MenuHost, useMessageMenu } from "@/components/chat/v2/pane/seams/menu-host";
import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { askKindOf, menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { quickReactionsOf } from "@/lib/chat/v2/menu/quick-reactions";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MessageDto, ReaderDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { classTokens } from "./ui-render";

/**
 * C2.6 — the message menu of the new screen, drawn on the server: the quick-reaction bar with «⌄», the hover actions, the registry's items in Telegram's
 * order by permission, the phone's sheet, and — as Q1 asks — one render test each for «🎫 مشكلة» (`me.problemKinds`) and «اسألي مشرفتك».
 */
const noop = () => undefined;
const quick = quickReactionsOf();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Actions = PaneActionsProvider as unknown as FunctionComponent<{ conversationId: string; jumpTo: () => void; toNewest: () => void; children?: ReactNode }>;
const Menus = MenuHost as unknown as FunctionComponent<{ header: ConversationHeaderDto; members: never[]; children?: ReactNode }>;

const headerWith = (me: Partial<ConversationHeaderDto["me"]> = {}, over: Parameters<typeof makeHeader>[0] = {}) => makeHeader({ ...over, me });
const contextFor = (header: ConversationHeaderDto, message: MessageDto = makeMessage(), readers = 0) =>
  menuContextV2(message, bubbleFactsOf(header), { readerCount: readers, askKind: askKindOf(header.me.problemKinds) });

function draw(context: ReturnType<typeof contextFor>, over: Partial<MessageMenuV2Props> = {}): string {
  const props: MessageMenuV2Props = { context, quick, onAction: noop, onReact: noop, sheetOpen: false, onSheetOpenChange: noop, menuOpen: false, onMenuOpenChange: noop, portal: false, ...over };
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(MessageMenuV2, props)));
}
const items = (html: string) => [...html.matchAll(/data-menu-item="(\w+)"/g)].map((m) => m[1]!);
const label = (key: string) => AR[key]!;

describe("the quick-reaction bar", () => {
  const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ReactionBar, { emojis: quick, onPick: noop, onMore: noop })));

  it("six emojis (today's six) and «⌄» that opens the full picker, as buttons with names a screen reader reads", () => {
    expect([...html.matchAll(/data-quick-reaction="([^"]+)"/g)].map((m) => m[1])).toEqual([...CHAT_REACTIONS]);
    expect(html).toContain("data-reaction-more");
    expect(html).toContain(`aria-label="${label("chatui.menu.react_more")}"`);
    for (const emoji of CHAT_REACTIONS) expect(html).toContain(`aria-label="${label("chatc.menu.react")} ${emoji}"`);
    expect(html).toContain('role="group"');
  });

  it("each target is 40 px and every colour is a theme token, every side logical", () => {
    expect(classTokens(html)).toContain("size-10");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t))).toEqual([]);
  });
});

describe("the hover actions of a bubble (the computer)", () => {
  it("a person who may post gets «↩» and a reaction button and «⋯», all hidden until the pointer rests on the bubble, never on a touch screen", () => {
    const html = draw(contextFor(makeHeader()));
    expect(html).toContain("data-hover-reply");
    expect(html).toContain("data-hover-react");
    expect(html).toContain("data-message-menu-trigger");
    expect(html).toContain(`aria-label="${label("chatc.menu.reply")}"`);
    expect(html).toContain(`aria-label="${label("chatc.menu.react")}"`);
    const tokens = classTokens(html);
    expect(tokens).toContain("opacity-0");
    expect(tokens).toContain("group-hover:opacity-100");
    expect(tokens).toContain("group-focus-within:opacity-100");
    expect(tokens).toContain("[@media(hover:none)]:hidden");
  });

  it("a person who may not post has no «↩» (the registry's rule, not the screen's) but can still react and open the menu", () => {
    const html = draw(contextFor(headerWith({ canPost: false })));
    expect(html).not.toContain("data-hover-reply");
    expect(html).toContain("data-hover-react");
    expect(html).toContain("data-message-menu-trigger");
  });

  it("nothing at all on a deleted message, on a system line, and for the owner reading in silent oversight (a reaction is refused to him)", () => {
    expect(draw(contextFor(makeHeader(), makeMessage({ deleted: true })))).toBe("");
    expect(draw(contextFor(makeHeader(), makeMessage({ kind: "SYSTEM", body: null })))).toBe("");
    expect(draw(contextFor(headerWith({ oversight: true, canPost: false })))).toBe("");
  });
});

describe("the menu, from the registry, in Telegram's order", () => {
  it("a member in a topic: the quick bar on top, then reply, copy, copy link, forward (no pin, edit, note or delete on somebody else's message)", () => {
    const html = draw(contextFor(headerWith({ canMakeWork: false })), { menuOpen: true });
    expect(html).toContain("data-reaction-bar");
    expect(items(html)).toEqual(["reply", "copy", "copyLink", "forward"]);
    expect(html.indexOf("data-reaction-bar")).toBeLessThan(html.indexOf('data-menu-item="reply"'));
    for (const key of ["chatc.menu.reply", "chatui.menu.copy", "chatui.menu.copy_link", "chatui.menu.forward"]) expect(html).toContain(label(key));
  });

  it("a moderator on her own message: …edit, delete (in danger colour), then task, ticket, note — Telegram's, then ours", () => {
    const header = headerWith({ canModerate: true, canMakeWork: true });
    const html = draw(contextFor(header, makeMessage({ mine: true })), { menuOpen: true });
    expect(items(html)).toEqual(["reply", "copy", "copyLink", "pin", "forward", "edit", "delete", "task", "ticket", "note"]);
    // the dangerous one is marked and is not last any more (ours follow it, as in the plan)
    expect(html).toMatch(/data-menu-item="delete"[^>]*class="[^"]*text-danger|text-danger[^"]*"[^>]*data-menu-item="delete"/);
    expect(html).toContain(label("chatui.menu.delete"));
  });

  it("the guest: reply (if she may post), copy, copy link, forward — no work, no note, no translate", () => {
    const html = draw(contextFor(headerWith({ canPost: true, canMakeWork: false, canTranslate: false })), { menuOpen: true });
    expect(items(html)).toEqual(["reply", "copy", "copyLink", "forward"]);
  });

  it("«مين شاف» lists today's readers of that message, and only in a topic or a group where somebody has read up to it", () => {
    expect(items(draw(contextFor(makeHeader(), makeMessage(), 2), { menuOpen: true }))).toContain("seen");
    expect(items(draw(contextFor(makeHeader(), makeMessage(), 0), { menuOpen: true }))).not.toContain("seen");
    expect(items(draw(contextFor(makeHeader({ kind: "DM", space: null }), makeMessage(), 2), { menuOpen: true }))).not.toContain("seen");
  });

  it("the phone's long press opens the SAME list as a sheet, with the quick bar on top and 44 px rows", () => {
    const html = draw(contextFor(headerWith({ canMakeWork: false })), { sheetOpen: true });
    expect(items(html)).toEqual(["reply", "copy", "copyLink", "forward"]);
    expect(html).toContain("data-reaction-bar");
    expect(classTokens(html)).toContain("min-h-11");
    expect(html).toContain(label("chatc.menu.title"));
  });
});

describe("Q1 carry-over: «🎫 مشكلة» (me.problemKinds) in the menu", () => {
  const kinds = [
    { key: "wrong_number", label: "رقم غلط أو ما في واتساب" },
    { key: "other", label: "غير ذلك" },
  ];

  it("is drawn on a text message for staff whose header carries the problem kinds", () => {
    const html = draw(contextFor(headerWith({ problemKinds: kinds })), { menuOpen: true });
    expect(items(html)).toContain("problem");
    expect(html).toContain(label("tickets.menu.problem"));
    expect(label("tickets.menu.problem")).toContain("🎫");
  });

  it("is not drawn without them (the switch is off, or a guest), nor on a voice note", () => {
    expect(items(draw(contextFor(makeHeader()), { menuOpen: true }))).not.toContain("problem");
    expect(items(draw(contextFor(headerWith({ problemKinds: kinds }), makeMessage({ kind: "VOICE", body: null })), { menuOpen: true }))).not.toContain("problem");
  });
});

describe("Q1 carry-over: «اسألي مشرفتك» in the menu", () => {
  const withQuestion = [
    { key: "wrong_number", label: "رقم غلط أو ما في واتساب" },
    { key: "product_question", label: "سؤال عن منتج" },
  ];

  it("is drawn on a text message when the company's problem kinds have the question kind, right after «🎫 مشكلة»", () => {
    const html = draw(contextFor(headerWith({ problemKinds: withQuestion })), { menuOpen: true });
    expect(items(html)).toContain("ask");
    expect(items(html).indexOf("ask")).toBe(items(html).indexOf("problem") + 1);
    expect(html).toContain("اسألي مشرفتك");
  });

  it("is not drawn when the kinds do not have it, or there are none", () => {
    expect(items(draw(contextFor(headerWith({ problemKinds: [{ key: "other", label: "غير ذلك" }] })), { menuOpen: true }))).not.toContain("ask");
    expect(items(draw(contextFor(makeHeader()), { menuOpen: true }))).not.toContain("ask");
  });
});

describe("the menu inside a bubble (the seam of the pane)", () => {
  function Bubble({ header, message, readers }: { header: ConversationHeaderDto; message: MessageDto; readers?: ReaderDto[] }) {
    const facts = React.useMemo(() => bubbleFactsOf(header), [header]);
    const menu = useMessageMenu(facts);
    return createElement(MessageBubble, { message, conversationId: header.id, facts, start: true, end: true, mentionNames: [], menu, readers, onReact: noop, onJump: noop });
  }
  const inPane = (header: ConversationHeaderDto, message: MessageDto, readers?: ReaderDto[]) =>
    renderToStaticMarkup(
      createElement(
        Translations,
        { initial: "ar" },
        createElement(
          Queries,
          { client: new QueryClient() },
          createElement(Actions, { conversationId: header.id, jumpTo: noop, toNewest: noop }, createElement(Menus, { header, members: [] }, createElement(Bubble, { header, message, readers }))),
        ),
      ),
    );

  it("a bubble of a member carries the hover actions beside it, inside the `group` that shows them", () => {
    const html = inPane(makeHeader(), makeMessage());
    expect(html).toContain("data-message-hover");
    expect(html).toContain("data-hover-reply");
    expect(classTokens(html)).toContain("group");
  });

  it("the owner reading in silent oversight gets no menu and no hover on any bubble", () => {
    const html = inPane(headerWith({ oversight: true, canPost: false }), makeMessage());
    expect(html).not.toContain("data-message-hover");
    expect(html).not.toContain("data-message-menu-trigger");
  });

  it("a deleted message has none", () => {
    expect(inPane(makeHeader(), makeMessage({ deleted: true, body: null }))).not.toContain("data-message-hover");
  });
});
