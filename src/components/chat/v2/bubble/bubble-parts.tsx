"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { MessageTicks } from "@/components/chat/message/message-item";
import { ct } from "@/lib/chat/text";
import { fmtTime } from "@/lib/format";

/**
 * C2.4 — the small parts of a bubble that carry no decision: the forwarded header, the reply block, the footer and the reaction chips. Each is built
 * from the same words and rules as `message-item.tsx` (and the same dictionary keys), restyled with the theme tokens and logical sides.
 */

/** «محوّلة من فلان». */
export function ForwardedHeader({ name }: { name: string }) {
  return (
    <span data-forwarded className="mb-1 block text-xs font-semibold text-accent">
      {ct("chatui.bubble.forwarded", { name })}
    </span>
  );
}

/** The quote of the message this one answers: a 3 px accent bar, the author, one line of the text; a tap goes to the original (a jump + 2 s highlight). */
export function ReplyBlock({ replyTo, onJump }: { replyTo: NonNullable<MessageDto["replyTo"]>; onJump: (messageId: string) => void }) {
  return (
    <button
      type="button"
      data-reply-block
      aria-label={ct("chatui.bubble.reply_jump")}
      onClick={() => onJump(replyTo.id)}
      className="mb-1.5 flex w-full min-w-0 flex-col items-start rounded-e-md border-s-[3px] border-accent bg-surface-2/60 px-2 py-1 text-start text-xs hover:bg-surface-2"
    >
      <span className="block max-w-full truncate font-semibold text-accent">{replyTo.authorName}</span>
      <span className="line-clamp-1 max-w-full text-fg-muted">{replyTo.deleted ? ct("chatc.deleted") : (replyTo.preview ?? ct("chatc.message_fallback"))}</span>
    </button>
  );
}

/** The footer inside the bubble, at the end: «معدّلة», «مثبّتة», the time (`HH:MM`, left-to-right, tabular) and, on my own message, the ticks. */
export function BubbleFooter({ message, singleTick = false }: { message: MessageDto; /** C3a.3: the saved chat has nobody to deliver to or to read: my message there has the single ✓ whatever status it carries */ singleTick?: boolean }) {
  return (
    <span data-bubble-footer className="mt-1 flex items-center justify-end gap-1.5 text-xs text-fg-muted">
      {message.edited && <span>{ct("chatc.edited")}</span>}
      {message.pinned && <span>{ct("chatc.pinned")}</span>}
      <time dateTime={message.createdAt} dir="ltr" className="tabular-nums">
        {fmtTime(message.createdAt)}
      </time>
      {message.mine && (singleTick || message.status) && !message.deleted && <MessageTicks status={singleTick ? "sent" : message.status!} />}
    </span>
  );
}

/** The reactions as chips under the content: mine outlined in the accent; a tap toggles it (not while the person only reads in oversight). */
export function ReactionChips({ message, canAct, onReact }: { message: MessageDto; canAct: boolean; onReact: (message: MessageDto, emoji: string) => void }) {
  if (message.reactions.length === 0) return null;
  return (
    <div data-reactions className="mt-1.5 flex flex-wrap gap-1">
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!canAct}
          aria-pressed={r.mine}
          aria-label={ct("chatc.reaction", { emoji: r.emoji, count: r.count })}
          onClick={() => onReact(message, r.emoji)}
          className={`inline-flex min-h-7 items-center gap-1 rounded-full bg-accent/15 px-2.5 text-[13px] font-bold tabular-nums text-accent transition-colors enabled:hover:bg-accent/25 disabled:cursor-default ${r.mine ? "ring-[1.5px] ring-inset ring-accent" : ""}`}
        >
          <span aria-hidden="true" className="text-base leading-none">{r.emoji}</span>
          <span aria-hidden="true">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
