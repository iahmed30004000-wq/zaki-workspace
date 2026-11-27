"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { messageClientId } from "@/lib/chat/conversation/client";
import { postChatMessage } from "@/lib/chat/outbox/send";
import { playChatSound } from "@/lib/chat/sounds";
import { ct } from "@/lib/chat/text";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { tgHoldDrag } from "@/lib/chat/v2/composer/hold-gesture";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { voiceEngine } from "@/lib/chat/voice-queue";
import { AR } from "@/lib/i18n/dict";
import { VIDEO_NOTE_MIN_MS } from "./limits";
import { CAPTURE_MODE_KEY, VIDEO_IDLE, captureModeOf, videoNoteFileName, videoNoteReducer, wasTap, type CaptureMode, type VideoNoteEvent, type VideoNoteState, type VideoTake } from "./model";
import { VideoNoteRecorder } from "./recorder";

/**
 * The engine of a round video message, kept APART from the voice recorder's (`use-composer.ts`), which it never changes: the voice
 * button's own hold stays the engine's, and this only watches whether that touch was a short tap (which switches the button to the
 * camera). It owns the camera button's hold on a phone (lift sends, a slide up locks, a slide aside throws away, as the voice hold),
 * the one-click recording of a computer, the review of a take, and the send. The camera is closed on every way out: stop, cancel, a
 * hidden page, another conversation, the composer leaving the screen.
 */
export interface VideoNoteParams {
  conversationId: string;
  /** the company's switch for this conversation's header (`videoNotes`) */
  enabled: boolean;
  replyToId?: string;
  onCancelReply: () => void;
  onMessage: (message: MessageDto) => void;
}

export interface VideoNoteEngine {
  enabled: boolean;
  state: VideoNoteState;
  /** the live picture while the camera is open */
  stream: MediaStream | null;
  /** which of the two the phone's round button is */
  captureMode: CaptureMode;
  /** the line under a short tap on the round button */
  tip: boolean;
  error: string;
  /** a touch that this engine already dealt with also fires `click` a moment later: that click is nobody's */
  swallowsClick: () => boolean;
  /** beside the VOICE engine's own pointer handler: a finger's tap (not a hold) switches the button to the camera */
  watchMicTap: (event: { pointerId: number; pointerType: string }) => void;
  onCameraPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onCameraClick: () => void;
  /** a computer's camera button (and the keyboard): records at once, locked */
  startLocked: () => void;
  send: () => void;
  cancel: () => void;
}

const failText = (key: string): string => (AR[key] ? ct(key) : ct("chat.f.upload_failed"));

function storedMode(): CaptureMode {
  try {
    return captureModeOf(window.localStorage.getItem(CAPTURE_MODE_KEY));
  } catch {
    return "voice";
  }
}

export function useVideoNote({ conversationId, enabled, replyToId, onCancelReply, onMessage }: VideoNoteParams): VideoNoteEngine {
  const [state, setState] = React.useState<VideoNoteState>(VIDEO_IDLE);
  // the listeners of a hold are bound while the box is idle: they read the state through this, never through their own closure
  const now = React.useRef<VideoNoteState>(VIDEO_IDLE);
  const dispatch = React.useCallback((event: VideoNoteEvent) => {
    now.current = videoNoteReducer(now.current, event);
    setState(now.current);
  }, []);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [captureMode, setCaptureMode] = React.useState<CaptureMode>("voice");
  React.useEffect(() => setCaptureMode(storedMode()), []);
  const [tip, setTip] = React.useState(false);
  const [error, setError] = React.useState("");
  const recorder = React.useRef<VideoNoteRecorder | null>(null);
  const releaseHold = React.useRef<(() => void) | null>(null);
  const tapWatch = React.useRef<(() => void) | null>(null);
  const tipTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchedAt = React.useRef(0);
  /** one take's own ids: a retry after a lost answer is the same message and the same upload */
  const attempt = React.useRef<{ take: VideoTake; clientId: string; fileId: string | null } | null>(null);
  const latest = React.useRef({ replyToId, onCancelReply, onMessage, conversationId });
  latest.current = { replyToId, onCancelReply, onMessage, conversationId };

  const showTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTip(true);
    tipTimer.current = setTimeout(() => setTip(false), TG_MOTION.micTipMs);
  };
  const switchTo = (mode: CaptureMode) => {
    setCaptureMode(mode);
    try {
      window.localStorage.setItem(CAPTURE_MODE_KEY, mode);
    } catch {
      /* the choice lasts as long as the page */
    }
    showTip();
  };

  /** Closes the camera and forgets the take: every way out that sends nothing. */
  const drop = React.useCallback(() => {
    releaseHold.current?.();
    recorder.current?.cancel();
    recorder.current = null;
    setStream(null);
    attempt.current = null;
    dispatch({ type: "reset" });
  }, [dispatch]);

  const cancel = () => {
    if (now.current.mode === "sending") return;
    drop();
  };

  async function start(locked: boolean) {
    if (!enabled || now.current.mode !== "idle") return;
    setError("");
    setTip(false);
    voiceEngine.pause(); // a note that plays would be recorded with the person's voice
    const rec = new VideoNoteRecorder({
      onTick: (elapsedMs) => {
        if (recorder.current === rec) dispatch({ type: "tick", elapsedMs });
      },
      // the minute, a hidden page, the camera taken away: the take waits to be sent or thrown away
      onAutoStop: (take) => {
        if (recorder.current !== rec) return;
        recorder.current = null;
        releaseHold.current?.();
        setStream(null);
        dispatch({ type: "held", take: take && take.durationMs >= VIDEO_NOTE_MIN_MS ? take : null });
      },
    });
    recorder.current = rec;
    dispatch({ type: "start", locked });
    try {
      const opened = await rec.start();
      // the finger lifted (or slid away) while the browser was still asking for the camera
      if (recorder.current !== rec || !opened) return void rec.cancel();
      setStream(opened);
      dispatch({ type: "ready" });
    } catch (e) {
      if (recorder.current !== rec) return;
      drop();
      const key = e instanceof Error ? e.name : "";
      setError(failText(key.startsWith("cam.") ? `chat.f.${key}` : "chat.f.cam.unavailable"));
    }
  }

  async function upload(take: VideoTake) {
    if (now.current.mode === "sending") return;
    const to = latest.current;
    if (attempt.current?.take !== take) attempt.current = { take, clientId: messageClientId(), fileId: null };
    const job = attempt.current;
    dispatch({ type: "send", take });
    setError("");
    try {
      if (!job.fileId) {
        const form = new FormData();
        form.append("file", new File([take.blob], videoNoteFileName(take.mime), { type: take.mime }));
        form.append("kind", "VIDEO_NOTE");
        form.append("durationMs", String(Math.round(take.durationMs)));
        const made = await uploadWithProgress("/api/chat/uploads", form, (percent) => dispatch({ type: "progress", percent }));
        if (typeof made["id"] !== "string") throw new Error("chat.f.upload_failed");
        job.fileId = made["id"];
      }
      // like a voice note it is never queued: sent now, or kept here to be tried again
      const outcome = await postChatMessage(to.conversationId, { body: "", attachmentIds: [job.fileId], mentions: [], ...(to.replyToId ? { replyToId: to.replyToId } : {}), clientId: job.clientId }, undefined, 0);
      if (outcome.kind !== "sent") throw new Error(outcome.kind === "refused" ? outcome.failure.key : "chatc.message_failed");
      attempt.current = null;
      dispatch({ type: "sent" });
      to.onMessage(outcome.message);
      to.onCancelReply();
      playChatSound("sent");
    } catch (e) {
      dispatch({ type: "failed" });
      setError(failText(e instanceof Error ? e.message : ""));
    }
  }

  async function send() {
    const current = now.current;
    if (current.mode === "review") return void upload(current.take);
    if (current.mode === "starting") {
      drop();
      return showTip();
    }
    const rec = recorder.current;
    if (current.mode !== "recording" || !rec) return;
    releaseHold.current?.();
    recorder.current = null;
    const take = await rec.stop();
    setStream(null);
    if (!take || take.durationMs < VIDEO_NOTE_MIN_MS) {
      dispatch({ type: "reset" });
      return showTip(); // a slip of the finger, not a message
    }
    dispatch({ type: "held", take });
    await upload(take);
  }

  // the window listeners of a hold call the functions of the newest render
  const actions = React.useRef({ send, drop, start, switchTo });
  actions.current = { send, drop, start, switchTo };

  function watchMicTap(event: { pointerId: number; pointerType: string }) {
    if (!enabled || event.pointerType === "mouse") return;
    tapWatch.current?.();
    const at = Date.now();
    const pointerId = event.pointerId;
    const done = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", gone);
      tapWatch.current = null;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      done();
      if (!wasTap(Date.now() - at)) return;
      touchedAt.current = Date.now();
      actions.current.switchTo("video");
    };
    const gone = (e: PointerEvent) => {
      if (e.pointerId === pointerId) done();
    };
    tapWatch.current = done;
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", gone);
  }

  function onCameraPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" || releaseHold.current || now.current.mode !== "idle") return;
    touchedAt.current = Date.now();
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* nothing was captured */
    }
    const from = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    let waiting: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      waiting = null;
      void actions.current.start(false);
    }, TG_MOTION.micHoldMs);
    const done = () => {
      if (waiting) clearTimeout(waiting);
      waiting = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", gone);
      releaseHold.current = null;
      touchedAt.current = Date.now();
    };
    const lock = () => dispatch({ type: "lock" });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || waiting) return;
      // the same slides as the voice hold of Telegram's look: aside past 40% of the width throws away, up locks
      const at = tgHoldDrag(from, { x: e.clientX, y: e.clientY }, window.innerWidth, false);
      if (at.outcome === "cancel") {
        done();
        actions.current.drop();
      } else if (at.outcome === "lock") {
        done();
        lock();
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const tapped = waiting !== null;
      done();
      if (tapped) actions.current.switchTo("voice");
      else void actions.current.send();
    };
    const gone = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const tapped = waiting !== null;
      done();
      // a touch the browser takes away never loses a take: it locks
      if (!tapped) lock();
    };
    releaseHold.current = done;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", gone);
  }

  const swallowsClick = () => Date.now() - touchedAt.current < 800;
  const onCameraClick = () => {
    if (!swallowsClick()) void start(true);
  };

  // another conversation, the composer leaving the screen, or the switch going off: the camera is closed
  React.useEffect(
    () => () => {
      tapWatch.current?.();
      releaseHold.current?.();
      recorder.current?.cancel();
      recorder.current = null;
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );
  const shownFor = React.useRef(conversationId);
  React.useEffect(() => {
    if (shownFor.current === conversationId) return;
    shownFor.current = conversationId;
    if (now.current.mode !== "sending") drop();
    setError("");
  }, [conversationId, drop]);
  React.useEffect(() => {
    if (!enabled && now.current.mode !== "idle" && now.current.mode !== "sending") drop();
  }, [enabled, drop]);

  const open = state.mode !== "idle";
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || now.current.mode === "sending") return;
      event.preventDefault();
      actions.current.drop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return {
    enabled,
    state,
    stream,
    captureMode: enabled ? captureMode : "voice",
    tip,
    error,
    swallowsClick,
    watchMicTap,
    onCameraPointerDown,
    onCameraClick,
    startLocked: () => void start(true),
    send: () => void send(),
    cancel,
  };
}
