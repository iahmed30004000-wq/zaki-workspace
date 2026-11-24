"use client";

import React from "react";
import { Phone } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { AssistantLine } from "@/components/chat/message/assistant-line";
import { BotFatherLine } from "@/components/chat/message/botfather-line";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dayLabelOf } from "@/lib/chat/day-separator";
import { fmtTime } from "@/lib/format";
import { systemSentence } from "@/lib/chat/system-sentence";
import { ct } from "@/lib/chat/text";
import { CALLS_FORMS, counted } from "@/lib/chat/v2/pane/plural";
import { callCount } from "@/lib/chat/viewport/calls";

/**
 * C2.4 — the rows of the log that are not a person's bubble: the day, the «رسائل غير مقروءة» line, a system line, and the chip a run of call lines folds
 * into. All of them are centred chips in the theme's tokens; every word is a dictionary key (a system line through `systemSentence`: the stored JSON is
 * never shown).
 */

const chip = "mx-auto block w-fit max-w-[92%] rounded-full bg-surface-2 px-3 py-1 text-center text-xs text-fg-muted";

/** «اليوم» / «أمس» / the long date, between the messages of two days. */
export function DaySeparator({ at }: { at: string }) {
  return (
    <p data-day-separator className="text-center text-xs font-semibold text-fg-muted">
      <span className="rounded-full bg-surface-1 px-3 py-1">{dayLabelOf(at)}</span>
    </p>
  );
}

/** «رسائل غير مقروءة»: the line the conversation opens on when something was unread (the landing is on THIS line, not on the message below it). */
export function UnreadLine() {
  return (
    <p data-unread-line role="separator" className="flex items-center gap-3 text-xs font-semibold text-accent">
      <span aria-hidden="true" className="h-px flex-1 bg-accent/30" />
      <span>{ct("chatui.pane.unread_line")}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-accent/30" />
    </p>
  );
}

/** A system line is a quiet sentence in the middle, never a bubble with an empty body; the assistant's answer is its own block. */
export function ServiceLine({ message, formatting = true }: { message: MessageDto; /** C3b.1: the company's `chatFormatting`, from the header's facts: the assistant's answer is drawn with its formatting unless it is off */ formatting?: boolean }) {
  if (message.system?.k === "assistant") return <AssistantLine meta={message.system} time={fmtTime(message.createdAt)} createdAt={message.createdAt} formatting={formatting} />;
  if (message.system?.k === "botfather") return <BotFatherLine messageId={message.id} meta={message.system} time={fmtTime(message.createdAt)} createdAt={message.createdAt} />;
  return (
    <p dir="rtl" role="note" data-service-line={message.system?.k ?? "other"} className={chip}>
      {systemSentence(message.system, message.authorName)}
    </p>
  );
}

/**
 * «6 مكالمات»: a dozen «بلّش مكالمة» / «خلصت المكالمة» lines in a row are ONE chip; pressing it asks the viewport to open the list (`onOpen` gets the id of the
 * run's FIRST line). The list is not drawn here: a virtual row can unmount (a new line gives the run a new key, a scroll drops it) and would take an open
 * dialog with it.
 */
export function CallsChip({ messages, onOpen }: { messages: readonly MessageDto[]; onOpen: (firstLineId: string) => void }) {
  return (
    <button type="button" data-calls-chip aria-haspopup="dialog" onClick={() => onOpen(messages[0]!.id)} className={`${chip} inline-flex items-center gap-1.5 font-semibold hover:bg-surface-1`}>
      <Phone aria-hidden="true" className="size-3.5" />
      {counted(CALLS_FORMS, callCount(messages))}
    </button>
  );
}

/** The list the chip opens, line by line; `null` is closed. The viewport draws it, outside the virtual rows. */
export function CallsDialog({ messages, onClose }: { messages: readonly MessageDto[] | null; onClose: () => void }) {
  return (
    <Dialog open={messages !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chatui.pane.calls_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ul data-calls-list className="divide-y divide-border text-sm">
            {(messages ?? []).map((m) => (
              <li key={m.id} className="flex min-h-11 items-center gap-3">
                <span className="min-w-0 flex-1">{systemSentence(m.system, m.authorName)}</span>
                <time dateTime={m.createdAt} dir="ltr" className="shrink-0 text-xs tabular-nums text-fg-muted">
                  {fmtTime(m.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
