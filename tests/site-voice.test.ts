import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AR } from "@/lib/i18n/dict";
import { cleanForSpeech, clampPrefs, DEFAULT_VOICE_PREFS, isArabicLang, rankArabicVoices, splitForSpeech } from "@/lib/site-guide/voice-text";

/** S6.1 — the browser voice of the guide and «اتصل بالمساعد»: the pure parts (what is said, in which pieces, with which voice, at which speed). */

const v = (lang: string, name = "x", extra: Record<string, unknown> = {}) => ({ lang, name, ...extra });

describe("which voice speaks", () => {
  it("knows an Arabic language tag in every spelling a browser uses", () => {
    for (const lang of ["ar", "ar-SA", "ar_JO", "AR-eg", "ara-XWW", "ar-001"]) expect(isArabicLang(lang), lang).toBe(true);
    for (const lang of ["en-US", "fa-IR", "he-IL", "ur-PK", "", "art-lojban"]) expect(isArabicLang(lang), lang).toBe(false);
  });

  it("ranks ar-SA, ar-JO and ar-EG first, then any other Arabic, and leaves every other language out", () => {
    const ranked = rankArabicVoices([v("en-US", "e"), v("ar-AE", "ae"), v("ar-EG", "eg"), v("ar", "plain"), v("ar-JO", "jo"), v("ar-SA", "sa"), v("fa-IR", "fa")]);
    expect(ranked.map((x) => x.name)).toEqual(["sa", "jo", "eg", "ae", "plain"]);
  });

  it("inside one language a natural, offline or Google voice beats a plain one and a compact one comes last", () => {
    const ranked = rankArabicVoices([v("ar-SA", "compact-voice (Compact)"), v("ar-SA", "plain"), v("ar-SA", "Microsoft Naayf Online (Natural)"), v("ar-SA", "local", { localService: true })]);
    expect(ranked[0]?.name).toBe("Microsoft Naayf Online (Natural)");
    expect(ranked.at(-1)?.name).toBe("compact-voice (Compact)");
    expect(ranked.findIndex((x) => x.name === "local")).toBeLessThan(ranked.findIndex((x) => x.name === "plain"));
  });

  it("is stable (the order the browser gave is kept for equals) and never fails on an empty list", () => {
    expect(rankArabicVoices([v("ar-SA", "a"), v("ar-SA", "b")]).map((x) => x.name)).toEqual(["a", "b"]);
    expect(rankArabicVoices([])).toEqual([]);
  });
});

describe("what is said", () => {
  it("drops markdown marks, links, paths, ids, long digit runs and symbols, and keeps the words", () => {
    const said = cleanForSpeech("## **تمام** يا أحمد!\n- افتح [صفحة المهام](https://workspace.zakiai.io/tasks) أو /settings/me ✅\n`رمز` المعرّف clx9a8b7c0000abcdefghijklm والرقم 0791234567");
    expect(said).not.toMatch(/[*#`\[\]()✅]/);
    expect(said).not.toContain("http");
    expect(said).not.toContain("/settings");
    expect(said).not.toContain("clx9a8b7");
    expect(said).not.toContain("0791234567");
    expect(said).toContain("تمام يا أحمد");
    expect(said).toContain("صفحة المهام");
    expect(said).toContain("افتح");
  });

  it("keeps ordinary numbers, dates and fractions of a sentence", () => {
    expect(cleanForSpeech("عندك 3 مهام و 12 رسالة، والموعد 5/12")).toBe("عندك 3 مهام و 12 رسالة، والموعد 5/12");
  });

  it("drops the guide's element references and a windows path", () => {
    expect(cleanForSpeech("اضغط على e12 أو [e7] أو C:\\Users\\x\\file.txt الآن")).toBe("اضغط على أو أو الآن");
  });

  it("keeps ordinary Latin words that only look like markup or paths: «TCP/IP», «and/or», «a < 5 and b > 3», «E5»", () => {
    expect(cleanForSpeech("نستعمل TCP/IP و and/or هون")).toBe("نستعمل TCP/IP و and/or هون");
    expect(cleanForSpeech("إذا a < 5 and b > 3 بنكمل")).toBe("إذا a < 5 and b > 3 بنكمل");
    expect(cleanForSpeech("موديل E5 أحسن")).toBe("موديل E5 أحسن");
    // but a real tag and a path with two separators go
    expect(cleanForSpeech("قبل <br/> بعد src/app/page")).toBe("قبل بعد");
  });

  it("an answer that is only symbols is nothing to say", () => {
    expect(cleanForSpeech("**  ✅ ⚠️ 🔧 ---")).toBe("");
    expect(cleanForSpeech("   ")).toBe("");
  });
});

describe("the pieces", () => {
  it("never cuts the text: a 1500-character answer comes back in full, in pieces of at most 160 characters", () => {
    const sentence = "هاي جملة عادية بالعربي للاختبار.";
    const long = Array.from({ length: 50 }, () => sentence).join(" ");
    expect(long.length).toBeGreaterThan(1500);
    const pieces = splitForSpeech(long);
    expect(pieces.length).toBeGreaterThan(8);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(160);
    expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("breaks at the end of a sentence (. ؟ ! … or a new line), and a decimal point is not an end", () => {
    expect(splitForSpeech("أهلًا. كيف حالك؟ تمام!")).toEqual(["أهلًا. كيف حالك؟ تمام!"]);
    const pieces = splitForSpeech(`${"كلمة ".repeat(25).trim()}. ثاني جملة 3.5 مرات.\nسطر جديد`, 140);
    expect(pieces.join(" ")).toContain("3.5");
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces[0]!.endsWith(".")).toBe(true);
  });

  it("a sentence longer than a piece is broken at a comma or a space, never inside a word", () => {
    const words = Array.from({ length: 80 }, (_, i) => `كلمة${i}`).join(" ");
    const pieces = splitForSpeech(words, 100);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(100);
      expect(p).toMatch(/^(كلمة\d+)( كلمة\d+)*$/);
    }
    expect(pieces.join(" ")).toBe(words);
  });

  it("empty in, empty out", () => {
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("  \n ")).toEqual([]);
  });
});

describe("speed and volume", () => {
  it("default to normal and are clamped to a range that stays understandable", () => {
    expect(DEFAULT_VOICE_PREFS).toEqual({ rate: 1, volume: 1 });
    expect(clampPrefs({ rate: 5, volume: 7 })).toEqual({ rate: 1.6, volume: 1 });
    expect(clampPrefs({ rate: 0.1, volume: -3 })).toEqual({ rate: 0.6, volume: 0.2 });
    expect(clampPrefs({ rate: 1.25, volume: 0.5 })).toEqual({ rate: 1.25, volume: 0.5 });
  });

  it("anything that is not a number falls back to the default", () => {
    expect(clampPrefs(null)).toEqual(DEFAULT_VOICE_PREFS);
    expect(clampPrefs("x")).toEqual(DEFAULT_VOICE_PREFS);
    expect(clampPrefs({ rate: "fast", volume: NaN })).toEqual(DEFAULT_VOICE_PREFS);
  });
});

describe("the words and the wiring", () => {
  it("every string of the voice panel and of the «no Arabic voice» note is Arabic, with no Latin word", () => {
    for (const key of ["settings", "rate", "volume", "test", "test_text", "no_voice", "speak_failed", "device_only", "slow", "fast"]) {
      const s = AR[`voiceStack.${key}`];
      expect(s, key).toBeTruthy();
      expect(s, key).toMatch(/[؀-ۿ]/);
      expect(s, key).not.toMatch(/[A-Za-z]/);
      expect(s, key).not.toContain("ـاً");
    }
  });

  it("the voice file uses the helpers, waits for the voices, unlocks the audio and keeps the callers' names", () => {
    const src = readFileSync("src/components/site-guide/voice.ts", "utf8");
    for (const name of ["export const canListen", "export function listenOnce", "export async function speak", "export function stopSpeaking"]) expect(src, name).toContain(name);
    expect(src).toContain("voiceschanged");
    expect(src).toContain("rankArabicVoices");
    expect(src).toContain("splitForSpeech");
    expect(src).toContain("cleanForSpeech");
    expect(src).toContain("export function unlockAudio");
    expect(src).not.toContain("slice(0, 600)");
  });

  it("the tap that starts the call unlocks the audio first, in the same event (the phone stays mute otherwise)", () => {
    const guide = readFileSync("src/components/site-guide/site-guide.tsx", "utf8");
    expect(guide).toContain("unlockAudio()");
    expect(guide).toMatch(/const onCall = \(\) => \{\s*unlockAudio\(\);/);
    expect(guide).toMatch(/const startCall = \(\) => \{\s*unlockAudio\(\);/);
    expect(guide).toContain("VoiceSettings");
    // the call button keeps its pinned event (tests/assistant-chat.test.ts)
    expect(readFileSync("src/components/site-guide/assistant-call-button.tsx", "utf8")).toContain("new CustomEvent(GUIDE_CALL_EVENT)");
  });

  it("the panel keeps the settings on this device only (localStorage), never on the server", () => {
    const panel = readFileSync("src/components/site-guide/voice-settings.tsx", "utf8");
    expect(panel).toContain("setVoicePrefs");
    expect(panel).not.toContain("apiPost");
    expect(panel).not.toContain("fetch(");
  });
});
