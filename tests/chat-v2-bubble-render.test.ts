import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { BubbleBody } from "@/components/chat/v2/bubble/bubble-body";
import { BubbleMedia } from "@/components/chat/v2/bubble/bubble-media";
import { layoutAlbum } from "@/lib/chat/album-layout";
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
    expect(html).toContain("bg-bubble-out");
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
    expect(html).toContain("ring-accent");
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
    // the picture is a box, not a link (a tap must not start a download: the viewer is C3's); the download is a visible line under it, as on the old screen
    expect(html).not.toMatch(/<a[^>]*data-image-box/);
    expect(html).toContain("تنزيل صورة.png");
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

describe("C3b.1 — the formatting of the words, composed with mentions and order chips", () => {
  const orderFacts = bubbleFactsOf(makeHeader({ me: { canOrderState: true, orderHints: true, canModerate: false } }));

  it("a bold word, a link and a quote are drawn inside the bubble", () => {
    const html = draw(makeMessage({ body: "**مهم**: [الدليل](https://example.com/guide)\n> اقتباس" }));
    expect(html).toContain("<strong>مهم</strong>");
    expect(html).toContain('href="https://example.com/guide"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<blockquote");
  });

  it("a mention INSIDE a bold word still highlights the person (one render test)", () => {
    const html = draw(makeMessage({ mentions: ["u1"], body: "**تمام يا @ليلى** شكرا" }), { mentionNames: ["ليلى"] });
    expect(html).toMatch(/<strong>تمام يا <span data-mention[^>]*>@ليلى<\/span><\/strong>/);
  });

  it("an order number INSIDE a bold word is still a chip, where the header says so (one render test)", () => {
    const html = draw(makeMessage({ body: "**الطلب ZK-2026-1234 تأخر**" }), { facts: orderFacts });
    expect(html).toContain("data-order-chip");
    expect(html).toContain("<strong>");
    expect(html).toContain("ZK-2026-1234");
  });

  it("an order number inside a code span is NOT a chip (code is drawn as typed)", () => {
    const html = draw(makeMessage({ body: "`ZK-2026-1234`" }), { facts: orderFacts });
    expect(html).not.toContain("data-order-chip");
    expect(html).toContain("ZK-2026-1234</code>");
  });

  it("a plain body keeps the markup it always had (one paragraph, pre-wrap, mention tint)", () => {
    const html = draw(makeMessage({ mentions: ["u1"], body: "تمام يا @ليلى" }), { mentionNames: ["ليلى"] });
    expect(html).toContain('<p class="whitespace-pre-wrap text-sm leading-relaxed">تمام يا <span data-mention');
  });

  it("with the switch off the body is the plain text it is, markers and all (the bubble body, `formatting={false}`)", () => {
    const message = makeMessage({ body: "**مهم** [x](https://example.com)" });
    const on = renderToStaticMarkup(createElement(BubbleBody, { message, mentionNames: [], conversationId: "c1", orderChips: false }));
    const off = renderToStaticMarkup(createElement(BubbleBody, { message, mentionNames: [], conversationId: "c1", orderChips: false, formatting: false }));
    expect(on).toContain("<strong>");
    expect(off).not.toContain("<strong>");
    expect(off).not.toContain("<a ");
    expect(off).toContain("**مهم** [x](https://example.com)");
  });

  it("a deleted message shows the deleted line and nothing of its words", () => {
    const html = draw(makeMessage({ deleted: true, body: null }));
    expect(html).not.toContain("<strong>");
  });
});

describe("albums and the media viewer (C3b.3)", () => {
  const pictures = (n: number, over: (i: number) => Partial<AttachmentDto> = () => ({ width: 1200, height: 800 })) => Array.from({ length: n }, (_, i) => image({ id: `p${i}`, name: `صورة${i}.png`, url: `/api/chat/attachments/p${i}`, ...over(i) }));
  const media = (list: AttachmentDto[], over: { albums?: boolean; kind?: "TEXT" | "VOICE" } = {}) =>
    renderToStaticMarkup(createElement(BubbleMedia, { attachments: list, kind: over.kind ?? "TEXT", canTranscribe: false, canReadImages: false, ...(over.albums === undefined ? {} : { albums: over.albums }) }));

  it("three pictures are ONE mosaic whose box is the layout's own (the one the list reserves), each cell a button that opens the viewer", () => {
    const list = pictures(3);
    const layout = layoutAlbum(list);
    const html = draw(makeMessage({ attachments: list }));
    expect(html.match(/data-album="true"/g)).toHaveLength(1);
    expect(html).toContain('data-album-count="3"');
    expect(html).toContain(`aspect-ratio:${layout.width} / ${layout.height}`);
    expect(html.match(/data-album-cell/g)).toHaveLength(3);
    expect(html).toContain("افتح صورة0.png");
    // no picture of the album is a link, a box of its own or a download line: the viewer has the download
    expect(html).not.toContain("data-image-box");
    expect(html).not.toContain("تنزيل صورة0.png");
    // the cells sit by percentages from the inline start, so the mosaic shrinks with a narrow bubble and flips in a right-to-left screen
    expect(html).toContain("inset-inline-start:0%");
    expect(html).not.toMatch(/(?:^|[;"\s])left:/);
  });

  it("a mosaic of two shows the first picture at the start and the second after it", () => {
    const html = media(pictures(2));
    const l = layoutAlbum(pictures(2));
    expect(html).toContain("inset-inline-start:0%");
    expect(html).toContain(`inset-inline-start:${Math.round((l.cells[1]!.x / l.width) * 1e6) / 1e4}%`);
  });

  it("a video in a mosaic is a muted still with a play mark; the native controls are the viewer's", () => {
    const html = media([...pictures(1), image({ id: "v1", kind: "VIDEO", mime: "video/mp4", name: "فيديو.mp4", url: "/api/chat/attachments/v1", width: 1280, height: 720 })]);
    expect(html).toContain("data-album-play");
    expect(html).toContain("شغّل فيديو.mp4");
    expect(html).toMatch(/<video[^>]*muted/);
    expect(html).not.toContain("controls");
  });

  it("a file or a voice note beside the pictures keeps its own line under the mosaic", () => {
    const html = media([...pictures(2), image({ id: "f1", kind: "FILE", mime: "application/pdf", name: "عرض.pdf", url: "/api/chat/attachments/f1" })]);
    expect(html).toContain('data-album-count="2"');
    expect(html).toContain("تنزيل عرض.pdf");
    const voice = media([image({ id: "vn", kind: "AUDIO", mime: "audio/webm", name: "voice.webm", url: "/api/chat/attachments/vn" }), ...pictures(2)], { kind: "VOICE" });
    expect(voice).not.toContain("data-album");
    expect(voice).toContain("data-voice-box");
  });

  it("a lone picture keeps its box, its download line and the OCR button, and becomes a button that opens the viewer", () => {
    const file = image({ width: 1600, height: 900 });
    const box = imageBox(file);
    const html = media([file]);
    expect(html).toContain("data-image-box");
    expect(html).toContain(`aspect-ratio:${box.width} / ${box.height}`);
    expect(html).toContain('<button type="button" class="block size-full" aria-label="افتح صورة.png">');
    expect(html).toContain("تنزيل صورة.png");
    expect(html).not.toContain("data-album");
  });

  it("with the switch off every picture is its own box as before, nothing opens, and there is no button", () => {
    const html = media(pictures(3), { albums: false });
    expect(html).not.toContain("data-album");
    expect(html.match(/data-image-box/g)).toHaveLength(3);
    expect(html).not.toContain("<button");
    expect(html).toContain("تنزيل صورة2.png");
    expect(media([image()], { albums: false })).not.toContain("<button");
  });

  it("a file that is not on our own address is never in the mosaic (a line that says it cannot be opened)", () => {
    const html = media([...pictures(2), image({ id: "far", url: "https://elsewhere.example/a.png", name: "بعيدة.png" })]);
    expect(html).toContain('data-album-count="2"');
    expect(html).not.toContain("elsewhere.example");
    expect(html).toContain('aria-disabled="true"');
  });

  it("a deleted message shows no mosaic and no file (and the viewer's list never holds it)", () => {
    const html = draw(makeMessage({ deleted: true, body: null, attachments: pictures(3) }));
    expect(html).not.toContain("data-album");
    expect(html).not.toContain("/api/chat/attachments/p0");
  });
});
