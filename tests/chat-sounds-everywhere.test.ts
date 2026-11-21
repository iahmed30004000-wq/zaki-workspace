import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { CHAT_TONES, DEFAULT_CHAT_TONE, toneLength, toneOf } from "@/lib/chat/chime/tones";
import {
  CHAT_SOUND_KEY,
  DEFAULT_CHAT_SOUND_PREFS,
  parseChatSoundPrefs,
  topicModeOf,
  withTopicMode,
} from "@/lib/chat/chime/prefs";
import { CHIME_GAP_MS, chimeFresh, chimeFor, chimeGate, chimeThrottled, openConversationOf, type ChimeFacts } from "@/lib/chat/chime/decide";
import { playTone, resetChimeThrottle, playChime } from "@/lib/chat/chime/player";
import { I18nProvider } from "@/lib/i18n";
import { ChatSoundBlock } from "@/components/settings-me/chat-sound-block";
import { TopicSoundRow } from "@/components/chat/v2/info/info-sound";
import { FEATURES, FEATURE_DEFAULTS, featureOn, featuresOff } from "@/lib/features";

(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(path, "utf8");

/**
 * S5.1 — sounds in the chats (the owner, 2026-11-21: «ما في أصوات بالدردشات، والنغمة مش حلوة… متل تيليغرام»). A short tone for a message in ANY
 * unmuted conversation (not only the open one), five original tones drawn by the browser (no sound file), a volume, a try button, per-topic
 * «كل الرسائل / الذكر بس», all behind the company's switch `chatSounds` (OFF).
 */

describe("the five tones: pure data, drawn by WebAudio, no sound files", () => {
  it("there are exactly five, with unique ids, an Arabic label each, and the first is the default", () => {
    expect(CHAT_TONES.map((t) => t.id)).toEqual(["bubble", "bell", "marimba", "taps", "chirp"]);
    expect(new Set(CHAT_TONES.map((t) => t.id)).size).toBe(5);
    expect(DEFAULT_CHAT_TONE).toBe("bubble");
    for (const tone of CHAT_TONES) {
      expect(AR[tone.labelKey], tone.id).toMatch(/[؀-ۿ]/);
      expect(toneOf(tone.id)).toBe(tone);
    }
    expect(CHAT_TONES.map((t) => AR[t.labelKey])).toEqual(["فقاعة", "جرس", "ماريمبا", "نقرتين", "زقزقة"]);
  });

  it("each lasts 150 to 450 ms, is quiet and made of audible notes", () => {
    for (const tone of CHAT_TONES) {
      const ms = toneLength(tone) * 1000;
      expect(ms, tone.id).toBeGreaterThanOrEqual(150);
      expect(ms, tone.id).toBeLessThanOrEqual(450);
      expect(tone.notes.length).toBeGreaterThan(0);
      for (const n of tone.notes) {
        expect(n.hz).toBeGreaterThan(80);
        expect(n.hz).toBeLessThan(4000);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.7);
        expect(["sine", "triangle"]).toContain(n.wave);
      }
      expect(tone.cutoff).toBeGreaterThan(500);
    }
  });

  it("they are clearly different from each other (not the same notes at another pitch)", () => {
    const shapes = CHAT_TONES.map((t) => JSON.stringify(t.notes.map((n) => [Math.round(n.hz), n.at, n.wave])));
    expect(new Set(shapes).size).toBe(5);
  });

  it("an unknown id falls back to the default tone", () => {
    expect(toneOf("nope" as never).id).toBe("bubble");
  });

  it("no sound file is added to the bundle for them", () => {
    const src = [read("src/lib/chat/chime/tones.ts"), read("src/lib/chat/chime/player.ts")].join("\n");
    expect(src).not.toMatch(/\.(mp3|wav|ogg|m4a)\b/);
    expect(src).not.toContain("new Audio(");
  });
});

describe("the device's choices («zk-chat-sound»): pure parse, tolerant", () => {
  it("defaults: the first tone, a quiet volume, no topic chosen", () => {
    expect(CHAT_SOUND_KEY).toBe("zk-chat-sound");
    expect(DEFAULT_CHAT_SOUND_PREFS).toEqual({ tone: "bubble", volume: 0.5, topics: {} });
    expect(parseChatSoundPrefs(null)).toEqual(DEFAULT_CHAT_SOUND_PREFS);
    expect(parseChatSoundPrefs("{not json")).toEqual(DEFAULT_CHAT_SOUND_PREFS);
    expect(parseChatSoundPrefs("[]")).toEqual(DEFAULT_CHAT_SOUND_PREFS);
  });

  it("reads what is valid and keeps the defaults for the rest", () => {
    expect(parseChatSoundPrefs('{"tone":"bell","volume":0.8}')).toEqual({ tone: "bell", volume: 0.8, topics: {} });
    expect(parseChatSoundPrefs('{"tone":"unknown","volume":"loud"}')).toEqual(DEFAULT_CHAT_SOUND_PREFS);
    expect(parseChatSoundPrefs('{"volume":7}').volume).toBe(1);
    expect(parseChatSoundPrefs('{"volume":-1}').volume).toBe(0);
    expect(parseChatSoundPrefs({ tone: "chirp" }).tone).toBe("chirp");
  });

  it("the per-topic choice is «كل الرسائل» unless «الذكر بس» was chosen; garbage values are dropped", () => {
    const prefs = parseChatSoundPrefs('{"topics":{"a":"mentions","b":"all","c":"zzz","":"mentions"}}');
    expect(topicModeOf(prefs, "a")).toBe("mentions");
    expect(topicModeOf(prefs, "b")).toBe("all");
    expect(topicModeOf(prefs, "c")).toBe("all");
    expect(topicModeOf(prefs, "never")).toBe("all");
    expect(prefs.topics).toEqual({ a: "mentions" });
  });

  it("choosing «كل الرسائل» again forgets the topic (only the exceptions are stored)", () => {
    const one = withTopicMode(DEFAULT_CHAT_SOUND_PREFS, "t1", "mentions");
    expect(one.topics).toEqual({ t1: "mentions" });
    expect(withTopicMode(one, "t1", "all").topics).toEqual({});
    expect(DEFAULT_CHAT_SOUND_PREFS.topics).toEqual({});
  });
});

describe("who hears what: the rules of the spec", () => {
  const base: ChimeFacts = { mine: false, silent: false, system: false, deleted: false, convKind: "TOPIC", muted: false, oversight: false, mentionsMe: false, topicMode: "all" };

  it("a message of somebody else in an unmuted topic sounds; a mention sounds as a mention", () => {
    expect(chimeFor(base)).toBe("plain");
    expect(chimeFor({ ...base, mentionsMe: true })).toBe("mention");
  });

  it("never my own message, never a system line, never a deleted one, never one sent «بدون صوت»", () => {
    expect(chimeFor({ ...base, mine: true })).toBeNull();
    expect(chimeFor({ ...base, system: true })).toBeNull();
    expect(chimeFor({ ...base, deleted: true })).toBeNull();
    expect(chimeFor({ ...base, silent: true, mentionsMe: true })).toBeNull();
  });

  it("never in a muted chat (a mention included: a mute that rings is not a mute) and never for a reader in silent oversight", () => {
    expect(chimeFor({ ...base, muted: true })).toBeNull();
    expect(chimeFor({ ...base, muted: true, mentionsMe: true })).toBeNull();
    expect(chimeFor({ ...base, oversight: true })).toBeNull();
  });

  it("every private message sounds, whatever the topic choice says", () => {
    expect(chimeFor({ ...base, convKind: "DM" })).toBe("plain");
    expect(chimeFor({ ...base, convKind: "DM", topicMode: "mentions" })).toBe("plain");
  });

  it("a topic on «الذكر بس» sounds only for a mention", () => {
    expect(chimeFor({ ...base, topicMode: "mentions" })).toBeNull();
    expect(chimeFor({ ...base, topicMode: "mentions", mentionsMe: true })).toBe("mention");
  });

  it("the page's own state: hidden tab (a push is shown), master switch off and the open conversation stay silent", () => {
    expect(chimeGate({ enabled: true, visible: true, openHere: false })).toBe(true);
    expect(chimeGate({ enabled: false, visible: true, openHere: false })).toBe(false);
    expect(chimeGate({ enabled: true, visible: false, openHere: false })).toBe(false);
    // the open conversation already makes its own arrival sound (`arrivalSoundOf`): the listener adds none
    expect(chimeGate({ enabled: true, visible: true, openHere: true })).toBe(false);
  });

  it("the open conversation is read from the address (a forum or the list is no conversation)", () => {
    expect(openConversationOf("/chat/abc123")).toBe("abc123");
    expect(openConversationOf("/chat/abc123/info")).toBe("abc123");
    expect(openConversationOf("/chat/s/space1")).toBeNull();
    expect(openConversationOf("/chat")).toBeNull();
    expect(openConversationOf("/tasks")).toBeNull();
  });

  it("a message from a replay after a reconnect (older than half a minute) makes no sound", () => {
    expect(chimeFresh(new Date(1_000_000).toISOString(), 1_010_000)).toBe(true);
    expect(chimeFresh(new Date(1_000_000).toISOString(), 1_040_000)).toBe(false);
    expect(chimeFresh("not a date", 1_000)).toBe(false);
  });

  it("two sounds never play within 600 ms", () => {
    expect(CHIME_GAP_MS).toBe(600);
    expect(chimeThrottled(null, 1000)).toBe(false);
    expect(chimeThrottled(1000, 1599)).toBe(true);
    expect(chimeThrottled(1000, 1600)).toBe(false);
  });
});

/** a recording AudioContext: enough of the WebAudio surface for `playTone` */
function fakeContext() {
  const log = { oscillators: [] as { type: string; frequency: { value: number }; started: number | null }[], filters: [] as { type: string; frequency: { value: number } }[] };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const ctx = {
    currentTime: 10,
    state: "running",
    destination: {},
    createGain() {
      return { gain: param(), connect() {} };
    },
    createBiquadFilter() {
      const f = { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect() {} };
      log.filters.push(f);
      return f;
    },
    createOscillator() {
      const o = { type: "sine", frequency: { value: 0 }, started: null as number | null, connect() {}, start(at: number) { o.started = at; }, stop() {} };
      log.oscillators.push(o);
      return o;
    },
  };
  return { ctx: ctx as unknown as AudioContext, log };
}

describe("the player draws a tone with oscillators, a filter and a master volume", () => {
  beforeEach(() => resetChimeThrottle());

  it("every note is at least one oscillator, behind one low-pass filter, started at its own time", () => {
    for (const tone of CHAT_TONES) {
      const { ctx, log } = fakeContext();
      playTone(ctx, tone, 0.5, 10);
      expect(log.filters).toHaveLength(1);
      expect(log.filters[0]?.type).toBe("lowpass");
      expect(log.oscillators.length).toBeGreaterThanOrEqual(tone.notes.length);
      const starts = log.oscillators.map((o) => o.started);
      for (const n of tone.notes) expect(starts).toContain(10 + n.at);
    }
  });

  it("a volume of 0 draws nothing", () => {
    const { ctx, log } = fakeContext();
    playTone(ctx, CHAT_TONES[0]!, 0, 10);
    expect(log.oscillators).toHaveLength(0);
  });

  it("without a context (a browser with no audio, or one still asleep) nothing plays and nothing throws", () => {
    expect(playChime({ tone: "bubble", volume: 0.5, mention: false })).toBe(false);
  });
});

describe("the company switch `chatSounds` (OFF by default)", () => {
  it("is registered, OFF, and named in Arabic", () => {
    expect(FEATURES).toContain("chatSounds");
    expect(FEATURE_DEFAULTS.chatSounds).toBe(false);
    expect(featureOn({}, "chatSounds")).toBe(false);
    expect(featureOn({ features: { chatSounds: true } }, "chatSounds")).toBe(true);
    expect(featuresOff({})).toContain("chatSounds");
    expect(AR["features.chatSounds.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.chatSounds.hint"]).toContain("🔧");
  });
});

describe("wiring (source text)", () => {
  it("the layout mounts the listener beside the call ring, behind the switch", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("ChatSoundsHost");
    expect(layout).toMatch(/<ChatSoundsHost enabled=\{on\.chatSounds\}/);
  });

  it("the listener hears the live line, ignores synthetic frames, and asks the server who wrote the message and whether the chat is muted", () => {
    const host = read("src/components/chat/chime/chat-sounds-host.tsx");
    expect(host).toContain("subscribeRealtime");
    expect(host).toContain('"message.created"');
    expect(host).toContain("synthetic");
    expect(host).toContain("chimeFor(");
    expect(host).toContain("chimeGate(");
    expect(host).toContain("primeChime");
    expect(host).toContain("visibilityState");
    expect(host).toContain("/api/chat/conversations/");
    expect(host).toContain("/header");
    expect(host).toContain("/messages?limit=");
  });

  it("iPhone / Safari: the audio is woken from the first touch (a gesture), like the wheel's tick", () => {
    const player = read("src/lib/chat/chime/player.ts");
    expect(player).toContain(".resume()");
    expect(player).toContain("webkitAudioContext");
    const host = read("src/components/chat/chime/chat-sounds-host.tsx");
    expect(host).toContain("touchstart");
    expect(host).toContain("pointerdown");
  });

  it("the old arrival sound of the open conversation plays the chosen tone while the switch is on, and is untouched while it is off", () => {
    const sounds = read("src/lib/chat/sounds.ts");
    expect(sounds).toContain("chatSoundsActive()");
    expect(sounds).toContain("CHAT_SOUND_URLS.received");
  });

  it("the personal page: tone, volume and «جرّب الصوت» sit in «الإعدادات ← الإشعارات», with no company switch", () => {
    const section = read("src/components/settings-me/notifications-section.tsx");
    expect(section).toContain("ChatSoundBlock");
    const block = read("src/components/settings-me/chat-sound-block.tsx");
    expect(block).toContain("CHAT_TONES");
    expect(block).toContain('type="range"');
    expect(block).toContain("settingsMe.cs.try");
    expect(block).not.toContain("featureOn");
    expect(AR["settingsMe.cs.try"]).toBe("جرّب الصوت");
  });

  it("the per-topic choice is in the info panel of a topic, drawn only while the switch is on", () => {
    expect(read("src/components/chat/v2/info/info-panel.tsx")).toContain("TopicSoundRow");
    const row = read("src/components/chat/v2/info/info-sound.tsx");
    expect(row).toContain("useChatSoundsActive");
    expect(AR["chatsound.mode.all"]).toBe("كل الرسائل");
    expect(AR["chatsound.mode.mentions"]).toBe("الذكر بس");
  });

  it("no hardcoded colour in the new screens (tokens only)", () => {
    for (const f of ["src/components/settings-me/chat-sound-block.tsx", "src/components/chat/v2/info/info-sound.tsx", "src/components/chat/chime/chat-sounds-host.tsx"]) {
      expect(read(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});

describe("the screens render", () => {
  it("«نغمة الرسائل» draws the five tones, a volume slider and «جرّب الصوت»", () => {
    const html = renderToStaticMarkup(createElement(I18nProvider as React.FC<{ initial: "ar"; children?: React.ReactNode }>, { initial: "ar" }, createElement(ChatSoundBlock)));
    expect((html.match(/data-chat-tone="/g) ?? []).length).toBe(5);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('type="range"');
    expect(html).toContain("جرّب الصوت");
    expect(html).toContain("فقاعة");
    expect(html).toContain("زقزقة");
    // the first tone is the chosen one from the start
    expect(html).toMatch(/aria-checked="true"[^>]*data-chat-tone="bubble"|data-chat-tone="bubble"[^>]*aria-checked="true"/);
  });

  it("«صوت هالموضوع» is not drawn while the switch is off", () => {
    const header = { id: "t1", kind: "TOPIC", me: { oversight: false } } as never;
    expect(renderToStaticMarkup(createElement(TopicSoundRow, { header, saved: false }))).toBe("");
  });
});
