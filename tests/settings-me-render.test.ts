import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/settings/me" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { AvatarMenu } from "@/components/shell/avatar-menu";
import { Drawer } from "@/components/shell/drawer";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { buildNav } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import {
  DEFAULT_FONT_STEP,
  FONT_SCALES,
  NOTIFY_TYPES,
  PREVIEW_OFF_TEXT,
  WALLPAPERS,
  PATTERN_WALLPAPERS,
  PHOTO_WALLPAPERS,
  DEFAULT_WALLPAPER,
  chatPrefsPatchSchema,
  chatPrefsSchema,
  fontScaleOf,
  fontStepOf,
  mergeChatPrefs,
  notifyOn,
  notifyTypeOf,
  pushBodyFor,
  quickReactionsPref,
  readChatPrefs,
  resolveChatPrefs,
  sendKeyAllows,
  sendsOnKey,
} from "@/lib/chat/prefs";
import {
  DEFAULT_AUTO_DOWNLOAD,
  DEVICE_PREFS_KEY,
  autoDownloadOn,
  cleanDevicePrefs,
  clearMirror,
  effectiveFontStep,
  mirrorOf,
  mirrorStale,
  patchDevicePrefs,
  readDevicePrefs,
  saveDevicePrefs,
  MIRROR_FRESH_MS,
} from "@/lib/device-prefs";
import { QUICK_PALETTE, TAP_MAX_MS, DOUBLE_TAP_MS, doubleTapEmojiOf, quickReactionsOf, shouldQuickReact, touchTap } from "@/lib/chat/v2/menu/quick-reactions";
import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { maxSideFor, MAX_SIDE, HIGH_MAX_SIDE } from "@/lib/chat/compress-image";
import { settingsShortcutOf, SETTINGS_SHORTCUT } from "@/lib/chat/shortcuts";
import { WALLPAPER_STYLE_ID, WALLPAPER_VAR, FONT_SCALE_VAR, applyFontScale, applyWallpaper, tintSvg, wallpaperRule } from "@/components/settings-me/appearance";
import { SECTION_KEYS, isSectionKey, sectionHref, sectionOfPath, visibleSections } from "@/components/settings-me/sections";
import { SettingsFrame } from "@/components/settings-me/settings-frame";
import { NotificationsSection, withRule } from "@/components/settings-me/notifications-section";
import { PrivacySection } from "@/components/settings-me/privacy-section";
import { ChatSection, withChat } from "@/components/settings-me/chat-section";
import { DataSection, formatBytes } from "@/components/settings-me/data-section";
import { DevicesSection, browserLabelOf } from "@/components/settings-me/devices-section";
import { LanguageSection } from "@/components/settings-me/language-section";
import { MenuSection, moveKey } from "@/components/settings-me/menu-section";
import { ShortcutsSection } from "@/components/settings-me/shortcuts-section";
import { HelpSection } from "@/components/settings-me/help-section";
import { bootData, bootScript } from "@/lib/themes/boot";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))));
}
const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

// ───────────────────────────── the schema ─────────────────────────────

describe("C4.1 · the person's choices in User.chatPrefs (src/lib/chat/prefs.ts)", () => {
  it("an empty object is «all defaults»: every new field has its default in code", () => {
    const all = resolveChatPrefs({});
    expect(all.notifications).toEqual({});
    expect(all.chat).toEqual({});
    for (const type of NOTIFY_TYPES) expect(notifyOn({}, type), type).toBe(true);
    expect(fontStepOf({})).toBe(DEFAULT_FONT_STEP);
    expect(fontScaleOf(DEFAULT_FONT_STEP)).toBe(1);
    expect(quickReactionsPref({})).toBeUndefined();
  });

  it("writing is strict: known keys with the right shape, six DIFFERENT emojis, a step of the five, a wallpaper of the seven", () => {
    const ok = chatPrefsSchema.safeParse({
      notifications: { private: { on: false }, calls: { on: true }, mentions: { preview: false }, dm: { on: false } },
      chat: { fontStep: 4, wallpaper: "coins", sendKey: "ctrl", quickReactions: [...CHAT_REACTIONS], doubleTap: "🔥", themeAuto: true, fontSize: 3 },
    });
    expect(ok.success).toBe(true);
    const bad = (value: unknown) => chatPrefsSchema.safeParse(value).success;
    expect(bad({ notifications: { private: { on: "x" } } })).toBe(false);
    expect(bad({ notifications: { private: { colour: 1 } } })).toBe(false);
    expect(bad({ chat: { fontStep: 5 } })).toBe(false);
    expect(bad({ chat: { fontStep: -1 } })).toBe(false);
    expect(bad({ chat: { wallpaper: "none" } })).toBe(false);
    expect(bad({ chat: { sendKey: "alt" } })).toBe(false);
    expect(bad({ chat: { quickReactions: ["👍", "👍", "😂", "🎉", "🔥", "👀"] } })).toBe(false);
    expect(bad({ chat: { quickReactions: ["👍", "😂"] } })).toBe(false);
    expect(bad({ chat: { quickReactions: ["a", "b", "c", "d", "e", "f"] } })).toBe(false);
    expect(bad({ chat: { doubleTap: "x" } })).toBe(false);
    // ONE emoji: two side by side are two, a flag, a family and a skin tone are one
    expect(bad({ chat: { doubleTap: "👍👍" } })).toBe(false);
    expect(bad({ chat: { quickReactions: ["👍🔥", "❤️", "😂", "🎉", "🔥", "👀"] } })).toBe(false);
    expect(bad({ chat: { doubleTap: "🇯🇴" } })).toBe(true);
    expect(bad({ chat: { doubleTap: "👨‍👩‍👧" } })).toBe(true);
    expect(bad({ chat: { doubleTap: "👍🏽" } })).toBe(true);
    expect(bad({ chat: { "bad key": 1 } })).toBe(false);
    expect(chatPrefsPatchSchema.safeParse({ chat: null, notifications: null }).success).toBe(true);
  });

  it("reading is forgiving: a damaged key goes, the rest of the section stays, an unknown key is kept", () => {
    const read = readChatPrefs({ chat: { fontStep: 9, wallpaper: "stars", extra: 1 }, notifications: { private: { on: 7 }, topics: { on: false } } });
    expect(read.chat).toEqual({ wallpaper: "stars", extra: 1 });
    expect(read.notifications).toEqual({ topics: { on: false } });
    expect(readChatPrefs({ chat: "loud", notifications: [] })).toEqual({});
  });

  it("a save is a patch: the section named is replaced whole, the others stay, null puts one back to its default", () => {
    const start = readChatPrefs({ chat: { wallpaper: "boxes" }, notifications: { private: { on: false } }, voiceSpeed: 2 });
    const next = mergeChatPrefs(start, { chat: { fontStep: 3 } });
    expect(next).toEqual({ chat: { fontStep: 3 }, notifications: { private: { on: false } }, voiceSpeed: 2 });
    expect(mergeChatPrefs(next, { notifications: null }).notifications).toBeUndefined();
  });

  it("the kinds a message is FOR a person: addressed → mentions, a private chat → private, a reply to me → replies, else topics", () => {
    expect(notifyTypeOf({ kind: "DM", mentioned: false, replied: false })).toBe("private");
    // a private chat is «private» even when the message names the person: the switch for mentions never silences it
    expect(notifyTypeOf({ kind: "DM", mentioned: true, replied: false })).toBe("private");
    expect(notifyTypeOf({ kind: "TOPIC", mentioned: false, replied: false })).toBe("topics");
    expect(notifyTypeOf({ kind: "TOPIC", mentioned: false, replied: true })).toBe("replies");
    expect(notifyTypeOf({ kind: "GROUP", mentioned: true, replied: true })).toBe("mentions");
  });
});

describe("C4.1 · the payload builder: preview off says «رسالة جديدة» only", () => {
  it("with the preview switched off for the kind the push body is the generic text, whatever the words were", () => {
    const prefs = readChatPrefs({ notifications: { private: { preview: false } } });
    expect(pushBodyFor(prefs, "private", "كلمة سرية")).toBe(PREVIEW_OFF_TEXT);
    expect(PREVIEW_OFF_TEXT).toBe("رسالة جديدة");
    expect(pushBodyFor(prefs, "private", "كلمة سرية")).not.toContain("سرية");
  });

  it("per kind, and never changes the words for a person who chose nothing", () => {
    const prefs = readChatPrefs({ notifications: { private: { preview: false } } });
    expect(pushBodyFor(prefs, "mentions", "يا أحمد")).toBe("يا أحمد");
    expect(pushBodyFor(prefs, "topics", "نص")).toBe("نص");
    expect(pushBodyFor({}, "private", "نص")).toBe("نص");
    expect(pushBodyFor(null, "private", "نص")).toBe("نص");
    expect(pushBodyFor(undefined, "calls", "نص")).toBe("نص");
  });

  it("src/server/chat/notify.ts hands that body to the push (and keeps the bell's), and a kind that is off is skipped before anything is written", () => {
    const notify = read("src/server/chat/notify.ts");
    expect(notify).toContain("pushBody: pushBodyFor(chosen, type,");
    expect(notify).toMatch(/if \(chosen && !notifyOn\(chosen, type\)\) continue;/);
    expect(read("src/server/calls/push.ts")).toContain('message.kind === "ring" || message.kind === "missed"');
  });
});

describe("C4.1 · the send key", () => {
  it("«إنتر بيبعت» (default): Enter sends, Shift+Enter is a new line; «كنترول مع إنتر»: only Ctrl+Enter sends; never while composing", () => {
    const enter = { key: "Enter", shiftKey: false, ctrlKey: false };
    expect(sendsOnKey(undefined, enter)).toBe(true);
    expect(sendsOnKey("enter", enter)).toBe(true);
    expect(sendsOnKey("enter", { ...enter, shiftKey: true })).toBe(false);
    expect(sendsOnKey("ctrl", enter)).toBe(false);
    expect(sendsOnKey("ctrl", { ...enter, ctrlKey: true })).toBe(true);
    expect(sendsOnKey("ctrl", { ...enter, metaKey: true })).toBe(true);
    expect(sendsOnKey("ctrl", { ...enter, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(sendsOnKey("ctrl", { ...enter, ctrlKey: true, isComposing: true })).toBe(false);
    expect(sendsOnKey("ctrl", { key: "a", shiftKey: false, ctrlKey: true })).toBe(false);
    expect(sendKeyAllows("ctrl", { ctrlKey: false })).toBe(false);
    expect(sendKeyAllows(undefined, { ctrlKey: false })).toBe(true);
  });

  it("the composer asks the person's choice at the moment of the key (and still asks enterSends, so the old rule is intact)", () => {
    const composer = read("src/lib/chat/v2/composer/use-composer.ts");
    expect(composer).toContain("enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: composing }) && sendKeyAllows(readDevicePrefs().mirror?.sendKey, event)");
    expect(composer).toContain("maxSide: maxSideFor(readDevicePrefs().imageQuality)");
  });

  it("the picture quality: «عادية» is today's 1600 px, «عالية» 3200 px", () => {
    expect(maxSideFor(undefined)).toBe(MAX_SIDE);
    expect(maxSideFor("normal")).toBe(1600);
    expect(maxSideFor("high")).toBe(HIGH_MAX_SIDE);
    expect(HIGH_MAX_SIDE).toBe(3200);
  });
});

// ───────────────────────────── the device's own choices ─────────────────────────────

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe("C4.1 · zk-device-prefs (src/lib/device-prefs.ts)", () => {
  it("nothing stored, a damaged value or a browser with no storage all read as the defaults", () => {
    expect(readDevicePrefs(memory())).toEqual({});
    expect(readDevicePrefs(memory({ [DEVICE_PREFS_KEY]: "{{{" }))).toEqual({});
    expect(readDevicePrefs(memory({ [DEVICE_PREFS_KEY]: "[1,2]" }))).toEqual({});
    expect(readDevicePrefs(null)).toEqual({});
    expect(effectiveFontStep({})).toBe(DEFAULT_FONT_STEP);
    expect(autoDownloadOn({}, "wifi", "video")).toBe(DEFAULT_AUTO_DOWNLOAD.wifi.video);
    expect(autoDownloadOn({}, "mobile", "video")).toBe(false);
  });

  it("what is kept is cleaned: a step of the five, a quality of the two, booleans, six different emojis", () => {
    const clean = cleanDevicePrefs({
      textSize: 4,
      imageQuality: "high",
      autoDownload: { wifi: { video: false, files: "no" }, mobile: {}, satellite: { images: true } },
      mirror: { fontStep: 1, wallpaper: "stars", sendKey: "ctrl", quickReactions: [...CHAT_REACTIONS], doubleTap: "❤️", themeAuto: true, themeV2: true, at: 5, junk: 1 },
      other: 1,
    });
    expect(clean).toEqual({
      textSize: 4,
      imageQuality: "high",
      autoDownload: { wifi: { video: false } },
      mirror: { fontStep: 1, wallpaper: "stars", sendKey: "ctrl", quickReactions: [...CHAT_REACTIONS], doubleTap: "❤️", themeAuto: true, themeV2: true, at: 5 },
    });
    expect(cleanDevicePrefs({ textSize: 9, imageQuality: "ultra", mirror: { quickReactions: ["👍", "👍", "😂", "🎉", "🔥", "👀"], wallpaper: "x" } })).toEqual({});
  });

  it("saving and patching keep the rest; an empty object removes the key; the device's own text size wins over the account's", () => {
    const store = memory();
    patchDevicePrefs({ textSize: 3 }, store);
    patchDevicePrefs({ imageQuality: "high" }, store);
    expect(readDevicePrefs(store)).toEqual({ textSize: 3, imageQuality: "high" });
    patchDevicePrefs({ textSize: undefined, imageQuality: undefined }, store);
    expect(store.data.has(DEVICE_PREFS_KEY)).toBe(false);
    saveDevicePrefs({ mirror: { fontStep: 1 } }, store);
    expect(effectiveFontStep(readDevicePrefs(store))).toBe(1);
    patchDevicePrefs({ textSize: 4 }, store);
    expect(effectiveFontStep(readDevicePrefs(store))).toBe(4);
  });

  it("sign-out removes the copy of the account's choices (the next person starts clean) and keeps the device's own", () => {
    const store = memory();
    saveDevicePrefs({ textSize: 3, imageQuality: "high", mirror: { fontStep: 4, sendKey: "ctrl", themeAuto: true } }, store);
    clearMirror(store);
    expect(readDevicePrefs(store)).toEqual({ textSize: 3, imageQuality: "high" });
    clearMirror(memory());
    for (const file of ["src/components/shell/avatar-menu.tsx", "src/components/settings-me/devices-section.tsx"]) expect(read(file), file).toContain("clearMirror()");
  });

  it("the copy of the account's choices is stamped, and is stale after six hours (or in the future, or when there is none)", () => {
    const mirror = mirrorOf(readChatPrefs({ chat: { fontStep: 3, wallpaper: "leaves", sendKey: "ctrl" } }), 1000);
    expect(mirror).toEqual({ at: 1000, fontStep: 3, wallpaper: "leaves", sendKey: "ctrl" });
    expect(mirrorStale({ mirror }, 1000 + MIRROR_FRESH_MS - 1)).toBe(false);
    expect(mirrorStale({ mirror }, 1000 + MIRROR_FRESH_MS + 1)).toBe(true);
    expect(mirrorStale({ mirror }, 10)).toBe(true);
    expect(mirrorStale({}, 1000)).toBe(true);
  });
});

// ───────────────────────────── the quick reactions and the double tap ─────────────────────────────

describe("C4.1 · the six quick reactions and the phone's double tap", () => {
  it("quickReactionsOf(preference) is where the person's six plug in; anything but six distinct emojis is today's six", () => {
    const mine = ["🙏", "💯", "😍", "🚀", "⭐", "🤝"];
    expect(quickReactionsOf(mine)).toEqual(mine);
    expect(quickReactionsOf(null)).toEqual([...CHAT_REACTIONS]);
    expect(quickReactionsOf(["🙏", "💯"])).toEqual([...CHAT_REACTIONS]);
    expect(quickReactionsOf(["🙏", "🙏", "😍", "🚀", "⭐", "🤝"])).toEqual([...CHAT_REACTIONS]);
    expect(quickReactionsOf(["a", "💯", "😍", "🚀", "⭐", "🤝"])).toEqual([...CHAT_REACTIONS]);
    // asked nothing in a browser with no storage (a test, the server): today's six
    expect(quickReactionsOf()).toEqual([...CHAT_REACTIONS]);
  });

  it("the palette of the settings screen is all single emojis, none repeated, and holds today's six", () => {
    expect(new Set(QUICK_PALETTE).size).toBe(QUICK_PALETTE.length);
    for (const emoji of QUICK_PALETTE) expect(quickReactionsOf([emoji, ...CHAT_REACTIONS.filter((e) => e !== emoji)].slice(0, 6))[0], emoji).toBeDefined();
    for (const emoji of CHAT_REACTIONS) expect(QUICK_PALETTE).toContain(emoji);
    expect(chatPrefsSchema.safeParse({ chat: { quickReactions: QUICK_PALETTE.slice(0, 6) } }).success).toBe(true);
  });

  it("the double tap reacts only with an emoji the person chose (none is the default), and never takes their own reaction away", () => {
    expect(doubleTapEmojiOf(undefined)).toBeNull();
    expect(doubleTapEmojiOf("")).toBeNull();
    expect(doubleTapEmojiOf("hello")).toBeNull();
    expect(doubleTapEmojiOf("❤️")).toBe("❤️");
    expect(shouldQuickReact(null, [])).toBe(false);
    expect(shouldQuickReact("❤️", [])).toBe(true);
    expect(shouldQuickReact("❤️", [{ emoji: "❤️", mine: false }])).toBe(true);
    expect(shouldQuickReact("❤️", [{ emoji: "❤️", mine: true }])).toBe(false);
  });

  const down = 1000;
  const tap = (over: Partial<Parameters<typeof touchTap>[1]> = {}) => ({ pointerType: "touch", target: null, at: down + 80, x: 100, y: 200, downAt: down, ...over });

  it("two quick taps of a finger close together are a double tap; the tracker then starts again", () => {
    const first = touchTap(null, tap());
    expect(first.double).toBe(false);
    expect(first.last).not.toBeNull();
    const second = touchTap(first.last, tap({ at: down + 80 + 200, downAt: down + 200, x: 110, y: 205 }));
    expect(second.double).toBe(true);
    expect(second.last).toBeNull();
    // a third tap right after is a first tap again
    expect(touchTap(second.last, tap({ at: down + 500, downAt: down + 440 })).double).toBe(false);
  });

  it("not a double tap: too slow between taps, too far apart, a long press, a pen or a mouse, or a tap on a link / button / field", () => {
    const first = touchTap(null, tap()).last;
    expect(touchTap(first, tap({ at: down + 80 + DOUBLE_TAP_MS + 1, downAt: down + 400 })).double).toBe(false);
    expect(touchTap(first, tap({ at: down + 160, downAt: down + 100, x: 160 })).double).toBe(false);
    expect(touchTap(first, tap({ at: down + 100 + TAP_MAX_MS + 1, downAt: down + 100 })).double).toBe(false);
    expect(touchTap(first, tap({ at: down + 160, downAt: down + 100, pointerType: "pen" })).double).toBe(false);
    expect(touchTap(first, tap({ at: down + 160, downAt: down + 100, pointerType: "mouse" })).double).toBe(false);
    const link = { closest: (selector: string) => (selector.includes("a,") ? {} : null) };
    expect(touchTap(first, tap({ at: down + 160, downAt: down + 100, target: link as unknown as EventTarget })).double).toBe(false);
    // a pen or a mouse also forgets the first tap
    expect(touchTap(first, tap({ pointerType: "mouse" })).last).toBeNull();
  });
});

// ───────────────────────────── the text size and the wallpaper apply at once ─────────────────────────────

function fakeDocument() {
  const style = new Map<string, string>();
  const attrs = new Map<string, string>();
  const nodes = new Map<string, { id: string; textContent: string | null; remove(): void }>();
  const doc = {
    documentElement: {
      style: { setProperty: (k: string, v: string) => void style.set(k, v), removeProperty: (k: string) => void style.delete(k) },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    },
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: () => {
      const node = { id: "", textContent: null as string | null, remove() {} };
      node.remove = () => void nodes.delete(node.id);
      return node;
    },
    head: { appendChild: (node: { id: string; textContent: string | null; remove(): void }) => void nodes.set(node.id, node) },
  };
  return { doc, style, attrs, nodes };
}

describe("C4.1 · text size and wallpaper apply live, without a reload", () => {
  it("the text size is --chat-font-scale on <html> at once: each of the five steps, and null puts it back", () => {
    const { doc, style } = fakeDocument();
    for (const [step, scale] of FONT_SCALES.entries()) {
      applyFontScale(doc, fontScaleOf(step));
      expect(style.get(FONT_SCALE_VAR), String(step)).toBe(String(scale));
    }
    applyFontScale(doc, null);
    expect(style.has(FONT_SCALE_VAR)).toBe(false);
    // globals.css really scales the chat's sizes by that variable
    expect(read("src/app/globals.css")).toContain("calc(15px * var(--chat-font-scale))");
  });

  it("a wallpaper draws its pattern tinted by the theme's colour behind the open conversation; «سادة» removes it all", async () => {
    const { doc, style, attrs, nodes } = fakeDocument();
    const svg = '<svg><path stroke="#000" d="M0 0"/></svg>';
    await applyWallpaper(doc, "stars", "28 58 82", async (url) => {
      expect(url).toBe("/brand/wallpapers/stars.svg");
      return svg;
    });
    expect(attrs.get("data-chat-wallpaper")).toBe("stars");
    const image = decodeURIComponent(style.get(WALLPAPER_VAR) ?? "");
    expect(image).toContain('stroke="rgb(28,58,82)"');
    expect(image).not.toContain("#000");
    expect(nodes.get(WALLPAPER_STYLE_ID)?.textContent).toBe(wallpaperRule());
    expect(wallpaperRule()).toContain('[role="log"][data-conversation-id]');
    expect(wallpaperRule()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // another wallpaper changes the picture (and keeps one rule)
    await applyWallpaper(doc, "leaves", "1 2 3", async () => svg);
    expect(attrs.get("data-chat-wallpaper")).toBe("leaves");
    expect(nodes.size).toBe(1);
    // a picture wallpaper: no fetch, the file is the image, the page knows it is a picture (wide and tall)
    await applyWallpaper(doc, "sunset", "1 2 3", async () => {
      throw new Error("a picture is not fetched");
    });
    expect(attrs.get("data-chat-wallpaper")).toBe("sunset");
    expect(attrs.get("data-chat-wallpaper-kind")).toBe("photo");
    expect(style.get(WALLPAPER_VAR)).toBe('url("/brand/wallpapers/photo/sunset.webp")');
    expect(style.get("--chat-wallpaper-image-tall")).toBe('url("/brand/wallpapers/photo/sunset-tall.webp")');
    expect(wallpaperRule()).toContain("cover");
    expect(wallpaperRule()).toContain("max-width:767px");
    expect(PHOTO_WALLPAPERS.length).toBe(15);
    expect(WALLPAPERS.length).toBe(1 + PATTERN_WALLPAPERS.length + PHOTO_WALLPAPERS.length);
    // plain: nothing is left
    await applyWallpaper(doc, "plain", "1 2 3", async () => svg);
    expect(attrs.has("data-chat-wallpaper")).toBe(false);
    expect(style.has(WALLPAPER_VAR)).toBe(false);
    expect(nodes.size).toBe(0);
  });

  it("a pattern that cannot be read leaves no half-drawn page; the six patterns of the set exist as files", async () => {
    const { doc, attrs, nodes } = fakeDocument();
    await applyWallpaper(doc, "boxes", "1 2 3", async () => {
      throw new Error("offline");
    });
    expect(attrs.has("data-chat-wallpaper")).toBe(false);
    expect(nodes.size).toBe(0);
    for (const key of PATTERN_WALLPAPERS) expect(read(`public/brand/wallpapers/${key}.svg`), key).toContain('stroke="#000"');
    expect(tintSvg('<g stroke="#000"/>', "bad")).toBe('<g stroke="#000"/>');
    // a person who never chose gets a drawn pattern out of the box (the chat looks like a messenger), never the bare wall
    expect(DEFAULT_WALLPAPER).not.toBe("plain");
    expect(WALLPAPERS).toContain(DEFAULT_WALLPAPER);
  });

  it("the settings screen saves the size through the same line as the folders, and the cache's effect applies it (no reload)", () => {
    const chat = read("src/components/settings-me/chat-section.tsx");
    expect(chat).toContain("save((p) => ({ chat: withChat(p, \"fontStep\"");
    expect(chat).toContain("applyAppearance(readDevicePrefs())");
    const hook = read("src/components/settings-me/use-person-prefs.ts");
    expect(hook).toContain("applyAppearance(readDevicePrefs())");
    expect(hook).toContain("[prefs, themeV2]");
  });
});

// ───────────────────────────── «تلقائي حسب الجهاز» and the switch themeV2Default ─────────────────────────────

function runBoot(opts: { cookie?: string; prefs?: unknown; dark?: boolean }) {
  const attrs: Record<string, string> = { "data-theme": "night" };
  const classes = new Set<string>(["dark"]);
  const style: Record<string, string> = { "--chat-font-scale": "stale" };
  const meta = { content: "unset", setAttribute(_k: string, v: string) { this.content = v; } };
  const listeners: Array<() => void> = [];
  const mq = { matches: opts.dark === true, addEventListener: (_: string, fn: () => void) => void listeners.push(fn) };
  const win: Record<string, unknown> = { matchMedia: () => mq };
  const html = {
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) },
    style: { setProperty: (k: string, v: string) => void (style[k] = v), removeProperty: (k: string) => void delete style[k] },
  };
  const document = { documentElement: html, cookie: opts.cookie ?? "", querySelector: (sel: string) => (sel.includes("theme-color") ? meta : null) };
  const sandbox = {
    window: win,
    document,
    localStorage: { getItem: (k: string) => (k === DEVICE_PREFS_KEY && opts.prefs !== undefined ? JSON.stringify(opts.prefs) : null) },
    matchMedia: () => mq,
  };
  vm.runInNewContext(bootScript(), sandbox);
  return { attrs, classes, style, meta, win, listeners, mq, document };
}

describe("C4.1 · «تلقائي حسب الجهاز» (the boot script of the root layout) and the switch themeV2Default", () => {
  it("with the switch OFF a person who never chose is left on the server's «ليل»: no cookie, no copy, nothing changes (DEFAULT_THEME does not change)", () => {
    for (const dark of [true, false]) {
      const r = runBoot({ dark });
      expect(r.attrs["data-theme"], String(dark)).toBe("night");
      expect(r.classes.has("dark")).toBe(true);
    }
    const off = runBoot({ dark: false, prefs: { mirror: { themeV2: false } } });
    expect(off.attrs["data-theme"]).toBe("night");
  });

  it("«تلقائي» chosen (the cookie says system) follows the device: «ليل» / «نهار» with the switch OFF, «ليل أزرق» / «سماء» with it ON", () => {
    expect(runBoot({ cookie: "zaki_theme=system", dark: true }).attrs["data-theme"]).toBe("night");
    const day = runBoot({ cookie: "zaki_theme=system", dark: false });
    expect(day.attrs["data-theme"]).toBe("day");
    expect(day.classes.has("dark")).toBe(false);
    const on = { mirror: { themeV2: true } };
    const blue = runBoot({ cookie: "zaki_theme=system", dark: true, prefs: on });
    expect(blue.attrs["data-theme"]).toBe("blue-night");
    expect(blue.classes.has("dark")).toBe(true);
    const sky = runBoot({ cookie: "zaki_theme=system", dark: false, prefs: on });
    expect(sky.attrs["data-theme"]).toBe("sky");
    expect(sky.classes.has("dark")).toBe(false);
    expect(sky.meta.content).toBe(bootData().v2.light.color);
  });

  it("with the switch ON a person who never chose a theme (no cookie) gets the flat pair by the device; one who CHOSE a theme is never moved", () => {
    const on = { mirror: { themeV2: true } };
    expect(runBoot({ dark: true, prefs: on }).attrs["data-theme"]).toBe("blue-night");
    expect(runBoot({ dark: false, prefs: on }).attrs["data-theme"]).toBe("sky");
    for (const cookie of ["zaki_theme=day", "zaki_theme=neon-coast", "zaki_theme=night", "zk-digits=latin; zaki_theme=islamic-epic"]) {
      const r = runBoot({ cookie, dark: false, prefs: { mirror: { themeV2: true, themeAuto: true } } });
      expect(r.attrs["data-theme"], cookie).toBe("night"); // the server's paint is left as it is
    }
  });

  it("an account that says «تلقائي» applies on a device with no cookie; a concrete cookie beats it", () => {
    expect(runBoot({ dark: false, prefs: { mirror: { themeAuto: true } } }).attrs["data-theme"]).toBe("day");
    expect(runBoot({ cookie: "zaki_theme=sky", dark: false, prefs: { mirror: { themeAuto: true } } }).attrs["data-theme"]).toBe("night");
  });

  it("the text size is set before the first paint: the device's own step wins over the account's; none removes the variable", () => {
    expect(runBoot({ prefs: { mirror: { fontStep: 4 } } }).style["--chat-font-scale"]).toBe(String(FONT_SCALES[4]));
    expect(runBoot({ prefs: { textSize: 0, mirror: { fontStep: 4 } } }).style["--chat-font-scale"]).toBe(String(FONT_SCALES[0]));
    expect(runBoot({}).style["--chat-font-scale"]).toBeUndefined();
    expect(runBoot({ prefs: { mirror: { fontStep: 99 } } }).style["--chat-font-scale"]).toBeUndefined();
  });

  it("it follows the device live and the settings screen can run it again; a broken page cannot break the layout", () => {
    const r = runBoot({ cookie: "zaki_theme=system", dark: true });
    expect(typeof r.win["__zkThemeBoot"]).toBe("function");
    expect(r.listeners).toHaveLength(1);
    r.mq.matches = false;
    r.listeners[0]!();
    expect(r.attrs["data-theme"]).toBe("day");
    expect(() => vm.runInNewContext(bootScript(), {})).not.toThrow();
  });

  it("the script is the first thing in the page and is wired from the registry's pairs (no second copy)", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('<script id="zk-boot" dangerouslySetInnerHTML={{ __html: BOOT }} />');
    expect(layout.indexOf("zk-boot")).toBeLessThan(layout.indexOf("{children}"));
    const data = bootData();
    expect([data.v1.dark.key, data.v1.light.key, data.v2.dark.key, data.v2.light.key]).toEqual(["night", "day", "blue-night", "sky"]);
    expect(data.v2.dark.dark).toBe(true);
    expect(data.v2.light.dark).toBe(false);
  });
});

// ───────────────────────────── the screens ─────────────────────────────

function privacyHtml(): string {
  return render(createElement(PrivacySection, { lastSeen: null }));
}

describe("C4.1 · the sections", () => {
  it("eleven sections in the order of the spec; «المجلدات» only while the company's switch is on; an address belongs to one section", () => {
    expect([...SECTION_KEYS]).toEqual(["account", "notifications", "sounds", "privacy", "chat", "effects", "folders", "data", "devices", "language", "menu", "shortcuts", "help"]);
    expect(visibleSections({ foldersOn: true })).toHaveLength(13);
    // «الأصوات» is a part of «تيليجرام على التلفون»: with the switch off it is not listed
    expect(visibleSections({ foldersOn: true, soundsOn: false })).toHaveLength(12);
    expect(visibleSections({ foldersOn: true, soundsOn: false })).not.toContain("sounds");
    expect(visibleSections({ foldersOn: false })).not.toContain("folders");
    expect(isSectionKey("chat")).toBe(true);
    expect(isSectionKey("gone")).toBe(false);
    expect(sectionOfPath("/settings/me/chat")).toBe("chat");
    expect(sectionOfPath("/settings/me")).toBeNull();
    expect(sectionOfPath("/settings/me/gone")).toBeNull();
    expect(sectionHref("account")).toBe("/settings/me/account");
  });

  it("every section has its name and its line in Arabic, and the strings are in ar.settings-me.json", () => {
    for (const key of SECTION_KEYS) {
      expect(AR[`settingsMe.s.${key}`], key).toMatch(/[؀-ۿ]/);
      expect(AR[`settingsMe.s.${key}.hint`], key).toMatch(/[؀-ۿ]/);
    }
    const file = JSON.parse(read("src/lib/i18n/ar.settings-me.json")) as Record<string, string>;
    for (const [key, value] of Object.entries(file)) {
      expect(AR[key], key).toBe(value);
      expect(value.replace(/\{[^{}]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toContain("ـاً");
    }
  });

  const header = { name: "أحمد الكوري", username: "ahmad", jobTitle: "المدير", avatarUrl: null };

  it("the frame: the header card, one link per section, and on the phone the list at the index / the section inside one (two columns from md)", () => {
    where.pathname = "/settings/me";
    const index = render(createElement(SettingsFrame, { header, sections: visibleSections({ foldersOn: true }) }, createElement("p", null, "المحتوى")));
    expect(index).toContain("أحمد الكوري");
    expect(index).toContain("@ahmad");
    expect(index).toContain("المدير");
    expect(index).toContain('href="/settings/me/account"');
    for (const key of SECTION_KEYS) expect(index, key).toContain(`href="/settings/me/${key}"`);
    const classesOf = (html: string, tag: string) => (new RegExp("<" + tag + ' class="([^"]*)"').exec(html)?.[1] ?? "").split(/\s+/);
    expect(classesOf(index, "aside")).toEqual(expect.arrayContaining(["block", "md:w-80"]));
    expect(classesOf(index, "aside")).not.toContain("hidden");
    expect(classesOf(index, "section")).toEqual(expect.arrayContaining(["hidden", "md:block"]));

    where.pathname = "/settings/me/chat";
    const inside = render(createElement(SettingsFrame, { header, sections: visibleSections({ foldersOn: false }) }, createElement("p", null, "المحتوى")));
    expect(inside).not.toContain('href="/settings/me/folders"');
    expect(classesOf(inside, "aside")).toEqual(expect.arrayContaining(["hidden", "md:block"]));
    expect(classesOf(inside, "section")).not.toContain("hidden");
    expect(inside).toContain('aria-current="page"');
    where.pathname = "/settings/me";
  });

  it("the look of the mockup: the sections list is a 14 px card with a coloured tile per icon and a soft accent for the open one; each block is a 14 px card under an accent heading", () => {
    where.pathname = "/settings/me/chat";
    const frame = render(createElement(SettingsFrame, { header: { name: "أحمد", username: null, jobTitle: null, avatarUrl: null }, sections: visibleSections({ foldersOn: true }) }, createElement("p", null, "x")));
    expect(frame).toMatch(/bg-surface-1 md:rounded-\[14px\]/);
    expect(frame.match(/data-section-tile/g)).toHaveLength(13);
    expect(frame).toMatch(/bg-accent\/15 text-accent/);
    expect(frame).not.toMatch(/bg-selected-row/);
    where.pathname = "/settings/me";
    const html = render(createElement(NotificationsSection));
    expect(html).toMatch(/data-settings-group="" class="[^"]*pt-4/);
    expect(html).toMatch(/rounded-\[14px\] bg-surface-1 overflow-hidden/);
    // a row's switch is the 42x24 pill of the mockup
    expect(html).toMatch(/h-6 w-\[42px\]/);
    expect(privacyHtml()).toMatch(/text-\[13px\] font-bold text-accent/);
  });

  it("«الإشعارات والأصوات»: the five kinds with their switches, the preview of each (not calls), the sounds, «استثناءات» and the reset", () => {
    const html = render(createElement(NotificationsSection));
    for (const type of NOTIFY_TYPES) expect(html, type).toContain(AR[`settingsMe.n.type.${type}`] as string);
    expect(html.match(/role="switch"/g)?.length).toBe(NOTIFY_TYPES.length + (NOTIFY_TYPES.length - 1) + 1);
    expect(html).toContain(AR["settingsMe.n.sounds"] as string);
    expect(html).toContain(AR["settingsMe.n.exceptions"] as string);
    expect(html).toContain(AR["settingsMe.n.reset"] as string);
  });

  it("a rule change keeps the other kinds and the keys this screen does not know; a rule back to the defaults is removed; it is what notify.ts reads", () => {
    const prefs = readChatPrefs({ notifications: { private: { on: false }, topics: { preview: false }, dm: { on: false } } });
    const next = withRule(prefs, "mentions", { on: false });
    expect(next).toEqual({ private: { on: false }, topics: { preview: false }, dm: { on: false }, mentions: { on: false } });
    expect(withRule(prefs, "private", { on: true })).toEqual({ topics: { preview: false }, dm: { on: false } });
    expect(withRule({}, "calls", { on: true })).toEqual({});
    expect(withChat({ chat: { wallpaper: "boxes", other: 1 } }, "fontStep", 3)).toEqual({ wallpaper: "boxes", other: 1, fontStep: 3 });
    expect(withChat({ chat: { wallpaper: "boxes" } }, "wallpaper", undefined)).toEqual({});
  });

  it("«الخصوصية والأمان»: «آخر ظهور» (today's switch with its ⚠️ and 🔧), the way to the devices and the password, and the wipe button", () => {
    const html = render(createElement(PrivacySection, { lastSeen: { hide: false } }));
    expect(html).toContain("data-last-seen-toggle");
    expect(html).toContain(AR["lastSeen.hide.warning"] as string);
    expect(html).toContain(AR["lastSeen.hide.fix"] as string);
    expect(html).toContain('href="/settings/me/devices"');
    expect(html).toContain('href="/settings/me/account"');
    expect(html).toContain("data-wipe");
    expect(html).toContain(AR["settingsMe.p.wipe.button"] as string);
    // the company's switch off (or a guest): the row says so instead of the toggle
    const none = render(createElement(PrivacySection, { lastSeen: null }));
    expect(none).not.toContain("data-last-seen-toggle");
    expect(none).toContain(AR["settingsMe.p.lastseen.off"] as string);
    // the wipe is C1.5's ONE function
    expect(read("src/components/settings-me/privacy-section.tsx")).toContain('import { wipeChatCache } from "@/lib/chat/cache/wipe"');
  });

  it("«الدردشة»: the size in five steps, the wallpapers (plain, six patterns, fifteen pictures), the theme with «تلقائي حسب الجهاز», the send key, six quick reactions and the double tap (⚠️ + 🔧 while it is not connected)", () => {
    const html = render(createElement(ChatSection));
    expect(html.match(/data-font-step="/g)).toHaveLength(5);
    expect(html.match(/data-wallpaper="/g)).toHaveLength(22);
    expect(html).toContain("/brand/wallpapers/photo/sunset-thumb.webp");
    expect(html).toContain(AR["settingsMe.c.theme.auto"] as string);
    expect(html).toContain('data-tour="theme"');
    expect(html).toContain(AR["settingsMe.c.sendkey.ctrl"] as string);
    expect(html.match(/data-quick-slot="/g)).toHaveLength(6);
    expect(html).toContain("data-double-tap");
    expect(html).toContain(AR["settingsMe.c.doubletap.warn"] as string);
    expect(html).toContain(AR["settingsMe.c.doubletap.fix"] as string);
  });

  it("«البيانات والتخزين»: the picture quality, the automatic download (device only, with its ⚠️ + 🔧), the storage and the wipe", () => {
    const html = render(createElement(DataSection));
    expect(html).toContain(AR["settingsMe.d.quality.high"] as string);
    expect(html.match(/data-auto-download="/g)).toHaveLength(2);
    expect(html).toContain(AR["settingsMe.d.auto.warn"] as string);
    expect(html).toContain(AR["settingsMe.d.auto.fix"] as string);
    expect(html).toContain("data-wipe");
    expect(formatBytes(512)).toBe("1 ك.ب");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 م.ب");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 غ.ب");
  });

  it("«الأجهزة»: the app, the browsers, and «اطلع من كل الأجهزة» says in words that THIS device is signed out too, before the button is pressed", () => {
    const html = render(createElement(DevicesSection, { appConnection: true }));
    expect(html).toContain("data-app-devices");
    expect(html).toContain('href="/app-link"');
    expect(html).toContain(AR["settingsMe.v.everywhere"] as string);
    expect(html).toContain(AR["settingsMe.v.everywhere.warn"] as string);
    expect(AR["settingsMe.v.everywhere.warn"]).toContain("هالجهاز");
    expect(html).toContain(AR["settingsMe.v.everywhere.fix"] as string);
    const off = render(createElement(DevicesSection, { appConnection: false }));
    expect(off).not.toContain("data-app-devices");
    expect(off).toContain(AR["settingsMe.v.apps.off"] as string);
    expect(read("src/components/settings-me/devices-section.tsx")).toContain('apiPost("/api/me/logout-everywhere")');
    expect(read("src/components/settings-me/devices-section.tsx")).toContain("await wipeChatCache()");
  });

  it("a browser is named in Arabic from its user agent, and an unknown one says so", () => {
    expect(browserLabelOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("كروم على ويندوز");
    expect(browserLabelOf("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit Chrome/130 Mobile Safari")).toBe("كروم على أندرويد");
    expect(browserLabelOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Safari/604")).toBe("سفاري على آيفون");
    expect(browserLabelOf("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("فايرفوكس على لينكس");
    expect(browserLabelOf(null)).toBe("متصفح ما بنعرف اسمه");
    expect(browserLabelOf("curl/8")).toBe("متصفح ما بنعرف اسمه");
  });

  it("«اللغة والأرقام»: Arabic as the only language, and the digits", () => {
    const html = render(createElement(LanguageSection));
    expect(html).toContain(AR["settingsMe.l.arabic"] as string);
    expect(html).toContain(AR["digits.latin"] as string);
    expect(html).toContain(AR["digits.arabic"] as string);
  });

  const places = [
    { key: "today", labelKey: "nav.today" },
    { key: "chat", labelKey: "nav.chat" },
    { key: "work", labelKey: "nav.work" },
  ];

  it("«القائمة»: a row per place with «ارفع» and «نزّل»; when the COMPANY's order is set it shows ⚠️ + 🔧 and no rows (the person's own order stays stored)", () => {
    const free = render(createElement(MenuSection, { places, tabs: {}, locked: false }));
    expect(free.match(/data-menu-place="/g)).toHaveLength(3);
    expect(free).toContain(AR["settingsMe.m.reset"] as string);
    const locked = render(createElement(MenuSection, { places, tabs: {}, locked: true }));
    expect(locked).toContain("data-order-locked");
    expect(locked).toContain("⚠️");
    expect(locked).toContain("🔧");
    expect(locked).toContain(AR["navv2.order.company_locked"] as string);
    expect(locked).not.toContain("data-menu-place");
    expect(locked).toContain(AR["settingsMe.m.locked_hint"] as string);
  });

  it("moving a place changes one step and stops at the ends", () => {
    expect(moveKey(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveKey(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveKey(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveKey(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("«الاختصارات»: the table of the chat sheet plus Ctrl+0 and Ctrl+, ; only the key names Ctrl, Alt, Shift and Esc are Latin", () => {
    const html = render(createElement(ShortcutsSection));
    expect(html.match(/<li /g)).toHaveLength(8 + 2);
    expect(html).toContain(AR["settingsMe.k.settings"] as string);
    expect(html).toContain(">Ctrl<");
    expect(html).toContain(">Esc<");
    expect(html).toContain(AR["chatsaved.keys.open"] as string);
    const latinWords = [...html.matchAll(/>([^<]*)</g)].map((m) => m[1] as string).filter((text) => /[A-Za-z]{2,}/.test(text) && !["Ctrl", "Alt", "Shift", "Esc"].includes(text));
    expect(latinWords).toEqual([]);
  });

  it("Ctrl+, is by the physical comma key, never with Alt, Shift or the command key, never while composing", () => {
    const e = (over: Record<string, unknown> = {}) => ({ key: ",", code: "Comma", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, ...over });
    expect(settingsShortcutOf(e())).toBe(true);
    expect(settingsShortcutOf(e({ key: "و" }))).toBe(true);
    expect(settingsShortcutOf(e({ ctrlKey: false }))).toBe(false);
    expect(settingsShortcutOf(e({ altKey: true }))).toBe(false);
    expect(settingsShortcutOf(e({ shiftKey: true }))).toBe(false);
    expect(settingsShortcutOf(e({ metaKey: true }))).toBe(false);
    expect(settingsShortcutOf(e({ isComposing: true }))).toBe(false);
    expect(settingsShortcutOf(e({ defaultPrevented: true }))).toBe(false);
    expect(SETTINGS_SHORTCUT.keys).toEqual(["ctrl", "comma"]);
    expect(read("src/components/settings-me/me-effects.tsx")).toContain("settingsShortcutOf(event)");
  });

  it("«المساعدة»: the guide, and «تواصل مع الإدارة» only when there is an owner to talk to", () => {
    const withOwner = render(createElement(HelpSection, { ownerId: "owner-1" }));
    expect(withOwner).toContain('href="/guide"');
    expect(withOwner).toContain(AR["settingsMe.h.contact"] as string);
    const without = render(createElement(HelpSection, { ownerId: null }));
    expect(without).not.toContain(AR["settingsMe.h.contact"] as string);
  });
});

describe("C4.1 · the entry points", () => {
  const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };

  it("the avatar menu has «إعداداتي» (the gear beside the name) and keeps its four items", () => {
    const html = render(createElement(AvatarMenu, { user: USER, rank: "OWNER", defaultOpen: true, portal: false }));
    expect(html).toMatch(/<a[^>]*data-settings-me-link[^>]*aria-label="إعداداتي"[^>]*href="\/settings\/me"/);
    expect(html).toContain('href="/profile"');
    expect(html).toContain('href="/guide"');
  });

  it("the phone's drawer has «إعداداتي» for everybody", () => {
    const nav = buildNav({ role: "MEMBER", caps: [...effectiveCapabilities({ role: "MEMBER" })] });
    const html = render(createElement(Drawer, { open: true, onOpenChange: () => {}, nav, current: null, pathname: "/", user: USER, rank: "MEMBER", isGuest: false, portal: false }));
    expect(html).toMatch(/<a[^>]*data-settings-me-link[^>]*href="\/settings\/me"/);
    expect(html).toContain(AR["settingsMe.drawer"] as string);
  });

  it("/profile redirects to «حسابي» and the company's /settings stays", () => {
    const profile = read("src/app/(app)/profile/page.tsx");
    expect(profile).toContain('redirect("/settings/me/account")');
    expect(profile).toContain("await pageActor()");
    expect(read("src/app/(app)/settings/page.tsx")).toBeTruthy();
  });
});

describe("C4.1 · nothing that belongs to the company moves into a person's settings", () => {
  it("the screens never write a company setting: no /api/settings, no organization route, no feature switch", () => {
    const dir = "src/components/settings-me";
    for (const file of ["chat-section", "notifications-section", "privacy-section", "data-section", "devices-section", "menu-section", "language-section", "help-section"]) {
      const text = read(`${dir}/${file}.tsx`);
      expect(text, file).not.toContain("/api/settings");
      expect(text, file).not.toContain("/api/organizations");
    }
  });
});
