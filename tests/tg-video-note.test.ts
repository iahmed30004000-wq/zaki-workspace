import * as React from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({ usePathname: () => "/chat/c1", useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { ComposerSurface, type SurfaceEngine } from "@/components/chat/v2/composer/composer-surface";
import { VideoNoteSurface } from "@/components/chat/v2/composer/video-note-overlay";
import { VideoNoteBubble } from "@/components/chat/v2/bubble/video-note-bubble";
import { VIDEO_NOTE_MAX_MS, VIDEO_NOTE_PX } from "@/lib/chat/v2/video-note/limits";
import { VIDEO_IDLE, cameraNeeded, captureModeOf, clockOf, pickVideoMime, ringShare, videoNoteFileName, videoNoteReducer, wasTap, type VideoNoteEvent, type VideoNoteState } from "@/lib/chat/v2/video-note/model";
import { leaveNote, previewRuns, takeTheSound, tapNote } from "@/lib/chat/v2/video-note/playback";
import { VideoNoteRecorder } from "@/lib/chat/v2/video-note/recorder";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { lastMessageOf } from "@/lib/chat/cache/reducers";
import { rowPreview } from "@/lib/chat/row-preview";
import { estimateRowHeight } from "@/lib/chat/viewport/sizes";
import { attachmentView } from "@/server/chat/attachments";
import { AR } from "@/lib/i18n/dict";
import { render } from "./ui-render";

const take = { blob: new Blob(["v"]), mime: "video/mp4", durationMs: 4000 };
const run = (...events: VideoNoteEvent[]) => events.reduce<VideoNoteState>(videoNoteReducer, VIDEO_IDLE);

describe("the states of a recording", () => {
  it("asks for the camera, records, and sends", () => {
    expect(run({ type: "start", locked: false })).toEqual({ mode: "starting", locked: false });
    expect(run({ type: "start", locked: false }, { type: "ready" }, { type: "tick", elapsedMs: 900 })).toEqual({ mode: "recording", locked: false, elapsedMs: 900 });
    expect(run({ type: "start", locked: true }, { type: "ready" }, { type: "held", take }, { type: "send", take }, { type: "progress", percent: 40 })).toEqual({ mode: "sending", take, percent: 40 });
    expect(run({ type: "start", locked: true }, { type: "ready" }, { type: "held", take }, { type: "send", take }, { type: "sent" })).toEqual(VIDEO_IDLE);
  });

  it("a send that failed keeps the take to be tried again", () => {
    expect(run({ type: "start", locked: true }, { type: "ready" }, { type: "held", take }, { type: "send", take }, { type: "failed" })).toEqual({ mode: "review", take });
  });

  it("ignores what arrives late: a camera that answers after a cancel, a tick or a stop after the end", () => {
    expect(run({ type: "start", locked: false }, { type: "reset" }, { type: "ready" }, { type: "tick", elapsedMs: 5 }, { type: "held", take }, { type: "sent" })).toEqual(VIDEO_IDLE);
    expect(run({ type: "start", locked: false }, { type: "start", locked: true })).toEqual({ mode: "starting", locked: false });
    expect(run({ type: "start", locked: true }, { type: "ready" }, { type: "tick", elapsedMs: VIDEO_NOTE_MAX_MS + 300 })).toMatchObject({ elapsedMs: VIDEO_NOTE_MAX_MS });
    expect(run({ type: "start", locked: true }, { type: "held", take: null })).toEqual(VIDEO_IDLE);
  });

  it("wants the camera only while asking and recording", () => {
    expect(cameraNeeded({ mode: "starting", locked: false })).toBe(true);
    expect(cameraNeeded({ mode: "recording", locked: true, elapsedMs: 1 })).toBe(true);
    expect(cameraNeeded({ mode: "review", take })).toBe(false);
    expect(cameraNeeded(VIDEO_IDLE)).toBe(false);
  });

  it("takes MP4 first and WebM where there is no MP4; the clock, the ring, the tap and the remembered button", () => {
    expect(pickVideoMime(() => true)).toContain("video/mp4");
    expect(pickVideoMime((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp8,opus");
    expect(pickVideoMime(() => false)).toBeNull();
    expect(videoNoteFileName("video/mp4")).toBe("video-note.mp4");
    expect(videoNoteFileName("video/webm")).toBe("video-note.webm");
    expect(clockOf(7_400)).toBe("0:07");
    expect(clockOf(VIDEO_NOTE_MAX_MS)).toBe("1:00");
    expect(ringShare(30_000)).toBe(0.5);
    expect(wasTap(TG_MOTION.micHoldMs - 1)).toBe(true);
    expect(wasTap(TG_MOTION.micHoldMs)).toBe(false);
    expect(captureModeOf("video")).toBe("video");
    expect(captureModeOf(null)).toBe("voice");
  });
});

/* ---------------- the camera is always closed ---------------- */

class FakeRecorder {
  static isTypeSupported = (type: string) => type.startsWith("video/webm");
  state = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["frames"]) });
    this.onstop?.();
  }
}

function fakeCamera() {
  const tracks = [{ stopped: false }, { stopped: false }].map((t) => ({ ...t, stop() { this.stopped = true; }, addEventListener: () => {} }));
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { tracks, stream, closed: () => tracks.every((t) => t.stopped) };
}

describe("the camera and the microphone are always released", () => {
  let visibility: "visible" | "hidden" = "visible";
  const listeners = new Set<() => void>();
  let answer: () => Promise<MediaStream>;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    listeners.clear();
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => answer() } });
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const hide = () => {
    visibility = "hidden";
    for (const fn of [...listeners]) fn();
  };

  it("on stop, with the take handed over", async () => {
    const cam = fakeCamera();
    answer = async () => cam.stream;
    const rec = new VideoNoteRecorder();
    expect(await rec.start()).toBe(cam.stream);
    await vi.advanceTimersByTimeAsync(2000);
    const made = await rec.stop();
    expect(made?.mime).toBe("video/webm");
    expect(made!.durationMs).toBeGreaterThanOrEqual(2000);
    expect(cam.closed()).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("on cancel", async () => {
    const cam = fakeCamera();
    answer = async () => cam.stream;
    const rec = new VideoNoteRecorder();
    await rec.start();
    rec.cancel();
    expect(cam.closed()).toBe(true);
    expect(await rec.stop()).toBeNull();
  });

  it("when the page is hidden mid-take: the take is kept", async () => {
    const cam = fakeCamera();
    answer = async () => cam.stream;
    const got: unknown[] = [];
    const rec = new VideoNoteRecorder({ onAutoStop: (t) => got.push(t) });
    await rec.start();
    hide();
    expect(cam.closed()).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ mime: "video/webm" });
  });

  it("when the person let go while the browser was still asking: what arrives is closed at once", async () => {
    const cam = fakeCamera();
    let give: (s: MediaStream) => void = () => {};
    answer = () => new Promise((resolve) => (give = resolve));
    const rec = new VideoNoteRecorder();
    const opening = rec.start();
    rec.cancel();
    give(cam.stream);
    expect(await opening).toBeNull();
    expect(cam.closed()).toBe(true);
  });

  it("when the page is hidden while the browser is still asking", async () => {
    const cam = fakeCamera();
    let give: (s: MediaStream) => void = () => {};
    answer = () => new Promise((resolve) => (give = resolve));
    const got: unknown[] = [];
    const rec = new VideoNoteRecorder({ onAutoStop: (t) => got.push(t) });
    const opening = rec.start();
    hide();
    give(cam.stream);
    expect(await opening).toBeNull();
    expect(cam.closed()).toBe(true);
    expect(got).toEqual([null]);
  });

  it("by itself at a minute", async () => {
    const cam = fakeCamera();
    answer = async () => cam.stream;
    const got: Array<{ durationMs: number } | null> = [];
    const rec = new VideoNoteRecorder({ onAutoStop: (t) => got.push(t) });
    await rec.start();
    await vi.advanceTimersByTimeAsync(VIDEO_NOTE_MAX_MS + 500);
    expect(cam.closed()).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0]!.durationMs).toBe(VIDEO_NOTE_MAX_MS);
  });

  it("says in one word why it could not open", async () => {
    answer = () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    await expect(new VideoNoteRecorder().start()).rejects.toMatchObject({ name: "cam.denied" });
    answer = () => Promise.reject(Object.assign(new Error("no"), { name: "NotFoundError" }));
    await expect(new VideoNoteRecorder().start()).rejects.toMatchObject({ name: "cam.unavailable" });
    vi.stubGlobal("MediaRecorder", undefined);
    await expect(new VideoNoteRecorder().start()).rejects.toMatchObject({ name: "cam.unsupported" });
    expect(listeners.size).toBe(0);
    for (const key of ["denied", "unavailable", "unsupported"]) expect(AR[`chat.f.cam.${key}`], key).toBeTruthy();
  });
});

/* ---------------- the composer ---------------- */

const engineOf = (over: Partial<SurfaceEngine> = {}): SurfaceEngine => {
  const nothing = () => undefined;
  return {
    body: "", files: [], busy: false, error: "", progress: [], voice: { mode: "idle" }, face: "mic", canSubmit: false, choices: [], pickAt: 0, setPick: nothing, hint: null,
    textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: nothing, removeFile: nothing, selectMention: nothing,
    onTextChange: nothing, onKeyDown: nothing, onPaste: nothing, submit: nothing, cancelRecording: nothing, sendVoice: async () => undefined, onMicPointerDown: nothing, onMicClick: nothing,
    setPollOpen: nothing, setRecall: nothing,
    ...over,
  } as unknown as SurfaceEngine;
};
const videoOf = (over: Record<string, unknown> = {}) => ({
  enabled: true, captureMode: "voice" as const, tip: false, error: "", state: VIDEO_IDLE, swallowsClick: () => false, watchMicTap: () => undefined, onCameraPointerDown: () => undefined, onCameraClick: () => undefined, startLocked: () => undefined,
  ...over,
});
const surface = (props: Record<string, unknown>) =>
  render(createElement(ComposerSurface, { c: engineOf(), me: {}, reply: null, editing: null, onCancelReply: () => undefined, onCancelEdit: () => undefined, recents: [], onEmoji: () => undefined, ...props } as never));
const tg = { conversationId: "c1", tip: false } as never;

describe("the composer", () => {
  it("is exactly what it was without the switch", () => {
    const before = surface({});
    expect(surface({ videoNote: videoOf({ enabled: false, captureMode: "video" }) })).toBe(before);
    expect(before).not.toContain("data-video-note-button");
  });

  it("on a computer keeps the microphone and gets a camera button of its own beside it", () => {
    const html = surface({ videoNote: videoOf({ captureMode: "video" }) });
    expect(html).toContain('data-composer-face="mic"');
    expect(html).toContain("data-video-note-button");
    expect(html).toContain(AR["tgstories.videonote.record"]);
  });

  it("under the phone's look the round button itself is the microphone or the camera, with no extra button", () => {
    const voice = surface({ c: engineOf({ tg }), videoNote: videoOf() });
    expect(voice).toContain('data-composer-face="mic"');
    expect(voice).not.toContain("data-video-note-button");
    const camera = surface({ c: engineOf({ tg }), videoNote: videoOf({ captureMode: "video" }) });
    expect(camera).toContain('data-composer-face="camera"');
    expect(camera).not.toContain('data-composer-face="mic"');
  });

  it("the line under a tap says what a hold does now and that a tap changes the button", () => {
    expect(surface({ c: engineOf({ tg }), videoNote: videoOf({ tip: true }) })).toContain(AR["tgstories.videonote.tip_voice"]);
    expect(surface({ c: engineOf({ tg }), videoNote: videoOf({ tip: true, captureMode: "video" }) })).toContain(AR["tgstories.videonote.tip_video"]);
    // without video notes the old line stays
    expect(surface({ c: engineOf({ tg: { conversationId: "c1", tip: true } as never }) })).toContain(AR["tgvoice.tap_tip"]);
  });

  it("offers no camera while there is something to send", () => {
    const html = surface({ c: engineOf({ face: "send", body: "مرحبا", canSubmit: true, tg }), videoNote: videoOf({ captureMode: "video" }) });
    expect(html).toContain('data-composer-face="send"');
    expect(html).not.toContain('data-composer-face="camera"');
  });
});

describe("what is drawn while a take is made", () => {
  const v = (state: VideoNoteState, error = "") => render(createElement(VideoNoteSurface, { v: { state, stream: null, send: () => undefined, cancel: () => undefined, error } }));
  it("nothing while idle; the slides under a finger; the two buttons once it is free", () => {
    expect(v(VIDEO_IDLE)).toBe("");
    const held = v({ mode: "recording", locked: false, elapsedMs: 5000 });
    expect(held).toContain("data-video-note-hint");
    expect(held).toContain("0:05");
    expect(held).not.toContain("data-video-note-send");
    const locked = v({ mode: "recording", locked: true, elapsedMs: 5000 });
    expect(locked).toContain("data-video-note-send");
    expect(locked).toContain("data-video-note-cancel");
    expect(v({ mode: "review", take }, "فشل")).toContain("فشل");
  });
});

describe("a sent round video", () => {
  it("is a muted circle in the bubble that waits to be tapped for its sound", () => {
    const html = render(createElement(VideoNoteBubble, { src: "/api/chat/attachments/a1", durationMs: 12_000 }));
    expect(html).toContain('data-video-note="muted"');
    expect(html).toContain("rounded-full");
    expect(html).toContain("muted");
    expect(html).not.toMatch(/<video[^>]*autoplay/i);
    expect(html).toContain("0:12");
    expect(html).toContain(`width:${VIDEO_NOTE_PX}px`);
  });

  it("plays by itself only muted, on the screen, on a looked-at page, where movement is wanted", () => {
    const facts = { visible: true, pageShown: true, autoplay: true };
    expect(previewRuns("muted", facts)).toBe(true);
    for (const off of ["visible", "pageShown", "autoplay"] as const) expect(previewRuns("muted", { ...facts, [off]: false }), off).toBe(false);
    expect(previewRuns("playing", facts)).toBe(false);
    expect(tapNote("muted")).toBe("playing");
    expect(tapNote("playing")).toBe("paused");
    expect(tapNote("paused")).toBe("playing");
    expect(leaveNote("playing", { visible: false, pageShown: true })).toBe("muted");
    expect(leaveNote("playing", { visible: true, pageShown: false })).toBe("muted");
    expect(leaveNote("playing", { visible: true, pageShown: true })).toBe("playing");
  });

  it("lets one sound at a time", () => {
    const stopped: string[] = [];
    const first = () => stopped.push("first");
    const second = () => stopped.push("second");
    const giveBack = takeTheSound(first);
    takeTheSound(second);
    expect(stopped).toEqual(["first"]);
    giveBack();
    takeTheSound(first);
    expect(stopped).toEqual(["first", "second"]);
  });

  it("the server's view says `round` only when it is one", () => {
    const row = { id: "a1", kind: "VIDEO", file: { id: "f", name: "v.mp4", mimeType: "video/mp4", size: 9 } };
    expect(attachmentView({ ...row, round: true }).round).toBe(true);
    expect(attachmentView({ ...row, round: false })).not.toHaveProperty("round");
    expect(attachmentView(row)).not.toHaveProperty("round");
  });

  it("the chat list's line says «رسالة فيديو», and the log keeps room for the circle", () => {
    const attachment = { id: "a1", kind: "VIDEO", name: "v.mp4", mime: "video/mp4", size: 9, url: "/api/chat/attachments/a1", round: true };
    const message = { id: "m1", kind: "TEXT", body: "", deleted: false, mine: false, authorName: "سامر", createdAt: new Date().toISOString(), reactions: [], attachments: [attachment] } as never;
    const last = lastMessageOf(message);
    expect(last.round).toBe(true);
    expect(rowPreview({ kind: "DM", lastMessage: last } as never).text).toBe(AR["tgstories.videonote.row"]);
    const plain = lastMessageOf({ ...(message as Record<string, unknown>), attachments: [{ ...attachment, round: undefined }] } as never);
    expect(plain).not.toHaveProperty("round");
    const high = estimateRowHeight({ type: "message", message } as never);
    const low = estimateRowHeight({ type: "message", message: { ...(message as Record<string, unknown>), attachments: [] } } as never);
    expect(high - low).toBe(VIDEO_NOTE_PX + 8);
  });
});
