"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Eye, Pause, Play, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useReturnFocus } from "@/components/ui/dialog";
import { ct, ctCount } from "@/lib/chat/text";
import { tgMotionVars, TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { barFill, keyMoveOf, releaseOf, stepViewer, storyLengthMs, type ViewerMove, type ViewerPlace } from "@/lib/chat/v2/stories/model";
import type { StoryPersonDto, StoryViewerDto } from "@/lib/chat/v2/stories/types";
import { useEffectOn } from "@/lib/motion/use-effect-on";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StoryViewerProps {
  /** the people as they stood when the viewer opened: their order does not move while it is open */
  people: StoryPersonDto[];
  start: ViewerPlace;
  seen: ReadonlySet<string>;
  /** a story of somebody else came on the screen for the first time */
  onSeen: (storyId: string) => void;
  /** «احذف» of my own story: resolves false when the server refused */
  onDelete: (storyId: string) => Promise<boolean>;
  onClose: () => void;
}

const ICON = "grid size-11 shrink-0 place-items-center rounded-full text-on-photo hover:bg-on-photo/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-on-photo";

/**
 * The full-screen viewer: the bars on top (one per story of this person), a tap goes on (back in the third at the reading start), a
 * finger held down pauses, a sideways swipe changes person, a drag down closes; the arrows and the space bar on a computer. It also
 * pauses while the page is hidden and while a sheet of its own is open. The author sees who saw the story and may delete it.
 */
export function StoryViewer({ people: opened, start, seen, onSeen, onDelete, onClose }: StoryViewerProps) {
  const [people, setPeople] = React.useState(opened);
  const [place, setPlace] = React.useState(start);
  const person = people[place.person];
  const story = person?.stories[place.story];
  const [holding, setHolding] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [viewersOpen, setViewersOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteFailed, setDeleteFailed] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  // WHICH story loaded (or failed): a boolean could be set by the new picture before the old one's answer was cleared
  const [readyId, setReadyId] = React.useState<string | null>(null);
  const [brokenId, setBrokenId] = React.useState<string | null>(null);
  const [chrome, setChrome] = React.useState(true);
  const moving = useEffectOn("transitions");
  const returnFocus = useReturnFocus();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const barRef = React.useRef<HTMLSpanElement | null>(null);
  const elapsed = React.useRef(0);
  const ready = story !== undefined && readyId === story.id;
  const broken = story !== undefined && brokenId === story.id;
  const stopped = holding || paused || hidden || viewersOpen || confirming;

  const move = React.useCallback(
    (how: ViewerMove) => {
      const next = stepViewer(people, place, how, seen);
      if (!next) return onClose();
      elapsed.current = 0;
      if (next.person === place.person && next.story === place.story) {
        // «back» on the very first story: it starts again
        if (videoRef.current) videoRef.current.currentTime = 0;
        return;
      }
      setPlace(next);
    },
    [people, place, seen, onClose],
  );
  const live = React.useRef(move);
  live.current = move;
  // a story ends ONCE: the clock and the video's own «ended» both say so, and a late word about the story before must not skip one
  const onScreen = React.useRef<string | null>(null);
  onScreen.current = story?.id ?? null;
  const finished = React.useRef<string | null>(null);
  const finish = React.useCallback((id: string) => {
    if (onScreen.current !== id || finished.current === id) return;
    finished.current = id;
    live.current("next");
  }, []);

  // a new story: its clock, its sheets and its loading start over
  const storyId = story?.id;
  React.useEffect(() => {
    elapsed.current = 0;
    finished.current = null;
    setViewersOpen(false);
    setConfirming(false);
    setDeleteFailed(false);
    setPaused(false);
  }, [storyId]);

  const seenRef = React.useRef(onSeen);
  seenRef.current = onSeen;
  React.useEffect(() => {
    if (story && ready && !person?.mine && !story.seen) seenRef.current(story.id);
  }, [story, ready, person?.mine]);

  React.useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // the video follows the pause; a browser that refuses sound without a fresh touch gets it muted, with the button to turn it on
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stopped) {
      video.pause();
      return;
    }
    void Promise.resolve(video.play()).catch(() => {
      video.muted = true;
      setMuted(true);
      void Promise.resolve(video.play()).catch(() => setPaused(true));
    });
  }, [stopped, storyId, ready]);

  // the clock of the story: a picture's own, a video's player. The bar moves only where movement is wanted
  const barMoves = React.useRef(moving);
  barMoves.current = moving;
  React.useEffect(() => {
    if (!story || stopped || (!ready && !broken)) return;
    let frame = 0;
    let before = performance.now();
    const tick = (now: number) => {
      const video = videoRef.current;
      if (story.kind === "VIDEO" && video && !broken) elapsed.current = video.currentTime * 1000;
      else elapsed.current += now - before;
      before = now;
      const length = broken ? TG_MOTION.storyImageMs : storyLengthMs(story, video?.duration);
      const share = elapsed.current / length;
      if (barRef.current) barRef.current.style.transform = `scaleX(${barMoves.current ? barFill(0, 0, share) : 1})`;
      if (share >= 1) return finish(story.id);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [story, stopped, ready, broken, finish]);

  // ---------- the finger ----------
  const touch = React.useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const chromeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const letGo = () => {
    touch.current = null;
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    setHolding(false);
    setChrome(true);
  };
  React.useEffect(() => () => void (chromeTimer.current && clearTimeout(chromeTimer.current)), []);
  const surface = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (touch.current || event.button > 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
      setHolding(true);
      // a finger that stays takes the words off the picture
      chromeTimer.current = setTimeout(() => setChrome(false), TG_MOTION.storyHoldMs);
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      const from = touch.current;
      if (!from || from.id !== event.pointerId) return;
      letGo();
      const box = event.currentTarget.getBoundingClientRect();
      const gesture = releaseOf({ dx: event.clientX - from.x, dy: event.clientY - from.y, heldMs: event.timeStamp - from.at, x: event.clientX - box.left, width: box.width, rtl: true });
      if (gesture === "close") onClose();
      else if (gesture !== "resume") move(gesture);
    },
    onPointerCancel: letGo,
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("button") && event.key === " ") return;
    const how = keyMoveOf(event.key, true);
    if (!how) return;
    event.preventDefault();
    if (how === "pause") setPaused((was) => !was);
    else move(how);
  };

  const remove = async () => {
    if (!story || deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    const gone = await onDelete(story.id);
    setDeleting(false);
    if (!gone) return setDeleteFailed(true);
    // the story leaves this viewer too; what stood after it takes its place
    const rest = people.map((p, i) => (i === place.person ? { ...p, stories: p.stories.filter((s) => s.id !== story.id) } : p));
    const mine = rest[place.person]!;
    if (mine.stories.length === 0) return onClose();
    setPeople(rest);
    setPlace({ person: place.person, story: Math.min(place.story, mine.stories.length - 1) });
    setConfirming(false);
  };

  if (!person || !story) return null;
  const fade = cn(moving && "transition-opacity", chrome ? "opacity-100" : "pointer-events-none opacity-0");
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-scrim" />
        <DialogPrimitive.Content
          aria-modal="true"
          aria-describedby={undefined}
          data-story-viewer=""
          onKeyDown={onKeyDown}
          onEscapeKeyDown={(event) => {
            // Escape closes what is on top first: the delete question, or the list of who saw it
            if (!confirming && !viewersOpen) return;
            event.preventDefault();
            setConfirming(false);
            setViewersOpen(false);
          }}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          // the focus rests on the viewer itself: on a button, the space bar would press it instead of pausing
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.target as HTMLElement | null)?.focus();
          }}
          className="zk-story-in fixed inset-0 z-[70] flex items-center justify-center focus:outline-none"
          style={{ "--tg-story-open-ms": tgMotionVars(["storyOpenMs"])["--tg-story-open-ms"] } as React.CSSProperties}
        >
          {returnFocus.noteOpener}
          <DialogPrimitive.Title className="sr-only">{ct("tgstories.viewer.title", { name: person.mine ? ct("tgstories.row.mine") : person.name })}</DialogPrimitive.Title>
          <button type="button" data-story-prev="" aria-label={ct("tgstories.viewer.prev")} onClick={() => move("prev")} className={cn(ICON, "me-3 max-md:sr-only")}>
            <ChevronRight aria-hidden="true" className="size-6" />
          </button>
          <div className="relative h-full w-full overflow-hidden bg-scrim md:max-h-[92dvh] md:max-w-[26rem] md:rounded-2xl">
            <div data-story-surface="" className="absolute inset-0 flex touch-none select-none items-center justify-center [-webkit-touch-callout:none]" {...surface}>
              {story.kind === "VIDEO" ? (
                <video
                  key={story.id}
                  ref={videoRef}
                  src={story.url}
                  playsInline
                  muted={muted}
                  preload="auto"
                  onLoadedData={() => setReadyId(story.id)}
                  onEnded={() => finish(story.id)}
                  onError={() => setBrokenId(story.id)}
                  className="pointer-events-none max-h-full w-full object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- our own private story address: next/image would need a loader for it, and must not keep a copy
                <img key={story.id} src={story.url} alt={story.caption || ct("tgstories.viewer.picture", { name: person.name })} draggable={false} onLoad={() => setReadyId(story.id)} onError={() => setBrokenId(story.id)} className="pointer-events-none max-h-full w-full object-contain" />
              )}
            </div>
            {!ready && !broken ? (
              <p role="status" className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-on-photo">
                {ct("tgstories.viewer.loading")}
              </p>
            ) : null}
            {broken ? (
              <p role="alert" className="pointer-events-none absolute inset-x-6 top-1/2 rounded-xl bg-scrim/80 p-3 text-center text-sm text-on-photo">
                {ct("tgstories.viewer.broken")}
              </p>
            ) : null}

            <div className={cn("absolute inset-x-0 top-0 bg-scrim/50 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]", fade)}>
              <div data-story-bars="" aria-hidden="true" className="flex gap-1">
                {person.stories.map((s, index) => (
                  // keyed by the story on screen too: the clock writes the fill straight onto the element, and a re-used one would keep what was written
                  <span key={`${s.id}:${place.story}`} className="h-0.5 flex-1 overflow-clip rounded-full bg-on-photo/30">
                    <span
                      {...(index === place.story ? { ref: barRef, "data-story-bar-now": "" } : {})}
                      className="block size-full rounded-full bg-on-photo ltr:origin-left rtl:origin-right"
                      style={{ transform: `scaleX(${index === place.story ? 0 : barFill(index, place.story, 0)})` }}
                    />
                  </span>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Avatar name={person.name} src={person.avatarUrl} className="size-9" />
                <div className="min-w-0 flex-1 text-on-photo">
                  <p className="truncate text-sm font-semibold">
                    <bdi>{person.mine ? ct("tgstories.row.mine") : person.name}</bdi>
                  </p>
                  <p className="truncate text-xs text-on-photo/80">{fmtAgo(story.createdAt)}</p>
                </div>
                <button type="button" data-story-pause="" aria-label={ct(paused ? "tgstories.viewer.play" : "tgstories.viewer.pause")} onClick={() => setPaused((was) => !was)} className={ICON}>
                  {paused ? <Play aria-hidden="true" className="size-5" /> : <Pause aria-hidden="true" className="size-5" />}
                </button>
                {story.kind === "VIDEO" ? (
                  <button type="button" data-story-sound="" aria-label={ct(muted ? "tgstories.viewer.unmute" : "tgstories.viewer.mute")} onClick={() => setMuted((was) => !was)} className={ICON}>
                    {muted ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}
                  </button>
                ) : null}
                {person.mine ? (
                  <button type="button" data-story-delete="" aria-label={ct("tgstories.viewer.delete")} onClick={() => setConfirming(true)} className={ICON}>
                    <Trash2 aria-hidden="true" className="size-5" />
                  </button>
                ) : null}
                <DialogPrimitive.Close aria-label={ct("tgstories.viewer.close")} className={ICON}>
                  <X aria-hidden="true" className="size-6" />
                </DialogPrimitive.Close>
              </div>
            </div>

            <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3", (story.caption || person.mine) && "bg-scrim/50", fade)}>
              {story.caption ? (
                <p data-story-caption="" dir="auto" className="max-h-32 w-full overflow-y-auto whitespace-pre-wrap break-words text-center text-base text-on-photo">
                  {story.caption}
                </p>
              ) : null}
              {person.mine ? (
                <button type="button" data-story-viewers="" onClick={() => setViewersOpen(true)} className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-scrim/60 px-4 text-sm text-on-photo focus-visible:outline focus-visible:outline-2 focus-visible:outline-on-photo">
                  <Eye aria-hidden="true" className="size-4" />
                  {story.views ? ctCount("tgstories.viewer.views", story.views) : ct("tgstories.viewer.views_none")}
                </button>
              ) : null}
            </div>

            {viewersOpen ? <ViewersSheet storyId={story.id} onClose={() => setViewersOpen(false)} /> : null}
            {confirming ? (
              <div role="alertdialog" aria-label={ct("tgstories.delete.title")} className="absolute inset-x-0 bottom-0 z-10 rounded-t-2xl border-t border-border bg-surface-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-fg">
                <p className="text-base font-semibold">{ct("tgstories.delete.title")}</p>
                <p className="mt-1 text-sm text-fg-muted">{ct("tgstories.delete.hint")}</p>
                {deleteFailed ? (
                  <p role="alert" className="mt-2 text-sm text-danger">
                    {ct("tgstories.delete.failed")}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="danger" data-story-delete-confirm="" disabled={deleting} onClick={() => void remove()} className="flex-1">
                    {ct("tgstories.delete.yes")}
                  </Button>
                  <Button type="button" variant="secondary" autoFocus onClick={() => setConfirming(false)} className="flex-1">
                    {ct("tgstories.cancel")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <button type="button" data-story-next="" aria-label={ct("tgstories.viewer.next")} onClick={() => move("next")} className={cn(ICON, "ms-3 max-md:sr-only")}>
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** «مين شافها» — the author's alone (the server answers nobody else). */
function ViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const [viewers, setViewers] = React.useState<StoryViewerDto[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch(`/api/stories/${encodeURIComponent(storyId)}/viewers`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("viewers");
        return (await response.json()) as { viewers: StoryViewerDto[] };
      })
      .then((answer) => alive && setViewers(answer.viewers))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [storyId]);
  return (
    <div role="region" aria-label={ct("tgstories.viewers.title")} data-story-viewers-sheet="" className="absolute inset-x-0 bottom-0 z-10 flex max-h-[60%] flex-col rounded-t-2xl border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] text-fg">
      <div className="flex items-center gap-2 px-4 py-2">
        <p className="flex-1 text-base font-semibold">{ct("tgstories.viewers.title")}</p>
        <button type="button" autoFocus aria-label={ct("tgstories.viewers.close")} onClick={onClose} className="grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {failed ? (
          <p role="alert" className="py-3 text-sm text-danger">
            {ct("tgstories.viewers.failed")}
          </p>
        ) : viewers === null ? (
          <p role="status" className="py-3 text-sm text-fg-muted">
            {ct("tgstories.viewer.loading")}
          </p>
        ) : viewers.length === 0 ? (
          <p className="py-3 text-sm text-fg-muted">{ct("tgstories.viewers.empty")}</p>
        ) : (
          <ul>
            {viewers.map((viewer) => (
              <li key={viewer.userId} className="flex items-center gap-3 py-2">
                <Avatar name={viewer.name} src={viewer.avatarUrl} />
                <bdi className="min-w-0 flex-1 truncate text-base">{viewer.name}</bdi>
                <span className="shrink-0 text-xs text-fg-muted">{fmtAgo(viewer.viewedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
