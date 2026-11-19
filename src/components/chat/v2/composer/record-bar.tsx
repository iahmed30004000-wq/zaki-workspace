"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import type { VoiceState } from "@/lib/chat/v2/composer/types";
import { barsFor, formatDuration } from "@/lib/chat/waveform";

/**
 * C2.5 — what replaces the box while a voice note is being recorded (the recorder and the upload are the old ones). On the phone the finger HOLDS the
 * microphone: the hint says «اسحب للجنب للإلغاء وللأعلى للقفل», a slide up LOCKS the take (the bar then has its own cancel and send), and lifting sends it. On the
 * computer a click started it and the bar's send button stops it. A take that stopped by itself (5 minutes, a hidden page) waits here for send or cancel.
 */
export function RecordBar({ voice, error, onCancel, onSend }: { voice: Exclude<VoiceState, { mode: "idle" }>; error: string; onCancel: () => void; onSend: () => void }) {
  const recording = voice.mode === "recording" ? voice : null;
  const elapsed = recording ? recording.elapsedMs : voice.mode === "review" ? voice.take.durationMs : 0;
  const peaks = recording ? recording.peaks : voice.mode === "review" ? voice.take.peaks : [];
  const holding = recording?.hold === true;
  return (
    <div className="flex flex-col gap-2" data-recording={voice.mode} data-locked={recording?.locked ? "" : undefined}>
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface-1 p-1">
        <Button type="button" variant="ghost" size="icon" className="text-danger" aria-label={ct("chat.f.cancel_recording")} onClick={onCancel}>
          <span aria-hidden="true">✕</span>
        </Button>
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full bg-danger ${recording ? "motion-safe:animate-pulse" : "opacity-40"}`} />
        <span role="timer" aria-live="off" className="w-12 shrink-0 text-sm tabular-nums" dir="ltr">
          {formatDuration(elapsed)}
        </span>
        <div aria-hidden="true" className="flex h-8 flex-1 items-center gap-px overflow-hidden" dir="ltr">
          {barsFor(peaks, 32).map((p, i) => (
            <span key={i} className="w-1 rounded-full bg-accent" style={{ height: `${Math.max(12, p)}%` }} />
          ))}
        </div>
        <Button type="button" variant="primary" size="icon" aria-label={ct("chat.f.send_recording")} onClick={onSend}>
          <span aria-hidden="true">➤</span>
        </Button>
      </div>
      <p className="text-center text-xs text-fg-muted" aria-live="polite">
        {holding ? ct("chatui.composer.record_hold_hint") : recording?.locked ? ct("chatui.composer.record_locked") : recording ? ct("chat.f.recording") : ct("chat.f.voice_label")}
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
