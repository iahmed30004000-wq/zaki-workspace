"use client";

import React from "react";
import { Bookmark, Check } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ForwardTargetDto } from "@/lib/chat/forward";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/** The circle of a target: the saved chat's bookmark, a person's picture or initials, a topic's emoji (initials of its title when it has none). */
export function TargetAvatar({ target, className }: { target: ForwardTargetDto; className?: string }) {
  if (target.kind === "SAVED") {
    return (
      <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-fg", className)}>
        <Bookmark className="size-5" />
      </span>
    );
  }
  if (target.kind === "TOPIC" && target.emoji) {
    return (
      <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-xl", className)}>
        {target.emoji}
      </span>
    );
  }
  return <Avatar name={target.title || "?"} src={target.avatarUrl} className={cn("size-11 text-sm", className)} />;
}

/** The words under a target's name: the saved chat's note, a topic's space, a private chat's space (or just «محادثة خاصة»), «مجموعة». */
export function targetSubtitle(target: ForwardTargetDto): string {
  if (target.kind === "SAVED") return ct("chatfwd.saved_hint");
  if (target.kind === "TOPIC") return target.spaceName ?? "";
  if (target.kind === "GROUP") return ct("chatfwd.sub.group");
  return target.spaceName ?? ct("chatfwd.sub.dm");
}

/** One row of the list: the circle, the name, the line under it, and a round check at the end. A press picks or unpicks (up to the cap: a full pick leaves the others disabled). */
export function TargetRow({ target, picked, disabled, onToggle }: { target: ForwardTargetDto; picked: boolean; disabled: boolean; onToggle: (id: string) => void }) {
  const title = target.kind === "SAVED" ? ct("chatfwd.saved") : target.title;
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        disabled={disabled && !picked}
        data-forward-target={target.id}
        data-forward-kind={target.kind}
        onClick={() => onToggle(target.id)}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-start hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
      >
        <TargetAvatar target={target} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          {targetSubtitle(target) ? <span className="block truncate text-xs text-fg-muted">{targetSubtitle(target)}</span> : null}
        </span>
        <span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", picked ? "border-accent bg-accent text-accent-fg" : "border-muted bg-surface")}>
          {picked ? <Check className="size-4" /> : null}
        </span>
      </button>
    </li>
  );
}

/** One of the recents' strip: the circle with the name under it; picked, it wears the accent ring and a check. */
export function RecentChip({ target, picked, disabled, onToggle }: { target: ForwardTargetDto; picked: boolean; disabled: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={picked}
      disabled={disabled && !picked}
      data-forward-recent={target.id}
      onClick={() => onToggle(target.id)}
      className="relative flex w-16 shrink-0 flex-col items-center gap-1 rounded-lg py-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className={cn("relative rounded-full", picked && "ring-2 ring-accent ring-offset-2 ring-offset-surface-1")}>
        <TargetAvatar target={target} />
        {picked ? (
          <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 grid size-5 place-items-center rounded-full bg-accent text-accent-fg">
            <Check className="size-3.5" />
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-center text-xs">{target.kind === "SAVED" ? ct("chatfwd.saved") : target.title}</span>
    </button>
  );
}
