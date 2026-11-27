import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/me/notifications",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/realtime/use-realtime", () => ({ subscribeRealtime: () => () => undefined }));

import { NotifyTypePage } from "@/components/settings-me/notify-types";
import { MY_SOUNDS_KEY, SoundsSection, soundChoiceName } from "@/components/settings-me/sounds-section";
import { onFrame } from "@/components/chat/chime/chat-sounds-host";
import { TgPhoneProvider } from "@/components/shell/tg-phone";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { CHAT_PREFS_KEY } from "@/lib/chat/cache/queries";
import { chatPrefsPatchSchema, NOTIFY_TYPES, readChatPrefs } from "@/lib/chat/prefs";
import { FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { arrivalTypeOf } from "@/lib/chat/v2/pane/arrival-sound";
import { playChatSound } from "@/lib/chat/sounds";
import { builtinsFor } from "@/lib/sound-library/catalog";
import { SOUND_EVENTS, SOUND_KEYS, TYPE_SOUND_EVENTS, TYPE_SOUND_OF } from "@/lib/sound-library/choice";
import { cleanSoundChoices, readSoundMirror, saveSoundMirror, setTypeSoundsOn, SOUND_MIRROR_KEY } from "@/lib/sound-library/device";
import { soundKindOf } from "@/lib/sound-library/hrefs";
import { playChosenSound, resetSoundThrottle } from "@/lib/sound-library/play";
import type { MessageDto } from "@/server/chat/dto";

/**
 * «صوت لكل نوع إشعار» — each kind of notification keeps its own sound on the account, and that sound is the one that plays when a message of the kind arrives. The sounds
 * here are the person's uploads, so the fake `Audio` says exactly which one played.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const CHOICES = { inChat: "custom:general", received: "custom:received", typePrivate: "custom:private", typeTopics: "custom:topics", typeMentions: "custom:mentions", typeReplies: "custom:replies" };

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
function fakeAudio(): string[] {
  const played: string[] = [];
  class FakeAudio {
    volume = 1;
    constructor(private readonly src: string) {}
    play() {
      played.push(this.src.replace("/api/me/sounds/", ""));
      return Promise.resolve();
    }
    pause() {}
  }
  vi.stubGlobal("Audio", FakeAudio);
  return played;
}
function onPhone(choices: Record<string, string>, extra: Record<string, unknown> = {}) {
  const storage = memory({ [SOUND_MIRROR_KEY]: JSON.stringify(choices) });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", { querySelector: (q: string) => (q === "[data-tg-phone]" ? {} : null), visibilityState: "visible" });
  vi.stubGlobal("window", { localStorage: storage, matchMedia: (q: string) => ({ matches: q === "(max-width: 767px)" }), location: { pathname: "/tasks" }, ...extra });
}

afterEach(() => {
  setTypeSoundsOn(false);
  resetSoundThrottle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the switch «صوت لكل نوع إشعار»", () => {
  it("is on by default and needs the phone's look", () => {
    expect(FEATURE_DEFAULTS.chatTypeSounds).toBe(true);
    expect(FEATURE_META.chatTypeSounds).toEqual({ group: "chat", dependsOn: ["tgPhone"] });
    expect(read("src/app/(app)/layout.tsx")).toContain("<TypeSoundsFlag on={on.chatLayoutV2 && on.tgPhone && on.chatTypeSounds} />");
  });
});

describe("the keys", () => {
  it("every kind of notification has its own key; calls keep the incoming ring they always had", () => {
    expect(NOTIFY_TYPES.map((type) => TYPE_SOUND_OF[type])).toEqual(["typePrivate", "typeTopics", "typeMentions", "typeReplies", null]);
    expect([...SOUND_KEYS]).toEqual([...SOUND_EVENTS, ...TYPE_SOUND_EVENTS]);
    for (const key of TYPE_SOUND_EVENTS) {
      expect(builtinsFor(key).map((s) => s.id), key).toEqual(builtinsFor("inChat").map((s) => s.id));
      expect(AR[`tgsheets.sounds.event.${key}`], key).toBeTruthy();
      expect(soundKindOf(key)).toBe(key);
    }
  });

  it("they are saved on the account beside the five events, checked like them, and copied to the device", () => {
    expect(chatPrefsPatchSchema.safeParse({ sounds: { typePrivate: "tick", typeMentions: "custom:f1", typeReplies: "none" } }).success).toBe(true);
    expect(chatPrefsPatchSchema.safeParse({ sounds: { typeTopics: "http://x" } }).success).toBe(false);
    expect(readChatPrefs({ sounds: { typeTopics: "bell", typeReplies: "NOT A SOUND" } }).sounds).toEqual({ typeTopics: "bell" });
    expect(cleanSoundChoices({ typePrivate: "tick", typeOther: "tick", ring: "none" })).toEqual({ ring: "none", typePrivate: "tick" });
    const storage = memory();
    saveSoundMirror({ typeMentions: "drop" }, storage);
    expect(readSoundMirror(storage)).toEqual({ typeMentions: "drop" });
  });
});

describe("the sound that plays", () => {
  it("each kind plays its own", () => {
    onPhone(CHOICES);
    const played = fakeAudio();
    setTypeSoundsOn(true);
    for (const type of ["private", "topics", "mentions", "replies"] as const) expect(playChosenSound("inChat", { mention: false, type })).toBe(true);
    expect(played).toEqual(["private", "topics", "mentions", "replies"]);
  });

  it("a kind with nothing chosen sounds like the event; «بلا صوت» of a kind is silence", () => {
    onPhone({ inChat: "custom:general", typeTopics: "none" });
    const played = fakeAudio();
    setTypeSoundsOn(true);
    expect(playChosenSound("inChat", { mention: false, type: "private" })).toBe(true);
    expect(playChosenSound("inChat", { mention: false, type: "topics" })).toBe(true);
    expect(played).toEqual(["general"]);
  });

  it("nothing chosen at all: «default», so the app plays what it always played", () => {
    onPhone({});
    fakeAudio();
    setTypeSoundsOn(true);
    expect(playChosenSound("inChat", { mention: true, type: "mentions" })).toBe(false);
  });

  it("with the switch off the kinds share the event's sound, whatever was chosen before", () => {
    onPhone(CHOICES);
    const played = fakeAudio();
    playChosenSound("inChat", { mention: false, type: "private" });
    expect(played).toEqual(["general"]);
  });

  it("a kind's own sound is played once for a mention; the shared one twice, as before", () => {
    onPhone({ inChat: "custom:general", typeMentions: "custom:mentions" });
    const played = fakeAudio();
    setTypeSoundsOn(true);
    vi.useFakeTimers();
    playChosenSound("inChat", { mention: true, type: "mentions" });
    vi.runAllTimers();
    expect(played).toEqual(["mentions"]);
    played.length = 0;
    playChosenSound("inChat", { mention: true, type: "private" });
    vi.runAllTimers();
    expect(played).toEqual(["general", "general"]);
  });

  it("a computer is untouched", () => {
    onPhone(CHOICES, { matchMedia: () => ({ matches: false }) });
    fakeAudio();
    setTypeSoundsOn(true);
    expect(playChosenSound("inChat", { mention: false, type: "private" })).toBe(false);
  });

  it("an arrival in the OPEN conversation plays its kind's sound; my own send never does", () => {
    onPhone({ ...CHOICES, sent: "custom:sent" });
    const played = fakeAudio();
    setTypeSoundsOn(true);
    playChatSound("received", null, "replies");
    playChatSound("sent", null, "private");
    expect(played).toEqual(["replies", "sent"]);
  });

  const msg = (over: Partial<MessageDto>) => ({ id: "n", mine: false, mentions: [], attachments: [], ...over }) as unknown as MessageDto;

  it("which kind the newest message is: the server's own rule (a private chat; else a mention; else a reply to me; else the topic)", () => {
    const type = (conversationKind: "DM" | "GROUP" | "TOPIC", messages: MessageDto[]) => arrivalTypeOf({ conversationKind, messages, meId: "me" });
    expect(type("DM", [msg({ mentions: ["me"] })])).toBe("private");
    expect(type("TOPIC", [msg({})])).toBe("topics");
    expect(type("GROUP", [msg({})])).toBe("topics");
    expect(type("TOPIC", [msg({ mentions: ["me"], replyTo: { id: "p", preview: "x", authorName: "أنا", mine: true } })])).toBe("mentions");
    expect(type("TOPIC", [msg({ mentions: ["*"] })])).toBe("mentions");
    expect(type("TOPIC", [msg({ replyTo: { id: "p", preview: "x", authorName: "أنا", mine: true } })])).toBe("replies");
    // the quoted message is on screen and is mine
    expect(type("TOPIC", [msg({ id: "p", mine: true }), msg({ replyTo: { id: "p", preview: "x", authorName: "أنا" } })])).toBe("replies");
    expect(type("TOPIC", [msg({ replyTo: { id: "p", preview: "x", authorName: "غيري" } })])).toBe("topics");
    expect(type("TOPIC", [])).toBeUndefined();
  });

  it("the open conversation hands the kind over", () => {
    expect(read("src/components/chat/v2/pane/message-viewport.tsx")).toContain("playChatSound(sound, undefined, arrivalTypeOf({ conversationKind: header.kind");
  });

  it("a message of ANOTHER conversation (the listener of «أصوات الرسائل») plays its kind's sound", async () => {
    onPhone(CHOICES);
    const played = fakeAudio();
    setTypeSoundsOn(true);
    const message = (id: string, over: Record<string, unknown>) => ({ id, kind: "TEXT", body: "x", deleted: false, mine: false, mentions: [], createdAt: new Date().toISOString(), ...over });
    const pages: Record<string, unknown> = {
      snd1: message("k1", {}),
      snd2: message("k2", { replyTo: { id: "p", preview: "x", authorName: "أنا", mine: true } }),
      snd3: message("k3", { mentions: ["me"] }),
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url === "/api/me") return json({ user: { id: "me" } });
      const asked = /conversations\/([^/]+)\/(header|messages)/.exec(url)!;
      if (asked[2] === "header") return json({ id: asked[1], kind: asked[1] === "snd1" ? "DM" : "TOPIC", me: { muted: false, oversight: false } });
      return json({ messages: [pages[asked[1]!]], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] });
    });
    for (const [conversationId, messageId] of [["snd1", "k1"], ["snd2", "k2"], ["snd3", "k3"]]) {
      resetSoundThrottle();
      await onFrame({ kind: "message.created", conversationId: conversationId!, messageId: messageId! });
    }
    expect(played).toEqual(["private", "replies", "mentions"]);
  });
});

describe("the phone's pages", () => {
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
  const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
  const Tg = TgPhoneProvider as unknown as FunctionComponent<{ on: boolean; children?: ReactNode }>;
  function render(element: ReactElement): string {
    const client = new QueryClient();
    client.setQueryData(CHAT_PREFS_KEY, { prefs: { sounds: { typePrivate: "tick" } } });
    client.setQueryData(MY_SOUNDS_KEY, []);
    return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Tg, { on: true }, createElement(Toasts, null, element)))));
  }
  const page = (type: (typeof NOTIFY_TYPES)[number], perType?: boolean) =>
    render(createElement(NotifyTypePage, { type, prefs: { sounds: { typePrivate: "tick" } }, loaded: true, onRule: () => {}, masterSounds: true, onMasterSounds: () => {}, moreOpen: true, ...(perType === undefined ? {} : { perType }) }));

  it("each message kind's «الصوت» opens ITS list and shows what it is set to; the app's general sound stays reachable", () => {
    for (const type of ["private", "topics", "mentions", "replies"] as const) {
      const html = page(type, true);
      expect(html, type).toContain(`data-notify-sound="${TYPE_SOUND_OF[type]}"`);
      expect(html, type).toContain(`href="/settings/me/sounds?kind=${TYPE_SOUND_OF[type]}"`);
      expect(html, type).toContain('data-notify-sound="inChat"');
      expect(html, type).toContain(AR["typesounds.own_hint"]!);
      expect(html, type).not.toContain(AR["tgsheets.notify.sound_shared"]!);
    }
    expect(page("private", true)).toContain(AR["tgsheets.sound.tick"]!);
    expect(page("topics", true)).toContain(AR["typesounds.follow"]!);
  });

  it("calls keep their ring; with the switch off the pages are what they were", () => {
    expect(page("calls", true)).toContain('data-notify-sound="ring"');
    expect(page("calls", true)).not.toContain('data-notify-sound="type');
    for (const html of [page("private"), page("private", false)]) {
      expect(html).not.toContain('data-notify-sound="type');
      expect(html).toContain(AR["tgsheets.notify.sound_shared"]!);
    }
  });

  it("a kind's list: «بلا صوت», «مثل صوت التطبيق العام» and our message sounds", () => {
    const html = render(createElement(SoundsSection, { event: "typeMentions" }));
    expect(html).toContain('data-sound-option="none"');
    expect(html).toContain(AR["typesounds.follow"]!);
    expect(html).toContain('data-sound-option="tick"');
    expect(html).not.toContain('data-sound-option="ring-wave"');
    const t = (key: string) => interpolate(AR[key] ?? key);
    expect(soundChoiceName(t, "typeTopics", undefined, [])).toBe("مثل صوت التطبيق العام");
    expect(soundChoiceName(t, "inChat", undefined, [])).toBe("افتراضي");
  });

  it("the library's first page still lists the five events, and a deleted upload is forgotten by the kinds too", () => {
    const html = render(createElement(SoundsSection));
    expect(html).not.toContain("data-sound-event=\"type");
    expect(read("src/components/settings-me/sounds-section.tsx")).toContain("SOUND_KEYS.reduce<SoundChoices>");
  });

  it("the section's page hands the switch over and guards a kind's address with it", () => {
    const source = read("src/app/(app)/settings/me/[section]/page.tsx");
    expect(source).toContain('typeSounds={await actorFeatureOn(actor, "chatTypeSounds")}');
    expect(source).toContain('if (kindOfSound && !(await actorFeatureOn(actor, "chatTypeSounds"))) notFound();');
  });
});
