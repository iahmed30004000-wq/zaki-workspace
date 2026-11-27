"use client";

import React from "react";
import { useEffectOn } from "@/lib/motion/use-effect-on";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * «صور متحركة» — how a GIF is drawn. It plays by itself while «تشغيل الصور المتحركة وحدها» is on for this device and the device does not ask for less motion
 * (`effectOn("gifs")`); otherwise only its FIRST picture is drawn, on a canvas (an `<img>` of a GIF cannot be stopped), with a «متحركة» mark, and it moves only because the
 * person asked: a tap.
 */

/** The first picture of a GIF: drawing an animated image onto a canvas draws its first frame, once. */
export function GifStill({ src, className }: { src: string; className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    let live = true;
    const picture = new Image();
    picture.decoding = "async";
    picture.onload = () => {
      const board = canvas.current;
      if (!live || !board) return;
      board.width = picture.naturalWidth;
      board.height = picture.naturalHeight;
      board.getContext("2d")?.drawImage(picture, 0, 0);
    };
    picture.src = src;
    return () => {
      live = false;
      picture.onload = null;
    };
  }, [src]);
  return <canvas ref={canvas} aria-hidden="true" data-gif-still="" className={cn("size-full object-cover", className)} />;
}

export function GifBadge() {
  return <span className="pointer-events-none absolute start-1.5 top-1.5 rounded-full bg-scrim/60 px-2 py-0.5 text-xs font-semibold text-on-photo">{ct("gifs.badge")}</span>;
}

/** A GIF where a small picture is wanted (an album's cell, the picker, a grid): it moves only where it may move by itself. */
export function GifThumb({ src, alt }: { src: string; alt: string }) {
  const moves = useEffectOn("gifs");
  if (moves) {
    // eslint-disable-next-line @next/next/no-img-element -- our own address of a private file: next/image would need a loader for it
    return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} data-gif="playing" className="size-full object-cover" />;
  }
  return (
    <span data-gif="still" className="relative block size-full" role={alt ? "img" : undefined} aria-label={alt || undefined}>
      <GifStill src={src} />
      <GifBadge />
    </span>
  );
}

/**
 * A GIF that stands alone in a bubble. Moving: the plain picture (and, where the screen has a viewer, a tap opens it). Still: a tap makes it move, in place; the tap after
 * that opens the viewer.
 */
export function GifPicture({ src, name, width, height, onOpen }: { src: string; name: string; width: number; height: number; /** open the media viewer; absent: this screen has none */ onOpen?: () => void }) {
  const moves = useEffectOn("gifs");
  const [asked, setAsked] = React.useState(false);
  if (!moves && !asked) {
    return (
      <button type="button" data-gif="still" aria-label={ct("gifs.play", { name })} onClick={() => setAsked(true)} className="relative block size-full">
        <GifStill src={src} />
        <GifBadge />
      </button>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- our own attachment address, already boxed from its own size
  const picture = <img src={src} alt={name} loading="lazy" width={width} height={height} data-gif="playing" className="size-full object-cover" />;
  if (!onOpen) return picture;
  return (
    <button type="button" className="block size-full" aria-label={ct("chatalb.open", { name })} onClick={onOpen}>
      {picture}
    </button>
  );
}
