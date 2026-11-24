"use client";

import React from "react";
import { Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUND_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { ct } from "@/lib/chat/text";
import { DICTATION_LANGS, type DictationError } from "@/lib/chat/v2/dictation";
import type { VoiceState } from "@/lib/chat/v2/composer/types";
import { barsFor, formatDuration } from "@/lib/chat/waveform";

/**
 * C2.5 — what replaces the box while a voice note is being recorded (the recorder and the upload are the old ones). On the phone the finger HOLDS the
 * microphone: the hint says «اسحب للجنب للإلغاء وللأعلى للقفل», a slide up LOCKS the take (the bar then has its own cancel and send), and lifting sends it. On the
 * computer a click started it and the bar's send button stops it. A take that stopped by itself (5 minutes, a hidden page) waits here for send or cancel.
 * Drawn like Telegram's: a pill with the red dot and the time, the waveform, a bin to cancel, and the same round accent button as the composer's.
 */
/** «نص مباشر أثناء التسجيل»: what the bar draws above the pill (absent: nothing) */
export interface LiveView {
  supported: boolean;
  listening: boolean;
  text: string;
  lang: string;
  error: DictationError | null;
  setLang: (code: string) => void;
  sendAsText: () => void;
}

/** The sentence under the language picker: what the live text is doing, or why it is not (a key of the dictionary each, never built from the error's name). */
function liveStatus(live: LiveView): string {
  if (live.error === "denied") return ct("chatlive.err_denied");
  if (live.error === "busy") return ct("chatlive.err_busy");
  if (live.error === "failed") return ct("chatlive.err_failed");
  return live.listening ? ct("chatlive.listening") : ct("chatlive.idle");
}

export function RecordBar({ voice, error, live, onCancel, onSend }: { voice: Exclude<VoiceState, { mode: "idle" }>; error: string; live?: LiveView | undefined; onCancel: () => void; onSend: () => void }) {
  const recording = voice.mode === "recording" ? voice : null;
  const elapsed = recording ? recording.elapsedMs : voice.mode === "review" ? voice.take.durationMs : 0;
  const peaks = recording ? recording.peaks : voice.mode === "review" ? voice.take.peaks : [];
  const holding = recording?.hold === true;
  return (
    <div className="mx-auto flex w-full max-w-[904px] flex-col gap-1" data-recording={voice.mode} data-locked={recording?.locked ? "" : undefined}>
      {live && live.supported ? (
        <div data-live-text className="flex flex-col gap-1 rounded-2xl bg-surface-1 px-3 py-2 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={ct("chatlive.lang")}
              value={live.lang}
              onChange={(e) => live.setLang(e.target.value)}
              data-live-lang
              className="min-h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-fg"
            >
              {DICTATION_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {ct(l.labelKey)}
                </option>
              ))}
            </select>
            <span className="text-xs text-fg-muted" aria-live="polite">
              {liveStatus(live)}
            </span>
            <Button type="button" size="sm" data-live-send onClick={live.sendAsText} disabled={live.text === ""} className="ms-auto rounded-full font-semibold">
              {ct("chatlive.send_text")}
            </Button>
          </div>
          <p dir="auto" aria-live="polite" className="min-h-6 whitespace-pre-wrap break-words text-sm text-fg">
            {live.text || ct("chatlive.placeholder")}
          </p>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-[26px] bg-surface-1 px-1 shadow-card">
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-danger transition-colors hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:size-10"
            aria-label={ct("chat.f.cancel_recording")}
            onClick={onCancel}
          >
            <Trash2 aria-hidden="true" className="size-6" />
          </button>
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full bg-danger ${recording ? "motion-safe:animate-pulse" : "opacity-40"}`} />
          <span role="timer" aria-live="off" className="w-12 shrink-0 text-sm tabular-nums" dir="ltr">
            {formatDuration(elapsed)}
          </span>
          <div aria-hidden="true" className="flex h-8 min-w-0 flex-1 items-center gap-px overflow-hidden pe-2" dir="ltr">
            {barsFor(peaks, 32).map((p, i) => (
              <span key={i} className="w-[3px] rounded-full bg-accent/70" style={{ height: `${Math.max(12, p)}%` }} />
            ))}
          </div>
        </div>
        <button type="button" className={ROUND_BUTTON} aria-label={ct("chat.f.send_recording")} onClick={onSend}>
          <Send aria-hidden="true" className="size-6" />
        </button>
      </div>
      <p className="text-center text-xs text-fg-muted" aria-live="polite">
        {holding ? ct("chatui.composer.record_hold_hint") : recording?.locked ? ct("chatui.composer.record_locked") : recording ? ct("chat.f.recording") : ct("chat.f.voice_label")}
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
