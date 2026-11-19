import { describe, expect, it } from "vitest";
import type { MessageDto } from "@/server/chat/dto";
import { composerBarOf } from "@/lib/chat/v2/pane/composer-bar";
import { composerFaceOf, canSubmitNow } from "@/lib/chat/v2/composer/face";
import { loadRecentEmoji, rememberEmoji, MAX_RECENT_EMOJI, RECENT_EMOJI_KEY } from "@/lib/chat/v2/composer/recent-emoji";
import { dragHasFiles, forDropMode, pastedImages, type ClipboardLike } from "@/lib/chat/v2/composer/clipboard-files";
import { HOLD_CANCEL_PX, HOLD_LOCK_PX, holdOutcome } from "@/lib/chat/v2/composer/hold-gesture";
import { arrowUpEdits, lastEditableOf } from "@/lib/chat/v2/composer/edit-last";
import { composerHintOf } from "@/lib/chat/v2/composer/hint";
import { attachItemsOf } from "@/lib/chat/v2/composer/attach-items";
import { emojiGroupOf } from "@/lib/chat/v2/composer/emoji-groups";

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
