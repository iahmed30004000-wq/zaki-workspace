import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";

import { chatKeys, LATEST, type MessagesData } from "@/lib/chat/cache";
import { resetPendingForTests } from "@/lib/chat/cache/pending";
import { Outbox, outboxKey, parseStored } from "@/lib/chat/outbox/queue";
import { memoryOutboxStorage } from "@/lib/chat/outbox/storage";
import { startOptimisticSend, type OptimisticDeps } from "@/lib/chat/outbox/optimistic";
import { postChatMessage, sendOutboxItem, type ChatSendPayload } from "@/lib/chat/outbox/send";
import { arrivalSoundOf } from "@/lib/chat/v2/pane/arrival-sound";
import { ComposerSurface } from "@/components/chat/v2/composer/composer-surface";
import { SEND_MENU_ITEMS, SendMenu, sendMenuItemsOf } from "@/components/chat/v2/composer/send-menu";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { makeMessage } from "./chat-v2-pane-fixtures.test";
import type { MessageDto } from "@/server/chat/dto";
import { composerBarOf } from "@/lib/chat/v2/pane/composer-bar";
import { composerFaceOf, canSubmitNow } from "@/lib/chat/v2/composer/face";
import { loadRecentEmoji, rememberEmoji, MAX_RECENT_EMOJI, RECENT_EMOJI_KEY } from "@/lib/chat/v2/composer/recent-emoji";
import { dragHasFiles, forDropMode, pastedImages, type ClipboardLike } from "@/lib/chat/v2/composer/clipboard-files";
import { HOLD_CANCEL_PX, HOLD_LOCK_PX, SEND_HOLD_MS, SEND_HOLD_SLOP_PX, holdOutcome, sendHoldOpensMenu } from "@/lib/chat/v2/composer/hold-gesture";
import { arrowUpEdits, lastEditableOf } from "@/lib/chat/v2/composer/edit-last";
import { composerHintOf } from "@/lib/chat/v2/composer/hint";
import { attachItemsOf } from "@/lib/chat/v2/composer/attach-items";
import { emojiGroupOf } from "@/lib/chat/v2/composer/emoji-groups";

(globalThis as { React?: typeof React }).React = React;

/**
 * C2.5 — the composer's rules that need no screen: the round button's face, the recent emojis, what a paste and a drop carry, the hold on the microphone, «↑»
 * to edit my last message, the customer-data hint, and what the attach menu offers.
 */
const mem = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
};
const file = (name: string, type: string) => new File(["x"], name, { type });
const msg = (over: Partial<MessageDto>): MessageDto =>
  ({ id: "m1", kind: "TEXT", body: "مرحبا", deleted: false, edited: false, pinned: false, mine: true, authorId: "me", authorName: "أنا", createdAt: "2026-11-19T10:00:00.000Z", mentions: [], attachments: [], reactions: [], ...over }) as MessageDto;

describe("the round button", () => {
  const base = { text: "", fileCount: 0, editing: false, voiceOn: true };
  it("empty is the microphone, text or an attachment is send, an edit is save", () => {
    expect(composerFaceOf(base)).toBe("mic");
    expect(composerFaceOf({ ...base, text: "   " })).toBe("mic");
    expect(composerFaceOf({ ...base, text: "أهلا" })).toBe("send");
    expect(composerFaceOf({ ...base, fileCount: 1 })).toBe("send");
    expect(composerFaceOf({ ...base, editing: true })).toBe("save");
    expect(composerFaceOf({ ...base, editing: true, text: "x" })).toBe("save");
  });
  it("with voice notes off an empty box shows a (disabled) send, never a microphone", () => {
    expect(composerFaceOf({ ...base, voiceOn: false })).toBe("send");
    expect(canSubmitNow({ ...base, voiceOn: false, busy: false })).toBe(false);
  });
  it("submits only with words or a file, an edit only with words, and never while busy", () => {
    expect(canSubmitNow({ ...base, text: "a", busy: false })).toBe(true);
    expect(canSubmitNow({ ...base, fileCount: 2, busy: false })).toBe(true);
    expect(canSubmitNow({ ...base, text: "a", busy: true })).toBe(false);
    expect(canSubmitNow({ ...base, editing: true, fileCount: 1, busy: false })).toBe(false);
    expect(canSubmitNow({ ...base, editing: true, text: "a", busy: false })).toBe(true);
  });
  it("composerBarOf is still the function that decides whether there is a composer at all", () => {
    expect(composerBarOf({ canPost: true } as never, { closed: false, topicType: "DISCUSSION" })).toBe("composer");
    expect(composerBarOf({ canPost: false, canJoin: true } as never, { closed: false, topicType: "DISCUSSION" })).toBe("join");
  });
});

describe("the recent emojis", () => {
  it("newest first, no duplicate, at most 24, kept on this device", () => {
    const s = mem();
    expect(loadRecentEmoji(s)).toEqual([]);
    rememberEmoji("😀", s);
    rememberEmoji("👍", s);
    expect(rememberEmoji("😀", s)).toEqual(["😀", "👍"]);
    expect(JSON.parse(s.map.get(RECENT_EMOJI_KEY)!)).toEqual(["😀", "👍"]);
    for (let i = 0; i < 40; i += 1) rememberEmoji(String.fromCodePoint(0x1f600 + i), s);
    expect(loadRecentEmoji(s)).toHaveLength(MAX_RECENT_EMOJI);
  });
  it("what is not an emoji-sized word is never kept, and a broken or missing storage is an empty list", () => {
    const s = mem();
    rememberEmoji("هذه جملة طويلة وليست إيموجي أبدا أبدا أبدا", s);
    rememberEmoji("", s);
    expect(loadRecentEmoji(s)).toEqual([]);
    s.setItem(RECENT_EMOJI_KEY, "{not json");
    expect(loadRecentEmoji(s)).toEqual([]);
    expect(loadRecentEmoji(null)).toEqual([]);
    expect(rememberEmoji("😀", null)).toEqual(["😀"]);
    const full = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => undefined };
    expect(rememberEmoji("😀", full)).toEqual(["😀"]);
  });
});

describe("a paste and a drop", () => {
  const item = (f: File | null, kind = "file") => ({ kind, type: f?.type ?? "text/plain", getAsFile: () => f });
  it("a pasted image is found in the files or in the items, once", () => {
    const png = file("image.png", "image/png");
    const data: ClipboardLike = { files: [png], items: [item(png)], getData: () => "" };
    expect(pastedImages(data)).toEqual([png]);
    const viaItems: ClipboardLike = { files: [], items: [item(png), item(null, "string")], getData: () => "" };
    expect(pastedImages(viaItems)).toEqual([png]);
  });
  it("a paste that carries words is a text paste, a pasted document is not an image", () => {
    const png = file("image.png", "image/png");
    expect(pastedImages({ files: [png], getData: () => "نص" })).toEqual([]);
    expect(pastedImages({ files: [file("a.pdf", "application/pdf")], getData: () => "" })).toEqual([]);
    expect(pastedImages(null)).toEqual([]);
    expect(pastedImages({ getData: () => { throw new Error("x"); }, files: [png] })).toEqual([png]);
  });
  it("only a drag of files draws the two zones", () => {
    expect(dragHasFiles(["Files"])).toBe(true);
    expect(dragHasFiles(["text/plain", "Files"])).toBe(true);
    expect(dragHasFiles(["text/plain"])).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
  it("«ابعت كصور» keeps each file's own kind, «ابعت كملفات» sends the bytes as they are", () => {
    const a = file("a.png", "image/png");
    const b = file("b.pdf", "application/pdf");
    expect(forDropMode([a, b], "media")).toEqual([{ file: a, asFile: false }, { file: b, asFile: false }]);
    expect(forDropMode([a, b], "files")).toEqual([{ file: a, asFile: true }, { file: b, asFile: true }]);
  });
});

describe("the hold on the microphone", () => {
  const start = { x: 200, y: 600 };
  it("a finger that stays is a hold", () => {
    expect(holdOutcome(start, start)).toBe("hold");
    expect(holdOutcome(start, { x: 230, y: 580 })).toBe("hold");
  });
  it("sliding sideways beyond the distance cancels, on either side (right to left or left to right)", () => {
    expect(holdOutcome(start, { x: 200 - HOLD_CANCEL_PX - 1, y: 600 })).toBe("cancel");
    expect(holdOutcome(start, { x: 200 + HOLD_CANCEL_PX + 1, y: 600 })).toBe("cancel");
    expect(holdOutcome(start, { x: 200 - HOLD_CANCEL_PX, y: 600 })).toBe("hold");
  });
  it("sliding up beyond the distance locks, and a mostly sideways diagonal cancels instead", () => {
    expect(holdOutcome(start, { x: 200, y: 600 - HOLD_LOCK_PX - 1 })).toBe("lock");
    expect(holdOutcome(start, { x: 215, y: 600 - HOLD_LOCK_PX - 20 })).toBe("lock");
    expect(holdOutcome(start, { x: 200 - 200, y: 600 - HOLD_LOCK_PX - 20 })).toBe("cancel");
  });
  it("sliding down and away is not a message either", () => {
    expect(holdOutcome(start, { x: 200, y: 600 + HOLD_CANCEL_PX + 5 })).toBe("cancel");
  });
});

describe("«↑» edits my last text message", () => {
  const key = { key: "ArrowUp", text: "", fileCount: 0, composing: false, choicesOpen: false, editing: false, recording: false };
  it("only a bare «↑» in an empty box with nothing attached", () => {
    expect(arrowUpEdits(key)).toBe(true);
    expect(arrowUpEdits({ ...key, text: "a" })).toBe(false);
    expect(arrowUpEdits({ ...key, text: " " })).toBe(false); // a space is something: the cursor moves, nothing is edited
    expect(arrowUpEdits({ ...key, fileCount: 1 })).toBe(false);
    expect(arrowUpEdits({ ...key, key: "ArrowDown" })).toBe(false);
    expect(arrowUpEdits({ ...key, shiftKey: true })).toBe(false);
    expect(arrowUpEdits({ ...key, ctrlKey: true })).toBe(false);
    expect(arrowUpEdits({ ...key, composing: true })).toBe(false);
    expect(arrowUpEdits({ ...key, choicesOpen: true })).toBe(false);
    expect(arrowUpEdits({ ...key, editing: true })).toBe(false);
    expect(arrowUpEdits({ ...key, recording: true })).toBe(false);
  });
  it("picks the newest of MY text messages: never a voice note, never somebody else's, never a pending or a deleted one", () => {
    const messages = [
      msg({ id: "a", body: "الأولى" }),
      msg({ id: "b", body: "من غيري", mine: false }),
      msg({ id: "c", kind: "VOICE", body: null }),
      msg({ id: "d", body: "محذوفة", deleted: true }),
      msg({ id: "pending:x", body: "لسا", pending: { state: "sending" } }),
    ];
    expect(lastEditableOf(messages)?.id).toBe("a");
    expect(lastEditableOf([msg({ id: "c", kind: "VOICE", body: null }), msg({ id: "b", mine: false })])).toBeNull();
    expect(lastEditableOf([])).toBeNull();
    expect(lastEditableOf([...messages, msg({ id: "e", body: "الأخيرة" })])?.id).toBe("e");
  });
});

describe("the customer-data hint under the box (Q1.7)", () => {
  const detail = (over: Record<string, unknown> = {}) => ({ kind: "TOPIC" as const, restricted: false, teamId: null, me: { orderHints: true }, ...over }) as never;
  const template = "الاسم: سامر\nرقم الهاتف: 0791234567\nالمحافظة: عمان\nالعنوان: شارع الجامعة";
  it("the template and a phone number get their line, with the switch on, in an open topic", () => {
    expect(composerHintOf(template, detail())).toBe("template");
    expect(composerHintOf("كلميه على 0791234567", detail())).toBe("phone");
    expect(composerHintOf("صباح الخير", detail())).toBeNull();
  });
  it("nothing with the switch off, in a private chat, a restricted topic, a team's topic, or while editing", () => {
    expect(composerHintOf(template, detail({ me: { orderHints: false } }))).toBeNull();
    expect(composerHintOf(template, detail({ kind: "DM" }))).toBeNull();
    expect(composerHintOf(template, detail({ restricted: true }))).toBeNull();
    expect(composerHintOf(template, detail({ teamId: "t1" }))).toBeNull();
    expect(composerHintOf(template, detail(), true)).toBeNull();
  });
});

describe("the attach menu and the picker's groups", () => {
  it("photo or video and file always; the poll only where the server says I may; no checklist, no schedule, no products", () => {
    expect(attachItemsOf({})).toEqual(["media", "file"]);
    expect(attachItemsOf({ canPoll: false })).toEqual(["media", "file"]);
    expect(attachItemsOf({ canPoll: true })).toEqual(["media", "file", "poll"]);
  });
  it("the nine groups are recognised from Emojibase's English labels", () => {
    expect(emojiGroupOf("Smileys & Emotion")).toBe("smileys");
    expect(emojiGroupOf("People & Body")).toBe("people");
    expect(emojiGroupOf("Animals & Nature")).toBe("animals");
    expect(emojiGroupOf("Food & Drink")).toBe("food");
    expect(emojiGroupOf("Travel & Places")).toBe("travel");
    expect(emojiGroupOf("Activities")).toBe("activities");
    expect(emojiGroupOf("Objects")).toBe("objects");
    expect(emojiGroupOf("Symbols")).toBe("symbols");
    expect(emojiGroupOf("Flags")).toBe("flags");
    expect(emojiGroupOf("Something new")).toBeNull();
  });
});

// ---- the review of C2.5: each of these was run red first ----
import { failMessageOf } from "@/lib/chat/v2/composer/fail-text";
import { pastedDocuments } from "@/lib/chat/v2/composer/clipboard-files";
import { MAX_EMOJI_VERSION, resolveBundledEmojiData, toEmojiData } from "@/lib/chat/v2/composer/emoji-data";

describe("an error shown under the box is Arabic (review of C2.5)", () => {
  const say = (key: string) => `[${key}]`;
  it("a dictionary key is translated, an Arabic sentence is shown, anything else becomes the fallback", () => {
    expect(failMessageOf(new Error("chat.f.too_large"), "chatc.upload_failed", say)).toBe("[chat.f.too_large]");
    expect(failMessageOf(new Error("فشل الرفع"), "chatc.upload_failed", say)).toBe("فشل الرفع");
    expect(failMessageOf(new TypeError("Failed to fetch"), "chatc.upload_failed", say)).toBe("[chatc.upload_failed]");
    expect(failMessageOf("boom", "chatc.upload_failed", say)).toBe("[chatc.upload_failed]");
    expect(failMessageOf(new Error(""), "chatc.upload_failed", say)).toBe("[chatc.upload_failed]");
  });
});

describe("a pasted file that is not a picture (review of C2.5)", () => {
  it("goes to the tray as a file; a paste with words, or with a picture, is not a document paste", () => {
    const pdf = file("a.pdf", "application/pdf");
    const png = file("a.png", "image/png");
    expect(pastedDocuments({ files: [pdf], getData: () => "" })).toEqual([pdf]);
    expect(pastedDocuments({ files: [pdf], getData: () => "نص" })).toEqual([]);
    expect(pastedDocuments({ files: [pdf, png], getData: () => "" })).toEqual([]);
    expect(pastedDocuments(null)).toEqual([]);
  });
});

describe("the emoji data is our own, no third-party address (review of C2.5)", () => {
  const raw = [
    { emoji: "😀", label: "grinning face", group: 0, tags: ["smile"], version: 1, order: 1 },
    { emoji: "👋", label: "waving hand", group: 1, tags: ["hi"], version: 0.6, order: 2, skins: [1, 2, 3, 4, 5].map((tone) => ({ emoji: `👋${tone}`, label: "x", tone, version: 1 })) },
    { emoji: "🏻", label: "light skin tone", group: 2, version: 1, order: 3 },
    { emoji: "🇦", label: "regional indicator A", version: 0.6, order: 4 },
    { emoji: "🫨", label: "shaking face", group: 0, tags: [], version: 15, order: 5 },
  ];
  it("keeps the nine groups, drops the skin-tone components, the lone letters and what an older phone cannot draw", () => {
    const data = toEmojiData(raw as never);
    expect(data.emojis.map((e) => e.emoji)).toEqual(["😀", "👋"]);
    expect(data.categories.map((c) => c.label)).toContain("Smileys & Emotion");
    expect(data.categories.find((c) => c.index === 1)?.label).toBe("People & Body");
    expect(data.emojis[1]!.skins).toEqual({ light: "👋1", "medium-light": "👋2", medium: "👋3", "medium-dark": "👋4", dark: "👋5" });
    expect(data.emojis[0]!.skins).toBeUndefined();
    expect(MAX_EMOJI_VERSION).toBeLessThan(15);
  });
  it("reads the set that ships in node_modules (a dynamic import, so the picker's chunk loads only when it opens)", async () => {
    const data = await resolveBundledEmojiData("en", {});
    expect(data.emojis.length).toBeGreaterThan(1500);
    expect(data.categories).toHaveLength(9);
    expect(data.emojis.find((e) => e.emoji === "👋")?.skins?.dark).toBeTruthy();
    expect(data.emojis.every((e) => e.version <= MAX_EMOJI_VERSION)).toBe(true);
  });
});

/**
 * C3c.2 — «ابعت بدون صوت»: the send button's menu (what it offers, how a long press opens it), and the flag's way through the optimistic send, the outbox
 * and the request. The server's half (no bell, no push, unread still counts) is `tests/db/chat-silent-send.test.ts`.
 */
describe("C3c.2: the send button's menu", () => {
  const on = { silentSend: true, editing: false, canSubmit: true };
  it("offers «ابعت بدون صوت» only with the switch on, with something to send and not while an edit is saved; the list is ordered so «جدول الإرسال» (C3c.3) can join it", () => {
    expect(sendMenuItemsOf(on)).toEqual(["silent"]);
    expect(sendMenuItemsOf({ ...on, silentSend: false })).toEqual([]);
    expect(sendMenuItemsOf({ ...on, editing: true })).toEqual([]);
    expect(sendMenuItemsOf({ ...on, canSubmit: false })).toEqual([]);
    expect(SEND_MENU_ITEMS).toEqual(["silent"]);
  });

  it("a long press opens it only when the finger stayed put for long enough (a scroll or an early lift is no press)", () => {
    const down = { x: 100, y: 100 };
    expect(SEND_HOLD_MS).toBeGreaterThanOrEqual(400);
    expect(sendHoldOpensMenu(down, { x: 103, y: 104 }, SEND_HOLD_MS)).toBe(true);
    expect(sendHoldOpensMenu(down, { x: 103, y: 104 }, SEND_HOLD_MS - 1)).toBe(false);
    expect(sendHoldOpensMenu(down, { x: 100 + SEND_HOLD_SLOP_PX + 1, y: 100 }, SEND_HOLD_MS)).toBe(false);
    expect(sendHoldOpensMenu(down, { x: 100, y: 100 - SEND_HOLD_SLOP_PX - 1 }, SEND_HOLD_MS + 500)).toBe(false);
  });

  const withI18n = (node: ReactElement) => renderToStaticMarkup(createElement(I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>, { initial: "ar" }, node));
  const button = createElement("button", { type: "submit", "data-composer-face": "send" }, "➤");

  it("with nothing to offer the button is drawn exactly as it was (no wrapper)", () => {
    expect(withI18n(createElement(SendMenu, { items: [], onPick: () => undefined }, button))).toBe(withI18n(button));
  });

  it("opened, it lists «ابعت بدون صوت» (the word is in the dictionary, no Latin letters)", () => {
    const html = withI18n(createElement(SendMenu, { items: ["silent"], onPick: () => undefined, defaultOpen: true, portal: false }, button));
    expect(html).toContain("data-send-menu");
    expect(html).toContain('data-send-item="silent"');
    expect(html).toContain(AR["chatsilent.menu.silent"]!);
    expect(AR["chatsilent.menu.silent"]).toBe("ابعت بدون صوت");
    expect(AR["chatsilent.menu.silent"]).not.toMatch(/[A-Za-z]/);
  });

  it("the surface draws the menu around the send button only for an engine that can send silently, with the switch on", () => {
    const noop = () => undefined;
    const engine = (over: Record<string, unknown>) =>
      ({
        body: "أهلا", files: [], busy: false, error: "", progress: [], voice: { mode: "idle" }, face: "send", canSubmit: true, choices: [], pickAt: 0, setPick: noop, hint: null,
        textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: noop, removeFile: noop, selectMention: noop,
        onTextChange: noop, onKeyDown: noop, onPaste: noop, submit: noop, cancelRecording: noop, sendVoice: noop, onMicPointerDown: noop, onMicClick: noop, setPollOpen: noop, setRecall: noop,
        ...over,
      }) as never;
    const surface = (c: never, editing: MessageDto | null = null) =>
      withI18n(createElement(ComposerSurface, { c, me: {}, reply: null, editing, onCancelReply: noop, onCancelEdit: noop, recents: [], onEmoji: noop }));
    expect(surface(engine({ submitSilent: noop, silentSendOn: true }))).toContain("data-send-menu");
    expect(surface(engine({ submitSilent: noop }))).toContain("data-send-menu"); // absent switch reads as on
    expect(surface(engine({ submitSilent: noop, silentSendOn: false }))).not.toContain("data-send-menu");
    expect(surface(engine({ silentSendOn: true }))).not.toContain("data-send-menu"); // an engine without the action
    expect(surface(engine({ submitSilent: noop, silentSendOn: true, face: "save" }), msg({ id: "e1" }))).not.toContain("data-send-menu");
    expect(surface(engine({ submitSilent: noop, silentSendOn: true, body: "", canSubmit: false, face: "mic" }))).not.toContain("data-send-menu");
  });
});

describe("C3c.2: the flag travels with the message", () => {
  const CONV = "c1";
  const ME = { id: "me", name: "أنا", avatar: null };
  const bodyOf = (call: { body: string }) => JSON.parse(call.body) as Record<string, unknown>;

  it("the request carries `silent` only for a silent message", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchImpl = async (_input: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push(init);
      return { ok: true, status: 201, json: async () => ({ id: "srv" }) };
    };
    await postChatMessage(CONV, { body: "أ", attachmentIds: [], mentions: [], clientId: "k1", silent: true }, fetchImpl as never);
    await postChatMessage(CONV, { body: "أ", attachmentIds: [], mentions: [], clientId: "k2" }, fetchImpl as never);
    expect(bodyOf(calls[0]!)).toMatchObject({ clientId: "k1", silent: true });
    expect("silent" in bodyOf(calls[1]!)).toBe(false);
  });

  it("the outbox keeps it: enqueue, a reload (sanitize), and every retry's request", async () => {
    const storage = memoryOutboxStorage();
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 201, json: async () => ({ id: "srv-k1" }) };
    });
    try {
      const outbox = new Outbox({ userId: "me", storage, send: sendOutboxItem });
      expect(outbox.enqueue({ clientId: "k1", conversationId: CONV, body: "أ", mentions: [], silent: true }, Date.now(), { retryAfterSec: 1 }).ok).toBe(true);
      expect(outbox.getSnapshot()[0]?.silent).toBe(true);
      // the stored copy (what a reload reads) is still silent; a loud one has no flag
      await outbox.settled();
      expect(parseStored(storage.dump()[outboxKey("me")] ?? null, "me")[0]?.silent).toBe(true);
      outbox.enqueue({ clientId: "k2", conversationId: "c2", body: "ب", mentions: [] }, Date.now(), { retryAfterSec: 1 });
      await outbox.settled();
      expect(parseStored(storage.dump()[outboxKey("me")] ?? null, "me").find((i) => i.clientId === "k2")?.silent).toBeUndefined();
      outbox.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
    // the retry's own request
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 201, json: async () => ({ id: "srv-k1" }) };
    });
    try {
      await sendOutboxItem({ clientId: "k1", conversationId: CONV, body: "أ", mentions: [], silent: true, createdAt: 1, attempts: 2 });
      await sendOutboxItem({ clientId: "k3", conversationId: CONV, body: "ج", mentions: [], createdAt: 1, attempts: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sent.at(-2)).toMatchObject({ clientId: "k1", silent: true });
    expect("silent" in sent.at(-1)!).toBe(false);
  });

  it("the optimistic send hands the flag to the outbox when the network is gone, and to the request when it is not (same clientId either way)", async () => {
    resetPendingForTests();
    const qc = new QueryClient();
    qc.setQueryData<MessagesData>(chatKeys.messages(CONV), { pages: [{ messages: [], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] }], pageParams: [LATEST] });
    const outbox = new Outbox({ userId: "me", storage: memoryOutboxStorage(), send: async () => ({ kind: "transient" }) });
    const payload = (clientId: string): ChatSendPayload => ({ body: "مرحبا", attachmentIds: [], mentions: [], clientId, silent: true });

    const offline = startOptimisticSend({ qc, outbox, online: () => false }, { conversationId: CONV, payload: payload("k1"), author: ME });
    expect(offline.shown).toBe(true);
    expect(outbox.getSnapshot().find((i) => i.clientId === "k1")?.silent).toBe(true);

    const seen: ChatSendPayload[] = [];
    const post = (async (_c: string, p: ChatSendPayload) => {
      seen.push(p);
      return { kind: "transient" } as const;
    }) as NonNullable<OptimisticDeps["post"]>;
    const online = startOptimisticSend({ qc, outbox: new Outbox({ userId: "me2", storage: memoryOutboxStorage(), send: async () => ({ kind: "transient" }) }), post, online: () => true }, { conversationId: CONV, payload: payload("k2"), author: ME });
    if (!online.shown) throw new Error("unreachable");
    await online.done;
    expect(seen[0]).toMatchObject({ clientId: "k2", silent: true });
    outbox.dispose();
  });
});

describe("C3c.2: a silent message makes no arrival sound on the other screen", () => {
  const old = [makeMessage({ id: "m1" })];
  it("silent: none (even a mention); the same message loud still sounds", () => {
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2", silent: true })], meId: "u1" })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2", silent: true, mentions: ["u1"] })], meId: "u1" })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2" })], meId: "u1" })).toBe("received");
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2", silent: false })], meId: "u1" })).toBe("received");
  });
});
