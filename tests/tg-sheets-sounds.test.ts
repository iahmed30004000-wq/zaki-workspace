import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOUND_EVENTS, customIdOf, customSoundUrl, isSoundChoice } from "@/lib/sound-library/choice";
import { BUILTIN_SOUNDS, builtinOf, builtinsFor } from "@/lib/sound-library/catalog";
import { resolveSound } from "@/lib/sound-library/resolve";
import { SOUND_MIRROR_KEY, activeSoundChoices, readSoundMirror, saveSoundMirror, withSoundChoice } from "@/lib/sound-library/device";
import { startChosenLoop, playChosenSound, resetSoundThrottle } from "@/lib/sound-library/play";
import { chatPrefsPatchSchema, chatPrefsSchema, mergeChatPrefs, readChatPrefs, resolveChatPrefs } from "@/lib/chat/prefs";
import { playChatSound, CHAT_SOUND_URLS } from "@/lib/chat/sounds";
import { RING_SOUND_URL, startRing, startRingback } from "@/lib/calls/ring-sound";
import { RINGBACK_NOTES, RING_PATTERNS } from "@/lib/calls/tones";
import { AR } from "@/lib/i18n/dict";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

/** A phone with Telegram's look on: the app frame carries `data-tg-phone` and the screen is narrow. */
function onTgPhone(choices: Record<string, string>, opts: { tg?: boolean; narrow?: boolean } = {}) {
  const storage = memory({ [SOUND_MIRROR_KEY]: JSON.stringify(choices) });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", { querySelector: (q: string) => (q === "[data-tg-phone]" && opts.tg !== false ? {} : null) });
  vi.stubGlobal("window", { localStorage: storage, matchMedia: (q: string) => ({ matches: q === "(max-width: 767px)" && opts.narrow !== false }) });
  return storage;
}

function fakeAudio(refuse = false) {
  const made: { src: string; plays: number; paused: boolean; onended: null | (() => void) }[] = [];
  class FakeAudio {
    src: string;
    volume = 1;
    onended: null | (() => void) = null;
    plays = 0;
    paused = false;
    constructor(src: string) {
      this.src = src;
      made.push(this);
    }
    play() {
      this.plays += 1;
      return refuse ? Promise.reject(new Error("no")) : Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
  return made;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSoundThrottle();
});

describe("the five events and what a choice may be", () => {
  it("message sent, message received, in-chat notification, outgoing ring, incoming ring", () => {
    expect([...SOUND_EVENTS]).toEqual(["sent", "received", "inChat", "ringback", "ring"]);
  });

  it("a choice is «none», a built-in id or an uploaded file; nothing else", () => {
    for (const ok of ["none", "tick", "ring-wave", "custom:ckabc123"]) expect(isSoundChoice(ok), ok).toBe(true);
    for (const bad of ["", "NONE", "custom:", "custom:../x", "http://x", "a b", 4, null]) expect(isSoundChoice(bad), String(bad)).toBe(false);
    expect(customIdOf("custom:abc")).toBe("abc");
    expect(customIdOf("tick")).toBeNull();
    expect(customSoundUrl("abc")).toBe("/api/me/sounds/abc");
  });
});

describe("our own sounds: notes drawn by WebAudio, no file", () => {
  it("every event has its own list; ids are unique, named in Arabic and clearly different", () => {
    for (const event of SOUND_EVENTS) expect(builtinsFor(event).length, event).toBeGreaterThanOrEqual(3);
    const ids = BUILTIN_SOUNDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BUILTIN_SOUNDS) expect(AR[s.labelKey], s.id).toMatch(/[؀-ۿ]/);
    const shapes = BUILTIN_SOUNDS.map((s) => JSON.stringify(s.play));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("the caller's ring never offers an incoming ringtone (the owner: «برن علي ع حالي»)", () => {
    const back = new Set(builtinsFor("ringback").map((s) => s.id));
    for (const s of builtinsFor("ring")) expect(back.has(s.id), s.id).toBe(false);
  });

  it("a loop is longer than its notes, a message sound is short", () => {
    for (const s of BUILTIN_SOUNDS) {
      if (s.play.type === "loop") {
        const end = Math.max(...s.play.notes.map((n) => (n.at + n.dur) * 1000));
        expect(s.play.periodMs, s.id).toBeGreaterThan(end);
      } else {
        expect(Math.max(...s.play.tone.notes.map((n) => n.at + n.dur)), s.id).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it("no audio file is named or shipped by the library", () => {
    const dir = path.join(ROOT, "src/lib/sound-library");
    for (const f of readdirSync(dir)) expect(read(`src/lib/sound-library/${f}`), f).not.toMatch(/\.(mp3|wav|ogg|m4a)\b/);
    expect(readdirSync(path.join(ROOT, "public/sounds")).sort()).toEqual(["received.mp3", "ring.mp3", "sent.mp3"]);
  });
});

describe("one resolver for every event", () => {
  it("nothing chosen is the default; «none» is silence; a built-in is synthesized; an upload is read from its owner-only route", () => {
    expect(resolveSound("sent", {})).toEqual({ type: "default" });
    expect(resolveSound("sent", undefined)).toEqual({ type: "default" });
    expect(resolveSound("ring", { ring: "none" })).toEqual({ type: "none" });
    expect(resolveSound("sent", { sent: "tick" })).toEqual({ type: "synth", sound: builtinOf("tick") });
    expect(resolveSound("ring", { ring: "custom:f1" })).toEqual({ type: "file", url: "/api/me/sounds/f1" });
  });

  it("a built-in of another family or an unknown id falls back to the default", () => {
    expect(resolveSound("ringback", { ringback: "ring-wave" })).toEqual({ type: "default" });
    expect(resolveSound("sent", { sent: "gone" })).toEqual({ type: "default" });
    expect(resolveSound("sent", { received: "tick" })).toEqual({ type: "default" });
  });
});

describe("this device's copy of the choices", () => {
  it("keeps only good values, and an empty set removes the key", () => {
    const storage = memory();
    saveSoundMirror({ sent: "tick", ring: "bad value" }, storage);
    expect(readSoundMirror(storage)).toEqual({ sent: "tick" });
    saveSoundMirror(undefined, storage);
    expect(storage.getItem(SOUND_MIRROR_KEY)).toBeNull();
    expect(readSoundMirror(memory({ [SOUND_MIRROR_KEY]: "{oops" }))).toEqual({});
  });

  it("a changed choice keeps the others; «default» forgets the event", () => {
    expect(withSoundChoice({ sent: "tick" }, "ring", "none")).toEqual({ sent: "tick", ring: "none" });
    expect(withSoundChoice({ sent: "tick", ring: "none" }, "sent", null)).toEqual({ ring: "none" });
  });

  it("counts only on a phone with Telegram's look on: a computer or the switch off hear what they always heard", () => {
    onTgPhone({ sent: "none" });
    expect(activeSoundChoices()).toEqual({ sent: "none" });
    onTgPhone({ sent: "none" }, { tg: false });
    expect(activeSoundChoices()).toEqual({});
    onTgPhone({ sent: "none" }, { narrow: false });
    expect(activeSoundChoices()).toEqual({});
    vi.unstubAllGlobals();
    expect(activeSoundChoices()).toEqual({});
  });
});

describe("the existing message sounds use the resolver", () => {
  it("nothing chosen: exactly today's files", () => {
    const storage = onTgPhone({});
    const made = fakeAudio();
    playChatSound("sent", storage);
    playChatSound("received", storage);
    expect(made.map((a) => a.src)).toEqual([CHAT_SOUND_URLS.sent, CHAT_SOUND_URLS.received]);
  });

  it("«بلا صوت» is silence; an upload plays from its route; the master switch still wins", () => {
    const storage = onTgPhone({ sent: "none", received: "custom:f9" });
    const made = fakeAudio();
    playChatSound("sent", storage);
    expect(made).toEqual([]);
    playChatSound("received", storage);
    expect(made.map((a) => a.src)).toEqual(["/api/me/sounds/f9"]);
    storage.setItem("zk.chat.sounds", "off");
    playChatSound("received", storage);
    expect(made).toHaveLength(1);
  });

  it("an upload that cannot be played falls back to today's sound", async () => {
    const storage = onTgPhone({ sent: "custom:gone" });
    const made = fakeAudio(true);
    playChatSound("sent", storage);
    await Promise.resolve();
    await Promise.resolve();
    expect(made.map((a) => a.src)).toEqual(["/api/me/sounds/gone", CHAT_SOUND_URLS.sent]);
  });

  it("a mention plays the chosen sound twice", () => {
    vi.useFakeTimers();
    const storage = onTgPhone({ received: "custom:f1" });
    const made = fakeAudio();
    playChatSound("mention", storage);
    vi.advanceTimersByTime(500);
    expect(made).toHaveLength(2);
  });

  it("the in-chat notification keeps the gap between two sounds", () => {
    onTgPhone({ inChat: "custom:f1" });
    const made = fakeAudio();
    expect(playChosenSound("inChat", { mention: false, throttle: true, now: 1000 })).toBe(true);
    expect(playChosenSound("inChat", { mention: false, throttle: true, now: 1100 })).toBe(true);
    expect(made).toHaveLength(1);
    expect(playChosenSound("sent", { mention: false })).toBe(false);
  });

  it("the other-chat listener asks the resolver first", () => {
    const host = read("src/components/chat/chime/chat-sounds-host.tsx");
    expect(host).toContain('playChosenSound("inChat"');
    expect(host).toContain("playChime(");
  });
});

describe("the call rings use the resolver", () => {
  it("«بلا صوت» rings silently, in both directions", () => {
    onTgPhone({ ring: "none", ringback: "none" });
    const made = fakeAudio();
    startRing()();
    startRingback()();
    expect(made).toEqual([]);
    expect(startChosenLoop("ring")).not.toBeNull();
  });

  it("an uploaded ringtone loops with the pause between two rings and stops cleanly", () => {
    vi.useFakeTimers();
    onTgPhone({ ring: "custom:r1" });
    const made = fakeAudio();
    const stop = startRing();
    expect(made.map((a) => a.src)).toEqual(["/api/me/sounds/r1"]);
    made[0]!.onended!();
    vi.advanceTimersByTime(1600);
    expect(made[0]!.plays).toBe(2);
    stop();
    stop();
    expect(made[0]!.paused).toBe(true);
  });

  it("nothing chosen: the ringtone of this device, as today; the old settings' preview ignores the library", () => {
    onTgPhone({});
    let made = fakeAudio();
    startRing()();
    expect(made.map((a) => a.src)).toEqual([RING_SOUND_URL]);
    onTgPhone({ ring: "custom:r1" });
    made = fakeAudio();
    startRing({ tone: "file" })();
    expect(made.map((a) => a.src)).toEqual([RING_SOUND_URL]);
  });

  it("nothing chosen: the caller still hears the soft ringback notes, never the incoming ringtone", () => {
    expect(startChosenLoop("ringback")).toBeNull();
    expect(RINGBACK_NOTES).not.toBe(RING_PATTERNS.soft);
    const src = read("src/lib/calls/ring-sound.ts");
    expect(src).toContain('startChosenLoop("ringback"');
    expect(src).toContain("playLoop(RINGBACK_NOTES, RINGBACK_PERIOD_MS)");
  });
});

describe("the account's section «sounds» (User.chatPrefs)", () => {
  it("is saved, read forgivingly, replaced whole and put back to default with null", () => {
    expect(chatPrefsSchema.safeParse({ sounds: { sent: "tick", ring: "custom:abc" } }).success).toBe(true);
    expect(chatPrefsSchema.safeParse({ sounds: { sent: "http://evil" } }).success).toBe(false);
    expect(chatPrefsPatchSchema.safeParse({ sounds: null }).success).toBe(true);
    expect(readChatPrefs({ sounds: { sent: "no way", ring: "none" } }).sounds).toEqual({ ring: "none" });
    expect(mergeChatPrefs({ sounds: { sent: "tick" }, voiceSpeed: 2 }, { sounds: { ring: "none" } })).toEqual({ sounds: { ring: "none" }, voiceSpeed: 2 });
    expect(mergeChatPrefs({ sounds: { sent: "tick" } }, { sounds: null })).toEqual({});
    expect(resolveChatPrefs({}).sounds).toEqual({});
  });

  it("reaches this device whenever the account's answer is applied", () => {
    expect(read("src/components/settings-me/use-person-prefs.ts")).toContain("saveSoundMirror(prefs.sounds");
  });
});
