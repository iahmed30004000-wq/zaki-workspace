"use client";

import React from "react";
import { MessagesSquare, Search, SquarePen, Users, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ListSearchPanel } from "@/components/chat/v2/info/list-search-results";
import { ct } from "@/lib/chat/text";

/**
 * C2.2 — the top of the list: the search field «بحث» (Esc clears it) and, on the computer, the pencil that starts a new message. The words typed
 * narrow the rows the list holds (`rowMatches`: only text the rows already show). The phone has the round button at the bottom end instead
 * (`NewMessageFab`).
 *
 * C3d: from two letters on, ONE request (`GET /api/search?scope=chat`) also brings the chats, the people and the messages that carry the words; they are drawn as
 * a panel over the rows (`ListSearchPanel`), only while there is something to show, and opening one clears the field.
 */
export function ListHeader({
  query,
  onQuery,
  onNewMessage,
  onNewGroup,
  onNewTopic,
  searchId,
  menu,
}: {
  query: string;
  onQuery: (value: string) => void;
  /** undefined: no pencil (a guest has no private chats; the phone has its round button) */
  onNewMessage?: () => void;
  /** «مجموعة جديدة» in the pencil's menu (given with `onNewMessage`) */
  onNewGroup?: () => void;
  /** «موضوع جديد», only for somebody who may open a topic in the space on screen */
  onNewTopic?: () => void;
  searchId: string;
  /** S6.6 «شكل تيليجرام»: the list's main «⋮» menu, at the end of the row */
  menu?: React.ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {ct("chatui.search.label")}
          </label>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                onQuery("");
              }
            }}
            placeholder={ct("chatui.search.placeholder")}
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 w-full rounded-full border border-border bg-surface-1 ps-9 pe-9 text-base text-fg placeholder:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:h-10 md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label={ct("chatui.search.clear")}
              onClick={() => onQuery("")}
              className="absolute end-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {onNewMessage && !onNewGroup && !onNewTopic ? (
          <button
            type="button"
            aria-label={ct("chath.new_dm")}
            title={ct("chath.new_dm")}
            onClick={onNewMessage}
            className="hidden size-10 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:grid"
          >
            <SquarePen className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        {onNewMessage && (onNewGroup || onNewTopic) ? (
          // the computer's pencil: a menu of everything new — a message, a group, a topic (the owner, 2026-11-21: «زر إنشاء المواضيع أو الجروب ما لقيته»)
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={ct("chath.new_dm")}
                title={ct("chath.new_dm")}
                className="hidden size-10 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:grid"
              >
                <SquarePen className="size-5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[60]">
              <DropdownMenuItem onSelect={onNewMessage}>
                <SquarePen aria-hidden="true" className="size-4" /> {ct("chath.new_dm")}
              </DropdownMenuItem>
              {onNewGroup ? (
                <DropdownMenuItem onSelect={onNewGroup}>
                  <Users aria-hidden="true" className="size-4" /> {ct("chath.group.new")}
                </DropdownMenuItem>
              ) : null}
              {onNewTopic ? (
                <DropdownMenuItem onSelect={onNewTopic}>
                  <MessagesSquare aria-hidden="true" className="size-4" /> {ct("chath.topic.new")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {menu}
      </div>
      <ListSearchPanel query={query} onPick={() => onQuery("")} />
    </div>
  );
}
