import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { VIDEO_NOTE_MAX_MS } from "./limits";

/**
 * «رسالة فيديو دائرية» — the recording's states and its small rules, with no browser in them (`tests/tg-video-note.test.ts`).
 *
 *   idle      nothing; the camera is closed
 *   starting  the camera was asked for (the browser may be asking the person)
 *   recording the take runs; `locked`: it goes on without a finger and shows its own cancel and send
 *   review    the take is whole and the camera is CLOSED: watch it, send it or throw it away (the minute ran out, the page was hidden, or a send failed)
 *   sending   it is on its way
 */
export interface VideoTake {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export type VideoNoteState =
  | { mode: "idle" }
  | { mode: "starting"; locked: boolean }
  | { mode: "recording"; locked: boolean; elapsedMs: number }
  | { mode: "review"; take: VideoTake }
  | { mode: "sending"; take: VideoTake; percent: number };

export const VIDEO_IDLE: VideoNoteState = { mode: "idle" };

export type VideoNoteEvent =
  | { type: "start"; locked: boolean }
  | { type: "ready" }
  | { type: "tick"; elapsedMs: number }
  | { type: "lock" }
  | { type: "held"; take: VideoTake | null }
  | { type: "send"; take: VideoTake }
  | { type: "progress"; percent: number }
  | { type: "sent" }
  | { type: "failed" }
  | { type: "reset" };

/** An event that does not belong to the state it arrives in changes nothing (a camera that answers after a cancel, a tick after the stop). */
export function videoNoteReducer(state: VideoNoteState, event: VideoNoteEvent): VideoNoteState {
  switch (event.type) {
    case "start":
      return state.mode === "idle" ? { mode: "starting", locked: event.locked } : state;
    case "ready":
      return state.mode === "starting" ? { mode: "recording", locked: state.locked, elapsedMs: 0 } : state;
    case "tick":
      return state.mode === "recording" ? { ...state, elapsedMs: Math.min(VIDEO_NOTE_MAX_MS, event.elapsedMs) } : state;
    case "lock":
      return state.mode === "recording" || state.mode === "starting" ? { ...state, locked: true } : state;
    case "held":
      if (state.mode !== "recording" && state.mode !== "starting") return state;
      return event.take ? { mode: "review", take: event.take } : VIDEO_IDLE;
    case "send":
      return state.mode === "idle" || state.mode === "sending" ? state : { mode: "sending", take: event.take, percent: 0 };
    case "progress":
      return state.mode === "sending" ? { ...state, percent: event.percent } : state;
    case "sent":
      return state.mode === "sending" ? VIDEO_IDLE : state;
    case "failed":
      // the take is never lost to a bad network: it waits to be sent again
      return state.mode === "sending" ? { mode: "review", take: state.take } : state;
    case "reset":
      return VIDEO_IDLE;
  }
}

/** The camera is open (or being asked for) in these states only. */
export const cameraNeeded = (state: VideoNoteState): boolean => state.mode === "starting" || state.mode === "recording";

/** MP4 first (every phone plays it), then WebM (what Firefox records). */
export const VIDEO_MIME_CHOICES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"] as const;

export function pickVideoMime(supports: (type: string) => boolean): string | null {
  return VIDEO_MIME_CHOICES.find((type) => supports(type)) ?? null;
}

export const videoNoteFileName = (mime: string): string => (mime.includes("mp4") ? "video-note.mp4" : "video-note.webm");

/** `0:07` — Western digits. */
export function clockOf(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** How much of the minute is gone, 0..1 (the ring around the circle). */
export const ringShare = (elapsedMs: number): number => Math.max(0, Math.min(1, elapsedMs / VIDEO_NOTE_MAX_MS));

/** A finger that left sooner than the hold's delay was a tap: it changes the button between the microphone and the camera. */
export const wasTap = (heldMs: number): boolean => heldMs >= 0 && heldMs < TG_MOTION.micHoldMs;

export type CaptureMode = "voice" | "video";
/** Which of the two the button was left on, on this device. */
export const CAPTURE_MODE_KEY = "zk-capture-mode";
export const captureModeOf = (stored: string | null | undefined): CaptureMode => (stored === "video" ? "video" : "voice");
