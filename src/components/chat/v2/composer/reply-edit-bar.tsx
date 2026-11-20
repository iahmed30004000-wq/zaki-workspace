"use client";

import React from "react";
import { Pencil, Reply, X } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";

const CLOSE = "flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const BAR = "flex items-center gap-2 rounded-xl border-s-[3px] border-accent bg-surface-1 py-1 ps-3 pe-1 text-sm shadow-card";

/**
 * C2.5 — the bar above the box while a reply or an edit is in progress (Telegram's: an accent stripe, the accent icon, the quoted message or «تعديل الرسالة» with
 * the old words, and the ✕ that ends it). Esc does the same from the box. An edit takes the place of a reply (the pane's `startEdit` clears it), so at most
 * one of the two is drawn.
 */
export function ReplyEditBar({ reply, editing, onCancelReply, onCancelEdit }: { reply: MessageDto | null; editing: MessageDto | null; onCancelReply: () => void; onCancelEdit: () => void }) {
  if (editing) {
    return (
      <div data-edit-bar className={BAR}>
        <Pencil aria-hidden="true" className="size-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-accent">{ct("chatc.editing")}</p>
          <p className="truncate text-fg-muted">{editing.body ?? ""}</p>
        </div>
        <button type="button" className={CLOSE} aria-label={ct("chatc.cancel")} onClick={onCancelEdit}>
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
    );
  }
  if (!reply) return null;
  return (
    <div data-reply-bar className={BAR}>
      <Reply aria-hidden="true" className="size-5 shrink-0 text-accent rtl:-scale-x-100" />
      <p className="min-w-0 flex-1 truncate">{ct("chatc.reply_to", { name: reply.authorName, body: reply.deleted ? ct("chatc.deleted") : (reply.body ?? "") })}</p>
      <button type="button" className={CLOSE} aria-label={ct("chatc.cancel_reply")} onClick={onCancelReply}>
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
