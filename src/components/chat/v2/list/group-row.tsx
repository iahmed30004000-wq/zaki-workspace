"use client";

import React from "react";
import { Lock } from "lucide-react";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import type { GroupRowModel } from "@/lib/chat/v2/groups";
import { ct, ctCount } from "@/lib/chat/text";
import { rowPreview, rowTimeLabel, unreadText } from "@/lib/chat/row-preview";
import { cn } from "@/lib/utils";
import { ROW_HEIGHT, ROW_HEIGHT_PHONE } from "./chat-row";

/**
 * «مجموعات المواضيع» — ONE row of the list for a group, like Telegram's forum group: its picture, its name, the newest message of its topics and the unread of all of them added up.
 * A tap opens the group's topics (`onOpen`); «عام» (`id` null) is the topics that have no group. The numbers come from the topic rows (`groupRows`), never from a counter of their own.
 */
export function GroupRowItem({ group, tall, now, onOpen }: { group: GroupRowModel; tall: boolean; now: Date; onOpen: (group: GroupRowModel) => void }) {
  // the last message is drawn with the very words of a topic row (author, «صورة»، «رسالة محذوفة»…): the group is shown as the topic it is the newest of
  const preview = rowPreview({ kind: "TOPIC", lastMessage: group.last } as ChatRowDto);
  const time = rowTimeLabel(group.last?.at, now);
  const unread = group.unread > 0;
  const size = tall ? "size-14" : "size-12";
  return (
    <button
      type="button"
      data-group-row={group.id ?? "general"}
      onClick={() => onOpen(group)}
      aria-label={ct("chatgrp.open_label", { name: group.name })}
      style={{ height: tall ? ROW_HEIGHT_PHONE : ROW_HEIGHT }}
      className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-start text-fg transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
    >
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-surface-2 text-xl", size)}>
        {group.emoji ?? (group.id === null ? "🗂️" : "📁")}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate text-base leading-5", unread ? "font-semibold" : "font-medium")}>
            <bdi>{group.name}</bdi>
          </span>
          {group.restricted ? <Lock className="size-3.5 shrink-0 text-fg-muted" role="img" aria-label={ct("chatgrp.restricted")} /> : null}
          {time ? (
            <time dir="ltr" className={cn("ms-auto shrink-0 ps-1 text-xs tabular-nums", unread && !group.muted ? "text-accent" : "text-fg-muted")}>
              {time}
            </time>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 text-fg-muted" data-group-preview={preview.tone}>
            {group.last ? (
              <>
                {preview.author ? <span className="text-fg">{preview.author}: </span> : null}
                <bdi>{preview.text}</bdi>
              </>
            ) : (
              ctCount("chatui.forum.topics", group.topicCount)
            )}
          </span>
          {group.mentions > 0 ? (
            <span role="img" aria-label={ct("chatui.row.mention")} className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold leading-none text-accent-fg">
              @
            </span>
          ) : null}
          {unread ? (
            <span data-unread-pill="" className={cn("min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs font-semibold leading-5 tabular-nums", group.muted ? "bg-surface-2 text-fg-muted" : "bg-accent text-accent-fg")}>
              {unreadText(group.unread)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
