"use client";

import React from "react";
import "./emoji-alive.css";
import type { MessageDto } from "@/server/chat/dto";
import { MessageTicks } from "@/components/chat/message/message-item";
import { ct } from "@/lib/chat/text";
import { useLongPress } from "@/components/chat/v2/bubble/use-long-press";
import { burstedReactions, type ReactionChip } from "@/lib/chat-reactions";
import { zakiIdOfCode, zakiNameOf, zakiSrc } from "@/lib/chat/zaki-emoji";
import { fmtTime } from "@/lib/format";

/**
 * C2.4 — the small parts of a bubble that carry no decision: the forwarded header, the reply block, the footer and the reaction chips. Each is built
 * from the same words and rules as `message-item.tsx` (and the same dictionary keys), restyled with the theme tokens and logical sides.
 */

/**
 * «محوّلة من فلان» — the ORIGINAL author's name (a re-forward keeps the first author). With `onOpen` it is a button: a tap goes to the original message when the viewer may
 * read it (S5.2; the server decides, `GET /api/chat/messages/[id]/forward`) and says so when they may not. A guest never gets this header at all (redact.ts).
 */
export function ForwardedHeader({ name, onOpen }: { name: string; onOpen?: () => void }) {
  if (!onOpen) {
    return (
      <span data-forwarded className="mb-1 block text-xs font-semibold text-accent">
        {ct("chatui.bubble.forwarded", { name })}
      </span>
    );
  }
  return (
    <button type="button" data-forwarded data-forwarded-open aria-label={ct("chatfwd.source_open")} onClick={onOpen} className="mb-1 block max-w-full truncate text-start text-xs font-semibold text-accent hover:underline">
      {ct("chatui.bubble.forwarded", { name })}
    </button>
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

/** What a chip shows for an emoji: a Zaki code is its small picture of the pack, anything else the emoji itself (the chip's `aria-label` says the name). */
function ChipFace({ emoji }: { emoji: string }) {
  const zaki = zakiIdOfCode(emoji);
  if (zaki === null) return <span aria-hidden="true" className="text-base leading-none">{emoji}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
  return <img src={zakiSrc(zaki)} alt="" aria-hidden="true" data-zaki-emoji={zaki} loading="lazy" decoding="async" draggable={false} className="size-5 object-contain" />;
}

function Chip({ chip, canAct, bursting, onToggle, onWho }: { chip: ReactionChip; canAct: boolean; bursting: boolean; onToggle: () => void; onWho?: (emoji: string) => void }) {
  // a long press that opened the list must not also toggle the reaction when the finger lifts
  const swallow = React.useRef(false);
  const long = useLongPress(onWho !== undefined, () => {
    swallow.current = true;
    setTimeout(() => {
      swallow.current = false;
    }, 700);
    onWho?.(chip.emoji);
  });
  const zaki = zakiIdOfCode(chip.emoji);
  return (
    <button
      type="button"
      data-reaction-chip={chip.emoji}
      aria-disabled={canAct ? undefined : true}
      aria-pressed={chip.mine}
      aria-label={ct("chatc.reaction", { emoji: zaki !== null ? zakiNameOf(zaki) : chip.emoji, count: chip.count })}
      title={onWho ? ct("chatemoji.who.hint") : undefined}
      // the chip is the bubble's own: its press must not start the bubble's long press (the message menu) or its double tap
      onPointerDown={(e) => {
        e.stopPropagation();
        long.onPointerDown(e);
      }}
      onPointerMove={long.onPointerMove}
      onPointerUp={long.onPointerUp}
      onPointerCancel={long.onPointerCancel}
      // the right button (and the keyboard's menu key) says who reacted; a finger's long press does the same (above)
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onWho?.(chip.emoji);
      }}
      onClick={() => {
        if (swallow.current) {
          swallow.current = false;
          return;
        }
        // not allowed to react (the owner only reads): a press says who reacted instead
        if (canAct) onToggle();
        else onWho?.(chip.emoji);
      }}
      className={`inline-flex min-h-7 items-center gap-1 rounded-full bg-accent/15 px-2.5 text-[13px] font-bold tabular-nums text-accent transition-colors ${canAct ? "hover:bg-accent/25" : "cursor-default"} ${chip.mine ? "ring-[1.5px] ring-inset ring-accent" : ""} ${bursting ? "zk-chip-burst" : ""}`}
    >
      <ChipFace emoji={chip.emoji} />
      <span aria-hidden="true">{chip.count}</span>
    </button>
  );
}

/**
 * The reactions as chips under the content: mine outlined in the accent; a press toggles it (while the person only reads in oversight a press says who reacted instead).
 * S5.6: a chip that was just ADDED (new, or its count grew) BURSTS (a quick scale and a ring, `emoji-alive.css`; never on the first draw, off under reduced motion); a Zaki
 * code is its picture; a long press (or the right button) on a chip asks `onWho` for «مين تفاعل» — the bubble draws that sheet beside itself, not inside.
 */
export function ReactionChips({ message, canAct, onReact, onWho }: { message: MessageDto; canAct: boolean; onReact: (message: MessageDto, emoji: string) => void; onWho?: (emoji: string) => void }) {
  const chips = message.reactions;
  const seen = React.useRef<readonly ReactionChip[] | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burst, setBurst] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    const grown = burstedReactions(seen.current, chips);
    seen.current = chips;
    if (grown.length === 0) return;
    setBurst(grown);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBurst([]), 520);
  }, [chips]);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (chips.length === 0) return null;
  return (
    <div data-reactions className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((r) => (
        <Chip key={r.emoji} chip={r} canAct={canAct} bursting={burst.includes(r.emoji)} onToggle={() => onReact(message, r.emoji)} onWho={onWho} />
      ))}
    </div>
  );
}
