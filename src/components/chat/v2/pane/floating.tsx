"use client";

import React from "react";
import { ArrowDown, AtSign } from "lucide-react";
import { ct, ctCount } from "@/lib/chat/text";
import { MENTIONS_FORMS, counted } from "@/lib/chat/v2/pane/plural";
import type { DownButton, MentionsButton } from "@/lib/chat/v2/pane/jump-model";

/**
 * C2.4 — what floats over the viewport: the date of the top visible message (the sticky chip) and the two round buttons at the bottom END (the left, in
 * this right-to-left layout — also on the phone).
 */

/** The date of the top visible message, floating at the top; it shows while the person scrolls and fades after a moment (never under reduced motion: it just goes). */
export function StickyDateChip({ label, visible }: { label: string | null; visible: boolean }) {
  if (!label) return null;
  return (
    <div aria-hidden="true" data-sticky-date className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <span className={`rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-fg-muted shadow-sm transition-opacity duration-150 motion-reduce:transition-none ${visible ? "opacity-100" : "opacity-0"}`}>{label}</span>
    </div>
  );
}

const round = "relative inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-border bg-surface text-accent shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none";

/**
 * «↓» with the unread counter (the number of new messages), or «آخر الرسائل» when only the windows do not reach the newest one; «@» with the number of
 * unread mentions, going to the next one at each press. Nothing is drawn when there is nothing to go to.
 */
export function JumpButtons({ down, mentions, onDown, onMention }: { down: DownButton; mentions: MentionsButton; onDown: () => void; onMention: () => void }) {
  if (!down.show && !mentions.show) return null;
  return (
    <div data-jump-buttons className="absolute bottom-3 end-3 z-10 flex flex-col items-center gap-2">
      {mentions.show ? (
        <button type="button" data-jump-mentions aria-label={counted(MENTIONS_FORMS, mentions.count)} onClick={onMention} className={`${round} min-w-11 px-2`}>
          <AtSign aria-hidden="true" className="size-5" />
          <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">{mentions.count}</span>
        </button>
      ) : null}
      {down.show ? (
        <button type="button" data-jump-down={down.kind} aria-label={down.kind === "unread" ? ctCount("chatc.new_below", down.count) : ct("chatui.pane.jump_newest")} onClick={onDown} className={`${round} px-3 text-sm font-semibold`}>
          <ArrowDown aria-hidden="true" className="size-5" />
          {down.kind === "unread" ? <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">{down.count}</span> : <span>{ct("chatui.pane.jump_newest")}</span>}
        </button>
      ) : null}
    </div>
  );
}
