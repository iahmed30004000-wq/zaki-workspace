"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { whenText } from "@/components/chat/v2/composer/schedule-dialog";
import { ct } from "@/lib/chat/text";
import { AR } from "@/lib/i18n/dict";

/**
 * C3c.3 — the person's OWN scheduled messages in this conversation (the calendar icon in the composer opens it): when each one goes out (in the company's zone), its words, and
 * «ابعت هلّق» / «عدّل» / «احذف». A failed row (the person could not write when its time came) shows why and can only be deleted. Nobody else's row is ever listed: the list comes from
 * `GET /api/chat/conversations/[id]/scheduled`, which answers the caller's rows only.
 */
/**
 * What `GET /api/chat/conversations/[id]/scheduled` answers for one row. Declared HERE, not imported from the server file (the composer's folders import nothing of the server but the
 * DTO types, a pin of C2.5): `tests/chat-scheduled-job.test.ts` checks at compile time that the server's `ScheduledDto` is assignable to it.
 */
export interface ScheduledItem {
  id: string;
  conversationId: string;
  body: string;
  attachmentIds: string[];
  mentions: string[];
  mentionAll: boolean;
  replyToId: string | null;
  silent: boolean;
  noPreview: boolean;
  /** ISO instant */
  sendAt: string;
  status: "PENDING" | "FAILED";
  /** a dictionary key, set on a FAILED row */
  failReason: string | null;
  createdAt: string;
}

/** The whole answer of the list route. */
export interface ScheduledAnswer {
  items: ScheduledItem[];
  /** the company's time zone: the dialog's date and time are read in it */
  timeZone: string;
  minLeadSec: number;
  maxDays: number;
  /** may the person write here now (the menu entry is drawn only then) */
  canSchedule: boolean;
}

export interface ScheduledListProps {
  open: boolean;
  onClose: () => void;
  items: readonly ScheduledItem[];
  timeZone: string;
  /** the row an action is running on (its buttons wait) */
  busyId: string | null;
  /** a sentence to show (an action failed) */
  error: string;
  onSendNow: (id: string) => void;
  onEdit: (item: ScheduledItem) => void;
  onDelete: (id: string) => void;
  /** server-render tests */
  portal?: boolean;
}

/** The sentence for a failure key; a key the dictionary does not know becomes the general one (no key text ever reaches the screen). */
export function failureText(key: string | null): string {
  return ct(key !== null && key in AR ? key : "chat.sched.e.failed");
}

export function ScheduledList({ open, onClose, items, timeZone, busyId, error, onSendNow, onEdit, onDelete, portal = true }: ScheduledListProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" portal={portal} data-sched-list>
        <DialogHeader>
          <DialogTitle>{ct("chatsched.list.title")}</DialogTitle>
          <p className="text-xs text-fg-muted">{ct("chatsched.list.private")}</p>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {items.length === 0 ? <p className="text-sm text-fg-muted">{ct("chatsched.list.empty")}</p> : null}
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const failed = item.status === "FAILED";
              const working = busyId === item.id;
              return (
                <li key={item.id} data-sched-item={item.id} data-sched-status={item.status} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
                  <p className="text-sm font-semibold" dir="auto">
                    {ct("chatsched.list.at", { when: whenText(item.sendAt, timeZone) })}
                  </p>
                  {item.body ? (
                    <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm" dir="auto">
                      {item.body}
                    </p>
                  ) : null}
                  {item.attachmentIds.length > 0 || item.silent ? (
                    <p className="text-xs text-fg-muted">
                      {[item.attachmentIds.length > 0 ? ct("chatsched.list.files", { n: item.attachmentIds.length }) : "", item.silent ? ct("chatsched.list.silent") : ""].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  {failed ? (
                    <p role="status" className="text-xs text-danger">
                      {ct("chatsched.list.failed", { reason: failureText(item.failReason) })}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {!failed ? (
                      <Button type="button" size="sm" variant="tonal" disabled={working} data-sched-now onClick={() => onSendNow(item.id)}>
                        {ct("chatsched.list.now")}
                      </Button>
                    ) : null}
                    {!failed ? (
                      <Button type="button" size="sm" variant="secondary" disabled={working} data-sched-edit onClick={() => onEdit(item)}>
                        {ct("chatsched.list.edit")}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" disabled={working} data-sched-delete className="text-danger" onClick={() => onDelete(item.id)}>
                      {ct("chatsched.list.delete")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
