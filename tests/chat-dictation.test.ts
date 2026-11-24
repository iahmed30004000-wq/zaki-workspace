import { describe, expect, it } from "vitest";
import { DICTATION_LANGS, DICTATION_MAX_CHARS, DEFAULT_DICTATION_LANG, browserRecognition, createDictation, dictationLangOf, dictationText, type RecognitionEventLike, type RecognitionLike } from "@/lib/chat/v2/dictation";

/** «نص مباشر أثناء التسجيل»: the engine around the browser's recognition, run with a fake one (no browser). */

class Fake implements RecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: RecognitionLike["onresult"] = null;
  onend: RecognitionLike["onend"] = null;
  onerror: RecognitionLike["onerror"] = null;
  starts = 0;
  aborted = false;
  failStart = false;
  start() {
    if (this.failStart) throw new Error("InvalidStateError");
    this.starts += 1;
  }
  stop() {}
  abort() {
    this.aborted = true;
  }
  say(parts: Array<[string, boolean]>, resultIndex = 0) {
    const results = parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } }));
    this.onresult?.({ resultIndex, results } as RecognitionEventLike);
  }
}

function rig(opts: { supported?: boolean } = {}) {
  const all: Fake[] = [];
  const engine = createDictation(() => {
    if (opts.supported === false) return null;
    const f = new Fake();
    all.push(f);
    return f;
  });
  // the first one is the probe of the support check (never started): the ones that listen come after it
  const made = {
    get length() {
      return Math.max(0, all.length - 1);
    },
    get 0() {
      return all[1];
    },
    get 1() {
      return all[2];
    },
  } as unknown as Fake[];
  return { engine, made, last: () => all[all.length - 1]! };
}

describe("the words and the language", () => {
  it("the list is Arabic first, and a code that is not in it is the default", () => {
    expect(DICTATION_LANGS[0]!.code).toBe("ar-JO");
    expect(dictationLangOf("en-US")).toBe("en-US");
    expect(dictationLangOf("xx-YY")).toBe(DEFAULT_DICTATION_LANG);
    expect(dictationLangOf(undefined)).toBe(DEFAULT_DICTATION_LANG);
  });

  it("the text is the sure part, then the part still being worked on, trimmed and capped", () => {
    expect(dictationText(" مرحبا ", " شباب ")).toBe("مرحبا شباب");
    expect(dictationText("", "")).toBe("");
    expect(dictationText("أ".repeat(DICTATION_MAX_CHARS + 50), "").length).toBe(DICTATION_MAX_CHARS);
  });

  it("the browser's recognition is looked up at call time (plain or webkit), and null when there is none", () => {
    class X {}
    expect(browserRecognition({ SpeechRecognition: X })()).toBeInstanceOf(X);
    expect(browserRecognition({ webkitSpeechRecognition: X })()).toBeInstanceOf(X);
    expect(browserRecognition({})()).toBeNull();
  });
});

describe("listening", () => {
  it("starts with the language, continuous and with interim results; the words appear as they are heard and the sure ones stay", () => {
    const { engine, last } = rig();
    expect(engine.getSnapshot()).toMatchObject({ supported: true, listening: false, final: "", interim: "" });
    engine.start();
    const f = last();
    expect(f).toMatchObject({ lang: "ar-JO", continuous: true, interimResults: true, starts: 1 });
    expect(engine.getSnapshot().listening).toBe(true);
    f.say([["مرحبا", false]]);
    expect(engine.getSnapshot()).toMatchObject({ final: "", interim: "مرحبا" });
    f.say([["مرحبا شباب", true]]);
    expect(engine.getSnapshot()).toMatchObject({ final: "مرحبا شباب", interim: "" });
    f.say([["مرحبا شباب", true], ["كيفكم", false]], 1);
    expect(engine.getSnapshot()).toMatchObject({ final: "مرحبا شباب", interim: "كيفكم" });
  });

  it("a second start while listening does nothing", () => {
    const { engine, made } = rig();
    engine.start();
    engine.start();
    expect(made).toHaveLength(1);
  });

  it("the browser ends a turn after a pause: it listens again while the person still wants the words, and the words are kept", () => {
    const { engine, last } = rig();
    engine.start();
    const f = last();
    f.say([["أول جملة", true]]);
    f.onend?.();
    expect(f.starts).toBe(2);
    expect(engine.getSnapshot()).toMatchObject({ listening: true, final: "أول جملة" });
  });

  it("finish answers every word heard (the sure and the unsure) and stops for good", () => {
    const { engine, last } = rig();
    engine.start();
    const f = last();
    f.say([["جملة", true], ["ناقصة", false]]);
    expect(engine.finish()).toBe("جملة ناقصة");
    expect(f.aborted).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ listening: false, final: "", interim: "" });
    f.onend?.();
    expect(f.starts).toBe(1);
  });

  it("cancel forgets everything", () => {
    const { engine, last } = rig();
    engine.start();
    last().say([["كلام", true]]);
    engine.cancel();
    expect(engine.getSnapshot()).toMatchObject({ listening: false, final: "", interim: "", error: null });
  });

  it("changing the language while listening keeps the words, opens a new recognition in the new language and goes on", () => {
    const { engine, made, last } = rig();
    engine.start();
    last().say([["hello there", true]]);
    engine.setLang("en-US");
    expect(made).toHaveLength(2);
    expect(made[0]!.aborted).toBe(true);
    expect(last().lang).toBe("en-US");
    expect(engine.getSnapshot()).toMatchObject({ lang: "en-US", final: "hello there", listening: true });
    last().say([["how are you", true]]);
    expect(engine.finish()).toBe("hello there how are you");
  });

  it("changing the language while idle only sets it", () => {
    const { engine, made } = rig();
    engine.setLang("ar-EG");
    expect(engine.getSnapshot().lang).toBe("ar-EG");
    expect(made).toHaveLength(0); // nothing listens; only the probe of the support check was made
  });
});

describe("what can go wrong never crashes the recording", () => {
  it("no recognition in this browser: unsupported, and start does nothing", () => {
    const { engine } = rig({ supported: false });
    expect(engine.getSnapshot()).toMatchObject({ supported: false, error: "unsupported" });
    engine.start();
    expect(engine.getSnapshot()).toMatchObject({ listening: false, error: "unsupported" });
    expect(engine.finish()).toBe("");
  });

  it("a refused permission or a microphone that is taken is a key, and it does not listen again", () => {
    const { engine, last } = rig();
    engine.start();
    const f = last();
    f.onerror?.({ error: "not-allowed" });
    expect(engine.getSnapshot()).toMatchObject({ listening: false, error: "denied" });
    f.onend?.();
    expect(f.starts).toBe(1);
    const second = rig();
    second.engine.start();
    second.last().onerror?.({ error: "audio-capture" });
    expect(second.engine.getSnapshot().error).toBe("busy");
  });

  it("«no-speech» and «aborted» are the normal ends of a turn, not errors", () => {
    const { engine, last } = rig();
    engine.start();
    last().onerror?.({ error: "no-speech" });
    last().onerror?.({ error: "aborted" });
    expect(engine.getSnapshot().error).toBeNull();
    expect(engine.getSnapshot().listening).toBe(true);
  });

  it("a recognition that throws on start is an error key", () => {
    const made: Fake[] = [];
    let first = true;
    const engine = createDictation(() => {
      const f = new Fake();
      if (!first) f.failStart = true;
      first = false;
      made.push(f);
      return f;
    });
    engine.start();
    expect(engine.getSnapshot()).toMatchObject({ listening: false, error: "failed" });
  });

  it("listeners are told, and stop being told after they leave", () => {
    const { engine } = rig();
    let n = 0;
    const off = engine.subscribe(() => (n += 1));
    engine.start();
    const seen = n;
    expect(seen).toBeGreaterThan(0);
    off();
    engine.cancel();
    expect(n).toBe(seen);
  });
});
