"use client";

import React from "react";
import { Check, ChevronUp, Globe, Lock, Mic, Pause, Play, Send, Settings } from "lucide-react";
import { ROUND_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { liveStatus, type LiveView } from "@/components/chat/v2/composer/record-bar";
import { VoiceDust } from "@/components/chat/v2/composer/voice-dust";
import { SpeechSection } from "@/components/settings-me/speech-section";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ct } from "@/lib/chat/text";
import { SPEECH_LANGS, serviceLangOf } from "@/lib/chat/speech-langs";
import { requestTakeTranscript } from "@/lib/chat/take-transcript";
import type { VoiceTake } from "@/lib/chat/voice-recorder";
import { voiceEngine } from "@/lib/chat/voice-queue";
import { barsFor, formatDuration } from "@/lib/chat/waveform";
import { formatRecordTime, levelScale, tgPhaseOf, type TakeWords } from "@/lib/chat/v2/composer/tg-record";
import type { TgVoiceView, VoiceState } from "@/lib/chat/v2/composer/types";
import { cn } from "@/lib/utils";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { useEffectOn } from "@/lib/motion/use-effect-on";
import "@/components/chat/tg-voice.css";

/**
 * «تيليجرام على التلفون» — what replaces the composer's row while a voice note is recorded on a phone (`tgPhone`; everywhere else `record-bar.tsx`).
 *
 *   hold        the finger holds the mic: a blinking red dot and the time, «السحب للإلغاء ‹» following the finger, the microphone grown into a big circle that
 *               pulses with the volume, and the lock rising above it
 *   locked      slid up (or started with a click): the circle is send, pause above it, «إلغاء» in the row, and the live words above (switch `voiceLiveText`)
 *   preview     paused (or stopped by itself): bin, the waveform to listen to, send, «go on» above it, and the recording's words from the company's service
 *   cancelling  thrown away: the bin's lid opens and the blue dust falls into it, then the composer comes back
 *
 * It only draws what the engine says; the finger's position is written straight onto the element (CSS variables), so a move renders nothing.
 */
export interface TgRecordBarProps {
  voice: Exclude<VoiceState, { mode: "idle" }>;
  error: string;
  live?: LiveView | undefined;
  tg: TgVoiceView;
  onSend: () => void;
}

const MOTION_VARS = ["recordMorphMs", "recordBlinkMs", "micLevelMs", "micToSendMs", "dictationFadeMs", "languageMenuMs", "voiceDustMs", "composerReturnMs", "bubbleGrowMs", "dictationGlowMs"] as const;

const ROUND = "flex shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The bin, with a lid of its own that can open. */
function Bin({ open = false }: { open?: boolean }) {
  return (
    <svg data-bin={open ? "open" : "closed"} aria-hidden="true" viewBox="0 0 24 24" className="size-6 overflow-visible" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <g className={open ? "tg-bin-lid" : undefined}>
        <path d="M4 7h16" />
        <path d="M9 7V4.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7" />
      </g>
      <path d="M6 7l1 12.2c.1 1 .9 1.8 2 1.8h6c1.1 0 1.9-.8 2-1.8L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function LivePanel({ live, tg, onSettings }: { live: LiveView; tg: TgVoiceView; onSettings: () => void }) {
  const [menu, setMenu] = React.useState(false);
  const chosen = SPEECH_LANGS.find((l) => l.code === live.lang) ?? SPEECH_LANGS[0];
  const problem = live.error ? liveStatus(live) : "";
  return (
    // the end side is left free for the pause button above the circle
    <div data-live-text className="tg-rec-strip flex flex-col gap-1.5 pe-14">
      <div className="relative flex flex-wrap items-center gap-2">
        <button type="button" data-live-settings aria-label={ct("tgvoice.settings")} title={ct("tgvoice.settings")} onClick={onSettings} className={`${ROUND} size-9 bg-surface-1 text-fg-muted shadow-card`}>
          <Settings aria-hidden="true" className="size-5" />
        </button>
        <button
          type="button"
          data-live-lang
          aria-haspopup="listbox"
          aria-expanded={menu}
          aria-label={ct("tgvoice.lang_chip", { lang: ct(chosen.labelKey) })}
          onClick={() => setMenu((open) => !open)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-1 px-3 text-sm font-semibold text-fg shadow-card"
        >
          <Globe aria-hidden="true" className="size-4 text-fg-muted" />
          {ct(chosen.labelKey)}
          <ChevronUp aria-hidden="true" className="size-4 text-fg-muted" />
        </button>
        <button type="button" data-live-send onClick={live.sendAsText} disabled={live.text === ""} className="ms-auto inline-flex min-h-9 items-center rounded-full bg-surface-1 px-3 text-sm font-semibold text-accent shadow-card disabled:opacity-50">
          {ct("chatlive.send_text")}
        </button>
        {menu ? (
          <>
            <div aria-hidden="true" className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <ul role="listbox" aria-label={ct("chatlive.lang")} data-live-lang-menu className="tg-lang-menu absolute bottom-full start-0 z-40 mb-2 max-h-64 w-56 overflow-y-auto overscroll-contain rounded-2xl bg-surface-1 py-1 shadow-lg ring-1 ring-border">
              {SPEECH_LANGS.map((l) => {
                const on = l.code === live.lang;
                return (
                  <li key={l.code} role="option" aria-selected={on}>
                    <button
                      type="button"
                      data-lang={l.code}
                      onClick={() => {
                        setMenu(false);
                        tg.setLanguage(l.code);
                      }}
                      className="flex min-h-11 w-full items-center gap-2 px-4 text-start text-sm text-fg hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate">{ct(l.labelKey)}</span>
                      {on ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
      <div className="relative rounded-3xl bg-surface-1 px-4 py-2.5 shadow-card">
        <span aria-hidden="true" data-live-glow className="tg-rec-glow pointer-events-none absolute inset-0 rounded-3xl ring-2 ring-accent/60" />
        <p dir="auto" aria-live="polite" className={`relative max-h-24 min-h-6 overflow-y-auto whitespace-pre-wrap break-words text-sm ${live.text ? "text-fg" : "text-fg-muted"}`}>
          {live.text || ct("tgvoice.listening")}
        </p>
      </div>
      {problem ? (
        <p role="status" className="text-xs text-fg-muted">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** The words of the take, above the preview: being written, written, nothing heard, no service, a failure to try again, or a button to ask. */
export function TakeWordsView({ words, onAsk }: { words: TakeWords; onAsk: () => void }) {
  const plain = words.kind === "busy" ? "tgvoice.transcript_busy" : words.kind === "none" ? "tgvoice.transcript_none" : words.kind === "off" ? "tgvoice.transcript_off" : null;
  return (
    <div data-take-words={words.kind} className="relative rounded-3xl bg-surface-1 px-4 py-2.5 text-sm shadow-card" aria-live="polite">
      {words.kind === "done" ? (
        <p dir="auto" className="tg-words-in max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-fg">
          {words.text}
        </p>
      ) : plain ? (
        <p className="text-fg-muted">{ct(plain)}</p>
      ) : words.kind === "error" ? (
        <p className="flex flex-wrap items-center gap-2">
          <span role="alert" className="text-danger">
            {ct(words.key)}
          </span>
          <button type="button" data-take-retry onClick={onAsk} className="min-h-8 font-semibold text-accent">
            {ct("tgvoice.transcript_retry")}
          </button>
        </p>
      ) : (
        <button type="button" data-take-ask onClick={onAsk} className="min-h-6 font-semibold text-accent">
          {ct("tgvoice.transcript_ask")}
        </button>
      )}
    </div>
  );
}

/** The words of one take: asked by themselves where the person left that on, else on the button; a take that changes or goes drops the request. */
function useTakeWords(take: VoiceTake, tg: TgVoiceView): { words: TakeWords; ask: () => void } {
  const auto = tg.transcribe && tg.speechReady && tg.speech.preview;
  const [asked, setAsked] = React.useState(0);
  const [words, setWords] = React.useState<TakeWords>(() => ({ kind: !tg.transcribe ? "off" : auto ? "busy" : "ask" }));
  const wanted = tg.transcribe && (auto || asked > 0);
  const language = serviceLangOf(tg.speech.language);
  const { conversationId } = tg;
  React.useEffect(() => {
    if (!wanted) return;
    const stop = new AbortController();
    setWords({ kind: "busy" });
    void requestTakeTranscript(conversationId, take, language, stop.signal).then((answer) => {
      if (stop.signal.aborted) return;
      if (answer.ok) setWords({ kind: "done", text: answer.text });
      else if (answer.key === "tgvoice.transcript_none") setWords({ kind: "none" });
      else if (answer.key === "tgvoice.transcript_off") setWords({ kind: "off" });
      else setWords({ kind: "error", key: answer.key });
    });
    return () => stop.abort();
  }, [wanted, asked, take, language, conversationId]);
  return { words, ask: () => setAsked((n) => n + 1) };
}

const PLAY_BARS = 36;

/** The pill of the preview: listen, the waveform filling as it plays, the length. Its own audio object: a take that was not sent is no note of the queue. */
function PreviewPlayer({ take }: { take: VoiceTake }) {
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [at, setAt] = React.useState(0);
  React.useEffect(() => {
    const made = URL.createObjectURL(take.blob);
    setUrl(made);
    setAt(0);
    setPlaying(false);
    const el = audio.current;
    return () => {
      el?.pause();
      URL.revokeObjectURL(made);
    };
  }, [take.blob]);
  // one sound at a time: a note of the conversation that starts stops the preview
  React.useEffect(
    () =>
      voiceEngine.subscribe(() => {
        if (voiceEngine.getSnapshot().playing) audio.current?.pause();
      }),
    [],
  );
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    voiceEngine.pause();
    void el.play()?.catch(() => setPlaying(false));
  };
  const seconds = take.durationMs / 1000;
  return (
    <div data-take-player className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-full bg-accent px-1.5 text-accent-fg">
      <button type="button" onClick={toggle} disabled={!url} aria-label={ct(playing ? "tgvoice.preview_pause" : "tgvoice.preview_play")} className={`${ROUND} size-9`}>
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-fg/20">
          {playing ? <Pause aria-hidden="true" className="size-4 fill-current" /> : <Play aria-hidden="true" className="size-4 fill-current" />}
        </span>
      </button>
      <div aria-hidden="true" dir="ltr" className="flex h-7 min-w-0 flex-1 items-center gap-px overflow-hidden">
        {barsFor(take.peaks, PLAY_BARS).map((p, i) => (
          <span key={i} className={`w-[3px] shrink-0 grow rounded-full ${i / PLAY_BARS < at ? "bg-accent-fg" : "bg-accent-fg/50"}`} style={{ height: `${Math.max(12, p)}%` }} />
        ))}
      </div>
      <span dir="ltr" className="shrink-0 pe-2 text-xs font-semibold tabular-nums">
        {formatDuration(take.durationMs)}
      </span>
      <audio
        ref={audio}
        src={url ?? undefined}
        preload="auto"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        // a recorder's own file may not know its length: the recorded time says it
        onTimeUpdate={(e) => setAt(seconds > 0 ? Math.min(1, e.currentTarget.currentTime / seconds) : 0)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
      />
    </div>
  );
}

function Preview({ take, canResume, tg, onSend }: { take: VoiceTake; canResume: boolean; tg: TgVoiceView; onSend: () => void }) {
  const { words, ask } = useTakeWords(take, tg);
  return (
    <div className="flex flex-col gap-1.5" aria-label={ct("tgvoice.preview_label")} role="group">
      <div className={canResume ? "pe-14" : undefined}>
        <TakeWordsView words={words} onAsk={ask} />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-1 rounded-[26px] bg-surface-1 pe-1.5 ps-1 shadow-card">
          <button type="button" data-take-trash onClick={() => tg.discard("trash")} aria-label={ct("tgvoice.trash")} className={`${ROUND} size-11 text-fg-muted`}>
            <Bin />
          </button>
          <PreviewPlayer take={take} />
        </div>
        <div className="relative flex size-[46px] shrink-0 items-center justify-center">
          {canResume ? (
            <button type="button" data-take-resume onClick={tg.resume} aria-label={ct("tgvoice.resume")} title={ct("tgvoice.resume")} className={`${ROUND} tg-rec-swap absolute bottom-[56px] size-10 bg-surface-1 text-accent shadow-card`}>
              <Mic aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          <button type="button" data-take-send onClick={onSend} aria-label={ct("chat.f.send_recording")} className={ROUND_BUTTON}>
            <Send aria-hidden="true" className="size-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TgRecordBar({ voice, error, live, tg, onSend }: TgRecordBarProps) {
  const root = React.useRef<HTMLDivElement | null>(null);
  const moving = useEffectOn("transitions");
  const phase = tgPhaseOf(voice);
  const { drag } = tg;
  // the gear opens the settings OVER the recording (going to the settings page would close the conversation and lose the take); the sheet lives here, so
  // switching the live words off inside it does not take it away with them
  const [settings, setSettings] = React.useState(false);
  React.useEffect(() => {
    const write = () => {
      const el = root.current;
      if (!el) return;
      const at = drag.get();
      el.style.setProperty("--tg-dx", `${at.dx}px`);
      el.style.setProperty("--tg-cancel", String(at.cancel));
      el.style.setProperty("--tg-up", `${at.up}px`);
      el.style.setProperty("--tg-lock", String(at.lock));
    };
    write();
    return drag.subscribe(write);
  }, [drag, phase]);

  const shell = (children: React.ReactNode) => (
    <div
      ref={root}
      data-tg-record={phase}
      data-recording={voice.mode}
      className="tg-rec-in relative mx-auto flex w-full max-w-[904px] select-none flex-col gap-1.5 [-webkit-touch-callout:none]"
      style={tgMotionVars(MOTION_VARS) as React.CSSProperties}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
      {error ? <p role="alert">{error}</p> : null}
      {settings ? (
        <Sheet open onOpenChange={setSettings}>
          <SheetContent aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle>{ct("settingsMe.s.speech")}</SheetTitle>
            </SheetHeader>
            <SheetBody className="px-0">
              <SpeechSection serviceReady={tg.transcribe} liveAllowed={tg.liveAllowed} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );

  if (voice.mode === "paused" || voice.mode === "review") {
    return shell(<Preview key={voice.mode} take={voice.take} canResume={voice.mode === "paused"} tg={tg} onSend={onSend} />);
  }

  if (voice.mode === "cancelling") {
    // the slide's dust is shorter than the trash's: the lid opens and closes within whichever it is
    const ms = voice.from === "trash" ? TG_MOTION.voiceDustMs : TG_MOTION.cancelDustMs;
    return shell(
      <div className="relative flex min-h-[52px] items-center rounded-[26px] bg-surface-1 ps-1 shadow-card" role="status" aria-label={ct("tgvoice.cancelling")} style={{ "--tg-voice-dust-ms": `${ms}ms` } as React.CSSProperties}>
        <span className="relative z-10 flex size-11 items-center justify-center text-accent">
          <Bin open />
        </span>
        {/* the bin sits at the start of the row, which is its right end on this right-to-left screen */}
        <VoiceDust ms={ms} toRight />
      </div>,
    );
  }

  const holding = phase === "hold";
  const level = voice.peaks.length ? voice.peaks[voice.peaks.length - 1]! : 0;
  return shell(
    <>
      {!holding && live && live.supported ? <LivePanel live={live} tg={tg} onSettings={() => setSettings(true)} /> : null}
      <div className="flex items-end gap-2">
        <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-[26px] bg-surface-1 ps-4 shadow-card">
          <span aria-hidden="true" data-rec-dot className="tg-rec-blink size-2.5 shrink-0 rounded-full bg-danger" />
          <span role="timer" aria-live="off" dir="ltr" className="w-16 shrink-0 text-sm tabular-nums text-fg">
            {formatRecordTime(voice.elapsedMs)}
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden pe-6">
            {holding ? (
              <span data-slide-cancel className="whitespace-nowrap text-sm text-fg-muted" style={{ transform: "translateX(calc(var(--tg-dx, 0px) * 0.6))", opacity: "calc(1 - var(--tg-cancel, 0))" }}>
                {ct("tgvoice.slide_cancel")}
              </span>
            ) : (
              <button type="button" data-rec-cancel onClick={() => tg.discard("trash")} className="min-h-11 rounded-full px-4 text-sm font-bold text-accent">
                {ct("tgvoice.cancel")}
              </button>
            )}
          </div>
        </div>
        <div className="relative flex size-[46px] shrink-0 items-center justify-center">
          {holding ? (
            <>
              <div data-lock-pill className="tg-rec-lock-in pointer-events-none absolute bottom-[78px] flex flex-col items-center">
                <span className="flex h-[68px] w-10 flex-col items-center justify-center gap-1 rounded-full bg-surface-1 text-fg-muted shadow-lg" style={{ transform: "translateY(calc(var(--tg-up, 0px) * -0.35))" }}>
                  <Lock aria-hidden="true" className="size-5" />
                  <ChevronUp aria-hidden="true" className="size-4" />
                </span>
              </div>
              <p data-lock-hint className="tg-rec-lock-in pointer-events-none absolute bottom-[96px] end-0 me-12 whitespace-nowrap rounded-full bg-surface-1 px-3 py-1 text-xs text-fg-muted shadow-card">
                {ct("tgvoice.slide_lock")}
              </p>
            </>
          ) : (
            <button type="button" data-rec-pause onClick={tg.pause} aria-label={ct("tgvoice.pause")} title={ct("tgvoice.pause")} className={`${ROUND} tg-rec-lock-in absolute bottom-[68px] size-10 bg-surface-1 text-fg-muted shadow-card`}>
              <Pause aria-hidden="true" className="size-5 fill-current" />
            </button>
          )}
          {/* the circle follows the finger, and shrinks as it nears the cancel */}
          <div data-mic-circle className="absolute flex items-center justify-center" style={{ transform: "translate(var(--tg-dx, 0px), calc(var(--tg-up, 0px) * -0.3)) scale(calc(1 - var(--tg-cancel, 0) * 0.35))" }}>
            <div className="tg-rec-circle-in relative flex size-[76px] items-center justify-center">
              <span aria-hidden="true" data-mic-level className="tg-rec-level absolute inset-0 rounded-full bg-accent/25" style={{ transform: `scale(${moving ? levelScale(level) : 1})` }} />
              {holding ? (
                <span className="relative flex size-[76px] items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg">
                  <Mic aria-hidden="true" className="size-8" />
                </span>
              ) : (
                <button type="button" data-rec-send onClick={onSend} aria-label={ct("chat.f.send_recording")} className={cn(ROUND_BUTTON, "relative size-[76px] shadow-lg")}>
                  <Send aria-hidden="true" className="tg-rec-swap size-8" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {ct(holding ? "chat.f.recording" : "chatui.composer.record_locked")}
      </p>
    </>,
  );
}
