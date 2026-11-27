import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { HOLD_LOCK_PX, createDragStore, tgHoldDrag } from "@/lib/chat/v2/composer/hold-gesture";
import { DEFAULT_SPEECH_LANG, SPEECH_AUTO, SPEECH_CHOICES, SPEECH_LANGS, liveLangOf, resolveSpeech, serviceLangOf, speechChoiceOf } from "@/lib/chat/speech-langs";
import { DICTATION_LANGS, createDictation, type RecognitionEventLike, type RecognitionLike } from "@/lib/chat/v2/dictation";
import { UNPLAYED_GRACE_MS, VOICE_HEARD_KEY, VOICE_HEARD_MAX, createHeardStore } from "@/lib/chat/voice-heard";
import { VOICE_SPEEDS, VOICE_SPEED_CHOICES, chatPrefsPatchSchema, chatPrefsSchema, mergeChatPrefs, nextVoiceSpeed, readChatPrefs, resolveChatPrefs } from "@/lib/chat/prefs";
import { createVoiceEngine, voiceNotesOf, type AudioLike } from "@/lib/chat/voice-queue";
import { requestTakeTranscript } from "@/lib/chat/take-transcript";
import { AR } from "@/lib/i18n/dict";
import type { MessageDto } from "@/server/chat/dto";

/** «تيليجرام على التلفون», phase 4 (voice and speech-to-text): the parts that need no screen. */

describe("phase 4 timings", () => {
  it("has the new voice names, each a sensible length", () => {
    expect(TG_MOTION.micHoldMs).toBeGreaterThanOrEqual(150);
    expect(TG_MOTION.micHoldMs).toBeLessThanOrEqual(300);
    expect(TG_MOTION.micTipMs).toBeGreaterThanOrEqual(1500);
    expect(TG_MOTION.recordBlinkMs).toBeGreaterThan(500);
    expect(TG_MOTION.micLevelMs).toBe(100);
    expect(TG_MOTION.speedHoldMs).toBeGreaterThanOrEqual(400);
    expect(TG_MOTION.transcriptSpinMs).toBeGreaterThan(500);
    expect(TG_MOTION.recordCancelShare).toBe(0.4);
  });
});

describe("the hold on the microphone, Telegram's way", () => {
  const start = { x: 40, y: 700 };
  const width = 400;

  it("cancels only past 40% of the width toward the cancel side (rightward on this right-to-left screen)", () => {
    const edge = width * TG_MOTION.recordCancelShare;
    expect(tgHoldDrag(start, { x: start.x + edge - 1, y: 700 }, width, true).outcome).toBe("hold");
    expect(tgHoldDrag(start, { x: start.x + edge, y: 700 }, width, true).outcome).toBe("cancel");
    // the old 80 px is not enough any more
    expect(tgHoldDrag(start, { x: start.x + 90, y: 700 }, width, true).outcome).toBe("hold");
  });

  it("never cancels by sliding the other way or down", () => {
    expect(tgHoldDrag({ x: 300, y: 700 }, { x: 40, y: 700 }, width, true).outcome).toBe("hold");
    expect(tgHoldDrag(start, { x: 40, y: 900 }, width, true).outcome).toBe("hold");
  });

  it("a left-to-right page mirrors the cancel side", () => {
    expect(tgHoldDrag({ x: 360, y: 700 }, { x: 190, y: 700 }, width, false).outcome).toBe("cancel");
    expect(tgHoldDrag({ x: 360, y: 700 }, { x: 390, y: 700 }, width, false).outcome).toBe("hold");
  });

  it("locks on a slide up, the same distance as before", () => {
    expect(tgHoldDrag(start, { x: 45, y: 700 - HOLD_LOCK_PX - 1 }, width, true).outcome).toBe("lock");
    expect(tgHoldDrag(start, { x: 45, y: 700 - HOLD_LOCK_PX + 1 }, width, true).outcome).toBe("hold");
  });

  it("reports what the finger is doing: the shift toward the cancel side and both progresses, from 0 to 1", () => {
    const half = tgHoldDrag(start, { x: start.x + 80, y: 700 }, width, true);
    expect(half.dx).toBe(80);
    expect(half.cancel).toBeCloseTo(0.5);
    expect(half.lock).toBe(0);
    const wrongWay = tgHoldDrag(start, { x: 0, y: 700 }, width, true);
    expect(wrongWay.dx).toBe(0);
    expect(wrongWay.cancel).toBe(0);
    const up = tgHoldDrag(start, { x: 40, y: 700 - HOLD_LOCK_PX / 2 }, width, true);
    expect(up.up).toBe(HOLD_LOCK_PX / 2);
    expect(up.lock).toBeCloseTo(0.5);
    // left-to-right: the shift is negative (toward the left)
    expect(tgHoldDrag({ x: 360, y: 700 }, { x: 320, y: 700 }, width, false).dx).toBe(-40);
  });

  it("the drag store hands every move to its listeners without a render of the whole composer", () => {
    const store = createDragStore();
    const seen: number[] = [];
    const off = store.subscribe(() => seen.push(store.get().dx));
    store.set({ outcome: "hold", dx: 12, cancel: 0.1, up: 0, lock: 0 });
    store.reset();
    off();
    store.set({ outcome: "hold", dx: 30, cancel: 0.2, up: 0, lock: 0 });
    expect(seen).toEqual([12, 0]);
  });
});

describe("the languages of speech-to-text", () => {
  it("Arabic is first and the default, and the old four are all there", () => {
    expect(SPEECH_LANGS[0]!.code).toBe("ar-JO");
    expect(DEFAULT_SPEECH_LANG).toBe("ar-JO");
    for (const old of DICTATION_LANGS) expect(SPEECH_LANGS.map((l) => l.code)).toContain(old.code);
    for (const code of ["ru-RU", "uk-UA", "es-ES", "it-IT", "pt-PT", "id-ID", "uz-UZ", "fa-IR", "km-KH"]) expect(SPEECH_LANGS.map((l) => l.code)).toContain(code);
    for (const l of SPEECH_LANGS) expect(AR[l.labelKey], l.labelKey).toMatch(/[؀-ۿ]/);
    expect(SPEECH_CHOICES).toContain(SPEECH_AUTO);
  });

  it("the live words need one language: «تلقائي» and anything unknown fall back to Arabic", () => {
    expect(liveLangOf("en-US")).toBe("en-US");
    expect(liveLangOf(SPEECH_AUTO)).toBe("ar-JO");
    expect(liveLangOf("xx")).toBe("ar-JO");
    expect(liveLangOf(undefined)).toBe("ar-JO");
  });

  it("the service is told the short code, «auto» to guess, and Arabic when nothing was chosen", () => {
    expect(serviceLangOf("ar-EG")).toBe("ar");
    expect(serviceLangOf("km-KH")).toBe("km");
    expect(serviceLangOf(SPEECH_AUTO)).toBe("auto");
    expect(serviceLangOf(undefined)).toBe("ar");
    expect(speechChoiceOf("junk")).toBe("ar-JO");
  });

  it("the defaults: Arabic, live words on, the preview's text on", () => {
    expect(resolveSpeech(undefined)).toEqual({ language: "ar-JO", live: true, preview: true });
    expect(resolveSpeech({ language: "en-US", live: false, preview: false })).toEqual({ language: "en-US", live: false, preview: false });
  });
});

describe("the person's «speech» section of the prefs", () => {
  it("is saved strictly and read forgivingly", () => {
    expect(chatPrefsSchema.safeParse({ speech: { language: "en-US", live: false, preview: true } }).success).toBe(true);
    expect(chatPrefsPatchSchema.safeParse({ speech: null }).success).toBe(true);
    expect(chatPrefsSchema.safeParse({ speech: { language: "zz-ZZ" } }).success).toBe(false);
    expect(chatPrefsSchema.safeParse({ speech: { live: "no" } }).success).toBe(false);
    expect(readChatPrefs({ speech: { language: "zz", live: false } })).toEqual({ speech: { live: false } });
    expect(readChatPrefs({ speech: 5 })).toEqual({});
  });

  it("merges alone and resolves", () => {
    const stored = readChatPrefs({ voiceSpeed: 1.5, speech: { language: "ar-SA" } });
    expect(mergeChatPrefs(stored, { speech: { language: "en-US" } })).toEqual({ voiceSpeed: 1.5, speech: { language: "en-US" } });
    expect(mergeChatPrefs(stored, { speech: null })).toEqual({ voiceSpeed: 1.5 });
    expect(resolveChatPrefs(stored).speech).toEqual({ language: "ar-SA" });
    expect(resolveChatPrefs({}).speech).toEqual({});
  });
});

describe("the speeds", () => {
  it("six choices, the old three still valid and still the tap's circle", () => {
    expect([...VOICE_SPEED_CHOICES]).toEqual([0.5, 1, 1.2, 1.5, 1.7, 2]);
    expect([...VOICE_SPEEDS]).toEqual([1, 1.5, 2]);
    for (const speed of VOICE_SPEED_CHOICES) {
      expect(chatPrefsSchema.safeParse({ voiceSpeed: speed }).success, String(speed)).toBe(true);
      expect(readChatPrefs({ voiceSpeed: speed }).voiceSpeed).toBe(speed);
    }
    for (const bad of [0.4, 1.1, 2.5, 3]) expect(chatPrefsSchema.safeParse({ voiceSpeed: bad }).success, String(bad)).toBe(false);
  });

  it("a tap goes to the next of the circle above the current speed, then back to 1", () => {
    expect(nextVoiceSpeed(0.5)).toBe(1);
    expect(nextVoiceSpeed(1.2)).toBe(1.5);
    expect(nextVoiceSpeed(1.7)).toBe(2);
    expect(nextVoiceSpeed(2)).toBe(1);
  });

  it("the engine takes every choice", () => {
    const engine = createVoiceEngine({ makeAudio: () => null });
    for (const speed of VOICE_SPEED_CHOICES) {
      engine.setSpeed(speed);
      expect(engine.getSnapshot().speed).toBe(speed);
    }
  });
});

class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  duration = 4;
  paused = true;
  playbackRate = 1;
  private handlers = new Map<string, Set<() => void>>();
  play() {
    this.paused = false;
    this.fire("play");
  }
  pause() {
    this.paused = true;
    this.fire("pause");
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.handlers.get(type)?.delete(fn);
  }
  fire(type: string) {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn();
  }
}

describe("what was played", () => {
  it("the engine says a note was played when it really plays, and not when the browser refuses", () => {
    const played: string[] = [];
    const engine = createVoiceEngine({ makeAudio: () => new FakeAudio(), onPlayed: (src) => played.push(src) });
    engine.toggle("/api/chat/attachments/a1");
    expect(played).toEqual(["/api/chat/attachments/a1"]);
    const refused: string[] = [];
    const blocked = createVoiceEngine({ makeAudio: () => Object.assign(new FakeAudio(), { play: () => Promise.reject(new Error("blocked")) }), onPlayed: (src) => refused.push(src) });
    blocked.toggle("/api/chat/attachments/a1");
    expect(refused).toEqual([]);
  });

  it("the notes carry when they were sent only when asked (the old shape is untouched)", () => {
    const message = { id: "m1", kind: "VOICE", deleted: false, mine: false, authorName: "ليلى", createdAt: "2026-11-22T15:48:00.000Z", attachments: [{ id: "a1", kind: "AUDIO", name: "v.webm", mime: "audio/webm", size: 1, url: "/api/chat/attachments/a1", durationMs: 1000 }] } as unknown as MessageDto;
    expect(voiceNotesOf([message])[0]).not.toHaveProperty("sentAt");
    expect(voiceNotesOf([message], { withTime: true })[0]!.sentAt).toBe("2026-11-22T15:48:00.000Z");
  });
});

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe("the unplayed dot, remembered on this device", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  const note = (n: number, sentAt: number, mine = false) => ({ src: `/api/chat/attachments/a${n}`, mine, sentAt: new Date(sentAt).toISOString() });

  it("a new note of somebody else is unplayed until it plays, and stays played after a reload", () => {
    const storage = memory();
    const store = createHeardStore(storage, () => now);
    store.know([note(1, now - 1000)]);
    expect(store.isUnplayed("/api/chat/attachments/a1")).toBe(true);
    let told = 0;
    store.subscribe(() => (told += 1));
    store.markPlayed("/api/chat/attachments/a1");
    expect(store.isUnplayed("/api/chat/attachments/a1")).toBe(false);
    expect(told).toBe(1);
    const again = createHeardStore(storage, () => now + 5000);
    again.know([note(1, now - 1000)]);
    expect(again.isUnplayed("/api/chat/attachments/a1")).toBe(false);
  });

  it("never my own note, never a note it knows nothing about, never one from long before this device started remembering", () => {
    const store = createHeardStore(memory(), () => now);
    store.know([note(2, now, true), note(3, now - UNPLAYED_GRACE_MS - 1000), note(4, now - UNPLAYED_GRACE_MS + 1000)]);
    expect(store.isUnplayed("/api/chat/attachments/a2")).toBe(false);
    expect(store.isUnplayed("/api/chat/attachments/a3")).toBe(false);
    expect(store.isUnplayed("/api/chat/attachments/a4")).toBe(true);
    expect(store.isUnplayed("/api/chat/attachments/zz")).toBe(false);
  });

  it("keeps only our own addresses, a bounded number of them, and survives a damaged or missing storage", () => {
    const storage = memory();
    const store = createHeardStore(storage, () => now);
    store.markPlayed("blob:https://x/1");
    expect(storage.data.get(VOICE_HEARD_KEY) ?? "").not.toContain("blob:");
    for (let i = 0; i < VOICE_HEARD_MAX + 20; i++) store.markPlayed(`/api/chat/attachments/n${i}`);
    expect((JSON.parse(storage.data.get(VOICE_HEARD_KEY)!) as { played: string[] }).played).toHaveLength(VOICE_HEARD_MAX);
    const damaged = createHeardStore(memory({ [VOICE_HEARD_KEY]: "{{{" }), () => now);
    damaged.know([note(1, now)]);
    expect(damaged.isUnplayed("/api/chat/attachments/a1")).toBe(true);
    const none = createHeardStore(null, () => now);
    none.know([note(1, now)]);
    none.markPlayed("/api/chat/attachments/a1");
    expect(none.isUnplayed("/api/chat/attachments/a1")).toBe(false);
  });
});

class Fake implements RecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: RecognitionLike["onresult"] = null;
  onend: RecognitionLike["onend"] = null;
  onerror: RecognitionLike["onerror"] = null;
  aborted = false;
  start() {}
  stop() {}
  abort() {
    this.aborted = true;
  }
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] } as unknown as RecognitionEventLike);
  }
}

describe("the live words while the recording is paused", () => {
  const rig = () => {
    const all: Fake[] = [];
    const engine = createDictation(() => {
      const f = new Fake();
      all.push(f);
      return f;
    });
    return { engine, all, last: () => all[all.length - 1]! };
  };

  it("pausing stops listening and keeps the words; resuming goes on after them", () => {
    const { engine, last } = rig();
    engine.start();
    const first = last();
    first.say("أول");
    engine.hold();
    expect(first.aborted).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ listening: false, final: "أول" });
    engine.resume();
    expect(last()).not.toBe(first);
    expect(engine.getSnapshot().listening).toBe(true);
    last().say("ثاني");
    expect(engine.finish()).toBe("أول ثاني");
  });

  it("resume without a pause does nothing, and cancel forgets the pause", () => {
    const { engine, all } = rig();
    engine.resume();
    expect(all).toHaveLength(1);
    engine.start();
    engine.hold();
    engine.cancel();
    engine.resume();
    expect(engine.getSnapshot().listening).toBe(false);
    expect(all).toHaveLength(2);
  });

  it("the phone's longer list of languages is allowed once the composer says so; without it the old list rules", () => {
    const { engine } = rig();
    engine.setLang("ru-RU");
    expect(engine.getSnapshot().lang).toBe("ar-JO");
    engine.allow(SPEECH_LANGS);
    engine.setLang("ru-RU");
    expect(engine.getSnapshot().lang).toBe("ru-RU");
    engine.allow(DICTATION_LANGS);
    expect(engine.getSnapshot().lang).toBe("ar-JO");
  });
});

describe("asking for the words of a take that was not sent", () => {
  const take = { blob: new Blob(["abc"], { type: "audio/webm" }), mime: "audio/webm", durationMs: 2000, peaks: [1] };
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it("posts the recording and the language to this conversation's door and returns the text", async () => {
    const f = answer(200, { text: "مرحبا" });
    expect(await requestTakeTranscript("c 1", take, "ar", undefined, f as unknown as typeof fetch)).toEqual({ ok: true, text: "مرحبا" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat/conversations/c%201/transcribe");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("language")).toBe("ar");
    expect((form.get("file") as File).name).toBe("voice.webm");
  });

  it("every failure is a key of the dictionary: the server's, «too many», «not set up», «empty», or the plain one", async () => {
    const ask = (status: number, body: unknown) => requestTakeTranscript("c1", take, "ar", undefined, answer(status, body) as unknown as typeof fetch);
    expect(await ask(502, { error: "upstream", message: "voiceTranscript.err_down" })).toEqual({ ok: false, key: "voiceTranscript.err_down" });
    expect(await ask(429, { error: "rate_limited", message: "tgvoice.err_rate" })).toEqual({ ok: false, key: "tgvoice.err_rate" });
    expect(await ask(404, { error: "not_found", message: "features.off" })).toEqual({ ok: false, key: "tgvoice.transcript_off" });
    expect(await ask(409, { error: "conflict", message: "voiceTranscript.err_not_configured" })).toEqual({ ok: false, key: "tgvoice.transcript_off" });
    expect(await ask(409, { error: "conflict", message: "voiceTranscript.err_empty" })).toEqual({ ok: false, key: "tgvoice.transcript_none" });
    expect(await ask(500, { error: "internal" })).toEqual({ ok: false, key: "voiceTranscript.err_failed" });
    expect(await requestTakeTranscript("c1", take, "ar", undefined, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toEqual({ ok: false, key: "voiceTranscript.err_failed" });
  });
});
