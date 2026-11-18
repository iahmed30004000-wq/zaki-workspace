"use client";

import React from "react";
import { Pin } from "lucide-react";
import { ct } from "@/lib/chat/text";

/**
 * The bar of pinned messages under the header — today's behaviour, unchanged: each tap goes to the next pinned message (newest first) and cycles, like a
 * messaging app. The jump is the history hook's (`around` the message, a 2 s highlight); nothing is drawn when nothing is pinned.
 */
export function PinnedBar({ pins, onJump }: { pins: { id: string; authorName: string; preview: string | null }[]; onJump: (messageId: string) => void }) {
  const [index, setIndex] = React.useState(0);
  if (!pins.length) return null;
  const i = index % pins.length;
  const pin = pins[i]!;
  return (
    <button
      type="button"
      data-pinned-bar
      aria-label={ct("chatc.pinbar.label")}
      onClick={() => {
        onJump(pin.id);
        setIndex(i + 1);
      }}
      className="flex min-h-11 w-full items-center gap-2 border-b border-border bg-surface-1 px-3 py-1 text-start hover:bg-surface-2"
    >
      <Pin aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-accent">
          {ct("chatc.pinbar.label")}
          {pins.length > 1 ? ` · ${ct("chatc.pinbar.count", { i: i + 1, n: pins.length })}` : ""}
        </span>
        <span className="block truncate text-sm">
          {pin.authorName}: {pin.preview ?? ct("chatc.pinbar.empty_preview")}
        </span>
      </span>
    </button>
  );
}
