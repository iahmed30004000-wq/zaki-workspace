"use client";

import React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { reactorRows, reactorsHidden, type ReactionChip } from "@/lib/chat-reactions";
import { ct } from "@/lib/chat/text";
import { zakiIdOfCode, zakiNameOf, zakiSrc } from "@/lib/chat/zaki-emoji";
import { cn } from "@/lib/utils";

/** An emoji as the sheet draws it: a Zaki code is its small picture, any other emoji is itself. */
function Face({ emoji, className }: { emoji: string; className?: string }) {
  const zaki = zakiIdOfCode(emoji);
  if (zaki === null) return <span aria-hidden="true" className={cn("leading-none", className)}>{emoji}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
  return <img src={zakiSrc(zaki)} alt={zakiNameOf(zaki)} draggable={false} className="size-5 shrink-0 object-contain" />;
}

/**
 * S5.6 — «مين تفاعل»: a sheet that lists the people behind a message's reaction chips. A tab «الكل» (every person once, with the emojis they used) and one tab per chip with its
 * count; a row is the person's picture and name («أنت» on my own). The names are what the SERVER decided this viewer may be told (`ReactionDto.by`: a guest sees only himself, a
 * receipt's names are the author's): what it could not name is said as «و N غيرهم», never guessed. Opened by a long press (or the right button) on a chip; the bubble draws it
 * BESIDE its article so a press in the sheet never starts the bubble's own gestures.
 */
export function ReactorsSheet({ open, onOpenChange, reactions, initial, portal = true }: { open: boolean; onOpenChange: (open: boolean) => void; reactions: readonly ReactionChip[]; initial: string | null; portal?: boolean }) {
  const [picked, setPicked] = React.useState<string | null>(initial);
  // a chip that went away while the sheet was open: back to «الكل»
  const tab = picked !== null && reactions.some((r) => r.emoji === picked) ? picked : null;
  if (!open) return null;
  const rows = reactorRows(reactions, tab);
  const hidden = reactorsHidden(reactions, tab);
  const total = reactions.reduce((sum, r) => sum + r.count, 0);
  const tabClass = (on: boolean) => cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", on ? "bg-accent/15 text-accent" : "bg-surface-2 text-fg-muted hover:text-fg");
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent portal={portal} data-reactors-sheet>
        <SheetHeader>
          <SheetTitle>{ct("chatemoji.who.title")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div role="tablist" aria-label={ct("chatemoji.who.title")} className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            <button type="button" role="tab" aria-selected={tab === null} data-reactors-tab="all" onClick={() => setPicked(null)} className={tabClass(tab === null)}>
              {ct("chatemoji.who.all")}
              <span>{total}</span>
            </button>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                role="tab"
                aria-selected={tab === r.emoji}
                aria-label={ct("chatemoji.who.tab", { emoji: zakiIdOfCode(r.emoji) !== null ? zakiNameOf(zakiIdOfCode(r.emoji)!) : r.emoji, count: r.count })}
                data-reactors-tab={r.emoji}
                onClick={() => setPicked(r.emoji)}
                className={tabClass(tab === r.emoji)}
              >
                <Face emoji={r.emoji} className="text-base" />
                <span>{r.count}</span>
              </button>
            ))}
          </div>
          {rows.length === 0 && hidden === 0 ? <p className="py-6 text-center text-sm text-fg-muted">{ct("chatemoji.who.empty")}</p> : null}
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.id} data-reactor-row {...(row.me ? { "data-reactor-me": "" } : {})} className="flex min-h-12 items-center gap-3 rounded-lg px-2">
                <Avatar name={row.name} src={row.avatar} className="size-9 text-sm" />
                <span className="min-w-0 flex-1 truncate text-base">
                  {row.name}
                  {row.me ? <span className="ms-1.5 text-xs text-fg-muted">{ct("chatemoji.who.me")}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {row.emojis.map((emoji) => (
                    <Face key={emoji} emoji={emoji} className="text-xl" />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <p data-reactors-more className="px-2 pt-2 text-sm text-fg-muted">
              {ct("chatemoji.who.more", { count: hidden })}
            </p>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
