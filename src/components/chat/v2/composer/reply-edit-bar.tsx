"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";

/**
 * C2.5 — the bar above the box while a reply or an edit is in progress: the quoted message (or «تعديل الرسالة» with the old words) and the ✕ that ends it.
 * Esc does the same from the box. An edit takes the place of a reply (the pane's `startEdit` clears it), so at most one of the two is drawn.
 */
export function ReplyEditBar({ reply, editing, onCancelReply, onCancelEdit }: { reply: MessageDto | null; editing: MessageDto | null; onCancelReply: () => void; onCancelEdit: () => void }) {
  if (editing) {
    return (
      <div data-edit-bar className="flex items-center justify-between gap-2 rounded-lg border-s-[3px] border-accent bg-surface-2 px-3 py-1 text-sm">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-accent">{ct("chatc.editing")}</p>
          <p className="truncate text-fg-muted">{editing.body ?? ""}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={ct("chatc.cancel")} onClick={onCancelEdit}>
          <span aria-hidden="true">✕</span>
        </Button>
      </div>
    );
  }
  if (!reply) return null;
  return (
    <div data-reply-bar className="flex items-center justify-between gap-2 rounded-lg border-s-[3px] border-accent bg-surface-2 px-3 py-1 text-sm">
      <p className="min-w-0 flex-1 truncate">{ct("chatc.reply_to", { name: reply.authorName, body: reply.deleted ? ct("chatc.deleted") : (reply.body ?? "") })}</p>
      <Button type="button" variant="ghost" size="icon" aria-label={ct("chatc.cancel_reply")} onClick={onCancelReply}>
        <span aria-hidden="true">✕</span>
      </Button>
    </div>
  );
}
