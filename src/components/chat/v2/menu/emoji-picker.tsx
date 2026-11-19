"use client";

import React from "react";
import { EmojiPicker, type EmojiData } from "frimousse";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { emojiDataOf, type EmojibaseRow } from "@/lib/chat/v2/menu/emoji-data";

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
 */
export function EmojiPickerDialog({ open, onOpenChange, onPick, portal = true }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (emoji: string) => void; portal?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent portal={portal} size="sm" aria-label={ct("chatui.menu.picker_title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatui.menu.picker_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="p-0">
          <EmojiPicker.Root
            data-emoji-picker
            columns={8}
            locale="en"
            resolveEmojiData={resolveEmojiData}
            onEmojiSelect={({ emoji }) => {
              onPick(emoji);
              onOpenChange(false);
            }}
            className="isolate flex h-80 w-full flex-col bg-surface-1"
          >
            <EmojiPicker.Viewport className="relative flex-1 outline-none">
              <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">{ct("chatui.menu.picker_loading")}</EmojiPicker.Loading>
              <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">{ct("chatui.menu.picker_empty")}</EmojiPicker.Empty>
              <EmojiPicker.List
                components={{
                  CategoryHeader: ({ category, ...props }) => (
                    <div {...props} className="bg-surface-1 px-3 pb-1.5 pt-3 text-xs font-semibold text-fg-muted">
                      {category.label}
                    </div>
                  ),
                  Row: ({ children, ...props }) => (
                    <div {...props} className="scroll-my-1.5 px-1.5">
                      {children}
                    </div>
                  ),
                  Emoji: ({ emoji, ...props }) => (
                    <button {...props} aria-label={emoji.emoji} className="flex size-10 items-center justify-center rounded-md text-xl data-[active]:bg-surface-2">
                      {emoji.emoji}
                    </button>
                  ),
                }}
              />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
