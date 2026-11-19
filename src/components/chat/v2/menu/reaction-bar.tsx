"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { ct } from "@/lib/chat/text";

/**
 * C2.6 — the quick reactions on top of the message menu: six emojis and «⌄», which opens the full picker. A press toggles the reaction through the pane's
 * `react` command (the existing react route; the server decides again, and the owner reading silently has no menu at all).
 */
export function ReactionBar({ emojis, onPick, onMore }: { emojis: readonly string[]; onPick: (emoji: string) => void; onMore: () => void }) {
  return (
    <div role="group" aria-label={ct("chatc.menu.react")} data-reaction-bar className="flex items-center justify-between gap-0.5 px-1 py-1">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          data-quick-reaction={emoji}
          aria-label={`${ct("chatc.menu.react")} ${emoji}`}
          onClick={() => onPick(emoji)}
          className="flex size-10 items-center justify-center rounded-full text-xl hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        data-reaction-more
        aria-label={ct("chatui.menu.react_more")}
        onClick={onMore}
        className="flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronDown aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
