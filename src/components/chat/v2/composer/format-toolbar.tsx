"use client";

import React from "react";
import { Bold, Code, EyeOff, Italic, Link2, Strikethrough, type LucideIcon } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { FORMAT_ACTIONS, FORMAT_SHORTCUTS, type FormatAction } from "@/lib/chat/v2/composer/format-keys";

const ICONS: Record<FormatAction, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code,
  spoiler: EyeOff,
  link: Link2,
};

/**
 * C3b.1 — the small bar that appears over the composer while words are selected: bold, italic, strike, code, hidden, link. It only reports the pressed action
 * (`onAction`); the surface applies it with `applyFormat`. A press must not take the focus (or the selection) away from the box, so `mousedown` is cancelled.
 * Every button has its Arabic name and, in the tooltip, its shortcut (Ctrl and the letter are the only Latin on this screen).
 */
export function FormatToolbar({ onAction }: { onAction: (action: FormatAction) => void }) {
  return (
    <div role="toolbar" aria-label={ct("chatfmt.toolbar")} data-format-toolbar className="absolute bottom-full z-10 mb-1 flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-card">
      {FORMAT_ACTIONS.map((action) => {
        const Icon = ICONS[action];
        const label = ct(`chatfmt.act.${action}`, { keys: FORMAT_SHORTCUTS[action] });
        return (
          <button
            key={action}
            type="button"
            data-format={action}
            aria-label={label}
            title={label}
            className="flex size-8 items-center justify-center rounded-lg text-fg hover:bg-surface-2"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAction(action)}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
