import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { I18nProvider } from "@/lib/i18n";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { VoiceMiniPlayerView } from "@/components/chat/v2/pane/voice-mini-player";
import { chatPrefsPatchSchema, chatPrefsSchema, mergeChatPrefs, nextVoiceSpeed, readChatPrefs, resolveChatPrefs, VOICE_SPEEDS } from "@/lib/chat/prefs";
import { createVoiceEngine, nextUnheard, voiceNotesOf, voiceSpeedLabel, type AudioLike, type VoiceNote } from "@/lib/chat/voice-queue";
import type { MessageDto } from "@/server/chat/dto";

/**
 * C3b.4 — voice notes: the speed (1× / 1.5× / 2×, kept in `User.chatPrefs.voiceSpeed`), the walk to the NEXT unheard note, and the mini bar under the header.
 * The queue is a pure function, the player's engine takes its audio objects from a factory (so it runs here without a browser), and the bar's look is
 * drawn from props.
 */

const note = (n: number, extra: Partial<VoiceNote> = {}): VoiceNote => ({ src: `/api/chat/attachments/a${n}`, messageId: `m${n}`, authorName: "ليلى", mine: false, durationMs: 4000, ...extra });

describe("the speed in the person's prefs", () => {
  it("the tap's circle is 1, 1.5 and 2; a speed outside the offered ones is refused; an empty prefs object resolves to 1", () => {
    expect([...VOICE_SPEEDS]).toEqual([1, 1.5, 2]);
    expect(chatPrefsSchema.safeParse({ voiceSpeed: 1.5 }).success).toBe(true);
    expect(chatPrefsSchema.safeParse({ voiceSpeed: 3 }).success).toBe(false);
    expect(chatPrefsPatchSchema.safeParse({ voiceSpeed: 2 }).success).toBe(true);
    // 0.5 became one of the offered speeds (the phone's long press, `tests/tg-voice-model.test.ts`); a speed that is none of them is still refused
    expect(chatPrefsPatchSchema.safeParse({ voiceSpeed: 0.25 }).success).toBe(false);
    expect(resolveChatPrefs({}).voiceSpeed).toBe(1);
    expect(resolveChatPrefs({ voiceSpeed: 2 }).voiceSpeed).toBe(2);
  });

  it("an old stored value without a speed, or with a damaged one, reads as 1 and keeps the rest", () => {
    expect(readChatPrefs({ tabs: { hidden: ["dm"] } })).toEqual({ tabs: { hidden: ["dm"] } });
    expect(readChatPrefs({ voiceSpeed: "fast", tabs: { hidden: ["dm"] } })).toEqual({ tabs: { hidden: ["dm"] } });
    expect(resolveChatPrefs(readChatPrefs({ voiceSpeed: 7 })).voiceSpeed).toBe(1);
  });

  it("a save of the speed leaves the other sections alone, and null puts it back to the default", () => {
    const stored = readChatPrefs({ tabs: { hidden: ["dm"] }, voiceSpeed: 1.5 });
    expect(mergeChatPrefs(stored, { voiceSpeed: 2 })).toEqual({ tabs: { hidden: ["dm"] }, voiceSpeed: 2 });
    expect(mergeChatPrefs(stored, { voiceSpeed: null })).toEqual({ tabs: { hidden: ["dm"] } });
  });

  it("the speed button cycles 1 → 1.5 → 2 → 1, and a value out of the list starts again at 1.5", () => {
    expect(nextVoiceSpeed(1)).toBe(1.5);
    expect(nextVoiceSpeed(1.5)).toBe(2);
    expect(nextVoiceSpeed(2)).toBe(1);
    expect(nextVoiceSpeed(9 as never)).toBe(1.5);
    expect(voiceSpeedLabel(1)).toBe("1×");
    expect(voiceSpeedLabel(1.5)).toBe("1.5×");
    expect(voiceSpeedLabel(2)).toBe("2×");
  });
});

describe("the next unheard voice note", () => {
  const queue = [note(1), note(2), note(3), note(4)];

  it("is the first one AFTER the one that ended, never an earlier one", () => {
    expect(nextUnheard(queue, queue[1]!.src, new Set())?.messageId).toBe("m3");
    expect(nextUnheard(queue, queue[0]!.src, new Set())?.messageId).toBe("m2");
  });

  it("skips what was already heard and my own notes", () => {
    const withMine = [note(1), note(2, { mine: true }), note(3), note(4)];
    expect(nextUnheard(withMine, withMine[0]!.src, new Set())?.messageId).toBe("m3");
    expect(nextUnheard(queue, queue[0]!.src, new Set([queue[1]!.src, queue[2]!.src]))?.messageId).toBe("m4");
  });

  it("is nothing at the end of the queue, or when the note is not in it, or when every later one was heard", () => {
    expect(nextUnheard(queue, queue[3]!.src, new Set())).toBeNull();
    expect(nextUnheard(queue, "/api/chat/attachments/zzz", new Set())).toBeNull();
    expect(nextUnheard(queue, queue[2]!.src, new Set([queue[3]!.src]))).toBeNull();
    expect(nextUnheard([], "x", new Set())).toBeNull();
  });

  it("never changes its inputs", () => {
    const heard = new Set<string>();
    const before = JSON.stringify(queue);
    nextUnheard(queue, queue[0]!.src, heard);
    expect(JSON.stringify(queue)).toBe(before);
    expect(heard.size).toBe(0);
  });
});

describe("the queue of a conversation, from its messages", () => {
  const msg = (id: string, over: Partial<MessageDto> = {}): MessageDto =>
    ({
      id,
      kind: "VOICE",
      body: null,
      deleted: false,
      edited: false,
      pinned: false,
      mine: false,
      authorId: "u1",
      authorName: "ليلى",
      createdAt: "2026-01-01T00:00:00Z",
      mentions: [],
      reactions: [],
      attachments: [{ id: `f-${id}`, kind: "AUDIO", name: "voice.webm", mime: "audio/webm", size: 9, url: `/api/chat/attachments/f-${id}`, durationMs: 2500, peaks: [5] }],
      ...over,
    }) as MessageDto;

  it("lists the voice notes oldest to newest with the address the bubble plays", () => {
    const list = voiceNotesOf([msg("m1"), msg("t1", { kind: "TEXT", attachments: [] }), msg("m2", { mine: true, authorName: "أنا" })]);
    expect(list).toEqual([
      { src: "/api/chat/attachments/f-m1", messageId: "m1", authorName: "ليلى", mine: false, durationMs: 2500 },
      { src: "/api/chat/attachments/f-m2", messageId: "m2", authorName: "أنا", mine: true, durationMs: 2500 },
    ]);
  });

  it("leaves out a deleted note, a pending one, a note that is not on our own address and a file that is not audio", () => {
    const foreign = msg("m3");
    foreign.attachments[0]!.url = "https://example.test/a.webm";
    const notAudio = msg("m4");
    notAudio.attachments[0]!.mime = "application/pdf";
    expect(voiceNotesOf([msg("m1", { deleted: true }), msg("pending:x"), foreign, notAudio])).toEqual([]);
  });
});

/** A stand-in for the browser's audio object: it plays when told and says what a real one would say. */
class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  duration = 4;
  paused = true;
  playbackRate = 1;
  plays: string[] = [];
  private handlers = new Map<string, Set<() => void>>();
  play() {
    this.paused = false;
    this.plays.push(this.src);
    this.fire("play");
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
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
  finish() {
    this.currentTime = this.duration;
    this.paused = true;
    this.fire("pause");
    this.fire("ended");
  }
}

function setup(notes: VoiceNote[] = [note(1), note(2), note(3)], conversation: string | null = "c1") {
  const made: FakeAudio[] = [];
  const engine = createVoiceEngine({ makeAudio: () => { const a = new FakeAudio(); made.push(a); return a; } });
  const mount = (src: string) => engine.attach(src);
  if (conversation) engine.setQueue(conversation, notes);
  /** the one audio object, once something has played */
  const el = () => made[0]!;
  return { engine, made, mount, el, notes };
}

describe("the player's engine: speed", () => {
  it("starts at 1× and applies the speed to what plays now and to what plays next", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    expect(el().playbackRate).toBe(1);
    engine.setSpeed(2);
    expect(el().playbackRate).toBe(2);
    expect(engine.getSnapshot().speed).toBe(2);
    engine.toggle(notes[1]!.src);
    expect(el().playbackRate).toBe(2);
  });

  it("a speed the person picked is handed to the saver once; what the prefs hold is taken only before the person picked one", () => {
    const { engine } = setup();
    const saved: number[] = [];
    const off = engine.onPersist((s) => saved.push(s));
    engine.hydrateSpeed(1.5);
    expect(engine.getSnapshot().speed).toBe(1.5);
    expect(saved).toEqual([]);
    engine.setSpeed(2);
    expect(saved).toEqual([2]);
    engine.hydrateSpeed(1);
    expect(engine.getSnapshot().speed).toBe(2);
    off();
    engine.setSpeed(1);
    expect(saved).toEqual([2]);
  });

  it("refuses a speed that is not in the list", () => {
    const { engine } = setup();
    engine.setSpeed(3 as never);
    expect(engine.getSnapshot().speed).toBe(1);
  });
});

describe("the player's engine: one note at a time, and on to the next", () => {
  it("every note plays through the SAME audio object (a phone unlocks one object, not each bubble)", () => {
    const { engine, made, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    engine.toggle(notes[1]!.src);
    expect(made).toHaveLength(1);
    expect(el().plays).toEqual([notes[0]!.src, notes[1]!.src]);
  });

  it("starting a note replaces the one that played, and a second tap pauses and resumes it", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: notes[0]!.src, playing: true });
    engine.toggle(notes[1]!.src);
    expect(el().src).toBe(notes[1]!.src);
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: notes[1]!.src, playing: true });
    engine.toggle(notes[1]!.src);
    expect(el().paused).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: notes[1]!.src, playing: false });
    engine.toggle(notes[1]!.src);
    expect(engine.getSnapshot().playing).toBe(true);
  });

  it("a note left half way starts again from where it was left", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    el().currentTime = 2.5;
    engine.toggle(notes[1]!.src);
    engine.toggle(notes[0]!.src);
    el().fire("loadedmetadata");
    expect(el().currentTime).toBe(2.5);
  });

  it("when a note ends the next unheard one starts by itself, and the last one ends the line", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    el().finish();
    expect(el().src).toBe(notes[1]!.src);
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: notes[1]!.src, playing: true, at: 0 });
    el().finish();
    expect(el().src).toBe(notes[2]!.src);
    el().finish();
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: null, playing: false, at: 0 });
  });

  it("the walk goes from one note straight to the next without an idle moment in between", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    const seen: (string | null)[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().activeSrc));
    el().finish();
    expect(seen).not.toContain(null);
  });

  it("skips a note that was heard (started) before, and goes on to the one after it", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[1]!.src); // the person heard m2 first
    engine.toggle(notes[0]!.src); // then started m1
    el().finish();
    expect(engine.getSnapshot().activeSrc).toBe(notes[2]!.src);
    expect(el().src).toBe(notes[2]!.src);
  });

  it("never plays one of my own notes by itself", () => {
    const mine = [note(1), note(2, { mine: true }), note(3)];
    const { engine, el } = setup(mine);
    engine.toggle(mine[0]!.src);
    el().finish();
    expect(engine.getSnapshot().activeSrc).toBe(mine[2]!.src);
  });

  it("the note that plays needs no bubble on the page: the sound and the sender stay when the list drops it", () => {
    const { engine, mount, el, notes } = setup();
    const gone = mount(notes[0]!.src);
    engine.toggle(notes[0]!.src);
    gone();
    expect(el().paused).toBe(false);
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: notes[0]!.src, playing: true, activeVisible: false });
    expect(engine.getSnapshot().note).toMatchObject({ authorName: "ليلى", messageId: "m1" });
  });

  it("with no pane owning the queue (the old screen, the quick chat) the sound stops when the playing note's last bubble goes", () => {
    const { engine, mount, el, notes } = setup(undefined, null);
    const one = mount(notes[0]!.src);
    const two = mount(notes[0]!.src);
    engine.toggle(notes[0]!.src);
    one();
    expect(el().paused).toBe(false);
    two();
    expect(engine.getSnapshot().activeSrc).toBeNull();
    expect(el().paused).toBe(true);
  });

  it("with no pane owning the queue, a bubble that is not the playing note leaving does not touch the sound", () => {
    const { engine, mount, el, notes } = setup(undefined, null);
    mount(notes[0]!.src);
    const other = mount(notes[1]!.src);
    engine.toggle(notes[0]!.src);
    other();
    expect(el().paused).toBe(false);
    expect(engine.getSnapshot().activeSrc).toBe(notes[0]!.src);
  });

  it("a note drawn twice counts as on the page while either bubble is", () => {
    const { engine, mount, notes } = setup();
    const one = mount(notes[0]!.src);
    const two = mount(notes[0]!.src);
    engine.toggle(notes[0]!.src);
    one();
    expect(engine.getSnapshot().activeVisible).toBe(true);
    two();
    expect(engine.getSnapshot().activeVisible).toBe(false);
  });

  it("with no conversation open (the old screen, the quick chat) a note that ends is just over", () => {
    const { engine, el, notes } = setup(undefined, null);
    engine.toggle(notes[0]!.src);
    el().finish();
    expect(engine.getSnapshot().activeSrc).toBeNull();
    expect(el().plays).toEqual([notes[0]!.src]);
  });

  it("leaving the conversation stops the sound and empties the queue", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    engine.leave("another");
    expect(engine.getSnapshot().playing).toBe(true);
    engine.leave("c1");
    expect(el().paused).toBe(true);
    expect(engine.getSnapshot().activeSrc).toBeNull();
    el().fire("ended");
    expect(engine.getSnapshot().activeSrc).toBeNull();
  });

  it("the position and the length follow the audio", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    el().duration = 8;
    el().currentTime = 2;
    el().fire("timeupdate");
    expect(engine.getSnapshot().at).toBeCloseTo(0.25);
    expect(engine.getSnapshot().durationMs).toBe(8000);
  });

  it("the bar is wanted only while the playing bubble is out of sight", () => {
    const { engine, mount, notes } = setup();
    mount(notes[0]!.src);
    engine.toggle(notes[0]!.src);
    expect(engine.getSnapshot().activeVisible).toBe(true);
    engine.setVisible(notes[0]!.src, false);
    expect(engine.getSnapshot().activeVisible).toBe(false);
    engine.setVisible(notes[0]!.src, true);
    expect(engine.getSnapshot().activeVisible).toBe(true);
  });

  it("a file that cannot play ends the line instead of leaving a note that never starts", () => {
    const { engine, el, notes } = setup();
    engine.toggle(notes[0]!.src);
    el().fire("error");
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: null, playing: false });
  });

  it("a browser that refuses to play leaves the note paused, not playing", async () => {
    const engine = createVoiceEngine({ makeAudio: () => Object.assign(new FakeAudio(), { play: () => Promise.reject(new Error("blocked")) }) });
    engine.toggle("/api/chat/attachments/a1");
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.getSnapshot()).toMatchObject({ activeSrc: "/api/chat/attachments/a1", playing: false });
  });

  it("with no audio at all (a server render) nothing happens and nothing breaks", () => {
    const engine = createVoiceEngine({ makeAudio: () => null });
    engine.toggle("/api/chat/attachments/a1");
    expect(engine.getSnapshot().activeSrc).toBeNull();
  });

  it("a snapshot is a new object only when something changed (the screen reads it as a store)", () => {
    const { engine, mount, notes } = setup();
    mount(notes[0]!.src);
    const idle = engine.getSnapshot();
    engine.stop();
    expect(engine.getSnapshot()).toBe(idle);
    let calls = 0;
    const off = engine.subscribe(() => (calls += 1));
    engine.toggle(notes[0]!.src);
    expect(calls).toBeGreaterThan(0);
    off();
  });
});

describe("what is drawn", () => {
  const draw = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(I18nProvider as unknown as React.FC<{ initial: "ar"; children?: React.ReactNode }>, { initial: "ar" }, el));

  it("an idle voice note in a bubble is as it was: the play button, the waveform and the length, no speed chip, and VoiceTranscript's neighbour box is untouched", () => {
    const html = draw(React.createElement(VoicePlayer, { src: "/api/chat/attachments/a1", peaks: [10, 90, 40], durationMs: 3000 }));
    expect(html).toContain("<audio");
    expect(html).toContain('aria-label="تشغيل"');
    expect(html).toContain("0:03");
    expect(html).not.toContain("data-voice-speed");
  });

  const props = {
    note: note(1),
    playing: true,
    at: 0.25,
    durationMs: 8000,
    speed: 1.5 as const,
    onToggle: () => undefined,
    onJump: () => undefined,
    onSpeed: () => undefined,
    onStop: () => undefined,
  };

  it("the bar shows who sent it, what is left, the speed, and a play / pause, a jump and a stop", () => {
    const html = draw(React.createElement(VoiceMiniPlayerView, props));
    expect(html).toContain("data-voice-mini");
    expect(html).toContain("ليلى");
    expect(html).toContain("0:06");
    expect(html).toContain("1.5×");
    expect(html).toContain('aria-label="إيقاف"');
    expect(html).toContain("data-voice-mini-jump");
    expect(html).toContain("data-voice-mini-stop");
    expect(html).toContain('aria-valuenow="25"');
    expect(draw(React.createElement(VoiceMiniPlayerView, { ...props, playing: false }))).toContain('aria-label="تشغيل"');
  });

  it("the bar uses theme tokens, logical sides and respects reduced motion", () => {
    const html = draw(React.createElement(VoiceMiniPlayerView, props));
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/\b(bg-black|bg-white|text-white)\b/);
    expect(html).not.toMatch(/\b(left|right|ml|mr|pl|pr)-\d/);
    const src = readFileSync(join(process.cwd(), "src/components/chat/v2/pane/voice-mini-player.tsx"), "utf8");
    expect(src).not.toMatch(/\btext-\[1[01]px\]/);
    expect(src).toContain("motion-reduce:");
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the pane mounts the bar right under the header, before the pinned bar, and gives it the loaded messages", () => {
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    const header = pane.indexOf("<PaneHeader");
    const bar = pane.indexOf("<VoiceMiniPlayer");
    const pinned = pane.indexOf("<PinnedBar");
    expect(header).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(header);
    expect(bar).toBeLessThan(pinned);
    expect(pane).toMatch(/<VoiceMiniPlayer[^>]*messages=\{history\.messages\}/);
  });

  it("the speed travels through the existing prefs door and no other", () => {
    const bar = read("src/components/chat/v2/pane/voice-mini-player.tsx");
    expect(bar).toContain("saveChatPrefs");
    expect(bar).toContain("chatPrefsQueryOptions");
    expect(bar).not.toMatch(/fetch\(/);
  });

  it("the speed chip keeps the player's own controls: the transcript button is still drawn by its callers", () => {
    expect(read("src/components/chat/v2/bubble/bubble-media.tsx")).toContain("<VoiceTranscript");
    expect(read("src/components/chat/message/message-item.tsx")).toContain("VoiceTranscript");
  });
});
