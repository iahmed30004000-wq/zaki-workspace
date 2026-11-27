"use client";

import React from "react";
import { Play, VolumeX } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { VIDEO_NOTE_PX } from "@/lib/chat/v2/video-note/limits";
import { clockOf } from "@/lib/chat/v2/video-note/model";
import { leaveNote, previewRuns, takeTheSound, tapNote, type NoteSound } from "@/lib/chat/v2/video-note/playback";
import { voiceEngine } from "@/lib/chat/voice-queue";
import { useEffectOn } from "@/lib/motion/use-effect-on";

const RADIUS = 49;
const AROUND = 2 * Math.PI * RADIUS;

/**
 * «رسالة فيديو دائرية» in a bubble: a circle. Muted and by itself while it is on the screen (never against the effects choice or a
 * request for less motion: then it waits for a tap); a tap gives it sound from the start with the ring of its length, a tap again
 * pauses. One sounds at a time, and never over a voice note. The rules are `playback.ts`.
 */
export function VideoNoteBubble({ src, durationMs }: { src: string; durationMs?: number }) {
  const autoplay = useEffectOn("stickers");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const boxRef = React.useRef<HTMLButtonElement | null>(null);
  const [sound, setSound] = React.useState<NoteSound>("muted");
  // until an observer says otherwise a bubble is not on the screen: nothing downloads and plays for a row far down the log
  const [visible, setVisible] = React.useState(false);
  const [pageShown, setPageShown] = React.useState(true);
  const [at, setAt] = React.useState(0);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver((entries) => setVisible((entries[entries.length - 1]?.intersectionRatio ?? 0) >= 0.5), { threshold: [0, 0.5] });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);
  React.useEffect(() => {
    const onVisibility = () => setPageShown(document.visibilityState !== "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // leaving the screen (or the page) takes the sound back; a bubble that never had an observer's answer keeps what the tap gave it
  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible) wasVisible.current = true;
    if (!wasVisible.current && pageShown) return;
    setSound((was) => leaveNote(was, { visible, pageShown }));
  }, [visible, pageShown]);

  const run = (el: HTMLVideoElement, onRefused?: () => void) => void Promise.resolve(el.play()).catch(() => onRefused?.());
  const preview = previewRuns(sound, { visible, pageShown, autoplay });
  React.useEffect(() => {
    const el = videoRef.current;
    if (!el || sound !== "muted") return;
    el.muted = true;
    el.loop = true;
    if (preview) run(el);
    else el.pause();
  }, [preview, sound]);

  // the one that sounds: it stops the note that sounded before it, and a voice note that starts stops it
  React.useEffect(() => {
    if (sound === "muted") return;
    const giveBack = takeTheSound(() => setSound("muted"));
    const offVoice = voiceEngine.subscribe(() => {
      if (voiceEngine.getSnapshot().playing) setSound("muted");
    });
    return () => {
      giveBack();
      offVoice();
    };
  }, [sound]);

  const tap = () => {
    const el = videoRef.current;
    const next = tapNote(sound);
    setSound(next);
    if (!el) return;
    if (next === "paused") return el.pause();
    voiceEngine.pause();
    if (sound === "muted") {
      el.currentTime = 0;
      setAt(0);
    }
    el.muted = false;
    el.loop = false;
    // inside the tap itself: a phone lets sound start only there
    run(el, () => setSound("paused"));
  };

  const length = durationMs ?? 0;
  const share = sound === "muted" || length <= 0 ? 0 : Math.min(1, at / length);
  return (
    <button
      ref={boxRef}
      type="button"
      data-video-note={sound}
      aria-label={ct(sound === "playing" ? "tgstories.videonote.pause" : "tgstories.videonote.play")}
      onClick={(event) => {
        // the tap is the video's: on a phone a tap on the bubble opens its menu
        event.stopPropagation();
        tap();
      }}
      className="relative my-1 block max-w-full rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ width: VIDEO_NOTE_PX, aspectRatio: "1 / 1" }}
    >
      <span className="absolute inset-0 overflow-hidden rounded-full bg-surface-2">
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          onTimeUpdate={(event) => setAt(event.currentTarget.currentTime * 1000)}
          onEnded={() => {
            setSound("muted");
            setAt(0);
          }}
          className="pointer-events-none size-full object-cover"
        />
      </span>
      {sound !== "muted" ? (
        <svg viewBox="0 0 100 100" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full -rotate-90">
          <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-accent" strokeDasharray={AROUND} strokeDashoffset={AROUND * (1 - share)} />
        </svg>
      ) : null}
      {sound === "paused" || (sound === "muted" && !preview) ? (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-scrim/60 text-on-photo">
            <Play className="size-6" />
          </span>
        </span>
      ) : null}
      <span className="absolute bottom-2 start-1/2 flex items-center gap-1 rounded-full bg-scrim/60 px-2 py-0.5 text-xs text-on-photo ltr:-translate-x-1/2 rtl:translate-x-1/2">
        <span dir="ltr">{clockOf(sound === "muted" ? length : Math.max(0, length - at))}</span>
        {sound === "muted" ? <VolumeX aria-hidden="true" className="size-3.5" /> : null}
      </span>
    </button>
  );
}
