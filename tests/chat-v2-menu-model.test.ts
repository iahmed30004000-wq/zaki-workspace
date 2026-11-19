import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { messageMenuContext } from "@/components/chat/message/message-item";
import { menuFor } from "@/components/chat/message/message-menu-registry";
import type { AttachmentDto } from "@/server/chat/dto";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { askKindOf, menuContextV2, ASK_KIND_KEY } from "@/lib/chat/v2/menu/menu-context";
import { QUICK_COUNT, quickReactionsOf } from "@/lib/chat/v2/menu/quick-reactions";
import { messageLinkOf } from "@/lib/chat/v2/menu/message-link";
import { replyOnDoubleClick } from "@/lib/chat/v2/menu/gestures";
import { emojiDataOf, MAX_EMOJI_VERSION } from "@/lib/chat/v2/menu/emoji-data";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C2.6 — the pure parts of the new message menu: the context the registry is asked with (the same fields as the old screen's plus the new screen's
 * flags), the six quick reactions, the link a message copies, the double-click that replies, and the emoji data the full picker reads from the package
 * that is already installed (no request to another site).
 */
const att = (over: Partial<AttachmentDto> = {}): AttachmentDto => ({ id: "a1", kind: "IMAGE", name: "x.png", mime: "image/png", size: 10, url: "/api/chat/attachments/a1", ...over });
const factsOf = (over: Parameters<typeof makeHeader>[0] = {}) => bubbleFactsOf(makeHeader(over));
const extras = { readerCount: 0, askKind: false };

describe("menuContextV2 — the registry's question for the new screen", () => {
  it("is the old screen's context plus `surface: v2` (the rules of the old fields are the SAME function, not a copy)", () => {
    const facts = factsOf({ me: { canMakeWork: true, canRemind: true, canTranslate: true, canModerate: true, problemKinds: [{ key: "other", label: "غير ذلك" }] } });
    const message = makeMessage({ mine: true, pinned: true, mustRead: true } as never);
    const old = messageMenuContext(message, facts);
    const now = menuContextV2(message, facts, extras);
    expect(now).toMatchObject(old);
    expect(now.surface).toBe("v2");
    expect(old.surface).toBeUndefined();
  });

  it("a picture is readable (readText) only with the header's switch, a type the service reads, and our own address", () => {
    const on = factsOf({ imageOcr: true } as never);
    expect(menuContextV2(makeMessage({ attachments: [att()] }), on, extras).canReadText).toBe(true);
    expect(menuContextV2(makeMessage({ attachments: [att({ mime: "image/webp" })] }), on, extras).canReadText).toBe(true);
    expect(menuContextV2(makeMessage({ attachments: [att({ mime: "image/gif" })] }), on, extras).canReadText).toBe(false);
    expect(menuContextV2(makeMessage({ attachments: [att({ url: "https://elsewhere.example/a.png" })] }), on, extras).canReadText).toBe(false);
    expect(menuContextV2(makeMessage({ attachments: [att({ kind: "FILE", mime: "application/pdf" })] }), on, extras).canReadText).toBe(false);
    expect(menuContextV2(makeMessage({ attachments: [att()] }), factsOf(), extras).canReadText).toBe(false);
    expect(menuContextV2(makeMessage(), on, extras).canReadText).toBe(false);
  });

  it("a voice note can be written out (transcribe) only with the header's switch and an audio file of ours", () => {
    const on = factsOf({ voiceTranscript: true } as never);
    const voice = (over: Partial<AttachmentDto> = {}) => makeMessage({ kind: "VOICE", body: null, attachments: [att({ kind: "AUDIO", mime: "audio/webm", ...over })] });
    expect(menuContextV2(voice(), on, extras).canTranscribe).toBe(true);
    expect(menuContextV2(voice(), factsOf(), extras).canTranscribe).toBe(false);
    expect(menuContextV2(voice({ url: "https://elsewhere.example/v.webm" }), on, extras).canTranscribe).toBe(false);
    expect(menuContextV2(makeMessage({ attachments: [att({ kind: "AUDIO", mime: "audio/webm" })] }), on, extras).canTranscribe).toBe(false);
  });

  it("the readers and the question kind come in as they are", () => {
    const c = menuContextV2(makeMessage(), factsOf(), { readerCount: 4, askKind: true });
    expect(c.readerCount).toBe(4);
    expect(c.canAsk).toBe(true);
  });

  it("the whole menu of a member in a topic, in Telegram's order, with every new switch on", () => {
    const facts = factsOf({ imageOcr: true, me: { canMakeWork: true, canRemind: true, canTranslate: true, problemKinds: [{ key: ASK_KIND_KEY, label: "سؤال" }] } } as never);
    const c = menuContextV2(makeMessage({ attachments: [att()] }), facts, { readerCount: 2, askKind: true });
    const ids = menuFor(c).map((i) => i.id);
    expect(ids).toEqual(["reply", "copy", "copyLink", "forward", "task", "ticket", "problem", "ask", "remind", "translate", "readText", "seen"]);
  });
});

describe("«اسألي مشرفتك» is the «🎫 مشكلة» door with the question kind", () => {
  it("is on offer exactly when the person's problem kinds include the question kind", () => {
    expect(ASK_KIND_KEY).toBe("product_question");
    expect(askKindOf([{ key: "wrong_number", label: "رقم غلط" }, { key: "product_question", label: "سؤال عن منتج" }])).toBe(true);
    expect(askKindOf([{ key: "wrong_number", label: "رقم غلط" }])).toBe(false);
    expect(askKindOf([])).toBe(false);
    expect(askKindOf(undefined)).toBe(false);
  });
});

describe("the six quick reactions", () => {
  it("are today's six until the person's settings (C4) say otherwise", () => {
    expect(QUICK_COUNT).toBe(6);
    expect(quickReactionsOf()).toEqual([...CHAT_REACTIONS]);
    expect(quickReactionsOf(null)).toEqual([...CHAT_REACTIONS]);
  });

  it("take the person's own six when they are six distinct single emojis", () => {
    const mine = ["😍", "🙏", "👏", "😢", "😮", "💯"];
    expect(quickReactionsOf(mine)).toEqual(mine);
  });

  it("fall back to the default for anything else (too few, too many, a word, a repeat, an empty one)", () => {
    const def = [...CHAT_REACTIONS];
    expect(quickReactionsOf(["😍", "🙏"])).toEqual(def);
    expect(quickReactionsOf(["😍", "🙏", "👏", "😢", "😮", "💯", "🔥"])).toEqual(def);
    expect(quickReactionsOf(["😍", "🙏", "👏", "😢", "😮", "ok"])).toEqual(def);
    expect(quickReactionsOf(["😍", "😍", "👏", "😢", "😮", "💯"])).toEqual(def);
    expect(quickReactionsOf(["😍", "🙏", "👏", "😢", "😮", ""])).toEqual(def);
  });
});

describe("«نسخ الرابط»: /chat/<id>?m=<message>", () => {
  it("is the conversation's address with the message in `m` (the same address a search hit or a notification opens)", () => {
    expect(messageLinkOf("https://workspace.example", "c1", "m9")).toBe("https://workspace.example/chat/c1?m=m9");
  });

  it("encodes both ids and tolerates an origin with a slash", () => {
    expect(messageLinkOf("https://w.example/", "a b", "x&y")).toBe("https://w.example/chat/a%20b?m=x%26y");
  });
});

describe("a double click replies — on the computer, never on a link, a button or a player, never from a finger", () => {
  const el = (matches: boolean) => ({ closest: (_selector: string) => (matches ? {} : null) }) as unknown as EventTarget;
  it("replies for a mouse on the bubble's own text", () => {
    expect(replyOnDoubleClick({ pointerType: "mouse", target: el(false) })).toBe(true);
  });
  it("does not reply when the click is on something that does its own thing", () => {
    expect(replyOnDoubleClick({ pointerType: "mouse", target: el(true) })).toBe(false);
  });
  it("does not reply for a touch or a pen (the phone's double tap is the quick reaction, a setting of C4)", () => {
    expect(replyOnDoubleClick({ pointerType: "touch", target: el(false) })).toBe(false);
    expect(replyOnDoubleClick({ pointerType: "pen", target: el(false) })).toBe(false);
  });
  it("a keyboard-made event (no pointer known yet) does not reply either", () => {
    expect(replyOnDoubleClick({ pointerType: "", target: el(false) })).toBe(false);
  });
});

describe("the full picker's data comes from the package that is installed", () => {
  const entries = [
    { emoji: "😀", label: "grinning face", group: 0, order: 1, version: 1, tags: ["smile"] },
    { emoji: "👋", label: "waving hand", group: 1, order: 200, version: 0.6, tags: ["hi"] },
    { emoji: "🏻", label: "light skin tone", group: 2, order: 300, version: 1 },
    { emoji: "🇦", label: "regional indicator A", version: 0 },
    { emoji: "🫨", label: "shaking face", group: 0, order: 2, version: 15 },
    { emoji: "🐶", label: "dog face", group: 3, order: 400, version: 0.6, tags: [] },
  ];
  const data = emojiDataOf(entries, { categoryLabel: (g) => `c${g}` });

  it("keeps only emojis with a category, drops the skin-tone components and the ones a browser may not draw yet", () => {
    expect(MAX_EMOJI_VERSION).toBeLessThanOrEqual(15);
    expect(data.emojis.map((e) => e.emoji)).toEqual(["😀", "👋", "🐶"]);
  });

  it("numbers each emoji with the category it sits in and labels the categories with the caller's words", () => {
    expect(data.categories).toEqual([
      { index: 0, label: "c0" },
      { index: 1, label: "c1" },
      { index: 3, label: "c3" },
    ]);
    expect(data.emojis.map((e) => e.category)).toEqual([0, 1, 3]);
  });

  it("follows the dataset's own order inside the picker", () => {
    const shuffled = emojiDataOf([...entries].reverse(), { categoryLabel: (g) => String(g) });
    expect(shuffled.emojis.map((e) => e.emoji)).toEqual(["😀", "👋", "🐶"]);
  });

  it("has no skin tones (a tone is a setting this picker does not have) and says its locale", () => {
    expect(data.emojis.every((e) => e.skins === undefined)).toBe(true);
    expect(data.locale).toBe("en");
    expect(Object.keys(data.skinTones).sort()).toEqual(["dark", "light", "medium", "medium-dark", "medium-light"]);
  });
});
