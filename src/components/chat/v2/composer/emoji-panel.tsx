"use client";

import React from "react";
import { EmojiPicker } from "frimousse";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ct } from "@/lib/chat/text";
import { resolveBundledEmojiData } from "@/lib/chat/v2/composer/emoji-data";
import { emojiGroupOf, type EmojiGroup } from "@/lib/chat/v2/composer/emoji-groups";
import { useIsDesktop } from "@/lib/chat/v2/use-media";

/**
 * C2.5 — the emoji picker (`frimousse`, already a dependency): a popover over the box on the computer, a bottom sheet on the phone, the person's recent
 * emojis on top (kept on this device, `recent-emoji.ts`). The picker's data is Emojibase's English set read from the package we already ship (`emoji-data.ts`:
 * no third-party address is asked); the nine group names on screen are the dictionary's.
 */
function groupLabels(): Record<EmojiGroup, string> {
  return {
    smileys: ct("chatui.composer.emoji_group_smileys"),
    people: ct("chatui.composer.emoji_group_people"),
    animals: ct("chatui.composer.emoji_group_animals"),
    food: ct("chatui.composer.emoji_group_food"),
    travel: ct("chatui.composer.emoji_group_travel"),
    activities: ct("chatui.composer.emoji_group_activities"),
    objects: ct("chatui.composer.emoji_group_objects"),
    symbols: ct("chatui.composer.emoji_group_symbols"),
    flags: ct("chatui.composer.emoji_group_flags"),
  };
}

const LIST_PARTS = {
  CategoryHeader: ({ category, ...props }: { category: { label: string } } & React.ComponentProps<"div">) => {
    const group = emojiGroupOf(category.label);
    return (
      <div {...props} className="bg-surface-1 px-2 py-1 text-xs font-semibold text-fg-muted">
        {group ? groupLabels()[group] : null}
      </div>
    );
  },
  Row: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props} className="flex scroll-my-1 px-1">
      {children}
    </div>
  ),
  Emoji: ({ emoji, ...props }: { emoji: { emoji: string; label: string; isActive: boolean } } & React.ComponentProps<"button">) => (
    <button {...props} type="button" className="flex size-9 shrink-0 items-center justify-center rounded-md text-xl data-[active]:bg-surface-2">
      {emoji.emoji}
    </button>
  ),
};

/** The picker itself (search, the list, the recents on top). */
export function EmojiPanel({ recents, onPick }: { recents: string[]; onPick: (emoji: string) => void }) {
  return (
    <div data-emoji-panel className="flex flex-col gap-2">
      {recents.length > 0 ? (
        <div data-emoji-recents>
          <p className="px-1 pb-1 text-xs font-semibold text-fg-muted">{ct("chatui.composer.emoji_recent")}</p>
          <ul className="flex flex-wrap gap-0.5">
            {recents.map((emoji) => (
              <li key={emoji}>
                <button type="button" className="flex size-9 items-center justify-center rounded-md text-xl hover:bg-surface-2" onClick={() => onPick(emoji)}>
                  {emoji}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <EmojiPicker.Root onEmojiSelect={({ emoji }) => onPick(emoji)} resolveEmojiData={resolveBundledEmojiData} columns={8} className="flex h-72 w-full flex-col">
        <EmojiPicker.Search placeholder={ct("chatui.composer.emoji_search")} aria-label={ct("chatui.composer.emoji_search")} className="mb-1 h-10 rounded-lg border border-border bg-surface px-3 text-base" />
        <EmojiPicker.Viewport className="min-h-0 flex-1 overflow-y-auto">
          <EmojiPicker.Loading>
            <span className="block p-3 text-center text-sm text-fg-muted">{ct("chatui.composer.emoji_loading")}</span>
          </EmojiPicker.Loading>
          <EmojiPicker.Empty>
            <span className="block p-3 text-center text-sm text-fg-muted">{ct("chatui.composer.emoji_empty")}</span>
          </EmojiPicker.Empty>
          <EmojiPicker.List components={LIST_PARTS} />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
}

/**
 * The picker where it belongs: on the computer a popover above the box (a tap outside or Esc closes it, it stays open to pick several); on the phone a bottom
 * sheet (it closes after a pick). Rendered inside the box's `relative` row so the popover is anchored to it.
 */
export function EmojiPopover({ open, onClose, recents, onPick }: { open: boolean; onClose: () => void; recents: string[]; onPick: (emoji: string) => void }) {
  const desktop = useIsDesktop();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const desktopOpen = open && desktop !== false;
  React.useEffect(() => {
    if (!desktopOpen) return;
    const down = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && ref.current && !ref.current.contains(target) && !(target as Element).closest?.("[data-emoji-toggle]")) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [desktopOpen, onClose]);
  if (!open) return null;
  if (desktop === false) {
    return (
      <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{ct("chatui.composer.emoji")}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <EmojiPanel
              recents={recents}
              onPick={(emoji) => {
                onPick(emoji);
                onClose();
              }}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <div ref={ref} role="dialog" aria-label={ct("chatui.composer.emoji")} data-emoji-popover className="absolute bottom-full start-0 z-20 mb-2 w-80 max-w-full rounded-xl border border-border bg-surface-1 p-2 shadow-lg">
      <EmojiPanel recents={recents} onPick={onPick} />
    </div>
  );
}
