"use client";

import React, { memo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BellOff, Check, CheckCheck, Lock, Megaphone, Pin, Users, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { RowActionsMenu, rowHasMenu, useRowMenuGestures, type RowMenuContext } from "@/components/chat/v2/row-menu";
import { useChatRow } from "@/lib/chat/cache/selectors";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { ct } from "@/lib/chat/text";
import { rowMarks, rowPinned, rowPreview, rowTicks, rowTicksLabel, rowTimeLabel, unreadText, type RowMark } from "@/lib/chat/row-preview";
import { chatHref } from "@/lib/chat/v2/routes";
import { useRowDraft } from "@/lib/chat/v2/use-draft";
import { useTyping } from "@/lib/realtime/use-realtime";
import { hasUnread } from "@/lib/chat/cache/unread";
import { cn } from "@/lib/utils";

/** The row heights of the spec (C2 §3): 72 px, and 76 px on the phone (a bigger thumb, a bigger avatar). */
export const ROW_HEIGHT = 72;
export const ROW_HEIGHT_PHONE = 76;
export const SECTION_HEIGHT = 36;

export function rowHref(row: Pick<ChatRowDto, "kind" | "id">): string {
  return row.kind === "SPACE" ? chatHref.forum(row.id) : chatHref.conversation(row.id);
}

const MARK_ICON: Record<RowMark["key"], LucideIcon> = {
  muted: BellOff,
  restricted: Lock,
  team: Users,
  announcements: Megaphone,
  closed: Lock,
};

function RowAvatar({ row, tall }: { row: ChatRowDto; tall: boolean }) {
  const size = tall ? "size-14" : "size-12";
  if (row.kind === "TOPIC") {
    return (
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-surface-2 text-xl", size)}>
        {row.emoji ?? "💬"}
      </span>
    );
  }
  return <Avatar name={row.title} src={row.kind === "DM" ? row.avatarUrl : null} className={cn(size, "text-sm")} />;
}

/**
 * ONE row of the list, drawn from the row the cache holds and nothing else — so every kind of row can be rendered on its own in a test:
 *   a space (a forum: the name, up to three topic chips, the newest message), a private chat or group (the person, the preview, the ticks),
 *   a topic (its emoji, the author in front of the preview). Strings come from `ar.chat-ui.json`; colours from the theme tokens; sides are
 *   logical (start / end), so the whole row mirrors itself in the right-to-left layout.
 *
 * The row is one link (a «stretched» link over the whole row: the title's own anchor reaches the row's edges), so a click, a tap, the keyboard
 * and a prefetch all go through the same address. The chips of a space row are their own links above it. The «⋮» sits at the end.
 */
export function RowView({
  row,
  selected,
  tall = false,
  typingNames,
  draft,
  now,
  menu,
}: {
  row: ChatRowDto;
  selected: boolean;
  tall?: boolean;
  typingNames?: readonly string[];
  draft?: string | null;
  now?: Date;
  /** the «⋮» of the row (the connected row passes it; a test may leave it out) */
  menu?: ReactNode;
}) {
  const unread = hasUnread(row);
  const preview = rowPreview(row, { ...(typingNames ? { typingNames } : {}), ...(draft !== undefined ? { draft } : {}) });
  const marks = rowMarks(row);
  const ticks = rowTicks(row);
  const time = rowTimeLabel(row.lastMessage?.at, now);
  const space = row.kind === "SPACE";
  const chips = space ? (row.topicChips ?? []) : [];
  const muted = row.muted;
  const on = selected;

  const quiet = on ? "text-accent-fg/80" : "text-fg-muted";
  const previewTone =
    preview.tone === "typing" ? (on ? "text-accent-fg" : "text-accent") : preview.tone === "deleted" ? cn(quiet, "italic") : quiet;

  return (
    <div
      data-chat-row=""
      data-row-id={row.id}
      data-kind={row.kind}
      data-selected={on ? "true" : "false"}
      className={cn(
        "group relative flex w-full items-center gap-3 overflow-hidden border-b border-border/60 px-3 text-start transition-colors motion-reduce:transition-none",
        space ? "py-1.5" : "py-2",
        on ? "bg-accent text-accent-fg" : "text-fg hover:bg-surface-2",
      )}
      style={{ height: tall ? ROW_HEIGHT_PHONE : ROW_HEIGHT }}
    >
      <RowAvatar row={row} tall={tall} />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {/* line 1: the title (heavier when something is unread), its small icons, then the time at the end */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={rowHref(row)}
            scroll={false}
            prefetch
            aria-current={on ? "page" : undefined}
            data-row-link=""
            className={cn(
              "min-w-0 truncate text-base leading-5 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            <bdi>{row.title}</bdi>
          </Link>
          {space ? <Users className={cn("size-3.5 shrink-0", quiet)} aria-label={ct("chatui.row.space")} role="img" /> : null}
          {marks.map((mark) => {
            const Icon = MARK_ICON[mark.key];
            return <Icon key={mark.key} className={cn("size-3.5 shrink-0", quiet)} aria-label={ct(mark.labelKey)} role="img" />;
          })}
          <span className="ms-auto flex shrink-0 items-center gap-1 ps-1">
            {ticks ? (
              ticks === "sent" ? (
                <Check className={cn("size-4", quiet)} aria-label={rowTicksLabel(ticks)} role="img" />
              ) : (
                <CheckCheck className={cn("size-4", ticks === "read" && !on ? "text-accent" : quiet)} aria-label={rowTicksLabel(ticks)} role="img" />
              )
            ) : null}
            {time ? (
              <time dir="ltr" className={cn("text-xs tabular-nums", unread && !muted && !on ? "text-accent" : quiet)}>
                {time}
              </time>
            ) : null}
          </span>
        </div>

        {/* a forum row: the most active topics as chips (unread ones first, bold), each its own link */}
        {chips.length > 0 ? (
          <div data-row-chips="" className="relative z-10 flex min-w-0 items-center gap-1 overflow-hidden py-0.5">
            {chips.map((chip) => (
              <Link
                key={chip.id}
                href={chatHref.conversation(chip.id)}
                scroll={false}
                prefetch
                className={cn(
                  "inline-flex h-5 min-w-0 max-w-[45%] shrink items-center gap-0.5 rounded-full px-2 text-xs leading-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                  on ? "bg-accent-fg/10 text-accent-fg" : "bg-surface-2 hover:bg-border/60",
                  chip.unread > 0 ? "font-semibold" : "font-normal",
                  chip.unread > 0 && !on ? "text-accent" : on ? "" : "text-fg-muted",
                )}
              >
                <span aria-hidden="true">{chip.emoji ?? "#"}</span>
                <span className="truncate">
                  <bdi>{chip.title}</bdi>
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {/* line 2: typing / the draft / the newest message, then the badges at the end */}
        <div className="flex min-w-0 items-center gap-1.5">
          <p className={cn("min-w-0 flex-1 truncate text-sm leading-5", previewTone)} data-row-preview={preview.tone}>
            {preview.tone === "draft" ? <span className={on ? "text-accent-fg" : "text-danger"}>{ct("chatui.row.draft")} </span> : null}
            {preview.author ? <span className={on ? "text-accent-fg" : "text-fg"}>{preview.author}: </span> : null}
            <bdi>{preview.text}</bdi>
          </p>
          {row.mentionsUnread > 0 ? (
            <span
              role="img"
              aria-label={ct("chatui.row.mention")}
              className={cn("grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold leading-none", on ? "bg-accent-fg text-accent" : "bg-accent text-accent-fg")}
            >
              @
            </span>
          ) : null}
          {unread ? (
            <span
              data-unread-pill=""
              className={cn(
                "min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs font-semibold leading-5 tabular-nums",
                on ? "bg-accent-fg text-accent" : muted ? "bg-surface-2 text-fg-muted" : "bg-accent text-accent-fg",
              )}
            >
              {row.unread > 0 ? unreadText(row.unread) : <span className="sr-only">{ct("chatui.row.marked_unread")}</span>}
            </span>
          ) : rowPinned(row) ? (
            <Pin className={cn("size-4 shrink-0", quiet)} aria-label={ct("chath.pinned")} role="img" />
          ) : null}
        </div>
      </div>

      {menu}
    </div>
  );
}

/** What a connected row needs from the column around it. Plain values, so `memo` can tell when a row has nothing new to draw. */
export interface ChatRowItemProps {
  id: string;
  /** is this the conversation that is open (its row is highlighted)? A boolean, so choosing another chat re-renders two rows, not all of them */
  selected: boolean;
  tall: boolean;
  userId: string;
  menu: RowMenuContext;
}

/**
 * The row as the list draws it: it subscribes to ITSELF by id (`useChatRow`), so a new message in one chat re-renders that one row and moves it,
 * never the whole list; the typing line and the draft are its own too. `memo` keeps the others still when the list re-sorts.
 */
export const ChatRowItem = memo(function ChatRowItem({ id, selected, tall, userId, menu }: ChatRowItemProps) {
  const row = useChatRow(id);
  if (!row) return null;
  return <ConnectedRow row={row} selected={selected} tall={tall} userId={userId} menu={menu} />;
});

function ConnectedRow({ row, selected, tall, userId, menu }: { row: ChatRowDto; selected: boolean; tall: boolean; userId: string; menu: RowMenuContext }) {
  const conversation = row.kind !== "SPACE";
  // a topic of a space row is a different conversation: «typing» and the draft belong to conversations only
  const typing = useTyping(conversation ? row.id : null);
  const draft = useRowDraft(userId, row.id, { selected, enabled: conversation });
  const [open, setOpen] = useState(false);
  const has = rowHasMenu(row, menu);
  const gestures = useRowMenuGestures(() => setOpen(true), has);
  return (
    <div {...gestures} className="contents">
      <RowView
        row={row}
        selected={selected}
        tall={tall}
        typingNames={typing.typingNames}
        draft={draft}
        menu={has ? <RowActionsMenu row={row} ctx={menu} open={open} onOpenChange={setOpen} openConversationId={selected ? row.id : null} className="ms-1" /> : null}
      />
    </div>
  );
}
