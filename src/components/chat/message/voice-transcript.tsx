"use client";
import React from "react";
import { AR } from "@/lib/i18n/dict";

type Phase = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string; open: boolean } | { kind: "error"; key: string };

/**
 * «اكتب النص» under a voice note (the `voiceTranscript` switch): one tap sends the recording to the company's own speech-to-text service and
 * shows the text under the note, marked «نص تقريبي» (it can be wrong; it never replaces the voice). The text is kept with the recording, so
 * the next tap, and everybody else's, is instant. A failure is one plain line from the dictionary, never the service's own words.
 */
export function VoiceTranscript({ attachmentId }: { attachmentId: string }) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const ask = async () => {
    setPhase({ kind: "busy" });
    try {
      const res = await fetch(`/api/chat/attachments/${encodeURIComponent(attachmentId)}/transcript`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { text?: unknown; message?: unknown } | null;
      if (res.ok && body && typeof body.text === "string") {
        setPhase({ kind: "done", text: body.text, open: true });
        return;
      }
      const key = typeof body?.message === "string" && AR[body.message] ? body.message : "voiceTranscript.err_failed";
      setPhase({ kind: "error", key });
    } catch {
      setPhase({ kind: "error", key: "voiceTranscript.err_failed" });
    }
  };
  if (phase.kind === "done") {
    return (
      <div data-voice-transcript className="mt-1 text-sm">
        {phase.open ? (
          <p dir="auto" className="whitespace-pre-wrap rounded-lg bg-surface-muted/60 px-2 py-1">
            <span className="me-1 text-xs text-fg-muted">{AR["voiceTranscript.label"]}:</span>
            {phase.text}
          </p>
        ) : null}
        <button type="button" onClick={() => setPhase({ ...phase, open: !phase.open })} className="mt-0.5 min-h-8 text-xs text-fg-muted underline">
          {AR[phase.open ? "voiceTranscript.hide" : "voiceTranscript.show"]}
        </button>
      </div>
    );
  }
  return (
    <div data-voice-transcript className="mt-0.5 text-xs">
      <button type="button" onClick={() => void ask()} disabled={phase.kind === "busy"} className="min-h-8 text-fg-muted underline disabled:opacity-60">
        {AR[phase.kind === "busy" ? "voiceTranscript.busy_button" : "voiceTranscript.button"]}
      </button>
      {phase.kind === "error" ? (
        <p role="alert" className="text-danger">
          {AR[phase.key]}
        </p>
      ) : null}
    </div>
  );
}
