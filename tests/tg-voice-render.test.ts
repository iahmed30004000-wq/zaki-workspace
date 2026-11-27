import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

/** «تيليجرام على التلفون», phase 4: what is drawn. The phone's views are drawn with the engine's phone view given by hand, or with the phone hook on. */
const world = vi.hoisted(() => ({ phone: false }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/c1", useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/shell/tg-phone", () => ({ useTgPhone: () => world.phone, useTgPhoneOn: () => world.phone }));

import { ComposerSurface, type SurfaceEngine } from "@/components/chat/v2/composer/composer-surface";
import { TakeWordsView } from "@/components/chat/v2/composer/tg-record-bar";
import { TgVoiceBar } from "@/components/chat/v2/pane/tg-voice-bar";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { TgVoiceTranscriptView } from "@/components/chat/message/voice-transcript";
import { BubbleMedia } from "@/components/chat/v2/bubble/bubble-media";
import { SpeechSection } from "@/components/settings-me/speech-section";
import { SettingsFrame } from "@/components/settings-me/settings-frame";
import { visibleSections } from "@/components/settings-me/sections";
import { ToastProvider } from "@/components/ui/toast";
import { composerFaceOf } from "@/lib/chat/v2/composer/face";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { createDragStore } from "@/lib/chat/v2/composer/hold-gesture";
import { formatRecordTime, levelScale, tgPhaseOf } from "@/lib/chat/v2/composer/tg-record";
import { VOICE_BIN_INSET, VOICE_DUST_CAP, dustAt, dustBurst } from "@/lib/chat/v2/composer/voice-dust-model";
import { SPEED_NAME_KEYS, speedAtStep, stepOfSpeed } from "@/lib/chat/v2/pane/voice-speed-menu";
import type { TgVoiceView, VoiceState } from "@/lib/chat/v2/composer/types";
import { voiceHeard } from "@/lib/chat/voice-heard";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { classTokens, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const draw = (node: ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, node))));
const noop = () => undefined;
const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  world.phone = false;
});

const tg = (over: Partial<TgVoiceView> = {}): TgVoiceView => ({
  conversationId: "c1", drag: createDragStore(), tip: false, transcribe: true, liveAllowed: true, speech: { language: "ar-JO", live: true, preview: true }, speechReady: true,
  setLanguage: noop, pause: noop, resume: noop, discard: noop, ...over,
});
const live = { supported: true, listening: true, text: "", lang: "ar-JO", error: null, setLang: noop, sendAsText: noop };
const surface = (voice: VoiceState, over: Record<string, unknown> = {}) =>
  draw(
    createElement(ComposerSurface, {
      c: {
        body: "", files: [], busy: false, error: "", progress: [], voice, face: composerFaceOf({ text: "", fileCount: 0, editing: false, voiceOn: true }), canSubmit: false, choices: [], pickAt: 0, setPick: noop, hint: null,
        textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: noop, removeFile: noop, selectMention: noop,
        onTextChange: noop, onKeyDown: noop, onPaste: noop, submit: noop, cancelRecording: noop, sendVoice: noop, onMicPointerDown: noop, onMicClick: noop, setPollOpen: noop, setRecall: noop,
        tg: tg(), ...over,
      } as unknown as SurfaceEngine,
      me: {}, reply: null, editing: null, onCancelReply: noop, onCancelEdit: noop, recents: [], onEmoji: noop,
    }),
  );
const take = { blob: new Blob(["x"]), mime: "audio/webm", durationMs: 33_000, peaks: [10, 60, 90] };
const recording = (hold: boolean): VoiceState => ({ mode: "recording", elapsedMs: 5400, peaks: [20, 80], hold, locked: !hold });

describe("the pure rules of the bar", () => {
  it("the phase, the timer with its tenth, and the halo that grows with the volume", () => {
    expect(tgPhaseOf(recording(true) as never)).toBe("hold");
    expect(tgPhaseOf(recording(false) as never)).toBe("locked");
    expect(tgPhaseOf({ mode: "recording", elapsedMs: 0, peaks: [], hold: false, locked: false })).toBe("locked");
    expect(tgPhaseOf({ mode: "review", take })).toBe("review");
    expect(formatRecordTime(0)).toBe("0:00,0");
    expect(formatRecordTime(5499)).toBe("0:05,4");
    expect(formatRecordTime(5999)).toBe("0:05,9");
    expect(formatRecordTime(72_100)).toBe("1:12,1");
    expect(levelScale(100)).toBeGreaterThan(levelScale(40));
    expect(levelScale(40)).toBeGreaterThan(levelScale(0));
    expect(levelScale(900)).toBe(levelScale(100));
  });

  it("the dust is capped, lives no longer than its effect, and every speck goes INTO the bin: never past it, never away", () => {
    expect(dustBurst({ width: 360, height: 52, toRight: true, ms: 400, count: 5000, seed: 3 })).toHaveLength(VOICE_DUST_CAP);
    expect(VOICE_DUST_CAP).toBeLessThanOrEqual(120);
    for (const toRight of [true, false]) {
      const bin = toRight ? 360 - VOICE_BIN_INSET : VOICE_BIN_INSET;
      for (const speck of dustBurst({ width: 360, height: 52, toRight, ms: 400, count: 40, seed: 7 })) {
        expect(speck.end).toBeLessThanOrEqual(400);
        let distance = Math.abs(bin - speck.x);
        for (let at = 0; at < speck.end; at += 10) {
          const now = Math.abs(bin - dustAt(speck, at)!.x);
          expect(now).toBeLessThanOrEqual(distance + 1e-9);
          distance = now;
        }
        // the last moment it is seen, it is at the bin's mouth
        const last = dustAt(speck, speck.end - 0.001)!;
        expect(Math.abs(last.x - bin)).toBeLessThan(0.5);
        expect(Math.abs(last.y - speck.binY)).toBeLessThan(0.5);
        expect(dustAt(speck, speck.end)).toBeNull();
      }
    }
  });

  it("which end the bin is at is asked of the row itself: the phone look runs it left to right inside a right-to-left page", () => {
    expect(read("src/components/chat/v2/composer/voice-dust.tsx")).toContain('const toRight = style.direction === "rtl";');
    expect(read("src/components/chat/v2/composer/tg-record-bar.tsx")).toContain("<VoiceDust ms={ms} />");
  });

  it("the slider walks the six speeds and each has its Arabic name", () => {
    expect([0, 1, 2, 3, 4, 5].map(speedAtStep)).toEqual([0.5, 1, 1.2, 1.5, 1.7, 2]);
    expect(speedAtStep(99)).toBe(2);
    expect(stepOfSpeed(1.7)).toBe(4);
    expect(AR[SPEED_NAME_KEYS[0.5]]).toBe("بطيئة");
    expect(AR[SPEED_NAME_KEYS[1]]).toBe("الأساسية");
    expect(AR[SPEED_NAME_KEYS[2]]).toBe("سريعة جدًا");
  });
});

describe("the composer on the phone", () => {
  it("holding: the blinking dot, the time, the slide words, the big circle and the lock with its words; no cancel button, no live words yet", () => {
    const html = surface(recording(true), { live });
    expect(html).toContain('data-tg-record="hold"');
    expect(html).toContain("data-rec-dot");
    expect(classTokens(html)).toContain("tg-rec-blink");
    expect(textOf(html)).toContain("0:05,4");
    expect(textOf(html)).toContain("السحب للإلغاء ‹");
    expect(textOf(html)).toContain("اسحب لتثبيت التسجيل");
    expect(html).toContain("data-lock-pill");
    expect(html).toContain("data-mic-circle");
    expect(html).toContain("data-mic-level");
    expect(html).not.toContain("data-rec-cancel");
    expect(html).not.toContain("data-rec-send");
    expect(html).not.toContain("data-live-text");
    expect(html).toContain("--tg-record-morph-ms:200ms");
    expect(html).not.toContain("<textarea");
    // the circle grows with the last level
    expect(html).toContain(`scale(${levelScale(80)})`);
  });

  it("locked: send in the circle, pause above it, «إلغاء», and the live words with the language (Arabic), the gear and «ابعت كنص»", () => {
    const html = surface(recording(false), { live });
    expect(html).toContain('data-tg-record="locked"');
    expect(html).toContain("data-rec-send");
    expect(html).toContain(AR["chat.f.send_recording"]!);
    expect(html).toContain("data-rec-pause");
    expect(html).toMatch(/data-rec-cancel[^>]*>إلغاء</);
    expect(html).toContain("data-live-text");
    expect(html).toContain("data-live-glow");
    expect(html).toContain("data-live-settings");
    expect(html).toContain("data-live-send");
    expect(textOf(html)).toContain("عم أسمع…");
    expect(textOf(html)).toContain(AR["chatlive.lang_ar_jo"]!);
    expect(html).not.toContain("data-lock-pill");
    // no camera: round video notes are not part of this
    expect(html).not.toContain("data-video-note");
  });

  it("locked without the company's live words: no strip, the rest is there", () => {
    const html = surface(recording(false));
    expect(html).toContain("data-rec-send");
    expect(html).not.toContain("data-live-text");
  });

  it("paused: bin, the waveform with play and the length, send, go on, and the words", () => {
    const html = surface({ mode: "paused", take, elapsedMs: 33_000, peaks: take.peaks });
    expect(html).toContain('data-tg-record="paused"');
    for (const mark of ["data-take-trash", "data-take-player", "data-take-send", "data-take-resume"]) expect(html, mark).toContain(mark);
    expect(textOf(html)).toContain("0:33");
    expect(html).toContain(AR["tgvoice.preview_play"]!);
    expect(html).toContain(AR["tgvoice.resume"]!);
    expect(html).toContain('data-take-words="busy"');
  });

  it("paused with no transcription service says so plainly and everything else works; with the person's automatic words off there is a button", () => {
    const off = surface({ mode: "paused", take, elapsedMs: 1, peaks: [] }, { tg: tg({ transcribe: false }) });
    expect(off).toContain('data-take-words="off"');
    expect(textOf(off)).toContain(AR["tgvoice.transcript_off"]!);
    expect(off).toContain("data-take-send");
    expect(off).toContain("data-take-resume");
    expect(surface({ mode: "paused", take, elapsedMs: 1, peaks: [] }, { tg: tg({ speech: { language: "ar-JO", live: true, preview: false } }) })).toContain("data-take-ask");
    // the person's choices not read yet: nothing is sent by itself
    expect(surface({ mode: "paused", take, elapsedMs: 1, peaks: [] }, { tg: tg({ speechReady: false }) })).toContain("data-take-ask");
  });

  it("a take that stopped by itself is the same preview without «go on»", () => {
    const html = surface({ mode: "review", take });
    expect(html).toContain('data-tg-record="review"');
    expect(html).toContain("data-take-send");
    expect(html).not.toContain("data-take-resume");
  });

  it("thrown away: the bin with its lid open and the dust", () => {
    const html = surface({ mode: "cancelling", from: "trash", elapsedMs: 100, peaks: [] });
    expect(html).toContain('data-tg-record="cancelling"');
    expect(html).toContain('data-bin="open"');
    expect(classTokens(html)).toContain("tg-bin-lid");
    expect(html).toContain("data-voice-dust");
    expect(html).not.toContain("data-take-send");
  });

  it("the tooltip of a short tap, with the owner's words; without a tap there is none; nothing morphs on the first drawing", () => {
    const html = surface({ mode: "idle" }, { tg: tg({ tip: true }) });
    expect(html).toContain("data-mic-tip");
    expect(textOf(html)).toContain("اضغط مطولًا لتسجيل رسالة صوتية");
    const calm = surface({ mode: "idle" });
    expect(calm).not.toContain("data-mic-tip");
    expect(classTokens(calm)).not.toContain("tg-face-morph");
    expect(classTokens(calm)).not.toContain("tg-composer-return");
    expect(read("src/components/chat/v2/composer/composer-surface.tsx")).toContain('const morph = c.tg && faceChanged ? "tg-face-morph" : "";');
  });

  it("without the phone view (switch off or a computer) the old bar and the old box are drawn", () => {
    const html = surface(recording(true), { tg: undefined });
    expect(html).not.toContain("data-tg-record");
    expect(html).toContain(AR["chatui.composer.record_hold_hint"]!);
    expect(surface({ mode: "idle" }, { tg: undefined })).not.toContain("--tg-composer-morph-ms");
  });
});

describe("the words of a take", () => {
  const view = (words: Parameters<typeof TakeWordsView>[0]["words"]) => draw(createElement(TakeWordsView, { words, onAsk: noop }));
  it("written, nothing heard, a failure with «again», and the ask button", () => {
    expect(textOf(view({ kind: "done", text: "مرحبا شباب" }))).toContain("مرحبا شباب");
    expect(textOf(view({ kind: "none" }))).toContain(AR["tgvoice.transcript_none"]!);
    const failed = view({ kind: "error", key: "voiceTranscript.err_down" });
    expect(textOf(failed)).toContain(AR["voiceTranscript.err_down"]!);
    expect(failed).toContain("data-take-retry");
    expect(view({ kind: "ask" })).toContain("data-take-ask");
  });
});

describe("a received note on the phone", () => {
  const attachments = [{ id: "a1", name: "voice.webm", url: "/api/chat/attachments/a1", mime: "audio/webm", kind: "AUDIO" as const, size: 100, peaks: [20, 60, 90], durationMs: 19_000 }];

  it("the waveform over the time, no speed chip while idle, and the round transcribe button in the row when the company's service is there", () => {
    world.phone = true;
    const html = draw(createElement(BubbleMedia, { attachments, kind: "VOICE", canTranscribe: true, canReadImages: false }));
    expect(html).toContain("data-tg-voice");
    expect(html).toContain('data-voice-transcribe="idle"');
    expect(html).toContain(AR["tgvoice.transcribe"]!);
    expect(html).not.toContain("data-voice-speed");
    expect(html).not.toContain(AR["voiceTranscript.button"]!);
    expect(textOf(html)).toContain("0:19");
    expect(draw(createElement(BubbleMedia, { attachments, kind: "VOICE", canTranscribe: false, canReadImages: false }))).not.toContain("data-voice-transcribe");
  });

  it("the phone look off: the old link under the note, and no new mark", () => {
    const html = draw(createElement(BubbleMedia, { attachments, kind: "VOICE", canTranscribe: true, canReadImages: false }));
    expect(html).not.toContain("data-tg-voice");
    expect(html).toContain(AR["voiceTranscript.button"]!);
    expect(html).toContain("data-voice-speed");
  });

  it("the button: a ring turns while it works; with the words the bubble holds them and the button folds them; folded it opens them again", () => {
    const row = (aside: React.ReactNode) => createElement("div", { "data-row": "" }, aside);
    const view = (phase: Parameters<typeof TgVoiceTranscriptView>[0]["phase"]) => draw(createElement(TgVoiceTranscriptView, { phase, onPress: noop, row }));
    const busy = view({ kind: "busy" });
    expect(busy).toContain("data-transcribe-ring");
    expect(classTokens(busy)).toContain("tg-transcribe-ring");
    expect(busy).toMatch(/disabled=""/);
    const open = view({ kind: "done", text: "أوكي. أوكي.", open: true });
    expect(open).toContain('data-voice-transcribe="open"');
    expect(open).toContain(AR["tgvoice.collapse"]!);
    expect(textOf(open)).toContain("أوكي. أوكي.");
    expect(textOf(open)).toContain(AR["voiceTranscript.label"]!);
    // the menu's «حوّل الصوت لنص» leaves an open one alone (the mark it looks for)
    expect(open).toMatch(/<span data-voice-transcript="true"[^>]*>.*<span dir="auto" hidden=""><\/span><\/span>/);
    const folded = view({ kind: "done", text: "أوكي", open: false });
    expect(folded).toContain(AR["tgvoice.expand"]!);
    expect(textOf(folded)).not.toContain("أوكي");
    expect(textOf(view({ kind: "error", key: "voiceTranscript.err_busy" }))).toContain(AR["voiceTranscript.err_busy"]!);
  });

  it("the dot beside the time while somebody else's note was not played here, and gone once it played", () => {
    world.phone = true;
    const src = "/api/chat/attachments/dot1";
    voiceHeard.know([{ src, mine: false, sentAt: new Date().toISOString() }]);
    expect(draw(createElement(VoicePlayer, { src, durationMs: 4000 }))).toContain("data-voice-unplayed");
    voiceHeard.markPlayed(src);
    expect(draw(createElement(VoicePlayer, { src, durationMs: 4000 }))).not.toContain("data-voice-unplayed");
  });
});

describe("the bar under the header on the phone", () => {
  const props = { note: { src: "/api/chat/attachments/a1", messageId: "m1", authorName: "ليلى", mine: true, sentAt: "2026-11-22T15:48:00.000Z" }, playing: true, at: 0.5, speed: 1.5 as const, onToggle: noop, onJump: noop, onSpeed: noop, onPickSpeed: noop, onStop: noop };

  it("pause, «أنت» for my own with the date and time, the speed chip, ✕ and the progress", () => {
    const html = draw(createElement(TgVoiceBar, props));
    expect(html).toContain("data-tg-voice-bar");
    expect(html).toContain('aria-label="إيقاف"');
    expect(textOf(html)).toContain("أنت");
    expect(textOf(html)).toMatch(/22 تشرين الثاني 2026 الساعة 15:48/);
    expect(textOf(html)).toContain("1.5×");
    expect(html).toContain("data-voice-mini-stop");
    expect(html).toContain('aria-valuenow="50"');
    expect(html).not.toContain("data-speed-menu");
    expect(textOf(draw(createElement(TgVoiceBar, { ...props, note: { ...props.note, mine: false } })))).toContain("ليلى");
  });

  it("the menu of the long press: the slider over six steps and every speed with its name, the chosen one marked", () => {
    const html = draw(createElement(TgVoiceBar, { ...props, initialMenu: true }));
    expect(html).toContain("data-speed-menu");
    expect(html).toMatch(/type="range"[^>]*max="5"/);
    for (const speed of [0.5, 1, 1.2, 1.5, 1.7, 2]) expect(html).toContain(`data-speed-choice="${speed}"`);
    for (const word of ["بطيئة", "الأساسية", "متوسطة", "سريعة", "سريعة جدًا"]) expect(textOf(html)).toContain(word);
    expect(html).toMatch(/data-speed-choice="1.5" aria-pressed="true"/);
  });

  it("the pane's player draws it only on the phone, and gives the unplayed memory the notes' times there", () => {
    const src = read("src/components/chat/v2/pane/voice-mini-player.tsx");
    expect(src).toContain("voiceNotesOf(messages, { withTime: phone })");
    expect(src).toContain("if (phone) voiceHeard.know(notes);");
    expect(src).toContain("<TgVoiceBar");
  });
});

describe("«تحويل الكلام لنص»", () => {
  it("the person's page: Arabic first and checked, «تلقائي», the live switch with its ⚠️ and 🔧, the preview switch, and what the service is", () => {
    const html = draw(createElement(SpeechSection, { serviceReady: false, liveAllowed: true }));
    const langs = [...html.matchAll(/data-speech-lang="([^"]+)"/g)].map((m) => m[1]);
    expect(langs[0]).toBe("ar-JO");
    expect(langs.at(-1)).toBe("auto");
    expect(html).toMatch(/aria-checked="true" data-speech-lang="ar-JO"/);
    expect(html).toContain("data-warn-fix");
    expect(textOf(html)).toContain(AR["tgvoice.set.live_warn"]!);
    expect(html).toContain('data-speech-service="off"');
    expect(textOf(html)).toContain(AR["tgvoice.set.service_off"]!);
  });

  it("the company's live words off: the switch is locked and says why", () => {
    const html = draw(createElement(SpeechSection, { serviceReady: true, liveAllowed: false }));
    expect(textOf(html)).toContain(AR["tgvoice.set.live_company_off"]!);
    expect(html).toContain('data-speech-service="ready"');
    expect(html).not.toContain("data-warn-fix");
    expect(html).toMatch(/data-speech-live[^>]*><button[^>]*disabled=""/);
  });

  it("is listed only while the phone look is on, and its row is not drawn on a computer; the other rows keep their colours", () => {
    expect(visibleSections({ foldersOn: true })).not.toContain("speech");
    expect(visibleSections({ foldersOn: true, speechOn: true })).toContain("speech");
    const header = { name: "أحمد", username: null, jobTitle: null, avatarUrl: null };
    const frame = (speechOn: boolean) => draw(createElement(SettingsFrame, { header, sections: visibleSections({ foldersOn: true, speechOn }) }, createElement("p", null, "x")));
    const on = frame(true);
    expect(on).toContain('href="/settings/me/speech"');
    expect(on).toMatch(/<li class="[^"]*md:hidden[^"]*"><a [^>]*href="\/settings\/me\/speech"|<li class="[^"]*md:hidden[^"]*"><a [^>]*data-section="speech"/);
    const tiles = (html: string) => [...html.matchAll(/data-section="([a-z]+)"[\s\S]*?data-section-tile="" class="[^"]*?(bg-cat-\d)/g)].filter((m) => m[1] !== "speech").map((m) => `${m[1]}:${m[2]}`);
    expect(tiles(on)).toEqual(tiles(frame(false)));
    expect(read("src/app/(app)/settings/me/[section]/page.tsx")).toContain('if (!(await actorFeatureOn(actor, "tgPhone"))) notFound();');
    expect(read("src/app/(app)/settings/me/layout.tsx")).toContain("visibleSections({ foldersOn, speechOn, soundsOn })");
  });
});

describe("every motion of phase 4 can be switched off", () => {
  it("each animation and transition of tg-voice.css sits under «no-preference» and the person's «الانتقالات» switch", () => {
    const css = read("src/components/chat/tg-voice.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const start = css.indexOf("@media (prefers-reduced-motion: no-preference) {");
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    const gated = css.slice(start, end);
    const outside = css.slice(0, start) + css.slice(end);
    expect(outside).not.toMatch(/(^|[\s{;])(animation|transition)\s*:/);
    const selectors = [...gated.matchAll(/\n\s{2}([^\n{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(selectors.length).toBeGreaterThanOrEqual(14);
    for (const selector of selectors) expect(selector).toContain('html:not([data-fx-off~="transitions"])');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // only transform and opacity move
    for (const frame of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)) {
      for (const prop of frame[1]!.matchAll(/\n\s+([a-z-]+):/g)) expect(["transform", "opacity"], frame[0].slice(0, 40)).toContain(prop[1]);
    }
  });

  it("every length the stylesheet reads is a named timing that one of the screens hands to it", () => {
    const css = read("src/components/chat/tg-voice.css");
    const screens = ["src/components/chat/v2/composer/tg-record-bar.tsx", "src/components/chat/v2/composer/composer-surface.tsx", "src/components/chat/message/voice-transcript.tsx", "src/components/chat/v2/pane/tg-voice-bar.tsx"].map(read).join("\n");
    const names = [...new Set([...css.matchAll(/var\(--tg-([a-z-]+)\)/g)].map((m) => m[1]!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())))];
    expect(names.length).toBeGreaterThanOrEqual(10);
    // no length is written into the stylesheet itself
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/(animation|transition):[^;]*\b\d*\.?\d+m?s\b/);
    for (const name of names) {
      expect(TG_MOTION, name).toHaveProperty(name);
      expect(screens, name).toContain(`"${name}"`);
    }
  });

  it("the dust asks «غبار الحذف» first, and the volume's halo asks the transitions", () => {
    expect(read("src/components/chat/v2/composer/voice-dust.tsx")).toContain('if (!canvas || !effectOn("dust")) return;');
    expect(read("src/components/chat/v2/composer/tg-record-bar.tsx")).toContain('const moving = useEffectOn("transitions");');
    expect(read("src/lib/chat/v2/composer/use-composer.ts")).toContain('if (!effectOn("dust") && !effectOn("transitions")) {');
  });
});
