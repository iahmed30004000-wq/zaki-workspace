import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { nameTone } from "@/lib/chat/v2/pane/bubble-model";
import { imageBox, VOICE_ROW_PX } from "@/lib/chat/viewport/sizes";
import type { AttachmentDto, MessageDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { classTokens } from "./ui-render";

(globalThis as { React?: typeof React }).React = React;

/**
 * C2.4 — the new bubble, drawn on the server so every rule of it can be read from its markup: own at the inline end, runs and tails, the name colour on
 * the first bubble of a run and the picture on the last (topics only), the footer, the reply block, reactions, the files that reserve their box, the
 * mention tint, and the two seams (the menu and the hover slot) that only exist where an action does.
 */
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
const facts = bubbleFactsOf(makeHeader());
const dmFacts = bubbleFactsOf(makeHeader({ kind: "DM", space: null, title: "سلمى" }));

function draw(message: MessageDto, over: Partial<MessageBubbleProps> = {}, client = new QueryClient()): string {
  const props: MessageBubbleProps = { message, conversationId: "c1", facts, start: true, end: true, mentionNames: [], onReact: noop, onJump: noop, ...over };
  return renderToStaticMarkup(createElement(Queries, { client }, createElement(MessageBubble, props) as ReactElement));
}
const image = (over: Partial<AttachmentDto> = {}): AttachmentDto => ({ id: "a1", kind: "IMAGE", name: "صورة.png", mime: "image/png", size: 10, url: "/api/chat/attachments/a1", ...over });

describe("where a bubble stands", () => {
  it("my message is at the inline end with the accent tint and a tail at the bottom end; I show no name and no picture", () => {
    const html = draw(makeMessage({ mine: true }));
    expect(html).toContain('data-message-row="mine"');
    expect(html).toContain("justify-end");
    expect(html).toContain("rounded-ee-sm");
    expect(html).toContain("bg-accent/10");
    expect(html).not.toContain("data-sender");
    expect(html).not.toContain("size-8");
  });

  it("the others sit at the start with a tail at the bottom start, in a topic", () => {
    const html = draw(makeMessage());
    expect(html).toContain('data-message-row="other"');
    expect(html).toContain("justify-start");
    expect(html).toContain("rounded-es-sm");
  });

  it("a run of three: the name on the FIRST only (in the sender's colour), the picture on the LAST only, the tail on the last only", () => {
    const first = draw(makeMessage({ id: "a" }), { start: true, end: false });
    const middle = draw(makeMessage({ id: "b" }), { start: false, end: false });
    const last = draw(makeMessage({ id: "c" }), { start: false, end: true });
    expect(first).toContain("data-sender");
    expect(first).toContain(nameTone("سلمى"));
    expect(middle).not.toContain("data-sender");
    expect(last).not.toContain("data-sender");
    // the picture (or its empty place, so the three line up) is drawn at the start of every bubble of the run: a circle on the last, a spacer on the others
    expect((first.match(/size-8/g) ?? []).length).toBe(1);
    expect(first).not.toContain("mb-1 size-8");
    expect(last).toContain("mb-1 size-8");
    expect(first).not.toMatch(/rounded-e[es]-sm/);
    expect(middle).not.toMatch(/rounded-e[es]-sm/);
    expect(last).toContain("rounded-es-sm");
    expect(first).toContain('data-run="start"');
    expect(middle).toContain('data-run="middle"');
    expect(last).toContain('data-run="end"');
  });

  it("a private chat shows neither the name nor the picture of the other person", () => {
    const html = draw(makeMessage(), { facts: dmFacts });
    expect(html).not.toContain("data-sender");
    expect(html).not.toContain("size-8");
  });

  it("uses theme tokens and logical sides only", () => {
    const html = draw(makeMessage({ mine: true, replyTo: { id: "r", preview: "x", authorName: "ليلى" }, reactions: [{ emoji: "👍", count: 1, mine: true }] }));
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t.replace(/^[\w-]+:/, "")))).toEqual([]);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
  });
});

describe("what is inside", () => {
  it("the footer carries «معدّلة», the time left-to-right, and the ticks of my own message", () => {
    const html = draw(makeMessage({ mine: true, edited: true, status: "read" }));
    expect(html).toContain("معدّلة");
    expect(html).toMatch(/<time[^>]*dir="ltr"[^>]*class="tabular-nums"/);
    expect(html).toContain('data-ticks="read"');
    expect(draw(makeMessage({ mine: false, status: "read" }))).not.toContain("data-ticks");
  });

  it("the reply block has the author and one line, and a press jumps to the original", () => {
    const html = draw(makeMessage({ replyTo: { id: "orig", preview: "رسالة أصلية", authorName: "ليلى" } }));
    expect(html).toContain("data-reply-block");
    expect(html).toContain("ليلى");
    expect(html).toContain("رسالة أصلية");
    expect(html).toContain("border-s-[3px]");
    expect(html).toContain("روح للرسالة الأصلية");
    expect(draw(makeMessage({ replyTo: { id: "orig", preview: null, authorName: "ليلى", deleted: true } }))).toContain("حُذفت الرسالة");
  });

  it("a forwarded message says who it came from", () => {
    expect(draw(makeMessage({ forwardedFrom: { name: "أحمد" } }))).toContain("محوّلة من أحمد");
    expect(draw(makeMessage())).not.toContain("data-forwarded");
  });

  it("the reactions are chips, mine outlined in the accent; they cannot be pressed while the owner only reads", () => {
    const message = makeMessage({ reactions: [{ emoji: "👍", count: 2, mine: true }, { emoji: "🔥", count: 1, mine: false }] });
    const html = draw(message);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("border-accent bg-accent/10");
    expect(html).toContain("تفاعل 👍، 2");
    expect(draw(message, { facts: { ...facts, oversight: true } })).toMatch(/<button[^>]*disabled=""[^>]*aria-pressed="true"/);
  });

  it("a message that mentions me keeps the warn tint and says so; the names it points at are highlighted", () => {
    const html = draw(makeMessage({ mentions: ["u1"], body: "تمام يا @ليلى" }), { mentionNames: ["ليلى"] });
    expect(html).toContain("bg-warn/10");
    expect(html).toContain("data-mentions-me");
    expect(html).toContain("data-mention");
    expect(draw(makeMessage({ mentions: ["u1"], mine: true }))).not.toContain("data-mentions-me");
  });

  it("a deleted message is one quiet line: no words, no files, no chips, no menu", () => {
    const menu = vi.fn(() => createElement("i", { "data-menu": "" }));
    const html = draw(makeMessage({ deleted: true, body: null, reactions: [{ emoji: "👍", count: 1, mine: false }], attachments: [image()] }), { menu });
    expect(html).toContain("حُذفت الرسالة");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-menu");
    expect(menu).not.toHaveBeenCalled();
  });

  it("the target of a jump has a ring", () => {
    expect(draw(makeMessage(), { highlighted: true })).toContain("ring-accent");
    expect(draw(makeMessage())).not.toContain("ring-accent");
  });
});

describe("files reserve their box", () => {
  it("a picture takes the box of its own size (the same function the virtual list's estimate uses) — no jump when it loads", () => {
    const file = image({ width: 1600, height: 900 });
    const box = imageBox(file);
    const html = draw(makeMessage({ attachments: [file] }));
    expect(html).toContain("data-image-box");
    expect(html).toContain(`width="${box.width}" height="${box.height}"`);
    expect(html).toContain(`aspect-ratio:${box.width} / ${box.height}`);
    expect(html).toContain('loading="lazy"');
  });

  it("an older picture with no size gets the ONE fixed 4:3 box", () => {
    const box = imageBox({});
    const html = draw(makeMessage({ attachments: [image()] }));
    expect(box.width / box.height).toBeCloseTo(4 / 3, 1);
    expect(html).toContain(`aspect-ratio:${box.width} / ${box.height}`);
  });

  it("a voice note has a box of fixed height, whatever its length", () => {
    const voice = (durationMs: number) => draw(makeMessage({ kind: "VOICE", body: "", attachments: [{ ...image({ kind: "AUDIO", mime: "audio/webm", name: "voice.webm", durationMs }) }] }));
    const short = voice(2000);
    const long = voice(600_000);
    const height = VOICE_ROW_PX - 32;
    expect(short).toContain(`height:${height}px`);
    expect(long).toContain(`height:${height}px`);
  });

  it("a file that is not on our own address is never drawn as media", () => {
    const html = draw(makeMessage({ attachments: [image({ url: "https://elsewhere.example/a.png" })] }));
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("the two seams of a bubble", () => {
  it("the menu slot is given the message and draws where an action exists; the hover slot too", () => {
    const seen: string[] = [];
    const menu: NonNullable<MessageBubbleProps["menu"]> = (api) => {
      seen.push(api.message.id);
      return createElement("i", { "data-menu-slot": "" });
    };
    const html = draw(makeMessage({ id: "m9" }), { menu, hover: createElement("i", { "data-hover-slot": "" }) });
    expect(seen).toEqual(["m9"]);
    expect(html).toContain("data-menu-slot");
    expect(html).toContain("data-hover-slot");
  });

  it("nothing is drawn for a person who only reads in oversight (the menu and the hover are not even asked)", () => {
    const menu = vi.fn(() => createElement("i", { "data-menu-slot": "" }));
    const html = draw(makeMessage(), { menu, hover: createElement("i", { "data-hover-slot": "" }), facts: { ...facts, oversight: true } });
    expect(html).not.toContain("data-menu-slot");
    expect(html).not.toContain("data-hover-slot");
    expect(menu).not.toHaveBeenCalled();
  });

  it("without a menu the bubble is still a bubble (a test, a read-only embed)", () => {
    expect(draw(makeMessage())).toContain("نص الرسالة");
  });
});
