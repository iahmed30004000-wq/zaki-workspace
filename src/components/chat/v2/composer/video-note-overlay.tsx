"use client";

import React from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Send, Trash2 } from "lucide-react";
import { ROUND_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { ct } from "@/lib/chat/text";
import { clockOf, ringShare } from "@/lib/chat/v2/video-note/model";
import type { VideoNoteEngine } from "@/lib/chat/v2/video-note/use-video-note";
import { useEffectOn } from "@/lib/motion/use-effect-on";
import { cn } from "@/lib/utils";

/** What the overlay reads of the engine (a test builds one by hand). */
export type OverlayEngine = Pick<VideoNoteEngine, "state" | "stream" | "send" | "cancel" | "error">;

const RADIUS = 48;
const AROUND = 2 * Math.PI * RADIUS;

/**
 * What is drawn while a round video message is made: the circle (the camera, mirrored as a mirror shows a face; after the take, the take
 * itself to watch), the ring of the minute, the clock, and — once the finger is free — «احذف» and «ابعت». While a finger holds the camera
 * button it only says how to cancel and how to lock: that touch is followed on the window by the engine.
 */
export function VideoNoteSurface({ v }: { v: OverlayEngine }) {
  const { state } = v;
  const moving = useEffectOn("transitions");
  const liveRef = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const el = liveRef.current;
    if (!el) return;
    el.srcObject = v.stream;
    if (v.stream) void Promise.resolve(el.play()).catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [v.stream]);
  const take = state.mode === "review" || state.mode === "sending" ? state.take : null;
  const [takeUrl, setTakeUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!take) return setTakeUrl(null);
    const made = URL.createObjectURL(take.blob);
    setTakeUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [take]);
  if (state.mode === "idle") return null;
  const held = (state.mode === "recording" || state.mode === "starting") && !state.locked;
  const elapsed = state.mode === "recording" ? state.elapsedMs : (take?.durationMs ?? 0);
  return (
    // a portal's touches still bubble through React's tree: they stop here, so the conversation under it never reads them as its own swipe
    <div onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={ct("tgstories.videonote.title")} data-video-note-overlay={state.mode} dir="rtl" className="fixed inset-0 z-[65] flex select-none flex-col items-center justify-center gap-4 bg-surface/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-fg [-webkit-touch-callout:none]">
      <div className="relative size-[min(76vw,18rem)]">
        <div className="absolute inset-1.5 overflow-hidden rounded-full bg-surface-2">
          {take ? (
            takeUrl ? <video data-video-note-take="" src={takeUrl} controls playsInline preload="metadata" className="size-full object-cover" /> : null
          ) : (
            <video data-video-note-live="" ref={liveRef} muted playsInline autoPlay aria-hidden="true" className="size-full -scale-x-100 object-cover" />
          )}
        </div>
        {state.mode === "recording" ? (
          <svg viewBox="0 0 100 100" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full -rotate-90">
            {/* the ring grows only where movement is wanted; elsewhere it is whole and the clock alone counts */}
            <circle data-video-note-ring="" cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-accent" strokeDasharray={AROUND} strokeDashoffset={moving ? AROUND * (1 - ringShare(elapsed)) : 0} />
          </svg>
        ) : null}
      </div>
      <p className="flex items-center gap-2 text-base font-semibold" role="status">
        {state.mode === "recording" ? <span aria-hidden="true" className="size-2.5 rounded-full bg-danger" /> : null}
        {state.mode === "starting" ? ct("tgstories.videonote.starting") : state.mode === "sending" ? ct("tgstories.videonote.sending", { n: state.percent }) : <span dir="ltr">{clockOf(elapsed)}</span>}
      </p>
      {state.mode === "review" ? <p className="text-center text-sm text-fg-muted">{ct("tgstories.videonote.ready")}</p> : null}
      {v.error ? (
        <p role="alert" className="text-center text-sm text-danger">
          {v.error}
        </p>
      ) : null}
      {held ? (
        <p data-video-note-hint="" className="text-center text-sm text-fg-muted">
          {ct("tgstories.videonote.hold_hint")}
        </p>
      ) : (
        <div className="flex items-center gap-8">
          <button type="button" data-video-note-cancel="" aria-label={ct("tgstories.videonote.cancel")} disabled={state.mode === "sending"} onClick={v.cancel} className="grid size-12 place-items-center rounded-full bg-surface-2 text-danger hover:bg-surface-1 disabled:opacity-50">
            <Trash2 aria-hidden="true" className="size-6" />
          </button>
          <button type="button" data-video-note-send="" aria-label={ct("tgstories.videonote.send")} disabled={state.mode === "sending" || state.mode === "starting"} onClick={v.send} className={cn(ROUND_BUTTON, "size-14")}>
            {state.mode === "sending" ? <LoaderCircle aria-hidden="true" className="size-6 motion-safe:animate-spin" /> : <Send aria-hidden="true" className="size-6" />}
          </button>
        </div>
      )}
    </div>
  );
}

/** The surface on the page itself: the conversation slides on a phone, and anything fixed inside it would slide along. */
export function VideoNoteOverlay({ v }: { v: OverlayEngine }) {
  if (v.state.mode === "idle" || typeof document === "undefined") return null;
  return createPortal(<VideoNoteSurface v={v} />, document.body);
}
