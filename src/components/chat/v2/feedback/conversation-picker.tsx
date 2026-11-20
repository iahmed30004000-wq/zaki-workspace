"use client";

import React from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useChatList } from "@/lib/chat/cache/selectors";
import { ct } from "@/lib/chat/text";
import { pickableChats } from "@/lib/chat/v2/feedback/feedback-model";

/**
 * C3w.2 (Q1.2) — the screen's own picker for «ابعتيها بالمحادثة»: the person's chats, from the chat list's cache (private chats, groups, topics — the topics of a space are
 * its chips), a search over them, one press picks. It only CHOOSES: what is sent, and whether the person may post there, are the door's (`POST …/media/<id>/chat`).
 */
export function ConversationPickerDialog({ open, onClose, onPick, busy = false, portal = true }: { open: boolean; onClose: () => void; onPick: (conversationId: string) => void; busy?: boolean; portal?: boolean }) {
  const list = useChatList("all");
  const [query, setQuery] = React.useState("");
  const chats = React.useMemo(() => pickableChats(list.rows, query), [list.rows, query]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent portal={portal} size="md" aria-label={ct("chatui.pick.title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatui.pick.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3">
            <input
              type="search"
              data-pick-search=""
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder={ct("chatui.pick.search")}
              aria-label={ct("chatui.pick.search")}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base md:h-9 md:text-sm"
            />
            {chats.length === 0 ? (
              <p role="status" className="py-4 text-center text-sm text-fg-muted">
                {ct("chatui.pick.none")}
              </p>
            ) : (
              <ul data-pick-list="" className="max-h-72 space-y-1 overflow-y-auto">
                {chats.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      data-pick-chat={chat.id}
                      disabled={busy}
                      onClick={() => onPick(chat.id)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                    >
                      {chat.emoji ? <span aria-hidden="true">{chat.emoji}</span> : null}
                      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                      {chat.space ? <span className="max-w-32 shrink-0 truncate text-xs text-fg-muted">{chat.space}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
