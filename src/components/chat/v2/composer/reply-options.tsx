"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowRight, CheckCircle2, TextQuote, Trash2 } from "lucide-react";
import "@/components/chat/v2/phone/tg-messages.css";
import type { MessageDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { quoteChoice } from "@/lib/chat/v2/composer/reply-options-model";
import { cleanQuote } from "@/lib/chat/v2/menu/gestures";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { splitZakiEmoji, zakiSrc } from "@/lib/chat/zaki-emoji";
import { cn } from "@/lib/utils";

const ROW = "flex min-h-12 w-full items-center gap-3 px-4 text-start text-base active:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

export interface ReplyOptionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the message being answered */
  message: MessageDto;
  /** the piece already picked for this reply */
  quote: string | null;
  /** the picked piece (null: an ordinary reply to the whole message) */
  onApply: (quote: string | null) => void;
  onCancelReply: () => void;
  portal?: boolean;
}

/** The words of the message as the finger selects them: the text exactly as the server keeps it (a quote must be a piece of it); our stickers are pictures. */
function QuotableText({ body, innerRef }: { body: string; innerRef: React.RefObject<HTMLParagraphElement> }) {
  return (
    <p ref={innerRef} data-quotable="" className="select-text whitespace-pre-wrap break-words text-base leading-relaxed [@media(hover:none)]:select-text">
      {splitZakiEmoji(body).map((piece, i) =>
        piece.emoji !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
          <img key={i} src={zakiSrc(piece.emoji)} alt="" draggable={false} className="inline-block size-6 select-none object-contain align-text-bottom" />
        ) : (
          <React.Fragment key={i}>{piece.text}</React.Fragment>
        ),
      )}
    </p>
  );
}

/**
 * «خيارات الرد» (Telegram's screen): the message being answered, with its words selectable. «تحديد اقتباس معين» selects all of it, and the person drags the
 * two handles down to the piece he wants; «تطبيق التغييرات» keeps that piece for the reply; «عدم الرد» ends the reply. (Answering in ANOTHER chat needs the
 * server and is not offered.)
 */
export function ReplyOptions({ open, onOpenChange, message, quote, onApply, onCancelReply, portal = true }: ReplyOptionsProps) {
  const body = message.deleted ? "" : (message.body ?? "");
  const textRef = React.useRef<HTMLParagraphElement>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [picked, setPicked] = React.useState("");
  const [refused, setRefused] = React.useState(false);
  React.useEffect(() => {
    if (open) return;
    setQuoting(false);
    setPicked("");
    setRefused(false);
  }, [open]);

  React.useEffect(() => {
    if (!open || !quoting) return;
    // the last words that were selected inside the message are the pick: a tap on a button may drop the selection before its click arrives
    const onChange = () => {
      const selection = document.getSelection();
      const box = textRef.current;
      if (!selection || selection.isCollapsed || !box || !box.contains(selection.anchorNode) || !box.contains(selection.focusNode)) return;
      setPicked(selection.toString());
      setRefused(false);
    };
    document.addEventListener("selectionchange", onChange);
    const frame = requestAnimationFrame(() => {
      if (textRef.current) document.getSelection()?.selectAllChildren(textRef.current);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onChange);
      document.getSelection()?.removeAllRanges();
    };
  }, [open, quoting]);

  const apply = () => {
    if (quoting) {
      const choice = quoteChoice(picked, body);
      if (choice.kind === "not-part") return setRefused(true);
      onApply(choice.kind === "part" ? choice.quote : null);
    }
    onOpenChange(false);
  };
  const shown = quoting ? cleanQuote(picked) : quote;
  const keep = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
  const motion = tgMotionVars(["messageDimMs", "messageMenuMs", "barSlideMs"]) as React.CSSProperties;
  const content = (
    <DialogPrimitive.Content
      data-reply-options=""
      dir="rtl"
      aria-modal="true"
      aria-describedby={undefined}
      style={motion}
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="zk-tg-dim zk-tg-overlay fixed inset-0 z-50 flex flex-col gap-3 bg-surface-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] text-fg focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
    >
      <div className="flex shrink-0 items-center gap-2 rounded-2xl bg-surface-1 py-1.5 pe-4 ps-1 shadow-card">
        <DialogPrimitive.Close aria-label={ct("tgmsg.reply.back")} className="flex size-11 shrink-0 items-center justify-center rounded-full">
          <ArrowRight aria-hidden="true" className="size-5" />
        </DialogPrimitive.Close>
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-base font-bold">{ct("tgmsg.reply.screen_title")}</DialogPrimitive.Title>
          <p className="truncate text-sm text-fg-muted">{ct("tgmsg.reply.screen_hint")}</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
        <div className={cn("max-w-[85%] rounded-[17px] px-3 py-2 shadow-sm", message.mine ? "self-end bg-bubble-out text-bubble-out-fg" : "self-start bg-bubble-in text-bubble-in-fg")}>
          <p className="mb-0.5 truncate text-xs font-semibold text-accent">{message.authorName}</p>
          {body ? <QuotableText body={body} innerRef={textRef} /> : <p className="text-base text-fg-muted">{message.deleted ? ct("chatc.deleted") : ct("chatc.message_fallback")}</p>}
        </div>
      </div>
      {shown ? (
        <div data-reply-options-picked="" className="shrink-0 rounded-xl border-s-[3px] border-accent bg-surface-1 px-3 py-1.5">
          <p className="text-xs font-semibold text-accent">{ct("tgmsg.reply.picked")}</p>
          <p className="line-clamp-2 text-sm">{shown}</p>
        </div>
      ) : null}
      {refused ? (
        <p role="alert" className="shrink-0 text-sm text-danger">
          {ct("tgmsg.reply.not_part")}
        </p>
      ) : null}
      <div role="group" aria-label={ct("tgmsg.reply.options")} className="zk-tg-slide-up flex shrink-0 flex-col overflow-hidden rounded-2xl bg-surface-1 py-1 shadow-lg">
        {body && !quoting ? (
          <button type="button" data-reply-pick-quote="" onClick={() => setQuoting(true)} className={ROW}>
            <TextQuote aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            {ct("tgmsg.reply.pick_quote")}
          </button>
        ) : null}
        <button type="button" data-reply-apply="" {...keep} onClick={apply} className={ROW}>
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
          {ct("tgmsg.reply.apply")}
        </button>
        <button
          type="button"
          data-reply-stop=""
          onClick={() => {
            onCancelReply();
            onOpenChange(false);
          }}
          className={cn(ROW, "text-danger")}
        >
          <Trash2 aria-hidden="true" className="size-5 shrink-0" />
          {ct("tgmsg.reply.cancel")}
        </button>
      </div>
    </DialogPrimitive.Content>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {portal ? <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal> : content}
    </DialogPrimitive.Root>
  );
}
