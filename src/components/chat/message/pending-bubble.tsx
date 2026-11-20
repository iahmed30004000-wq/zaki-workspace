import React from "react";
import type { OutboxItem } from "@/lib/chat/outbox/queue";
import { ct } from "@/lib/chat/text";
import { fmtTime } from "@/lib/format";

/**
 * A message of mine that has not reached the server yet (the outbox, src/lib/chat/outbox/): the same bubble as my own
 * messages, drawn dashed and a little quieter with a clock — «⏳ بانتظار الإرسال» — and the two things a person can do about
 * it, «إعادة المحاولة» and «احذف». When the server refused it for good the bubble turns «تعذّر الإرسال» with a red «!», says why, and also
 * offers «انسخ» and «عدّل» (the words go back to the box): a message that failed is never dropped without the person's say.
 *
 * C1.8: a pending message of the chat cache (`pending: {...}` on a MessageDto, src/lib/chat/cache/pending.ts) is drawn by this same bubble through
 * `outboxItemOfPending`, so the optimistic bubble and the outbox's bubble look and behave alike.
 */
export interface PendingBubbleProps {
  item: OutboxItem;
  onRetry: (item: OutboxItem) => void;
  onDelete: (item: OutboxItem) => void;
  onCopy?: (item: OutboxItem) => void;
  onEdit?: (item: OutboxItem) => void;
}

const action = "inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold hover:bg-surface-2";

export function PendingBubble({ item, onRetry, onDelete, onCopy, onEdit }: PendingBubbleProps) {
  const failed = Boolean(item.failed);
  const hasText = item.body.trim().length > 0;
  return (
    <div className="group mb-2.5" data-message-row="mine" data-pending-message={item.clientId} data-outbox-state={failed ? "failed" : "pending"}>
      <div className="flex flex-row-reverse items-end gap-1.5">
        <div className="flex min-w-0 flex-col items-end">
          <article
            dir="rtl"
            aria-label={failed ? ct("outbox.failed_aria") : ct("outbox.pending_aria")}
            className={`max-w-[85%] min-w-0 break-words rounded-[17px] rounded-ee-md border border-dashed px-3 py-1.5 sm:max-w-[75%] ${failed ? "border-danger/50 bg-danger/10" : "border-bubble-out/60 bg-bubble-out text-bubble-out-fg opacity-80"}`}
          >
            {hasText
              ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</p>
              : <p className="text-sm italic text-fg-muted">{ct("outbox.attachments_only")}</p>}
            <span className="mt-1 flex items-center justify-end gap-1.5 text-xs text-fg-muted">
              <time dateTime={new Date(item.createdAt).toISOString()} dir="ltr" className="tabular-nums">{fmtTime(new Date(item.createdAt).toISOString())}</time>
              {failed && <span data-outbox-bang aria-hidden="true" className="inline-flex size-4 items-center justify-center rounded-full bg-danger text-xs font-bold leading-none text-danger-fg">!</span>}
              <span data-outbox-mark className={failed ? "font-semibold text-danger" : ""}>{failed ? ct("outbox.failed") : ct("outbox.pending")}</span>
            </span>
            {item.failed && <p role="note" data-outbox-reason className="mt-1 text-xs text-danger">{ct(item.failed.key)}</p>}
          </article>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <button type="button" className={`${action} text-accent`} onClick={() => onRetry(item)}>{ct("outbox.retry")}</button>
            {failed && onCopy && <button type="button" className={action} onClick={() => onCopy(item)}>{ct("outbox.copy")}</button>}
            {failed && onEdit && <button type="button" className={action} onClick={() => onEdit(item)}>{ct("outbox.edit")}</button>}
            <button type="button" className={`${action} text-danger`} onClick={() => onDelete(item)}>{ct("outbox.delete")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
