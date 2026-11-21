import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { BubbleBody } from "@/components/chat/v2/bubble/bubble-body";
import { ReactionChips } from "@/components/chat/v2/bubble/bubble-parts";
import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { ReactorsSheet } from "@/components/chat/v2/menu/reactors-sheet";
import { EmojiPickerDialog } from "@/components/chat/v2/menu/emoji-picker";
import { ZakiStickerGrid } from "@/components/chat/v2/composer/emoji-panel";
import { PendingBubble } from "@/components/chat/message/pending-bubble";
import { AR } from "@/lib/i18n/dict";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { burstedReactions, reactorRows, reactorsHidden } from "@/lib/chat-reactions";
import { ZAKI_TASK_STICKERS, emojiOnlyCount, isZakiCode, zakiIdOfCode, zakiSrc, zakiToWords } from "@/lib/chat/zaki-emoji";
import { previewOf } from "@/server/chat/redact";
import { previewText } from "@/server/chat/notify";
import { isSingleEmoji } from "@/server/chat/messages";
import type { ReactionDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { render } from "./ui-render";

(globalThis as { React?: typeof React }).React = React;

const root = process.cwd();
const read = (rel: string): string => readFileSync(path.join(root, rel), "utf8");
const noop = () => undefined;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const facts = bubbleFactsOf(makeHeader());
const drawBubble = (message: ReturnType<typeof makeMessage>, over: Partial<MessageBubbleProps> = {}): string => {
  const props: MessageBubbleProps = { message, conversationId: "c1", facts, start: true, end: true, mentionNames: [], onReact: noop, onJump: noop, ...over };
  return renderToStaticMarkup(createElement(Queries, { client: new QueryClient() }, createElement(MessageBubble, props) as ReactElement));
};
const drawBody = (body: string, fresh = false): string => renderToStaticMarkup(createElement(BubbleBody, { message: makeMessage({ body }), mentionNames: [], conversationId: "c1", orderChips: false, fresh }));

describe("what counts as an emoji-only message", () => {
  it("one to three emojis — unicode, Zaki or both — with spaces between", () => {
    expect(emojiOnlyCount("😀")).toBe(1);
    expect(emojiOnlyCount(" 😀 🔥 ")).toBe(2);
    expect(emojiOnlyCount("😀🔥👍")).toBe(3);
    expect(emojiOnlyCount(":zaki_love:")).toBe(1);
    expect(emojiOnlyCount(":zaki_love: 😀")).toBe(2);
    expect(emojiOnlyCount(":zaki_love::zaki_fire::zaki_clap:")).toBe(3);
  });

  it("a flag, a keycap, a skin tone and a family are ONE emoji each", () => {
    expect(emojiOnlyCount("🇯🇴")).toBe(1);
    expect(emojiOnlyCount("1️⃣")).toBe(1);
    expect(emojiOnlyCount("👍🏽")).toBe(1);
    expect(emojiOnlyCount("👨‍👩‍👧")).toBe(1);
    expect(emojiOnlyCount("❤️")).toBe(1);
  });

  it("is not one when there are words, more than three, no emoji at all, an unknown code, or a plain symbol", () => {
    expect(emojiOnlyCount("شكرا 😀")).toBe(0);
    expect(emojiOnlyCount("😀😀😀😀")).toBe(0);
    expect(emojiOnlyCount(":zaki_love: x")).toBe(0);
    expect(emojiOnlyCount(":zaki_nothing:")).toBe(0);
    expect(emojiOnlyCount("")).toBe(0);
    expect(emojiOnlyCount("   ")).toBe(0);
    expect(emojiOnlyCount("123")).toBe(0);
    expect(emojiOnlyCount("©")).toBe(0);
    expect(emojiOnlyCount("**😀**")).toBe(0);
  });
});

describe("a Zaki code as a reaction", () => {
  it("is a known id inside one pair of colons and nothing else", () => {
    expect(zakiIdOfCode(":zaki_clap:")).toBe("clap");
    expect(zakiIdOfCode(":zaki_task_done:")).toBe("task_done");
    expect(isZakiCode(":zaki_clap:")).toBe(true);
    for (const bad of [":zaki_nothing:", "x :zaki_clap:", ":zaki_clap: ", ":zaki_clap::zaki_clap:", ":ZAKI_CLAP:", "clap", ""]) expect(isZakiCode(bad), bad).toBe(false);
  });

  it("the server takes a known code and a real emoji; any other text is not a reaction", () => {
    for (const ok of [":zaki_smile:", ":zaki_task_in_progress:", "👍", "❤️", "🇯🇴", "1️⃣", "👍🏽"]) expect(isSingleEmoji(ok), ok).toBe(true);
    for (const bad of ["", ":zaki_nothing:", "hello", "<b>x</b>", "a", "😀😀", "😀 😀", ":zaki_smile: :zaki_smile:", "x".repeat(40)]) expect(isSingleEmoji(bad), bad).toBe(false);
  });
});

describe("the Arabic name instead of the raw code (push, list preview, reply quote)", () => {
  it("zakiToWords puts the name in brackets and leaves every other letter alone", () => {
    expect(zakiToWords("شكراً :zaki_thanks: كتير")).toBe("شكراً (شكراً) كتير");
    expect(zakiToWords(":zaki_love:")).toBe("(عيون قلوب)");
    expect(zakiToWords("a :zaki_nothing: b")).toBe("a :zaki_nothing: b");
    expect(zakiToWords("plain")).toBe("plain");
    expect(zakiToWords(":zaki_task_done:")).toBe("(تم)");
  });

  it("the push body and the bell show the name, never the code", () => {
    const body = previewText("مبروك :zaki_party:");
    expect(body).toBe("مبروك (احتفال)");
    expect(body).not.toContain(":zaki_");
    expect(previewText(":zaki_fire:")).toBe("(نار)");
  });

  it("the list and quote previews do the same (the words are what the server sends)", () => {
    expect(previewOf(":zaki_like:", null)).toBe("(لايك)");
    expect(previewOf("تمام :zaki_like:", null, { format: true })).toBe("تمام (لايك)");
    expect(previewOf("x", null)).toBe("x");
  });

  it("the switch's hint no longer promises the raw code in the notifications", () => {
    const hint = AR["features.zakiEmojis.hint"] ?? "";
    expect(hint).toContain("⚠️");
    expect(hint).toContain("🔧");
    expect(hint).toContain("كود نصي قصير");
    expect(hint).not.toContain("بالإشعارات وبنص الرسالة الخام بيبين الكود");
    expect(hint).toContain("اسمه بالعربي");
  });
});

describe("the big emoji", () => {
  it("one to three unicode emojis are drawn jumbo, the biggest for one and smaller as they grow", () => {
    const one = drawBody("😀");
    expect(one).toContain("data-jumbo-emoji");
    expect(one).toContain('data-count="1"');
    expect(one).toContain("😀");
    expect(drawBody("😀😀")).toContain('data-count="2"');
    expect(drawBody("😀🔥👍")).toContain('data-count="3"');
    const sizes = [1, 2, 3].map((n) => /data-count="\d"[^>]*class="([^"]*)"/.exec(drawBody("😀".repeat(n)))?.[1] ?? "");
    expect(new Set(sizes).size).toBe(3);
  });

  it("a Zaki code is its picture, big, with its name for a screen reader; mixed with a unicode emoji both are big", () => {
    const html = drawBody(":zaki_love:");
    expect(html).toContain("data-jumbo-emoji");
    expect(html).toContain(`src="${zakiSrc("love")}"`);
    expect(html).toContain('alt="عيون قلوب"');
    const mixed = drawBody(":zaki_love: 😀");
    expect(mixed).toContain('data-count="2"');
    expect(mixed).toContain("😀");
    expect(mixed).toContain(zakiSrc("love"));
  });

  it("words, four emojis, an emoji inside a bold run or a message with a file are NOT jumbo", () => {
    expect(drawBody("شكرا 😀")).not.toContain("data-jumbo-emoji");
    expect(drawBody("😀😀😀😀")).not.toContain("data-jumbo-emoji");
    expect(drawBody("**😀**")).not.toContain("data-jumbo-emoji");
    const withFile = drawBubble(makeMessage({ body: "😀", attachments: [{ id: "a1", kind: "IMAGE", name: "x.png", mime: "image/png", size: 10, url: "/api/chat/attachments/a1" }] }));
    expect(withFile).not.toContain("data-jumbo-emoji");
  });

  it("pops ONLY when the message has just arrived (a re-render, opening a chat or scrolling up never does)", () => {
    expect(drawBody("😀", true)).toContain("data-pop=\"on\"");
    expect(drawBody("😀", true)).toContain("zk-emoji-pop");
    expect(drawBody("😀", false)).not.toContain("zk-emoji-pop");
    expect(drawBody("😀", false)).toContain("data-pop=\"off\"");
    const old = drawBubble(makeMessage({ body: "😀" }));
    expect(old).toContain("data-jumbo-emoji");
    expect(old).not.toContain("zk-emoji-pop");
    const fresh = drawBubble(makeMessage({ body: "😀", createdAt: new Date().toISOString() }));
    expect(fresh).toContain("zk-emoji-pop");
  });

  it("a tap replays a short animation on the picture itself (not on a link, a button or a reaction)", () => {
    const body = read("src/components/chat/v2/bubble/jumbo-emoji.tsx");
    expect(body).toContain("onClick");
    expect(body).toContain("zk-emoji-wiggle");
    expect(body).not.toContain("role=\"button\"");
  });

  it("the plain bubble of a message with words keeps its small pictures exactly as before", () => {
    const html = drawBody("شكراً :zaki_thanks: كتير");
    expect(html).not.toContain("data-jumbo-emoji");
    expect(html).toContain("size-6");
  });
});

describe("the animations are pure CSS and respect reduced motion", () => {
  const css = read("src/components/chat/v2/bubble/emoji-alive.css");
  it("has the three keyframes the bubble uses and no colour, no URL and no picture", () => {
    for (const name of ["zk-emoji-pop", "zk-emoji-wiggle", "zk-chip-burst", "zk-chip-ring"]) expect(css).toContain(`@keyframes ${name}`);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/url\(|@import/);
  });
  it("switches every one off under prefers-reduced-motion (the state stays visible: no opacity is left at 0)", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const klass of [".zk-emoji-pop", ".zk-emoji-wiggle", ".zk-chip-burst"]) expect(reduced).toContain(klass);
    expect(reduced).toContain("animation: none");
  });
  it("is imported by the bubble that uses it", () => {
    expect(read("src/components/chat/v2/bubble/jumbo-emoji.tsx")).toContain('import "./emoji-alive.css"');
    expect(read("src/components/chat/v2/bubble/bubble-parts.tsx")).toContain("emoji-alive.css");
  });
});

describe("reaction chips", () => {
  const chip = (emoji: string, count = 1, mine = false, by?: ReactionDto["by"]): ReactionDto => ({ emoji, count, mine, ...(by ? { by } : {}) });
  it("a Zaki code is its picture on the chip, named for a screen reader", () => {
    const message = makeMessage({ reactions: [chip(":zaki_clap:", 2, true), chip("👍")] });
    const html = renderToStaticMarkup(createElement(ReactionChips, { message, canAct: true, onReact: noop, onWho: noop }));
    expect(html).toContain(`src="${zakiSrc("clap")}"`);
    expect(html).toContain("تفاعل تصفيق، 2");
    expect(html).not.toContain(">:zaki_clap:<");
    expect(html).toContain("👍");
    expect(html).toContain("data-reaction-chip");
  });

  it("a long press (or the right button) on a chip says who reacted; the hint is on the chip", () => {
    const src = read("src/components/chat/v2/bubble/bubble-parts.tsx");
    expect(src).toContain("onContextMenu");
    expect(src).toContain("useLongPress");
    expect(src).toContain("onWho");
    expect(src).toContain("chatemoji.who.hint");
  });

  it("while the owner only reads, a chip is not disabled: a press opens the list of who reacted instead of toggling", () => {
    const message = makeMessage({ reactions: [chip("👍", 2, true)] });
    const html = renderToStaticMarkup(createElement(ReactionChips, { message, canAct: false, onReact: noop, onWho: noop }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("the bubble draws the who-reacted sheet beside the article, never inside it (a press in the sheet must not start the bubble's own long press)", () => {
    const src = read("src/components/chat/v2/message-bubble.tsx");
    expect(src).toContain("ReactorsSheet");
    expect(src.indexOf("<ReactorsSheet")).toBeGreaterThan(src.indexOf("</article>"));
  });

  it("burst: only a chip that is NEW or whose count GREW bursts, never the first draw, a removal or a stand-still", () => {
    const a = [chip("👍", 1)];
    expect(burstedReactions(null, a)).toEqual([]);
    expect(burstedReactions(a, a)).toEqual([]);
    expect(burstedReactions(a, [chip("👍", 2)])).toEqual(["👍"]);
    expect(burstedReactions(a, [chip("👍", 1), chip("🔥", 1)])).toEqual(["🔥"]);
    expect(burstedReactions([chip("👍", 2)], [chip("👍", 1)])).toEqual([]);
    expect(burstedReactions(a, [])).toEqual([]);
    expect(burstedReactions([chip("👍", 1), chip("🔥", 1)], [chip("🔥", 1), chip("👍", 2)])).toEqual(["👍"]);
  });
});

describe("«مين تفاعل» — the list", () => {
  const people = (n: number, prefix = "P") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}` }));
  const reactions: ReactionDto[] = [
    { emoji: "👍", count: 2, mine: true, by: [{ id: "u1", name: "سلمى", me: true }, { id: "u2", name: "ليلى" }] },
    { emoji: ":zaki_clap:", count: 3, mine: false, by: [{ id: "u2", name: "ليلى" }, ...people(1)] },
  ];

  it("rows for ALL: each person once with every emoji they used; for one emoji: only the people who used it", () => {
    const all = reactorRows(reactions, null);
    expect(all.map((r) => r.name)).toEqual(["سلمى", "ليلى", "P 0"]);
    expect(all.find((r) => r.name === "ليلى")?.emojis).toEqual(["👍", ":zaki_clap:"]);
    expect(reactorRows(reactions, "👍").map((r) => r.name)).toEqual(["سلمى", "ليلى"]);
    expect(reactorRows(reactions, ":zaki_clap:").map((r) => r.name)).toEqual(["ليلى", "P 0"]);
    expect(reactorRows(reactions, "🔥")).toEqual([]);
  });

  it("how many reactions the list could not name (a guest's view, a receipt, the cap)", () => {
    expect(reactorsHidden(reactions, null)).toBe(1);
    expect(reactorsHidden(reactions, "👍")).toBe(0);
    expect(reactorsHidden(reactions, ":zaki_clap:")).toBe(1);
    expect(reactorsHidden([{ emoji: "👍", count: 3, mine: false }], null)).toBe(3);
  });

  it("the sheet shows the tabs, the names, my own row marked, a Zaki chip as its picture and «و N آخرين»", () => {
    const html = render(createElement(ReactorsSheet, { open: true, portal: false, reactions, initial: null, onOpenChange: noop }));
    expect(html).toContain("data-reactors-sheet");
    expect(html).toContain(AR["chatemoji.who.title"]!);
    expect(html).toContain('data-reactors-tab="all"');
    expect(html).toContain('data-reactors-tab="👍"');
    expect(html).toContain(`data-reactors-tab=":zaki_clap:"`);
    expect(html).toContain(zakiSrc("clap"));
    expect(html).toContain("سلمى");
    expect(html).toContain("ليلى");
    expect(html).toContain("data-reactor-me");
    expect(html).toContain("data-reactors-more");
    expect(html).not.toContain(":zaki_clap:</");
  });

  it("opened on one chip it lists only that chip's people", () => {
    const html = render(createElement(ReactorsSheet, { open: true, portal: false, reactions, initial: "👍", onOpenChange: noop }));
    expect(html).toContain("سلمى");
    expect(html).not.toContain("P 0");
  });

  it("draws nothing while closed", () => {
    expect(renderToStaticMarkup(createElement(ReactorsSheet, { open: false, portal: false, reactions, initial: null, onOpenChange: noop }))).toBe("");
  });
});

describe("the picker: Zaki stickers as reactions and the 16 task stickers under their own tab", () => {
  const inI18n = (el: ReactElement): string => render(el);
  it("the grid can show the task stickers alone: 16 picture buttons with their Arabic names, none of the 32 chat ones", () => {
    const html = inI18n(createElement(ZakiStickerGrid, { onPick: noop, section: "task" }));
    expect((html.match(/data-zaki-pick="task_/g) ?? []).length).toBe(16);
    for (const t of ZAKI_TASK_STICKERS) {
      expect(html).toContain(`data-zaki-pick="${t.emoji}"`);
      expect(html).toContain(t.name);
      expect(html).toContain(zakiSrc(t.emoji));
    }
    expect(html).not.toContain('data-zaki-pick="smile"');
  });

  it("the default grid is still the 32 chat emojis only", () => {
    const html = inI18n(createElement(ZakiStickerGrid, { onPick: noop }));
    expect(html).toContain('data-zaki-pick="smile"');
    expect(html).not.toContain('data-zaki-pick="task_');
  });

  it("the composer's picker has the tab for them beside «ذكي», only while the switch is on", () => {
    const src = read("src/components/chat/v2/composer/emoji-panel.tsx");
    expect(src).toContain('data-emoji-tab="task"');
    expect(src).toContain("chatemoji.tab_task");
    expect(src).toContain("section={sticker}");
  });

  it("the reaction picker offers the Zaki stickers and the task stickers as tabs next to the emojis; a press hands over the code", () => {
    const html = inI18n(createElement(EmojiPickerDialog, { open: true, onOpenChange: noop, onPick: noop, portal: false }));
    expect(html).toContain('data-picker-tab="emoji"');
    expect(html).toContain('data-picker-tab="zaki"');
    expect(html).toContain('data-picker-tab="task"');
    const off = inI18n(createElement(EmojiPickerDialog, { open: true, onOpenChange: noop, onPick: noop, portal: false, zaki: false }));
    expect(off).not.toContain('data-picker-tab="zaki"');
  });
});

describe("the message that has not been sent yet", () => {
  const item = (body: string) => ({ clientId: "c1", conversationId: "c", body, createdAt: Date.now(), attachments: [], failed: undefined }) as never;
  it("draws a Zaki code as its picture, big when it is alone, and never as the raw code", () => {
    const small = renderToStaticMarkup(createElement(PendingBubble, { item: item("تمام :zaki_like:"), onRetry: noop, onDelete: noop }));
    expect(small).toContain(zakiSrc("like"));
    expect(small).not.toContain(":zaki_like:");
    expect(small).toContain("size-6");
    const big = renderToStaticMarkup(createElement(PendingBubble, { item: item(":zaki_like:"), onRetry: noop, onDelete: noop }));
    expect(big).toContain(zakiSrc("like"));
    expect(big).toContain("data-jumbo-emoji");
  });

  it("a plain text is exactly as it was", () => {
    const html = renderToStaticMarkup(createElement(PendingBubble, { item: item("أهلين"), onRetry: noop, onDelete: noop }));
    expect(html).toContain("أهلين");
    expect(html).not.toContain("data-jumbo-emoji");
  });
});

describe("the words", () => {
  it("are in their own Arabic fragment (no Latin letters, no tanween on the alef)", () => {
    const json = JSON.parse(read("src/lib/i18n/ar.chat-emoji.json")) as Record<string, string>;
    expect(Object.keys(json).length).toBeGreaterThan(8);
    for (const [key, value] of Object.entries(json)) {
      expect(key.startsWith("chatemoji.") || key.startsWith("chat.e."), key).toBe(true);
      expect(value.replace(/{[^}]*}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toContain("اً");
      expect(AR[key], key).toBe(value);
    }
    expect(read("src/lib/i18n/dict.ts")).toContain("ar.chat-emoji.json");
  });
});
