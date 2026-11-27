import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

// the autoplay rule is a browser fact (`effectOn("gifs")`); a server render is handed it here
const motion = vi.hoisted(() => ({ moves: true }));
vi.mock("@/lib/motion/use-effect-on", () => ({ useEffectOn: () => motion.moves }));

import { COMPANY_CHAT_GROUP, FEATURE_DEFAULTS, FEATURE_META, featureOn } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { dropGif, GIF_MAX_BYTES, GifError, gifSendBody, isGifAttachment, keepGif, sendGif, uploadGif, type GifDto } from "@/lib/chat/gifs";
import { effectAllowed, EFFECT_KEYS, MOTION_EFFECTS } from "@/lib/motion/effects";
import { menuFor, V2_MENU_ORDER, type MessageMenuContext } from "@/components/chat/message/message-menu-registry";
import { gifsOf, menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { BubbleMedia } from "@/components/chat/v2/bubble/bubble-media";
import { GifPicture, GifThumb } from "@/components/chat/v2/bubble/gif-image";
import { GifGrid, type GifGridProps } from "@/components/chat/v2/composer/gif-panel";
import { EmojiKeyboard, PickerTabs } from "@/components/chat/v2/composer/emoji-panel";
import type { AttachmentDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";

/**
 * «صور متحركة» — the person's own GIF library, seen from the screen and from the source: the switch, what the menu offers, how a GIF is drawn when it may and may not move,
 * the picker's tab, and the calls the page makes. WHO may see or send a kept GIF is the server's rule and is proven against a real database in tests/db/chat-gifs.test.ts.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const noop = () => undefined;
beforeEach(() => {
  motion.moves = true;
});

const gif = (over: Partial<AttachmentDto> = {}): AttachmentDto => ({ id: "a1", kind: "IMAGE", name: "رقصة.gif", mime: "image/gif", size: 900, width: 200, height: 100, url: "/api/chat/attachments/a1", ...over });
const message = (attachments: AttachmentDto[]) => ({ id: "m1", kind: "TEXT", body: "", deleted: false, pinned: false, mine: false, attachments, reactions: [], mentions: [] }) as unknown as MessageDto;
const header = (over: Partial<ConversationHeaderDto> = {}) => ({ id: "c1", kind: "TOPIC", title: "عام", me: { canPost: true, canModerate: false, muted: false, oversight: false, canJoin: false, id: "me" }, ...over }) as unknown as ConversationHeaderDto;

describe("the switch «الصور المتحركة»", () => {
  it("is on by default, in the chat group, needs the new chat screen and off is only that key", () => {
    expect(FEATURE_DEFAULTS.chatGifs).toBe(true);
    expect(FEATURE_META.chatGifs).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(featureOn({ features: { chatGifs: false } }, "chatGifs")).toBe(false);
    expect(featureOn({ features: { chatGifs: false } }, "chatLocation")).toBe(true);
    expect(COMPANY_CHAT_GROUP.map((x) => x.key)).not.toContain("chatGifs");
    expect(AR["features.chatGifs.hint"]).toContain("صور متحركة");
  });
});

describe("what the chat keeps", () => {
  it("only a picture whose sniffed type is a GIF", () => {
    expect(isGifAttachment(gif())).toBe(true);
    expect(isGifAttachment(gif({ mime: "image/png" }))).toBe(false);
    expect(isGifAttachment(gif({ kind: "FILE" }))).toBe(false);
  });
  it("only a file at our own attachment address", () => {
    expect(gifsOf(message([gif(), gif({ id: "a2", url: "https://elsewhere.example/x.gif" }), gif({ id: "a3", mime: "image/jpeg" })])).map((f) => f.id)).toEqual(["a1"]);
  });
});

describe("«احفظ بالصور المتحركة» in a message's menu", () => {
  const context = (over: Partial<MessageMenuContext> = {}): MessageMenuContext => ({ mine: false, deleted: false, kind: "TEXT", hasText: false, pinned: false, conversationKind: "TOPIC", canPost: true, canModerate: false, oversight: false, surface: "v2", canSaveGif: true, ...over });
  const ids = (c: MessageMenuContext) => menuFor(c).map((i) => i.id);

  it("is offered on the new screen where the flag says so; never on the old one, a deleted message, a system line or to the silent eye", () => {
    expect(ids(context())).toContain("saveGif");
    expect(ids(context({ canSaveGif: false }))).not.toContain("saveGif");
    expect(ids(context({ surface: undefined }))).not.toContain("saveGif");
    expect(ids(context({ deleted: true }))).toEqual([]);
    expect(ids(context({ kind: "SYSTEM" }))).toEqual([]);
    expect(ids(context({ oversight: true }))).toEqual([]);
    expect(V2_MENU_ORDER).toContain("saveGif");
    expect(AR[menuFor(context()).find((i) => i.id === "saveGif")!.labelKey(context())]).toBe("احفظ بالصور المتحركة");
  });

  it("the flag needs the header's switch AND a GIF in the message", () => {
    const flag = (gifs: boolean | undefined, files: AttachmentDto[]) => menuContextV2(message(files), bubbleFactsOf(header(gifs === undefined ? {} : { gifs })), { readerCount: 0, askKind: false }).canSaveGif;
    expect(flag(true, [gif()])).toBe(true);
    expect(flag(false, [gif()])).toBeUndefined();
    expect(flag(undefined, [gif()])).toBeUndefined();
    expect(flag(true, [gif({ mime: "image/png" })])).toBeUndefined();
  });
});

describe("autoplay obeys the effects page and the device", () => {
  it("«تشغيل الصور المتحركة وحدها» is an effect of its own, stopped by a request for less motion", () => {
    expect(EFFECT_KEYS).toContain("gifs");
    expect(MOTION_EFFECTS.has("gifs")).toBe(true);
    expect(effectAllowed("gifs", { off: [], reducedMotion: false, economy: false })).toBe(true);
    expect(effectAllowed("gifs", { off: ["gifs"], reducedMotion: false, economy: false })).toBe(false);
    expect(effectAllowed("gifs", { off: [], reducedMotion: true, economy: false })).toBe(false);
  });

  it("the effects page draws its row only where the company's switch is on", () => {
    expect(read("src/components/settings-me/effects-section.tsx")).toContain('gifs || key !== "gifs"');
    expect(read("src/app/(app)/settings/me/[section]/page.tsx")).toContain('actorFeatureOn(actor, "chatGifs")');
  });

  const picture = () => renderToStaticMarkup(createElement(GifPicture, { src: "/api/chat/attachments/a1", name: "رقصة.gif", width: 200, height: 100, onOpen: noop }));

  it("allowed to move: the ordinary picture", () => {
    expect(picture()).toContain('data-gif="playing"');
    expect(picture()).toContain("<img");
    expect(picture()).not.toContain("<canvas");
  });

  it("not allowed: no <img> at all, only the first picture on a canvas, a «متحركة» mark and a button that plays it", () => {
    motion.moves = false;
    const html = picture();
    expect(html).toContain('data-gif="still"');
    expect(html).toContain("<canvas");
    expect(html).not.toContain("<img");
    expect(html).toContain("متحركة");
    expect(html).toContain(AR["gifs.play"]!.replace("{name}", "رقصة.gif"));
    const small = renderToStaticMarkup(createElement(GifThumb, { src: "/x", alt: "" }));
    expect(small).toContain("<canvas");
    expect(small).not.toContain("<img");
  });

  it("a still frame is drawn from the picture itself, once (a canvas draws an animated image's first frame)", () => {
    const source = read("src/components/chat/v2/bubble/gif-image.tsx");
    expect(source).toContain("drawImage(picture, 0, 0)");
    expect(source).toContain('useEffectOn("gifs")');
  });

  const bubble = (props: { gifs?: boolean; files?: AttachmentDto[] }) => renderToStaticMarkup(createElement(BubbleMedia, { attachments: props.files ?? [gif()], kind: "TEXT", canTranscribe: false, canReadImages: false, ...(props.gifs === undefined ? {} : { gifs: props.gifs }) }));

  it("a bubble with the switch off (or absent) is the plain picture it was, even where motion is not allowed", () => {
    motion.moves = false;
    for (const html of [bubble({}), bubble({ gifs: false })]) {
      expect(html).toContain("<img");
      expect(html).not.toContain("data-gif");
      expect(html).not.toContain("<canvas");
    }
  });

  it("with the switch on, a lone GIF and a GIF inside an album obey the rule; the other pictures are untouched", () => {
    motion.moves = false;
    expect(bubble({ gifs: true })).toContain('data-gif="still"');
    const album = bubble({ gifs: true, files: [gif(), gif({ id: "a2", name: "صورة.png", mime: "image/png", url: "/api/chat/attachments/a2" })] });
    expect(album).toContain("data-album");
    expect(album.match(/data-gif="still"/g)).toHaveLength(1);
    expect(album.match(/<img/g)).toHaveLength(1);
    motion.moves = true;
    expect(bubble({ gifs: true })).toContain('data-gif="playing"');
  });

  it("the new bubble hands the header's switch to the files", () => {
    expect(read("src/components/chat/v2/message-bubble.tsx")).toContain("gifs={facts.gifs}");
    expect(bubbleFactsOf(header({ gifs: true })).gifs).toBe(true);
    expect(bubbleFactsOf(header()).gifs).toBe(false);
  });
});

describe("the picker's tab «صور متحركة»", () => {
  const slot = createElement("p", { "data-slot": "" }, "x");

  it("without the slot the picker is what it was: no tabs", () => {
    const html = renderToStaticMarkup(createElement(PickerTabs, { children: createElement("span", { "data-inside": "" }) }));
    expect(html).toBe('<span data-inside=""></span>');
    const keyboard = renderToStaticMarkup(createElement(EmojiKeyboard, { recents: [], onEmoji: noop, onSticker: noop, onBackspace: noop }));
    expect(keyboard).not.toContain('data-tg-panel-tab="gifs"');
  });

  it("with it: «الرموز» and «صور متحركة», the GIF tab drawn only when it is chosen", () => {
    const first = renderToStaticMarkup(createElement(PickerTabs, { gifs: slot, children: createElement("span", { "data-inside": "" }) }));
    expect(first).toContain('data-picker-tab="gifs"');
    expect(first).toContain("صور متحركة");
    expect(first).not.toContain("data-slot");
    const chosen = renderToStaticMarkup(createElement(PickerTabs, { gifs: slot, initial: "gifs", children: createElement("span", { "data-inside": "" }) }));
    expect(chosen).toContain("data-slot");
    expect(chosen).not.toContain("data-inside");
    const keyboard = renderToStaticMarkup(createElement(EmojiKeyboard, { recents: [], onEmoji: noop, onSticker: noop, onBackspace: noop, gifs: slot }));
    expect(keyboard).toContain('data-tg-panel-tab="gifs"');
  });

  it("the composer offers it only while the header says the switch is on, and never while an edit is typed", () => {
    expect(read("src/components/chat/v2/composer/chat-composer-v2.tsx")).toContain("detail.gifs === true");
    expect(read("src/components/chat/v2/composer/composer-surface.tsx").match(/gifPanel && !editing/g)).toHaveLength(2);
  });

  const saved: GifDto = { savedId: "s1", name: "محفوظة.gif", url: "/api/chat/gifs/s1/file" };
  const recent: GifDto = { attachmentId: "a9", name: "مرسلة.gif", url: "/api/chat/attachments/a9" };
  const grid = (over: Partial<GifGridProps> = {}) =>
    renderToStaticMarkup(createElement(GifGrid, { list: { saved: [saved], recent: [recent] }, failed: false, busy: null, error: "", removing: null, onSend: noop, onKeep: noop, onAskRemove: noop, onRemove: noop, onUpload: noop, onRetry: noop, ...over }));

  it("my kept ones and the recently sent ones, each a button that sends it; keep on a recent one, remove (asked twice) on a kept one; an upload of GIFs only", () => {
    const html = grid();
    expect(html).toContain('data-gif-send="s1"');
    expect(html).toContain('data-gif-send="a9"');
    expect(html).toContain('data-gif-remove="s1"');
    expect(html).toContain('data-gif-keep="a9"');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/gif"/);
    expect(html).not.toContain("data-gif-remove-confirm");
    expect(grid({ removing: "s1" })).toContain('data-gif-remove-confirm="s1"');
    expect(grid({ list: { saved: [], recent: [{ ...recent, kept: true }] } })).not.toContain("data-gif-keep");
  });

  it("empty, loading and failed say so; a send in flight stops every other tap", () => {
    expect(grid({ list: { saved: [], recent: [] } })).toContain(AR["gifs.empty"]!);
    expect(grid({ list: null })).toContain(AR["gifs.loading"]!);
    expect(grid({ list: null, failed: true })).toContain("data-gif-retry");
    expect(grid({ busy: saved.url }).match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the calls the page makes", () => {
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

  it("one tap posts the library row or the attachment, never a file or an address", async () => {
    const asked: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      asked.push({ url, body: JSON.parse(String(init?.body)) });
      return answer(201, { id: "new" });
    }) as unknown as typeof fetch;
    await sendGif({ conversationId: "c1", gif: { savedId: "s1" }, clientId: "k1" }, fake);
    await sendGif({ conversationId: "c1", gif: { attachmentId: "a9" }, clientId: "k2", replyToId: "m0" }, fake);
    expect(asked).toEqual([
      { url: "/api/chat/gifs/send", body: { conversationId: "c1", clientId: "k1", savedId: "s1" } },
      { url: "/api/chat/gifs/send", body: { conversationId: "c1", clientId: "k2", attachmentId: "a9", replyToId: "m0" } },
    ]);
    expect(Object.keys(gifSendBody({ conversationId: "c", gif: { savedId: "s" }, clientId: "k" }))).not.toContain("url");
    // «رد بالاقتباس»: the piece picked for the reply goes with the GIF as it goes with words, and only with a reply
    expect(gifSendBody({ conversationId: "c", gif: { savedId: "s" }, clientId: "k", replyToId: "m", replyQuote: "عشرة" })).toMatchObject({ replyToId: "m", replyQuote: "عشرة" });
    expect(gifSendBody({ conversationId: "c", gif: { savedId: "s" }, clientId: "k", replyQuote: "عشرة" })).not.toHaveProperty("replyQuote");
    expect(read("src/components/chat/v2/composer/chat-composer-v2.tsx")).toContain("replyQuoteStore.clear();\n");
  });

  it("a refusal is always a sentence of the dictionary: a validation answer gives its detail, an unknown key gives the screen's own words", async () => {
    const refusal = (body: unknown) => (async () => answer(422, body)) as unknown as typeof fetch;
    await expect(keepGif("a1", refusal({ error: "validation.failed", message: "validation.failed", details: [{ path: "savedId", message: "gifs.e.bad_request" }] }))).rejects.toMatchObject({ key: "gifs.e.bad_request" });
    await expect(keepGif("a1", refusal({ error: "validation.failed", message: "validation.failed", details: [{ path: "x", message: "Required" }] }))).rejects.toMatchObject({ key: "gifs.save_failed" });
    await expect(keepGif("a1", refusal({ error: "internal", message: "some.unknown_key" }))).rejects.toMatchObject({ key: "gifs.save_failed" });
  });

  it("a refusal carries the server's dictionary key; a file that is too big never leaves the page", async () => {
    const refuse = (async () => answer(404, { error: "not_found", message: "gifs.e.not_found" })) as unknown as typeof fetch;
    await expect(keepGif("a1", refuse)).rejects.toMatchObject({ key: "gifs.e.not_found" });
    await expect(dropGif("s1", (async () => answer(500, {})) as unknown as typeof fetch)).rejects.toMatchObject({ key: "gifs.remove_failed" });
    const never = vi.fn();
    const big = { size: GIF_MAX_BYTES + 1 } as File;
    await expect(uploadGif(big, never as unknown as typeof fetch)).rejects.toBeInstanceOf(GifError);
    expect(never).not.toHaveBeenCalled();
  });

  it("nothing of the feature names an address outside the app: no provider, no key", () => {
    for (const file of ["src/lib/chat/gifs.ts", "src/server/chat/gifs.ts", "src/components/chat/v2/composer/gif-panel.tsx", "src/components/chat/v2/bubble/gif-image.tsx"]) {
      expect(read(file), file).not.toMatch(/https?:\/\//);
      expect(read(file), file).not.toMatch(/process\.env|tenor|giphy/i);
    }
  });
});

describe("the server's shape (the rules themselves: tests/db/chat-gifs.test.ts)", () => {
  const service = read("src/server/chat/gifs.ts");

  it("every door asks the switch, and the reading rule never uses silent oversight", () => {
    for (const door of ["listMyGifs", "saveGifFromAttachment", "uploadMyGif", "removeSavedGif", "openSavedGif", "sendGifMessage"]) {
      const body = service.slice(service.indexOf(`export async function ${door}(`));
      expect(body.slice(0, 600), door).toContain("assertGifsOn(ctx.orgId)");
    }
    expect(service).toContain("canRead(facts, { ...org, oversight: false })");
  });

  it("the public send schema cannot name a file: only the server's own callers link one", () => {
    const messages = read("src/server/chat/messages.ts");
    expect(messages.slice(messages.indexOf("export const sendSchema"), messages.indexOf("export type SendInput"))).not.toContain("gif");
    expect(messages).toContain("if (internal.gif)");
    expect(read("src/app/api/chat/gifs/send/route.ts")).toContain("gifSendSchema.parse");
  });

  it("an upload to the library has its own purpose, so the sweep of unsent chat uploads leaves it alone", () => {
    expect(service).toContain('export const GIF_PURPOSE = "GIF"');
    expect(read("src/server/chat/attachments.ts")).toContain('purpose: { in: ["CHAT", "VOICE"] },\n      createdAt');
  });
});
