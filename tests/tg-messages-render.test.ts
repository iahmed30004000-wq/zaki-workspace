import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
// «تيليجرام على التلفون» switched ON, on a phone: the server's render cannot know the screen, so the two hooks are told. The switch OFF is what every older
// render test of the chat already draws (no provider).
vi.mock("@/components/shell/tg-phone", () => ({ useTgPhone: () => true, useTgPhoneOn: () => true, TgPhoneProvider: ({ children }: { children: unknown }) => children }));

import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { EmojiEffectPieces } from "@/components/chat/v2/bubble/emoji-effect";
import { EmojiKeyboard, EmojiSkeleton } from "@/components/chat/v2/composer/emoji-panel";
import { ReplyEditBar } from "@/components/chat/v2/composer/reply-edit-bar";
import { ReplyOptions } from "@/components/chat/v2/composer/reply-options";
import { StickerStrip } from "@/components/chat/v2/composer/sticker-strip";
import { MessageOverlay, type MessageOverlayProps } from "@/components/chat/v2/menu/message-overlay";
import { TgConfirm } from "@/components/chat/v2/menu/tg-confirm";
import { SelectionBottomBar, TgSelectionBar, singleOffer } from "@/components/chat/v2/menu/tg-selection-bar";
import { PinnedBar } from "@/components/chat/v2/pane/pinned-bar";
import { menuFor } from "@/components/chat/message/message-menu-registry";
import { menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { AR } from "@/lib/i18n/dict";
import type { MessageDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { render, textOf } from "./ui-render";

const noop = () => undefined;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const withQueries = (element: ReactElement) => render(createElement(Queries, { client: new QueryClient() }, element));
const read = (rel: string) => readFileSync(path.join(path.resolve(__dirname, ".."), rel), "utf8").replace(/\r\n/g, "\n");
const word = (key: string) => AR[key]!;
const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

describe("a tap on a message: the dim, the bar of seven and the menu", () => {
  const header = makeHeader({ kind: "DM" });
  const mine = makeMessage({ mine: true });
  const context = menuContextV2(mine, bubbleFactsOf(header), { readerCount: 0, askKind: false });
  const draw = (over: Partial<MessageOverlayProps> = {}) =>
    render(
      createElement(MessageOverlay, {
        open: true, onClose: noop, context, actions: menuFor(context), quick: CHAT_REACTIONS, chosen: new Set(["🔥"]),
        anchor: () => null, openedBy: () => null, onPick: noop, onHide: noop, onReact: noop, portal: false, ...over,
      }),
    );
  const html = draw();

  it("seven reactions and «⌄», mine on a grey ground", () => {
    expect(attr(html, "data-quick-reaction")).toHaveLength(7);
    expect(html).toContain("data-reaction-more");
    expect(html).toMatch(/data-quick-reaction="🔥"[^>]*data-tg-chosen/);
  });

  it("the menu is the spec's six in its words, then «المزيد»; the rest is not on the first page", () => {
    expect(attr(html, "data-menu-item")).toEqual(["reply", "copy", "forward", "pin", "edit", "delete"]);
    const text = textOf(html);
    for (const key of ["reply", "copy", "forward", "pin", "edit", "delete", "more"]) expect(text).toContain(word(`tgmsg.menu.${key}`));
    expect(html).toContain("data-menu-more");
    expect(html).not.toContain('data-menu-item="copyLink"');
    expect(html).not.toContain('data-menu-item="hide-for-me"');
  });

  it("it is a modal layer with a name, and its dim and panels carry the spec's timings", () => {
    expect(html).toContain("data-tg-message-overlay");
    expect(html).toContain(word("tgmsg.menu.label"));
    expect(html).toContain("--tg-message-dim-ms:140ms");
    expect(html).toContain("--tg-message-menu-ms:150ms");
    expect(html).toContain("zk-tg-dim");
  });

  it("a pinned message says «إلغاء التثبيت»", () => {
    const pinned = menuContextV2(makeMessage({ mine: true, pinned: true }), bubbleFactsOf(header), { readerCount: 0, askKind: false });
    expect(textOf(draw({ context: pinned, actions: menuFor(pinned) }))).toContain(word("tgmsg.menu.unpin"));
  });
});

describe("Telegram's dialog", () => {
  it("«حذف الرسالة»، the question, «إلغاء» then a red «حذف»، no corner ✕", () => {
    const html = render(createElement(TgConfirm, { open: true, onOpenChange: noop, title: word("tgmsg.del.title.one"), body: word("tgmsg.del.body.one"), confirmLabel: word("tgmsg.del.confirm"), danger: true, onConfirm: noop, portal: false }));
    const text = textOf(html);
    expect(text.indexOf(word("tgmsg.cancel"))).toBeLessThan(text.lastIndexOf(word("tgmsg.del.confirm")));
    expect(html).toMatch(/data-tg-confirm-do[^>]*text-danger/);
    expect(html).not.toContain(`aria-label="${word("ui.close")}"`);
    expect(html).toContain("zk-tg-dialog");
    expect(html).toContain("--tg-delete-dialog-ms:100ms");
  });
});

describe("selection mode", () => {
  const bar = (count: number, over: Record<string, unknown> = {}) => render(createElement(TgSelectionBar, { count, canCopy: true, canDelete: true, canTask: true, onCopy: noop, onDelete: noop, onTask: noop, onClose: noop, ...over }));

  it("one message: ✕ · «محددة» · تعديل · تثبيت · نسخ · حذف", () => {
    const html = bar(1, { onEdit: noop, onPin: noop });
    expect(textOf(html)).toContain(word("tgmsg.sel.count.one"));
    expect(attr(html, "data-selection-action")).toEqual(["edit", "pin", "copy", "delete"]);
    expect(html).toContain("data-selection-close");
    expect(html).toContain("data-selection-more");
  });

  it("two: «محددتان»، and no edit (nor pin)", () => {
    const html = bar(2);
    expect(textOf(html)).toContain(word("tgmsg.sel.count.two"));
    expect(attr(html, "data-selection-action")).toEqual(["copy", "delete"]);
  });

  it("who may edit and pin is the registry's answer, and only for ONE message", () => {
    const header = makeHeader({ kind: "DM" });
    expect(singleOffer([makeMessage({ mine: true })], header)).toMatchObject({ reply: true, edit: true, pin: true });
    expect(singleOffer([makeMessage({ mine: false })], header)).toMatchObject({ reply: true, edit: false });
    expect(singleOffer([makeMessage({ id: "a" }), makeMessage({ id: "b" })], header)).toBeNull();
  });

  it("at the bottom «رد» and «تحويل»; with two picked only «تحويل»", () => {
    const one = render(createElement(SelectionBottomBar, { onReply: noop, onForward: noop, canForward: true }));
    expect(textOf(one)).toContain(word("tgmsg.sel.reply"));
    expect(textOf(one)).toContain(word("tgmsg.sel.forward"));
    const two = render(createElement(SelectionBottomBar, { onForward: noop, canForward: true }));
    expect(two).not.toContain("data-selection-reply");
    expect(two).toContain("data-selection-forward");
  });

  it("the box is hidden, never unmounted, while messages are picked (its words, files and recording stay)", () => {
    const host = read("src/components/chat/v2/pane/seams/composer-host.tsx");
    expect(host).toContain("<SelectionBottomBarHost header={header} />");
    expect(host).toContain('<div data-composer-body="" className={picking ? "hidden" : "contents"}>');
  });
});

describe("the reply bar and the edit bar", () => {
  const reply = makeMessage({ id: "r1", authorName: "سلمى", body: "الطلب جاهز" });
  const draw = (props: Partial<React.ComponentProps<typeof ReplyEditBar>>) => render(createElement(ReplyEditBar, { reply: null, editing: null, onCancelReply: noop, onCancelEdit: noop, onOptions: noop, ...props }));

  it("slides up: «الرد على …» and «انقر هنا لعرض خيارات الرد»، the words open the options, ✕ ends it", () => {
    const html = draw({ reply });
    expect(html).toContain("data-reply-bar");
    expect(html).toContain("zk-tg-slide-up");
    expect(html).toContain("--tg-bar-slide-ms:150ms");
    expect(textOf(html)).toContain("الرد على سلمى");
    expect(textOf(html)).toContain(word("tgmsg.reply.hint"));
    expect(html).toContain("data-reply-options-open");
    expect(html).toContain(`aria-label="${word("chatc.cancel_reply")}"`);
  });

  it("a picked quote takes the hint's place", () => {
    const html = draw({ reply, quote: "جاهز" });
    expect(html).toContain("data-reply-quote");
    expect(textOf(html)).not.toContain(word("tgmsg.reply.hint"));
  });

  it("an edit: «تعديل الرسالة» over the old words", () => {
    const html = draw({ editing: reply });
    expect(html).toContain("data-edit-bar");
    expect(textOf(html)).toContain(word("chatc.editing"));
    expect(textOf(html)).toContain("الطلب جاهز");
    expect(html).not.toContain("data-reply-options-open");
  });
});

describe("«خيارات الرد»", () => {
  const draw = (message: MessageDto) => render(createElement(ReplyOptions, { open: true, onOpenChange: noop, message, quote: null, onApply: noop, onCancelReply: noop, portal: false }));

  it("the message with its words selectable, quote a part, apply, and «عدم الرد» in red; no reply in another chat", () => {
    const html = draw(makeMessage({ body: "الطلب جاهز للشحن" }));
    const text = textOf(html);
    for (const key of ["screen_title", "screen_hint", "pick_quote", "apply", "cancel"]) expect(text).toContain(word(`tgmsg.reply.${key}`));
    expect(html).toContain("data-quotable");
    expect(html).toContain("select-text");
    expect(html).toMatch(/data-reply-stop[^>]*text-danger/);
    expect(text).not.toContain("محادثة أخرى");
  });

  it("a message with no words has nothing to quote", () => {
    expect(draw(makeMessage({ body: null, kind: "VOICE" }))).not.toContain("data-reply-pick-quote");
  });
});

describe("the pinned bar", () => {
  const pins = [{ id: "m2", authorName: "عمر", preview: "الأحدث" }];
  const draw = (canUnpinAll: boolean, tg = true) => withQueries(createElement(PinnedBar, { pins, onJump: noop, tg, conversationId: "c1", canUnpinAll }));

  it("has its ✕ for whoever may pin, and none for the others", () => {
    expect(draw(true)).toContain("data-pinned-unpin");
    expect(draw(true)).toContain(`aria-label="${word("tgmsg.pin.close")}"`);
    expect(draw(false)).not.toContain("data-pinned-unpin");
    expect(draw(true, false)).toContain("data-pinned-unpin");
  });

  it("the ✕ asks, then offers «تراجع» through the same door that pins", () => {
    const src = read("src/components/chat/v2/pane/pinned-bar.tsx");
    expect(src).toContain("callDoor(doors.pin(messageId))");
    expect(src).toContain('label: ct("tgmsg.undo")');
    expect(src).toContain('title={ct("tgmsg.pin.unpin_title")}');
  });
});

describe("the emoji panel under the box", () => {
  const draw = (zaki: boolean) => render(createElement(EmojiKeyboard, { recents: ["😂"], zaki, onEmoji: noop, onSticker: noop, onBackspace: noop }));

  it("«الرموز التعبيرية» · «الملصقات» and ⌫ at the bottom; the packs, the search and the categories on top; no pictures-that-move tab", () => {
    const html = draw(true);
    expect(attr(html, "data-tg-panel-tab")).toEqual(["emoji", "stickers"]);
    expect(html).toContain("data-tg-backspace");
    expect(attr(html, "data-tg-pack")).toEqual(["emoji", "zaki", "task"]);
    expect(html).toContain("data-tg-categories");
    expect(textOf(html)).not.toContain("صور متحركة");
  });

  it("no stickers where our pack is switched off", () => {
    const html = draw(false);
    expect(attr(html, "data-tg-panel-tab")).toEqual(["emoji"]);
    expect(attr(html, "data-tg-pack")).toEqual(["emoji"]);
  });

  it("the skeleton is grey squares, row after row", () => {
    const html = render(createElement(EmojiSkeleton, { staggered: true }));
    expect(html).toContain("zk-tg-skeleton");
    expect((html.match(/bg-surface-2/g) ?? []).length).toBeGreaterThanOrEqual(32);
  });
});

describe("the sticker strip and the big emoji", () => {
  it("the strip names each sticker; nothing for none", () => {
    const html = render(createElement(StickerStrip, { ids: ["joy", "laugh"], onPick: noop }));
    expect(attr(html, "data-sticker-suggestion")).toEqual(["joy", "laugh"]);
    expect(html).toContain("zaki-emojis/joy.webp");
    expect(render(createElement(StickerStrip, { ids: [], onPick: noop }))).toBe("");
  });

  const bubble = (message: MessageDto) => {
    const props: MessageBubbleProps = { message, conversationId: "c1", facts: bubbleFactsOf(makeHeader()), start: true, end: true, mentionNames: [], onReact: noop, onJump: noop };
    return withQueries(createElement(MessageBubble, props));
  };

  it("one emoji alone stands big and alive, without a bubble, its time on a pill", () => {
    const html = bubble(makeMessage({ body: "😂" }));
    expect(html).toContain("data-tg-bare");
    expect(html).toContain("max-md:bg-transparent");
    expect(html).toContain("data-tg-alive");
    expect(html).toContain("zk-tg-alive");
    expect(html).toContain("max-md:rounded-full");
  });

  it("a just-sent one shows its grey shadow first", () => {
    const html = bubble(makeMessage({ body: "😂", createdAt: new Date().toISOString() }));
    expect(html).toContain("zk-tg-ghost");
    expect(html).toContain("zk-tg-wake");
    expect(html).toContain("--tg-send-emoji-ms:300ms");
  });

  it("two emojis, an emoji with a quote, and words keep their bubble", () => {
    for (const message of [makeMessage({ body: "😂😂" }), makeMessage({ body: "😂", replyTo: { id: "q", preview: "x", authorName: "ليلى" } }), makeMessage({ body: "مرحبا 😂" })]) expect(bubble(message)).not.toContain("data-tg-bare");
  });

  it("the full-screen play takes no touch and is silent to a screen reader; a laugh brings Arabic words", () => {
    const html = render(createElement(EmojiEffectPieces, { glyph: "😂" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(textOf(html)).toContain(word("tgmsg.effect.laugh_short"));
    expect(textOf(html)).not.toMatch(/[A-Za-z]/);
  });
});

describe("found in a real browser", () => {
  const bubbleOf = (message: MessageDto) => withQueries(createElement(MessageBubble, { message, conversationId: "c1", facts: bubbleFactsOf(makeHeader()), start: true, end: true, mentionNames: [], onReact: noop, onJump: noop } satisfies MessageBubbleProps));

  it("a short message keeps one line on a touch screen: the width limit is not a share of a box that shrinks to the words", () => {
    expect(bubbleOf(makeMessage({ body: "رسالة رقم 1" }))).toContain("max-md:max-w-[min(82vw,100%)]");
  });

  it("the grid's category names keep their height: frimousse measures it from a header with no name", () => {
    const panel = read("src/components/chat/v2/composer/emoji-panel.tsx");
    expect(panel).toContain("CategoryHeader: TgCategoryHeader,");
    expect(panel).toContain('{group ? groupLabels()[group] : "\u00a0"}');
  });

  it("only a jump to a message slides: the landing on the first unread when a chat opens stays instant", () => {
    expect(read("src/lib/chat/viewport/use-message-viewport.ts")).toContain('wanted: smoothRef.current && target.align === "center"');
  });

  it("nothing that grows or slides gives the log a sideways scroll", () => {
    expect(read("src/components/chat/v2/pane/message-viewport.tsx")).toContain('tg && "overflow-x-hidden"');
  });

  it("a pill on its way is never drawn on a message that was deleted meanwhile", () => {
    expect(read("src/components/chat/v2/message-bubble.tsx")).toContain("pending === null || message.deleted ? message.reactions : withPendingReaction(message.reactions, pending)");
  });
});

describe("what a server render cannot see, held by the source", () => {
  it("the emoji grid gives frimousse's viewport a height from the layout: it sets `position: relative` on it by itself, so an absolute box would grow to every emoji and never scroll", () => {
    const panel = read("src/components/chat/v2/composer/emoji-panel.tsx");
    const grid = panel.slice(panel.indexOf("export function TgEmojiGrid"));
    expect(grid).toContain('<EmojiPicker.Viewport ref={viewport} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">');
    expect(grid).toContain('<div className="relative flex min-h-0 flex-1 flex-col"');
  });

  it("a closing pin dialog keeps the words it opened with", () => {
    const menuSrc = read("src/components/chat/v2/menu/message-menu-v2.tsx");
    expect(menuSrc).toContain("open={pinOpen}");
    expect(menuSrc).not.toContain("open={pinAsk !== null}");
  });

  const css = read("src/components/chat/v2/phone/tg-messages.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("every animation of the stylesheet waits for «no preference» about motion, and the switches of «التأثيرات الحركية» stop them", () => {
    const outside = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(outside).not.toMatch(/\banimation|\btransition|@keyframes/);
    for (const key of ["transitions", "zoom", "emoji"]) expect(css).toContain(`html[data-fx-off~="${key}"]`);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });

  it("only transform and opacity move", () => {
    for (const frame of css.match(/@keyframes[\s\S]*?\n {2}\}/g) ?? []) expect(frame.replace(/@keyframes[^{]*\{/, "")).not.toMatch(/\b(?:width|height|top|left|margin|padding|filter|clip-path)\s*:/);
  });

  it("what no stylesheet can stop asks the switch itself: dust, flight, sparks, the full screen, the sliding rows", () => {
    const fx = read("src/components/chat/v2/phone/message-fx.ts");
    for (const key of ["dust", "particles", "emoji", "transitions"]) expect(fx).toContain(`effectOn("${key}")`);
    expect(read("src/components/chat/v2/phone/use-message-motion.ts")).toContain('effectOn("transitions")');
    expect(read("src/components/chat/v2/bubble/jumbo-emoji.tsx")).toContain('effectOn("particles")');
  });

  it("the log notes where the rows are while it renders and slides them after the viewport's own anchor is back", () => {
    const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");
    expect(viewport).toContain("data-row-key={String(item.key)}");
    expect(viewport.indexOf("useMessageViewport({")).toBeLessThan(viewport.indexOf("useMessageMotion({"));
    expect(viewport).toContain("zk-tg-flash");
  });

  it("the tap, the long press and the double tap of the phone are the bubble's, behind the switch", () => {
    const bubbleSrc = read("src/components/chat/v2/message-bubble.tsx");
    expect(bubbleSrc).toContain("{...(tg && menuNode");
    expect(bubbleSrc).toContain("longPressDoes({ phone: tg, canSelect })");
    expect(bubbleSrc).toContain("selectionStore.begin(message.id)");
  });
});
