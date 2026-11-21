import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S6.1 — the browser voice engine (src/components/site-guide/voice.ts) against a fake `speechSynthesis`: the voices arrive late, the audio is unlocked
 * in the tap, a long answer is spoken in pieces, the next utterance survives a cancel, and a device with no Arabic voice says so in Arabic.
 */

interface FakeVoice {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
  voiceURI: string;
}
interface Said {
  text: string;
  lang: string;
  voice: FakeVoice | null;
  rate: number;
  volume: number;
}

class FakeUtterance {
  text: string;
  lang = "";
  voice: FakeVoice | null = null;
  rate = 1;
  volume = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function makeSynth(initial: FakeVoice[]) {
  const listeners = new Map<string, Set<() => void>>();
  const synth = {
    voices: initial,
    said: [] as Said[],
    cancels: 0,
    resumes: 0,
    queue: [] as FakeUtterance[],
    /** when false the engine never finishes by itself (the test ends an utterance by hand) */
    auto: true,
    speaking: false,
    pending: false,
    getVoices() {
      return synth.voices;
    },
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    cancel() {
      synth.cancels += 1;
      const dropped = synth.queue.splice(0);
      synth.speaking = false;
      for (const u of dropped) u.onerror?.({ error: "canceled" });
    },
    resume() {
      synth.resumes += 1;
    },
    speak(u: FakeUtterance) {
      synth.said.push({ text: u.text, lang: u.lang, voice: u.voice, rate: u.rate, volume: u.volume });
      synth.queue.push(u);
      synth.speaking = true;
      if (synth.auto) {
        setTimeout(() => {
          const i = synth.queue.indexOf(u);
          if (i >= 0) synth.queue.splice(i, 1);
          synth.speaking = synth.queue.length > 0;
          u.onend?.();
        }, 5);
      }
    },
  };
  return synth;
}

const sa: FakeVoice = { lang: "ar-SA", name: "Arabic Saudi", voiceURI: "sa" };
const jo: FakeVoice = { lang: "ar-JO", name: "Arabic Jordan", voiceURI: "jo" };
const en: FakeVoice = { lang: "en-US", name: "English", voiceURI: "en", default: true };

let synth: ReturnType<typeof makeSynth>;
let store: Map<string, string>;
const g = globalThis as unknown as Record<string, unknown>;

async function load() {
  vi.resetModules();
  return import("@/components/site-guide/voice");
}

beforeEach(() => {
  vi.useFakeTimers();
  store = new Map();
  synth = makeSynth([en, jo, sa]);
  g["SpeechSynthesisUtterance"] = FakeUtterance;
  g["window"] = {
    speechSynthesis: synth,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, val: string) => void store.set(k, val),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  delete g["window"];
  delete g["SpeechSynthesisUtterance"];
});

describe("the voice that speaks", () => {
  it("speaks with the best Arabic voice (ar-SA before ar-JO), not the first one of the list and not the English default", async () => {
    const voice = await load();
    const done = voice.speak("أهلًا فيك.");
    await vi.runAllTimersAsync();
    await done;
    const real = synth.said.filter((s) => s.text.trim() !== "" && s.volume > 0);
    expect(real).toHaveLength(1);
    expect(real[0]!.voice?.voiceURI).toBe("sa");
    expect(real[0]!.lang).toBe("ar-SA");
  });

  it("waits for `voiceschanged` when the list is empty at first (Chrome), then speaks with the voice that arrived", async () => {
    synth.voices = [];
    const voice = await load();
    const done = voice.speak("أهلًا فيك.");
    await vi.advanceTimersByTimeAsync(50);
    expect(synth.said.filter((s) => s.volume > 0)).toHaveLength(0);
    synth.voices = [en, sa];
    synth.fire("voiceschanged");
    await vi.runAllTimersAsync();
    await done;
    expect(synth.said.filter((s) => s.volume > 0)[0]?.voice?.voiceURI).toBe("sa");
  });

  it("gives up waiting after a timeout when the browser never announces its voices, and says no Arabic voice exists", async () => {
    synth.voices = [];
    const voice = await load();
    const issues: string[] = [];
    voice.onSpeechIssue((kind) => issues.push(kind));
    const done = voice.speak("أهلًا فيك.");
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(synth.said.filter((s) => s.volume > 0)).toHaveLength(0);
    expect(issues).toEqual(["no_voice"]);
  });

  it("a device with only English voices never reads Arabic in an English voice: it says so (once) and stays quiet", async () => {
    synth.voices = [en];
    const voice = await load();
    const issues: string[] = [];
    voice.onSpeechIssue((kind) => issues.push(kind));
    expect(await voice.hasArabicVoice()).toBe(false);
    await voice.speak("أهلًا.");
    await voice.speak("وكمان مرة.");
    expect(synth.said.filter((s) => s.volume > 0)).toHaveLength(0);
    expect(issues).toEqual(["no_voice"]);
  });

  it("a device with no voices makes the FIRST answer wait for the list, not every answer after it", async () => {
    synth.voices = [];
    const voice = await load();
    voice.onSpeechIssue(() => undefined);
    const first = voice.speak("أهلًا فيك.");
    await vi.advanceTimersByTimeAsync(2100);
    await first;
    let second = false;
    void voice.speak("وكمان مرة.").then(() => {
      second = true;
    });
    await vi.advanceTimersByTimeAsync(5);
    expect(second).toBe(true);
    // a voice that shows up later is still found
    synth.voices = [sa];
    const third = voice.speak("هلأ في صوت.");
    await vi.runAllTimersAsync();
    await third;
    expect(synth.said.filter((s) => s.volume > 0).map((s) => s.text)).toEqual(["هلأ في صوت."]);
  });

  it("an issue raised while nobody listens is kept for the one who listens later (the guide's window may not be open yet)", async () => {
    synth.voices = [en];
    const voice = await load();
    await voice.speak("أهلًا.");
    const issues: string[] = [];
    voice.onSpeechIssue((kind) => issues.push(kind));
    expect(await voice.hasArabicVoice()).toBe(false);
    expect(issues).toEqual(["no_voice"]);
  });

  it("reports an Arabic voice when there is one", async () => {
    const voice = await load();
    expect(await voice.hasArabicVoice()).toBe(true);
  });
});

describe("the tap", () => {
  it("unlockAudio speaks a silent utterance inside the tap (volume 0) so a phone lets the later answers through", async () => {
    const voice = await load();
    voice.unlockAudio();
    expect(synth.said).toHaveLength(1);
    expect(synth.said[0]!.volume).toBe(0);
    expect(synth.resumes).toBeGreaterThanOrEqual(1);
  });

  it("unlockAudio never throws where there is no speech engine", async () => {
    delete (g["window"] as Record<string, unknown>)["speechSynthesis"];
    const voice = await load();
    expect(() => voice.unlockAudio()).not.toThrow();
    expect(voice.canSpeak()).toBe(false);
  });
});

describe("a long answer", () => {
  it("is spoken in pieces, one after the other, all of it, with no cut at 600 characters", async () => {
    const voice = await load();
    const sentence = "هاي جملة عادية بالعربي للاختبار.";
    const long = Array.from({ length: 40 }, () => sentence).join(" ");
    expect(long.length).toBeGreaterThan(1200);
    const done = voice.speak(long);
    await vi.runAllTimersAsync();
    await done;
    const pieces = synth.said.filter((s) => s.volume > 0).map((s) => s.text);
    expect(pieces.length).toBeGreaterThan(5);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(160);
    expect(pieces.join(" ")).toBe(long);
  });

  it("strips markers and paths before speaking", async () => {
    const voice = await load();
    const done = voice.speak("**تمام** افتح /settings/me الآن ✅");
    await vi.runAllTimersAsync();
    await done;
    expect(synth.said.filter((s) => s.volume > 0).map((s) => s.text).join(" ")).toBe("تمام افتح الآن");
  });

  it("stopSpeaking ends the pieces that were still to come", async () => {
    const voice = await load();
    const sentence = "هاي جملة عادية بالعربي للاختبار.";
    const long = Array.from({ length: 40 }, () => sentence).join(" ");
    const done = voice.speak(long);
    await vi.advanceTimersByTimeAsync(80);
    const before = synth.said.length;
    voice.stopSpeaking();
    await vi.runAllTimersAsync();
    await done;
    expect(synth.said.length).toBeLessThanOrEqual(before + 1);
  });

  it("the watchdog does not cut a slow voice short: while the engine still says it is speaking the piece is not finished, and an engine stuck for good is cancelled", async () => {
    synth.auto = false;
    const voice = await load();
    let finished = false;
    void voice.speak("جملة وحدة.").then(() => {
      finished = true;
    });
    // the estimate for this piece is a little over four seconds: at ten seconds it is still speaking, so the call keeps waiting
    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finished).toBe(true);
    expect(synth.cancels).toBeGreaterThanOrEqual(1);
  });

  it("an engine that never fires `end` does not hang the call: a watchdog moves on", async () => {
    synth.auto = false;
    const voice = await load();
    let finished = false;
    void voice.speak("جملة وحدة.").then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finished).toBe(true);
  });
});

describe("cancel does not eat the next utterance", () => {
  it("a new answer while an old one is speaking: the old one is cancelled, then the new one is spoken (after a short pause), once", async () => {
    synth.auto = false;
    const voice = await load();
    void voice.speak("الجواب القديم.");
    await vi.advanceTimersByTimeAsync(10);
    expect(synth.speaking).toBe(true);
    synth.auto = true;
    const second = voice.speak("الجواب الجديد.");
    await vi.runAllTimersAsync();
    await second;
    expect(synth.cancels).toBeGreaterThanOrEqual(1);
    const texts = synth.said.filter((s) => s.volume > 0).map((s) => s.text);
    expect(texts.at(-1)).toBe("الجواب الجديد.");
    expect(texts.filter((t) => t === "الجواب الجديد.")).toHaveLength(1);
  });

  it("an empty text changes nothing: it does not cancel what is being said", async () => {
    synth.auto = false;
    const voice = await load();
    void voice.speak("جملة طويلة شوي للاختبار.");
    await vi.advanceTimersByTimeAsync(10);
    const cancels = synth.cancels;
    await voice.speak("");
    await voice.speak("  ✅ ");
    expect(synth.cancels).toBe(cancels);
  });
});

describe("speed and volume", () => {
  it("are read from this device's storage on every piece, clamped, and change without a reload", async () => {
    const voice = await load();
    expect(voice.getVoicePrefs()).toEqual({ rate: 1, volume: 1 });
    voice.setVoicePrefs({ rate: 1.3, volume: 0.5 });
    expect(JSON.parse(store.get("zk-guide-voice") ?? "{}")).toEqual({ rate: 1.3, volume: 0.5 });
    const done = voice.speak("أهلًا فيك.");
    await vi.runAllTimersAsync();
    await done;
    const real = synth.said.filter((s) => s.text.trim() !== "" && s.volume > 0);
    expect(real[0]).toMatchObject({ rate: 1.3, volume: 0.5 });
  });

  it("a broken or hostile stored value falls back to the defaults", async () => {
    store.set("zk-guide-voice", "{not json");
    const voice = await load();
    expect(voice.getVoicePrefs()).toEqual({ rate: 1, volume: 1 });
    store.set("zk-guide-voice", JSON.stringify({ rate: 99, volume: "loud" }));
    expect(voice.getVoicePrefs()).toEqual({ rate: 1.6, volume: 1 });
  });
});
