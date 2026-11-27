"use client";

import React from "react";
import { Pause, Play, X } from "lucide-react";
import { VOICE_SPEED_CHOICES, type VoiceSpeed } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { dayLabelOf } from "@/lib/chat/day-separator";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { SPEED_HOLD_SLOP_PX, SPEED_NAME_KEYS, speedAtStep, stepOfSpeed } from "@/lib/chat/v2/pane/voice-speed-menu";
import { voiceSpeedLabel, type VoiceNote } from "@/lib/chat/voice-queue";
import { fmtTime } from "@/lib/format";
import "@/components/chat/tg-voice.css";

/** The speeds under a long press of the chip: a slider over the six, then each with its name (the chosen one marked). */
export function TgSpeedMenu({ speed, onPick, onClose }: { speed: VoiceSpeed; onPick: (speed: VoiceSpeed) => void; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div aria-hidden="true" data-speed-dim className="tg-speed-dim fixed inset-0 z-40 bg-scrim/20" onClick={onClose} />
      <div role="dialog" aria-label={ct("tgvoice.speed_menu")} data-speed-menu className="tg-speed-menu absolute end-2 top-full z-50 mt-1 w-56 origin-top rounded-2xl bg-surface-1 py-2 text-fg shadow-lg ring-1 ring-border">
        <div className="flex items-center gap-3 px-4 pb-2">
          <input
            type="range"
            dir="ltr"
            min={0}
            max={VOICE_SPEED_CHOICES.length - 1}
            step={1}
            value={stepOfSpeed(speed)}
            onChange={(event) => onPick(speedAtStep(Number(event.currentTarget.value)))}
            aria-label={ct("tgvoice.speed_slider")}
            aria-valuetext={voiceSpeedLabel(speed)}
            className="h-8 min-w-0 flex-1 accent-accent"
          />
          <span dir="ltr" className="w-9 shrink-0 text-sm font-bold tabular-nums">
            {voiceSpeedLabel(speed)}
          </span>
        </div>
        <ul>
          {VOICE_SPEED_CHOICES.map((choice) => (
            <li key={choice}>
              <button
                type="button"
                data-speed-choice={choice}
                aria-pressed={choice === speed}
                onClick={() => {
                  onPick(choice);
                  onClose();
                }}
                className={`flex min-h-11 w-full items-center gap-3 px-4 text-start text-sm hover:bg-surface-2 ${choice === speed ? "font-bold text-accent" : "text-fg"}`}
              >
                <span className="min-w-0 flex-1 truncate">{ct(SPEED_NAME_KEYS[choice])}</span>
                <span dir="ltr" className="shrink-0 tabular-nums">
                  {voiceSpeedLabel(choice)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export interface TgVoiceBarProps {
  note: VoiceNote;
  playing: boolean;
  /** 0..1 */
  at: number;
  speed: VoiceSpeed;
  onToggle: () => void;
  onJump: () => void;
  /** a tap on the chip: the next speed */
  onSpeed: () => void;
  /** a speed picked in the menu */
  onPickSpeed: (speed: VoiceSpeed) => void;
  onStop: () => void;
  /** (a test draws the menu open) */
  initialMenu?: boolean;
}

/**
 * «تيليجرام على التلفون» (`tgPhone`) — the bar under the header while a note plays: pause, who sent it («أنت» for my own) with when, the speed chip (a tap
 * goes round, a long press or the context key opens every speed), ✕, and the progress line. A tap on the words goes to the note. It only draws.
 */
export function TgVoiceBar({ note, playing, at, speed, onToggle, onJump, onSpeed, onPickSpeed, onStop, initialMenu = false }: TgVoiceBarProps) {
  const [menu, setMenu] = React.useState(initialMenu);
  const press = React.useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  /** the press that opened the menu must not also be a tap */
  const held = React.useRef(false);
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  React.useEffect(() => endPress, []);
  const closeMenu = React.useCallback(() => {
    held.current = false; // the next press of the chip is a tap again, also one from the keyboard
    setMenu(false);
  }, []);
  const when = note.sentAt ? ct("tgvoice.bar_when", { day: dayLabelOf(note.sentAt), time: fmtTime(note.sentAt) }) : "";
  const percent = Math.round(Math.max(0, Math.min(1, at)) * 100);
  return (
    <div data-voice-mini data-tg-voice-bar role="group" aria-label={ct("chatvoice.mini")} className="relative flex min-h-11 items-center border-b border-border bg-surface-1 px-1" style={tgMotionVars(["menuDimMs", "menuScaleMs"]) as React.CSSProperties}>
      <button type="button" onClick={onToggle} aria-label={ct(playing ? "chat.f.pause" : "chat.f.play")} className="flex size-11 shrink-0 items-center justify-center rounded-full text-accent">
        {playing ? <Pause aria-hidden="true" className="size-5 fill-current" /> : <Play aria-hidden="true" className="size-5 fill-current" />}
      </button>
      <button type="button" data-voice-mini-jump onClick={onJump} aria-label={ct("chatvoice.jump")} className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-start">
        <span className="max-w-[55%] shrink-0 truncate text-sm font-bold">{note.mine ? ct("tgvoice.bar_you") : note.authorName}</span>
        <span className="min-w-0 truncate text-xs text-fg-muted">{when}</span>
      </button>
      <button
        type="button"
        data-voice-speed={speed}
        aria-label={ct("chatvoice.speed", { speed: voiceSpeedLabel(speed) })}
        aria-haspopup="dialog"
        aria-expanded={menu}
        className="flex min-h-11 min-w-11 shrink-0 select-none items-center justify-center [-webkit-touch-callout:none]"
        onPointerDown={(event) => {
          held.current = false;
          endPress();
          press.current = {
            x: event.clientX,
            y: event.clientY,
            timer: setTimeout(() => {
              press.current = null;
              held.current = true;
              setMenu(true);
            }, TG_MOTION.speedHoldMs),
          };
        }}
        onPointerMove={(event) => {
          if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > SPEED_HOLD_SLOP_PX) endPress();
        }}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={(event) => {
          event.preventDefault();
          endPress();
          held.current = true;
          setMenu(true);
        }}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          onSpeed();
        }}
      >
        <span dir="ltr" className="rounded-md border-2 border-accent px-1 text-xs font-bold leading-4 tabular-nums text-accent">
          {voiceSpeedLabel(speed)}
        </span>
      </button>
      <button type="button" data-voice-mini-stop onClick={onStop} aria-label={ct("chatvoice.stop")} className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted">
        <X aria-hidden="true" className="size-5" />
      </button>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={ct("chatvoice.mini")} className="absolute inset-x-0 bottom-0 h-0.5 bg-fg-muted/20">
        <div className="h-full origin-right bg-accent" style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      {menu ? <TgSpeedMenu speed={speed} onPick={onPickSpeed} onClose={closeMenu} /> : null}
    </div>
  );
}
