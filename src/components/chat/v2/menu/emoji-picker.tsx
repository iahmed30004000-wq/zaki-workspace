"use client";

import React from "react";
import { EmojiPicker, type EmojiData } from "frimousse";
import { Search } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { emojiDataOf, type EmojibaseRow } from "@/lib/chat/v2/menu/emoji-data";
import { ZakiStickerGrid } from "@/components/chat/v2/composer/emoji-panel";
import { cn } from "@/lib/utils";

/** The ten groups of the dataset (the skin-tone components, group 2, are not drawn): one literal key each, so a missing word fails a test. */
const CATEGORY_KEYS: Record<number, string> = {
  0: "chatui.menu.cat.smileys",
  1: "chatui.menu.cat.people",
  3: "chatui.menu.cat.animals",
  4: "chatui.menu.cat.food",
  5: "chatui.menu.cat.travel",
  6: "chatui.menu.cat.activities",
  7: "chatui.menu.cat.objects",
  8: "chatui.menu.cat.symbols",
  9: "chatui.menu.cat.flags",
};
const categoryLabel = (group: number) => ct(CATEGORY_KEYS[group] ?? "chatui.menu.cat.symbols");

/** The dataset of the installed package, loaded when the picker first opens (it is large) and never from another site. */
async function resolveEmojiData(): Promise<EmojiData> {
  const rows = (await import("emojibase-data/en/data.json")).default as unknown as EmojibaseRow[];
  return emojiDataOf(rows, { categoryLabel });
}

/**
 * C2.6 — the full emoji picker (`frimousse`) behind «⌄» of the quick-reaction bar: a dialog with the categories in Arabic, one press picks the emoji and
 * closes it. The reaction goes through the same react door as the quick six (the server accepts any single emoji).
 *
 * S5.6 — Zaki stickers are reactions too: beside the emojis the dialog has the tab «ذكي» (the 32 dolphin stickers) and «حالات المهام» (the 16 task stickers); a press hands over the
 * sticker's code (`:zaki_clap:`), which the react door checks against the pack's allow-list (and the company's switch `zakiEmojis`). `zaki={false}` leaves the emojis alone.
 */
export function EmojiPickerDialog({ open, onOpenChange, onPick, portal = true, zaki = true }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (emoji: string) => void; portal?: boolean; zaki?: boolean }) {
  const [tab, setTab] = React.useState<"emoji" | "zaki" | "task">("emoji");
  const tabs: { id: "emoji" | "zaki" | "task"; label: string }[] = [
    { id: "emoji", label: ct("chatemoji.picker.emoji") },
    { id: "zaki", label: ct("chatemoji.picker.zaki") },
    { id: "task", label: ct("chatemoji.picker.task") },
  ];
  const picked = (code: string) => {
    onPick(code);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent portal={portal} size="sm" aria-label={ct("chatui.menu.picker_title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatui.menu.picker_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="p-0">
          {zaki ? (
            <div role="tablist" aria-label={ct("chatui.menu.picker_title")} className="flex gap-1.5 bg-surface-1 px-2 pt-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  data-picker-tab={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn("inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", tab === t.id ? "bg-accent/15 text-accent" : "bg-surface-2 text-fg-muted hover:text-fg")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
          {zaki && tab !== "emoji" ? (
            <div className="flex h-96 flex-col bg-surface-1 p-2">
              <ZakiStickerGrid onPick={picked} section={tab === "task" ? "task" : "chat"} />
            </div>
          ) : (
          <EmojiPicker.Root
            data-emoji-picker
            columns={8}
            locale="en"
            resolveEmojiData={resolveEmojiData}
            onEmojiSelect={({ emoji }) => {
              onPick(emoji);
              onOpenChange(false);
            }}
            className="isolate flex h-96 w-full flex-col gap-1.5 bg-surface-1 p-2"
          >
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
              <EmojiPicker.Search placeholder={ct("chatui.composer.emoji_search")} aria-label={ct("chatui.composer.emoji_search")} className="h-10 w-full rounded-full bg-surface-2 ps-10 pe-3 text-base text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent/40" />
            </div>
            <EmojiPicker.Viewport className="relative min-h-0 flex-1 outline-none">
              <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">{ct("chatui.menu.picker_loading")}</EmojiPicker.Loading>
              <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">{ct("chatui.menu.picker_empty")}</EmojiPicker.Empty>
              <EmojiPicker.List
                components={{
                  CategoryHeader: ({ category, ...props }) => (
                    <div {...props} className="bg-surface-1 px-3 pb-1 pt-2 text-xs font-semibold text-fg-muted">
                      {category.label}
                    </div>
                  ),
                  Row: ({ children, ...props }) => (
                    <div {...props} className="flex scroll-my-1.5 px-1">
                      {children}
                    </div>
                  ),
                  Emoji: ({ emoji, ...props }) => (
                    <button {...props} aria-label={emoji.emoji} className="flex h-11 flex-1 items-center justify-center rounded-lg text-[30px] leading-none data-[active]:bg-surface-2">
                      {emoji.emoji}
                    </button>
                  ),
                }}
              />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
