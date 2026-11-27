"use client";

import React from "react";
import { Pencil, Reply, X } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import "@/components/chat/v2/phone/tg-messages.css";
import { useTgPhone } from "@/components/shell/tg-phone";
import { ct } from "@/lib/chat/text";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { zakiToWords } from "@/lib/chat/zaki-emoji";

const CLOSE = "flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const BAR = "flex items-center gap-2 rounded-xl border-s-[3px] border-accent bg-surface-1 py-1 ps-3 pe-1 text-sm shadow-card";

/**
 * C2.5 — the bar above the box while a reply or an edit is in progress (Telegram's: an accent stripe, the accent icon, the quoted message or «تعديل الرسالة» with
 * the old words, and the ✕ that ends it). Esc does the same from the box. An edit takes the place of a reply (the pane's `startEdit` clears it), so at most
 * one of the two is drawn.
 */
export function ReplyEditBar({ reply, editing, quote = null, onCancelReply, onCancelEdit, onOptions }: { reply: MessageDto | null; editing: MessageDto | null; /** S5.7 «رد بالاقتباس»: the piece of `reply` the person picked; shown in place of the whole message */ quote?: string | null; onCancelReply: () => void; onCancelEdit: () => void; /** «تيليجرام على التلفون»: a tap on the reply bar opens «خيارات الرد» */ onOptions?: () => void }) {
  const phone = useTgPhone();
  if (phone && (editing || reply)) return <PhoneReplyBar reply={reply} editing={editing} quote={quote} onCancelReply={onCancelReply} onCancelEdit={onCancelEdit} {...(onOptions ? { onOptions } : {})} />;
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
  const quoted = quote && !reply.deleted ? quote : null;
  return (
    <div data-reply-bar className={BAR}>
      <Reply aria-hidden="true" className="size-5 shrink-0 text-accent rtl:-scale-x-100" />
      {quoted ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-accent">{ct("chatparity.quote.reply_to", { name: reply.authorName })}</p>
          <p data-reply-quote className="line-clamp-2 whitespace-pre-line text-fg-muted">
            {quoted}
          </p>
        </div>
      ) : (
        <p className="min-w-0 flex-1 truncate">{ct("chatc.reply_to", { name: reply.authorName, body: reply.deleted ? ct("chatc.deleted") : (reply.body ?? "") })}</p>
      )}
      <button type="button" className={CLOSE} aria-label={ct("chatc.cancel_reply")} onClick={onCancelReply}>
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

const PHONE_BAR = "zk-tg-slide-up flex min-w-0 items-center gap-2 rounded-2xl bg-surface-1 py-1 ps-3 pe-1 shadow-card";

/**
 * «تيليجرام على التلفون»: the bar slides up from the box. A reply says to whom and «انقر هنا لعرض خيارات الرد» (or the picked quote), and a tap on its words
 * opens «خيارات الرد»; an edit says «تعديل الرسالة» over the old words (the send button is ✓ then).
 */
export function PhoneReplyBar({ reply, editing, quote = null, onCancelReply, onCancelEdit, onOptions }: { reply: MessageDto | null; editing: MessageDto | null; quote?: string | null; onCancelReply: () => void; onCancelEdit: () => void; onOptions?: () => void }) {
  const motion = tgMotionVars(["barSlideMs"]) as React.CSSProperties;
  const Icon = editing ? Pencil : Reply;
  const quoted = !editing && quote && reply && !reply.deleted ? quote : null;
  const title = editing ? ct("chatc.editing") : ct("tgmsg.reply.title", { name: reply?.authorName ?? "" });
  const words = (
    <>
      <span className="block truncate text-sm font-semibold text-accent">{title}</span>
      {editing ? (
        <span className="block truncate text-sm text-fg-muted">{zakiToWords(editing.body ?? "")}</span>
      ) : quoted ? (
        <span data-reply-quote className="block truncate text-sm text-fg">
          {quoted}
        </span>
      ) : (
        <span className="block truncate text-sm text-fg-muted">{ct("tgmsg.reply.hint")}</span>
      )}
    </>
  );
  return (
    <div key={editing ? `edit:${editing.id}` : `reply:${reply?.id ?? ""}`} {...(editing ? { "data-edit-bar": "" } : { "data-reply-bar": "" })} data-tg-reply-bar="" style={motion} className={PHONE_BAR}>
      <Icon aria-hidden="true" className="size-6 shrink-0 text-accent rtl:-scale-x-100" />
      {editing || !onOptions ? (
        <div className="min-w-0 flex-1">{words}</div>
      ) : (
        <button type="button" data-reply-options-open="" aria-haspopup="dialog" onClick={onOptions} className="min-h-11 min-w-0 flex-1 rounded-lg text-start">
          {words}
        </button>
      )}
      <button type="button" className={`${CLOSE} size-11`} aria-label={ct(editing ? "chatc.cancel" : "chatc.cancel_reply")} onClick={editing ? onCancelEdit : onCancelReply}>
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
