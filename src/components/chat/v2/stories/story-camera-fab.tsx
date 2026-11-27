"use client";

import React from "react";
import { Camera, ImageIcon, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ct } from "@/lib/chat/text";

export type StoryPick = "photo" | "video" | "gallery";

/** The three ways a story starts on a phone: its camera for a picture or a video, or something already on it. */
export function StoryPickItems({ onPick }: { onPick: (from: StoryPick) => void }) {
  return (
    <>
      <DropdownMenuItem onSelect={() => onPick("photo")}>
        <Camera aria-hidden="true" className="size-4" /> {ct("tgstories.pick.photo")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onPick("video")}>
        <Video aria-hidden="true" className="size-4" /> {ct("tgstories.pick.video")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onPick("gallery")}>
        <ImageIcon aria-hidden="true" className="size-4" /> {ct("tgstories.pick.gallery")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Telegram's small round camera above the «new message» button of the phone's chat list: it posts a story. Where it stands is the
 * stylesheet's (`stories.css`): above the pencil, over the tab bar's room, and out of the way while the list scrolls down.
 */
export function StoryCameraFab({ onPick }: { onPick: (from: StoryPick) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="fab"
          data-story-camera=""
          aria-label={ct("tgstories.camera")}
          title={ct("tgstories.camera")}
          // the pencil is 56 px from the end's 1rem; this is 44 px, centred over it
          className="absolute end-[1.375rem] z-20 size-11 border border-border bg-surface-1 text-fg hover:bg-surface-2 md:hidden"
        >
          <Camera className="size-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="z-[60]">
        <StoryPickItems onPick={onPick} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
