"use client";

import React, { useState } from "react";
import { MessageCircle } from "lucide-react";
import { MeetingButton } from "@/components/calls/meeting-button";
import { Button } from "@/components/ui/button";
import { NewDmDialog } from "@/components/chat/home/new-dm-dialog";
import { ct } from "@/lib/chat/text";

/**
 * C2.1 — the main pane of the computer when no conversation is open: «اختار محادثة». It carries the two starts the old home had at its top — a new
 * message and, for whoever may (`calls.edit`), the meeting button — so nothing of the old screen is lost. On the phone the list is the screen, so this
 * pane is not shown there (the shell hides the page's content on the list routes).
 *
 * An empty state is one of the few places decoration is allowed (the plan's design rules); it is kept plain: theme tokens, one icon.
 */
export function EmptyState({ guest, canMeet }: { guest: boolean; canMeet: boolean }) {
  const [newDm, setNewDm] = useState(false);
  return (
    <div data-chat-empty="" className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <span aria-hidden="true" className="grid size-20 place-items-center rounded-full bg-surface-2 text-fg-muted">
        <MessageCircle className="size-10" />
      </span>
      <div>
        <h1 className="text-lg font-semibold text-fg">{ct("chatui.empty_pane.title")}</h1>
        <p className="mt-1 text-sm text-fg-muted">{ct(guest ? "chatui.empty_pane.hint_guest" : "chatui.empty_pane.hint")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {guest ? null : (
          <Button type="button" onClick={() => setNewDm(true)}>
            {ct("chath.new_dm")}
          </Button>
        )}
        {canMeet ? <MeetingButton /> : null}
      </div>
      {guest ? null : <NewDmDialog open={newDm} onOpenChange={setNewDm} />}
    </div>
  );
}
