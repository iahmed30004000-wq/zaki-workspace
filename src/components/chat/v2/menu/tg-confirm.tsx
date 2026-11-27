"use client";

import React from "react";
import "@/components/chat/v2/phone/tg-messages.css";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { cn } from "@/lib/utils";

const TEXT_BUTTON = "inline-flex min-h-11 min-w-16 items-center justify-center rounded-lg px-4 text-base font-semibold hover:bg-surface-2 disabled:opacity-50";

/**
 * «تيليجرام على التلفون» — the messages' confirmations (delete, pin, unpin), drawn as Telegram's: a title, one question, and two text buttons («إلغاء» in
 * the accent, the action after it, red when it destroys). No corner ✕ and no filled buttons. It is the kit's dialog (focus, Esc, a tap outside).
 */
export function TgConfirm({
  open,
  onOpenChange,
  title,
  body,
  note,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  portal = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  /** a second, quiet line: what the action leaves behind */
  note?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  portal?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent portal={portal} size="sm" hideClose aria-label={title} data-tg-confirm="" style={tgMotionVars(["menuScaleMs", "deleteDialogMs"]) as React.CSSProperties} className="zk-tg-dialog rounded-2xl">
        <DialogHeader className="pb-2 pe-5">
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="pb-2">
          <p className="text-base">{body}</p>
          {note ? <p className="mt-2 text-sm text-fg-muted">{note}</p> : null}
        </DialogBody>
        <div className="flex shrink-0 items-center justify-end gap-1 px-3 pb-3">
          <button type="button" data-tg-confirm-cancel="" onClick={() => onOpenChange(false)} className={cn(TEXT_BUTTON, "text-accent")}>
            {ct("tgmsg.cancel")}
          </button>
          <button type="button" data-tg-confirm-do="" disabled={busy} onClick={onConfirm} className={cn(TEXT_BUTTON, danger ? "text-danger" : "text-accent")}>
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
