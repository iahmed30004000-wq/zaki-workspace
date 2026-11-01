"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ct } from "@/lib/chat/text";
import { setSoundsEnabled, soundsEnabled } from "@/lib/chat/sounds";

/** «الأصوات»: a switch for the chat's sounds, kept in this browser (src/lib/chat/sounds.ts). */
function SoundToggle() {
  const [on, setOn] = React.useState(true);
  React.useEffect(() => setOn(soundsEnabled()), []);
  return (
    <button
      type="button"
      data-sound-toggle
      aria-pressed={on}
      aria-label={ct("chatc.sounds")}
      title={ct("chatc.sounds")}
      onClick={() => {
        setSoundsEnabled(!on);
        setOn(!on);
      }}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-lg hover:bg-surface-2"
    >
      <span aria-hidden="true">{on ? "🔔" : "🔕"}</span>
    </button>
  );
}

/**
 * The conversation's head, one tidy row on every screen (the owner, 2026-10-26: «نسخة الهاتف مخربطة ومعجوقة»، «ما في زر
 * رجوع بنسخة اللابتوب»): «رجوع» always (an arrow on a phone, the word too from `md`), the title and its line under it
 * (cut, never wrapping over the buttons), the call button, then — on a computer — search, the whiteboard and the topic's
 * settings as buttons, and on a phone the same three folded in one «⋯» menu.
 */
export function ConversationHeader({
  conversationId,
  title,
  subtitle,
  call,
  searching,
  onSearch,
  canSet,
  onSettings,
  onBack,
  whiteboard = true,
}: {
  conversationId: string;
  title: string;
  subtitle: string;
  /** the call button (it decides by itself whether to show) */
  call: React.ReactNode;
  searching: boolean;
  onSearch: () => void;
  canSet: boolean;
  onSettings: () => void;
  onBack: () => void;
  /** the company's «السبورة» switch: off, no link to the board (the page is gone too) */
  whiteboard?: boolean;
}) {
  const board = `/chat/${encodeURIComponent(conversationId)}/whiteboard`;
  const pill = "inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-surface-2";
  return (
    <header className="flex items-center gap-2 border-b border-border px-2 py-2 md:gap-3 md:px-3">
      <button type="button" onClick={onBack} aria-label={ct("chatc.back")} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 hover:bg-surface-2">
        <ArrowRight aria-hidden="true" className="size-5" />
        <span className="hidden text-sm md:inline">{ct("chatc.back")}</span>
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold leading-tight">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-fg-muted">{subtitle}</p> : null}
      </div>
      <SoundToggle />
      <div className="shrink-0">{call}</div>
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <button type="button" aria-expanded={searching} onClick={onSearch} className={pill}>
          <span aria-hidden="true">🔍</span>
          {ct("chatc.search.open")}
        </button>
        {whiteboard && (
          <Link href={board} className={pill}>
            <span aria-hidden="true">🖍️</span>
            {ct("whiteboard.open")}
          </Link>
        )}
        {canSet && (
          <button type="button" onClick={onSettings} className={pill}>
            <span aria-hidden="true">⚙</span>
            {ct("chatc.topic.settings")}
          </button>
        )}
      </div>
      <div className="shrink-0 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={ct("chatc.more")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-2">
              <MoreVertical aria-hidden="true" className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onSearch}>
              <span aria-hidden="true">🔍</span> {ct("chatc.search.open")}
            </DropdownMenuItem>
            {whiteboard && (
              <DropdownMenuItem asChild>
                <Link href={board}>
                  <span aria-hidden="true">🖍️</span> {ct("whiteboard.open")}
                </Link>
              </DropdownMenuItem>
            )}
            {canSet && (
              <DropdownMenuItem onSelect={onSettings}>
                <span aria-hidden="true">⚙</span> {ct("chatc.topic.settings")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
