import React from "react";
import { cn } from "@/lib/utils";
import { ct } from "@/lib/chat/text";

/**
 * The face of a group of topics: its picture when it has one (`/api/avatars/<id>`, lazy, never dragged), else its emoji, else the folder. One place so the list row, the group's
 * own pane, the arrange sheet and the edit dialog draw the same circle. The name is already written beside it, so the picture carries no alt text of its own.
 */
export function GroupFace({ emoji, imageUrl, fallback, className }: { emoji: string | null; imageUrl: string | null; fallback: string; className?: string }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a private, already-small picture behind the app's own door; next/image would only proxy it
      <img src={imageUrl} alt={ct("chatgrp.picture_alt")} data-group-image="" loading="lazy" decoding="async" draggable={false} className={cn("shrink-0 rounded-full bg-surface-2 object-cover", className)} />
    );
  }
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-surface-2", className)}>
      {emoji ?? fallback}
    </span>
  );
}
