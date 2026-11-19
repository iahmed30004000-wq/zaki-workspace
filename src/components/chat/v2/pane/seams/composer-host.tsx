"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { ChatComposer } from "@/components/chat/composer/chat-composer";
import { OutboxStatusLine } from "@/components/chat/composer/outbox-status";
import { usePaneActions } from "@/components/chat/v2/pane/pane-actions";
import { Button } from "@/components/ui/button";
import { chatKeys } from "@/lib/chat/cache/keys";
import { appendMessage, replaceMessage } from "@/lib/chat/cache/writer";
import { ct } from "@/lib/chat/text";
import { composerBarOf } from "@/lib/chat/v2/pane/composer-bar";
import { composerDetailOf, type PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { doors } from "@/lib/chat/v2/pane/message-actions";
import { useOnline, useOutbox } from "@/lib/chat/outbox/use-outbox";
import { useStreamEvicted } from "@/lib/realtime/use-realtime";

/**
 * C2.4 — SEAM 2: what sits under the messages. C2.5 OWNS THIS FILE AFTERWARDS (emoji, the attach menu, paste and drop, mic ⇄ send); until then it renders
 * TODAY'S `ChatComposer` working end to end: the optimistic bubble (`optimistic={{ qc }}` with the person's outbox: C1.8), the reply / edit state from the
 * pane's actions, the failed message put back by «عدّل», the offline status line, and — when the person cannot post — the one line that says why, or the
 * owner's «شارك بالمحادثة» (`composerBarOf`, unchanged).
 *
 * It is the DIRECT child of the pane root (`data-chat-pane-root`, `relative`), so C2.5 can lay a drop overlay over the pane from here without touching
 * any other file. A message that the composer sends the old way (files, a voice note, a poll) lands in the cache through the writer; one that is edited
 * replaces itself in place.
 */
export function ComposerHost({ header, people, onSent }: { header: ConversationHeaderDto; people: PaneMembers | null; onSent?: () => void }) {
  const qc = useQueryClient();
  const a = usePaneActions();
  const conversationId = header.id;
  const detail = React.useMemo(() => composerDetailOf(header, people), [header, people]);
  // «الرسائل بدون نت»: a send that could not leave stays in the person's outbox; never for the owner's silent reading (he posts nothing there)
  const outboxOn = header.chatOutbox !== false && header.me.canPost && !header.me.oversight;
  const { outbox, items } = useOutbox(header.me.id, outboxOn);
  const online = useOnline();
  const liveElsewhere = useStreamEvicted();
  const mine = React.useMemo(() => items.filter((i) => i.conversationId === conversationId), [items, conversationId]);
  const waiting = mine.filter((i) => !i.failed).length;
  const failed = mine.length - waiting;
  const [joining, setJoining] = React.useState(false);

  const bar = composerBarOf(header.me, header);
  if (bar !== "composer") {
    return (
      <footer data-composer-host={bar} className="border-t border-border p-3 text-center text-sm">
        {bar === "join" ? (
          <div className="flex flex-col items-center gap-1">
            <Button
              type="button"
              disabled={joining}
              className="min-h-11 font-bold"
              onClick={() => {
                setJoining(true);
                void a.call(doors.join(conversationId)).finally(() => {
                  setJoining(false);
                  void qc.invalidateQueries({ queryKey: chatKeys.header(conversationId), exact: true });
                });
              }}
            >
              {joining ? ct("chatc.joining") : ct("chatc.join")}
            </Button>
            <p className="text-xs text-fg-muted">{ct("chatc.join_hint")}</p>
          </div>
        ) : (
          ct(`chatc.bar.${bar}`)
        )}
      </footer>
    );
  }

  return (
    <footer data-composer-host="composer" className="border-t border-border p-3">
      {liveElsewhere && (
        <p role="status" className="px-3 pb-1 text-xs text-fg-muted">
          {ct("chatc.live_elsewhere")}
        </p>
      )}
      <OutboxStatusLine pending={waiting} failed={failed} offline={!online} />
      {a.reply && (
        <div data-reply-bar className="mb-2 flex items-center justify-between gap-2 rounded-lg border-s-[3px] border-accent bg-surface-2 px-3 py-1 text-sm">
          <p className="min-w-0 flex-1 truncate">{ct("chatc.reply_to", { name: a.reply.authorName, body: a.reply.deleted ? ct("chatc.deleted") : (a.reply.body ?? "") })}</p>
          <button type="button" aria-label={ct("chatc.cancel_reply")} className="min-h-11 shrink-0 px-2" onClick={a.cancelReply}>
            {ct("chatc.cancel")}
          </button>
        </div>
      )}
      <ChatComposer
        conversationId={conversationId}
        detail={detail}
        reply={a.reply}
        onCancelReply={a.cancelReply}
        outbox={outbox}
        restore={a.restore}
        onRestored={a.endRestore}
        optimistic={{ qc }}
        onMessage={(message) => {
          appendMessage(qc, conversationId, message);
          a.cancelReply();
          onSent?.();
        }}
        editing={a.editing}
        onCancelEdit={a.cancelEdit}
        onEdited={(updated) => {
          a.cancelEdit();
          replaceMessage(qc, conversationId, updated);
        }}
      />
    </footer>
  );
}
