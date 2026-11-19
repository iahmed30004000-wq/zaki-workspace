import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pressInlineButton } from "@/lib/chat/v2/menu/inline-press";

/**
 * C2.6 — the gestures and the wiring that cannot be seen in a server render (there is no DOM and no pointer here): pinned by reading the source, the way
 * `chat-v2-pane-seams.test.ts` pins the pane — plus the one pure piece, the press of the button a picture or a voice note draws under itself.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("«اقرأ النص» and «حوّل الصوت لنص» press the button the file already draws", () => {
  const button = (over: { disabled?: boolean } = {}) => ({ click: vi.fn(), ...over });
  const root = (mark: string, host: { querySelector: (s: string) => unknown } | null) => ({ querySelector: (s: string) => (s === mark ? host : null) }) as never;

  it("presses the first button of the picture's block when nothing was asked yet", () => {
    const b = button();
    const host = { querySelector: (s: string) => (s === "button" ? b : null) };
    expect(pressInlineButton(root("[data-image-text]", host), "image-text")).toBe(true);
    expect(b.click).toHaveBeenCalledTimes(1);
  });

  it("presses the voice note's block the same way, by its own mark", () => {
    const b = button();
    const host = { querySelector: (s: string) => (s === "button" ? b : null) };
    expect(pressInlineButton(root("[data-voice-transcript]", host), "voice-transcript")).toBe(true);
    expect(b.click).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the text is already on screen (it never hides what the person is reading)", () => {
    const b = button();
    const host = { querySelector: (s: string) => (s === '[dir="auto"]' ? {} : s === "button" ? b : null) };
    expect(pressInlineButton(root("[data-image-text]", host), "image-text")).toBe(false);
    expect(b.click).not.toHaveBeenCalled();
  });

  it("does nothing for a busy (disabled) button, a block without a button, a bubble without the block, or no bubble", () => {
    const busy = button({ disabled: true });
    expect(pressInlineButton(root("[data-image-text]", { querySelector: (s: string) => (s === "button" ? busy : null) }), "image-text")).toBe(false);
    expect(busy.click).not.toHaveBeenCalled();
    expect(pressInlineButton(root("[data-image-text]", { querySelector: () => null }), "image-text")).toBe(false);
    expect(pressInlineButton(root("[data-image-text]", null), "image-text")).toBe(false);
    expect(pressInlineButton(null, "image-text")).toBe(false);
  });

  it("the marks it looks for are still the ones the two owners write", () => {
    expect(read("src/components/image-text.tsx")).toContain("data-image-text");
    expect(read("src/components/chat/message/voice-transcript.tsx")).toContain("data-voice-transcript");
    // the new bubble's media is where those blocks are drawn
    const media = read("src/components/chat/v2/bubble/bubble-media.tsx");
    expect(media).toContain("<ImageText");
    expect(media).toContain("<VoiceTranscript");
  });
});

describe("the bubble's gestures", () => {
  const bubble = read("src/components/chat/v2/message-bubble.tsx");

  it("a right click (and the menu key) opens the menu; a long press with a finger opens the sheet (the old LONG_PRESS_MS, not a second number)", () => {
    expect(bubble).toMatch(/onContextMenu=\{\(e\) => \{[\s\S]*pointer\.current !== "touch"[\s\S]*setMenuOpen\(true\)/);
    expect(bubble).toContain("useLongPress(canAct,");
    expect(read("src/components/chat/v2/bubble/use-long-press.ts")).toContain("LONG_PRESS_MS");
    expect(bubble).not.toMatch(/LONG_PRESS_MS\s*=/);
  });

  it("the browser's own menu is kept for text that is selected (a right click to copy a word still works)", () => {
    expect(bubble).toContain("window.getSelection()?.toString()");
  });

  it("a double click replies through the menu host's gestures, which ask the registry first", () => {
    expect(bubble).toContain("onDoubleClick={(e) =>");
    expect(bubble).toContain("replyOnDoubleClick({ pointerType: pointer.current, target: e.target })");
    expect(bubble).toContain("gestures.reply(message, facts)");
    const host = read("src/components/chat/v2/pane/seams/menu-host.tsx");
    expect(host).toMatch(/reply: \(message, facts\) => \{\s*if \(menuFor\(menuContextV2\(message, facts,/);
    expect(host).toContain("commands.startReply(message)");
  });

  it("the phone's double tap (a quick reaction) is NOT wired: it is a setting of C4, which does not exist yet", () => {
    expect(bubble).not.toMatch(/onTouchEnd|doubleTap|double_tap/i);
    expect(read("src/lib/chat/v2/menu/gestures.ts")).toContain('event.pointerType !== "mouse"');
  });

  it("nothing is wired for a message that cannot be acted on (deleted, a system line, the owner reading silently)", () => {
    expect(bubble).toContain("const canAct = !facts.oversight && !message.deleted && message.kind !== \"SYSTEM\"");
    expect(bubble).toContain("if (canAct && gestures &&");
  });
});

describe("the menu host's wiring", () => {
  const host = read("src/components/chat/v2/pane/seams/menu-host.tsx");

  it("a reaction (quick or from the picker) is toggled through the pane's react command: the existing route, no door of its own", () => {
    expect(host).toContain("onReact={(emoji) => void commands.react(message, emoji)}");
    expect(host).not.toMatch(/fetch\(/);
  });

  it("«نسخ الرابط» copies /chat/<id>?m=<message> (the one function that writes it) and says so", () => {
    expect(host).toContain("messageLinkOf(window.location.origin, conversationId, message.id)");
    expect(host).toContain('commands.say("chatui.menu.link_copied")');
  });

  it("«اسألي مشرفتك» opens the «🎫 مشكلة» form with the question kind: the existing door, no new one", () => {
    expect(host).toContain("setProblemFor({ message, kindKey: ASK_KIND_KEY })");
  });

  it("«اقرأ النص» and «حوّل الصوت لنص» press the file's own button; «مين شاف» opens today's reader list", () => {
    expect(host).toContain('pressInline("image-text")');
    expect(host).toContain('pressInline("voice-transcript")');
    expect(host).toContain("<ReaderList");
  });

  it("«حدّد» is not wired: its id is not in the registry (C3b.5)", () => {
    expect(host).not.toMatch(/["']select["']/);
  });
});

describe("the full picker", () => {
  const picker = read("src/components/chat/v2/menu/emoji-picker.tsx");

  it("is frimousse with the installed emoji data, never a request to another site", () => {
    expect(picker).toContain('from "frimousse"');
    expect(picker).toContain('import("emojibase-data/en/data.json")');
    expect(picker).toContain("resolveEmojiData={resolveEmojiData}");
    expect(picker).not.toMatch(/jsdelivr|unpkg|emojibaseUrl|https?:\/\//);
  });

  it("every one of the nine categories has a word, and it is in Arabic", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    for (const key of ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"]) {
      expect(picker).toContain(`"chatui.menu.cat.${key}"`);
      expect(AR[`chatui.menu.cat.${key}`], key).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("what the independent review found", () => {
  it("a second picture is read when the first already has its text on screen (the press goes to the first block that has none)", () => {
    const first = { querySelector: (s: string) => (s === '[dir="auto"]' ? {} : null) };
    const clickSecond = vi.fn();
    const second = { querySelector: (s: string) => (s === "button" ? { click: clickSecond } : null) };
    const root = { querySelectorAll: (s: string) => (s === "[data-image-text]" ? [first, second] : []), querySelector: () => null } as never;
    expect(pressInlineButton(root, "image-text")).toBe(true);
    expect(clickSecond).toHaveBeenCalledTimes(1);
  });

  it("«نسخ الرابط» says it failed when the browser has no clipboard (an insecure address, a webview), instead of doing nothing", async () => {
    const { copyText } = await import("@/lib/chat/v2/menu/clipboard");
    expect(await copyText("x", undefined)).toBe(false);
    expect(await copyText("x", { writeText: () => Promise.reject(new Error("denied")) })).toBe(false);
    const written: string[] = [];
    expect(await copyText("x", { writeText: async (t: string) => void written.push(t) })).toBe(true);
    expect(written).toEqual(["x"]);
  });

  it("the keyboard's context menu key opens the menu too (anything but a finger's touch), and the source says so", () => {
    expect(read("src/components/chat/v2/message-bubble.tsx")).toMatch(/pointer\.current !== "touch"/);
  });

  it("Esc does not leave the conversation while a popover or a tooltip is open", () => {
    expect(read("src/lib/chat/shortcuts.ts")).toContain("data-radix-popper-content-wrapper");
  });

  it("the menu context of a bubble is not rebuilt on every draw", () => {
    expect(read("src/components/chat/v2/pane/seams/menu-host.tsx")).toMatch(/const context = React\.useMemo\(\(\) => menuContextV2\(message, facts,/);
  });
});
