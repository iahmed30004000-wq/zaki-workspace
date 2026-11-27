"use client";

import React from "react";
import { Pause, Play, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTgPhone } from "@/components/shell/tg-phone";
import { TgVoiceBar } from "@/components/chat/v2/pane/tg-voice-bar";
import { voiceHeard } from "@/lib/chat/voice-heard";
import { chatPrefsQueryOptions, saveChatPrefs } from "@/lib/chat/cache/queries";
import { nextVoiceSpeed, resolveChatPrefs, type VoiceSpeed } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { voiceEngine, voiceNotesOf, voiceSpeedLabel, type VoiceNote } from "@/lib/chat/voice-queue";
import { formatDuration } from "@/lib/chat/waveform";
import type { MessageDto } from "@/server/chat/dto";

export interface VoiceMiniPlayerViewProps {
  note: VoiceNote;
  playing: boolean;
  /** 0..1 */
  at: number;
  durationMs: number;
  speed: VoiceSpeed;
  onToggle: () => void;
  onJump: () => void;
  onSpeed: () => void;
  onStop: () => void;
}

/**
 * The bar under the pane header (Telegram's): who sent the note that is playing, what is left of it, play / pause, the speed, and a stop. A tap on the
 * words goes to the note's message (the history's jump, with its 2 s highlight). It only draws; `VoiceMiniPlayer` decides when it is wanted.
 */
export function VoiceMiniPlayerView({ note, playing, at, durationMs, speed, onToggle, onJump, onSpeed, onStop }: VoiceMiniPlayerViewProps) {
  const total = durationMs || note.durationMs || 0;
  const left = total * (1 - at);
  const percent = Math.round(Math.max(0, Math.min(1, at)) * 100);
  return (
    <div data-voice-mini role="group" aria-label={ct("chatvoice.mini")} className="relative flex min-h-12 items-center gap-1 border-b border-border bg-surface-1 px-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={ct(playing ? "chat.f.pause" : "chat.f.play")}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-accent hover:bg-surface-2"
      >
        {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
      </button>
      <button
        type="button"
        data-voice-mini-jump
        onClick={onJump}
        aria-label={ct("chatvoice.jump")}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-start hover:bg-surface-2"
      >
        <span className="block truncate text-sm font-semibold">{ct("chatvoice.from", { name: note.authorName })}</span>
        <span className="block text-xs tabular-nums text-fg-muted" dir="ltr">{formatDuration(left)}</span>
      </button>
      <button
        type="button"
        data-voice-speed={speed}
        onClick={onSpeed}
        aria-label={ct("chatvoice.speed", { speed: voiceSpeedLabel(speed) })}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums text-fg-muted hover:bg-surface-2"
        dir="ltr"
      >
        {voiceSpeedLabel(speed)}
      </button>
      <button
        type="button"
        data-voice-mini-stop
        onClick={onStop}
        aria-label={ct("chatvoice.stop")}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={ct("chatvoice.mini")} className="absolute inset-x-0 bottom-0 h-0.5 bg-fg-muted/20">
        <div className="h-full bg-accent transition-none motion-reduce:transition-none" style={{ inlineSize: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * C3b.4 — mounted ONCE in the conversation pane. It gives the engine this conversation's voice notes (the queue the next-note walk follows), keeps the
 * person's speed in step with their prefs (read from, and saved to, the existing `/api/me/chat-prefs` door through the chat cache's own helpers), and draws
 * the bar while a note of this conversation is playing (or paused part of the way) and its bubble is out of sight. Leaving the conversation stops the sound.
 * On a phone with `tgPhone` the bar is `TgVoiceBar` (the sender and the date, the speed chip with its long press), and the notes also tell the unplayed
 * dot's memory when they were sent.
 */
export function VoiceMiniPlayer({ conversationId, messages, onJump, always = false }: { conversationId: string; messages: readonly MessageDto[]; onJump: (messageId: string) => void; /** «الصوت زي تيليجرام»: the bar stays while a note plays even when its bubble is on screen */ always?: boolean }) {
  const qc = useQueryClient();
  const prefs = useQuery(chatPrefsQueryOptions());
  const phone = useTgPhone();
  const notes = React.useMemo(() => voiceNotesOf(messages, { withTime: phone }), [messages, phone]);
  const snap = React.useSyncExternalStore(voiceEngine.subscribe, voiceEngine.getSnapshot, voiceEngine.getServerSnapshot);

  React.useEffect(() => {
    voiceEngine.setQueue(conversationId, notes);
  }, [conversationId, notes]);
  React.useEffect(() => {
    if (phone) voiceHeard.know(notes);
  }, [phone, notes]);
  React.useEffect(() => () => voiceEngine.leave(conversationId), [conversationId]);

  React.useEffect(() => {
    if (prefs.data) voiceEngine.hydrateSpeed(resolveChatPrefs(prefs.data.prefs).voiceSpeed);
  }, [prefs.data]);
  React.useEffect(
    () =>
      voiceEngine.onPersist((speed) => {
        // the screen already shows it; a refused save puts the cache back to what the server holds (the helper marks it to be read again)
        void saveChatPrefs(qc, { voiceSpeed: speed }).catch(() => undefined);
      }),
    [qc],
  );

  // the note as it was when it started: the bar stays while the sound goes on, even when the list has since dropped the message
  const note = snap.note;
  if (!note || (snap.activeVisible && !always)) return null;
  if (phone) {
    return (
      <TgVoiceBar
        note={note}
        playing={snap.playing}
        at={snap.at}
        speed={snap.speed}
        onToggle={() => voiceEngine.toggle(note.src)}
        onJump={() => onJump(note.messageId)}
        onSpeed={() => voiceEngine.setSpeed(nextVoiceSpeed(snap.speed))}
        onPickSpeed={(speed) => voiceEngine.setSpeed(speed)}
        onStop={() => voiceEngine.stop()}
      />
    );
  }
  return (
    <VoiceMiniPlayerView
      note={note}
      playing={snap.playing}
      at={snap.at}
      durationMs={snap.durationMs}
      speed={snap.speed}
      onToggle={() => voiceEngine.toggle(note.src)}
      onJump={() => onJump(note.messageId)}
      onSpeed={() => voiceEngine.setSpeed(nextVoiceSpeed(snap.speed))}
      onStop={() => voiceEngine.stop()}
    />
  );
}
