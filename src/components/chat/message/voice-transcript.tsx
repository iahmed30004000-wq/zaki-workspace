"use client";
import React from "react";
import { ArrowLeft, ChevronUp } from "lucide-react";
import { useTgPhone } from "@/components/shell/tg-phone";
import { AR } from "@/lib/i18n/dict";
import { ct } from "@/lib/chat/text";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import "@/components/chat/tg-voice.css";

export type TranscriptPhase = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string; open: boolean } | { kind: "error"; key: string };

/** One note's words: asked once (the server keeps them), then shown and hidden at will. */
function useVoiceTranscript(attachmentId: string) {
  const [phase, setPhase] = React.useState<TranscriptPhase>({ kind: "idle" });
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
  return { phase, setPhase, ask };
}

/**
 * «تيليجرام على التلفون» (`tgPhone`): the words of a received note, Telegram's way. A round button («←أ») beside the waveform, a ring turning around it
 * while the words are written, then the bubble grows with them and the button becomes ⌃ to fold them (a second press shows them again at once).
 * `row` draws the note's own row with the button in it. The marks are the old ones: the menu's «حوّل الصوت لنص» presses the button inside
 * `data-voice-transcript`, and leaves it alone while the words are on screen (the hidden `dir="auto"` mark).
 */
export function TgVoiceTranscriptView({ phase, onPress, row, mine = false }: { phase: TranscriptPhase; onPress: () => void; row: (aside: React.ReactNode) => React.ReactNode; mine?: boolean }) {
  const open = phase.kind === "done" && phase.open;
  const busy = phase.kind === "busy";
  const label = ct(busy ? "tgvoice.transcribing" : open ? "tgvoice.collapse" : phase.kind === "done" ? "tgvoice.expand" : "tgvoice.transcribe");
  // in my own bubble (the accent colour) the button takes the bubble's text colour
  const tone = mine ? "bg-bubble-out-fg/20 text-bubble-out-fg" : "bg-accent/15 text-accent";
  const button = (
    <span data-voice-transcript className="relative flex size-9 shrink-0 items-center justify-center">
      <button
        type="button"
        data-voice-transcribe={open ? "open" : phase.kind}
        onClick={(event) => {
          event.stopPropagation();
          onPress();
        }}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`flex size-8 items-center justify-center rounded-xl text-xs font-bold ${tone}`}
      >
        {open ? (
          <ChevronUp aria-hidden="true" className="size-5" />
        ) : (
          <span aria-hidden="true" className="flex items-center">
            <ArrowLeft className="size-3.5" />
            {ct("tgvoice.glyph")}
          </span>
        )}
      </button>
      {busy ? <span aria-hidden="true" data-transcribe-ring className={`tg-transcribe-ring pointer-events-none absolute inset-0 rounded-full border-2 border-t-transparent ${mine ? "border-bubble-out-fg" : "border-accent"}`} /> : null}
      {open ? <span dir="auto" hidden /> : null}
    </span>
  );
  return (
    <div data-tg-voice-note style={tgMotionVars(["transcriptSpinMs", "bubbleGrowMs"]) as React.CSSProperties}>
      {row(button)}
      {phase.kind === "done" && phase.open ? (
        <div data-voice-transcript-text className="tg-words-in pt-1 text-sm">
          <p dir="auto" className="whitespace-pre-wrap break-words">
            {phase.text}
          </p>
          <p className="text-xs opacity-75">{AR["voiceTranscript.label"]}</p>
        </div>
      ) : null}
      {phase.kind === "error" ? (
        <p role="alert" className={`pt-0.5 text-xs ${mine ? "text-bubble-out-fg" : "text-danger"}`}>
          {AR[phase.key]}
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {busy ? ct("tgvoice.transcribing") : ""}
      </span>
    </div>
  );
}

/**
 * «اكتب النص» under a voice note (the `voiceTranscript` switch): one tap sends the recording to the company's own speech-to-text service and
 * shows the text under the note, marked «نص تقريبي» (it can be wrong; it never replaces the voice). The text is kept with the recording, so
 * the next tap, and everybody else's, is instant. A failure is one plain line from the dictionary, never the service's own words.
 *
 * With `row` (the bubble of the new screen) it also draws the note's row: before the words as always, or, on a phone with `tgPhone`, with the round button
 * inside it.
 */
export function VoiceTranscript({ attachmentId, row, mine }: { attachmentId: string; row?: (aside?: React.ReactNode) => React.ReactNode; mine?: boolean }) {
  const phone = useTgPhone();
  const { phase, setPhase, ask } = useVoiceTranscript(attachmentId);
  if (phone && row) {
    return <TgVoiceTranscriptView phase={phase} row={row} mine={mine} onPress={() => (phase.kind === "done" ? setPhase({ ...phase, open: !phase.open }) : void ask())} />;
  }
  const under =
    phase.kind === "done" ? (
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
    ) : (
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
  return row ? (
    <>
      {row()}
      {under}
    </>
  ) : (
    under
  );
}
