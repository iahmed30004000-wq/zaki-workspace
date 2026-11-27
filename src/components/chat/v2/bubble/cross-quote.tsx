"use client";

import React from "react";
import { Reply, X } from "lucide-react";
import type { CrossReplyDto } from "@/server/chat/dto";
import type { CrossKind } from "@/lib/chat/cross-reply";
import { ct } from "@/lib/chat/text";

/**
 * «الرد في محادثة أخرى» — the quote of a message of ANOTHER conversation: in a bubble, over the composer and in the picker, so the three always say the same. The words
 * are React text (never markup). It names no conversation: the server never sends one. It is a button only where the server said this person may go to the source.
 */
export function crossWords(text: string | null, kind: CrossKind): string {
  if (text === null) return ct("chatc.deleted");
  const label = kind === "text" ? "" : ct(`tgx.cross.kind.${kind}`);
  if (label && text) return `${label}: ${text}`;
  return label || text || ct("chatc.message_fallback");
}

export function CrossQuote({ authorName, text, kind, onOpen, onRemove }: { authorName: string; text: string | null; kind: CrossKind; onOpen?: () => void; onRemove?: () => void }) {
  const inner = (
    <>
      <span className="flex max-w-full items-center gap-1 text-fg-muted">
        <Reply aria-hidden="true" className="size-3.5 shrink-0 rtl:-scale-x-100" />
        <span className="truncate">{ct("tgx.cross.from_elsewhere")}</span>
      </span>
      {authorName ? <span className="block max-w-full truncate font-semibold text-accent">{authorName}</span> : null}
      <span data-cross-text="" className="line-clamp-2 max-w-full text-fg-muted [overflow-wrap:anywhere]">
        {crossWords(text, kind)}
      </span>
    </>
  );
  const box = "flex min-w-0 flex-1 flex-col items-start rounded-e-md border-s-[3px] border-accent bg-surface-2/60 px-2 py-1 text-start text-xs";
  return (
    <div data-cross-quote="" className="mb-1.5 flex w-full min-w-0 items-center gap-1">
      {onOpen ? (
        <button type="button" data-cross-open="" aria-label={ct("tgx.cross.open")} onClick={onOpen} className={`${box} hover:bg-surface-2`}>
          {inner}
        </button>
      ) : (
        <div className={box}>{inner}</div>
      )}
      {onRemove ? (
        <button type="button" data-cross-remove="" aria-label={ct("tgx.cross.remove")} onClick={onRemove} className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
          <X aria-hidden="true" className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

/** The quote of a bubble, from what the server sent THIS person: the way to the source only when it said `jump`. */
export function CrossReplyBlock({ crossReply, onOpen }: { crossReply: CrossReplyDto; onOpen: () => void }) {
  return <CrossQuote authorName={crossReply.authorName} text={crossReply.text} kind={crossReply.kind} {...(crossReply.jump ? { onOpen } : {})} />;
}
