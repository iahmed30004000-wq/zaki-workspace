"use client";

import React from "react";
import { EmojiPicker } from "frimousse";
import { Car, Delete, Dumbbell, Flag, Hash, Lightbulb, PawPrint, Search, Smile, ThumbsUp, Utensils, type LucideIcon } from "lucide-react";
import "@/components/chat/v2/phone/tg-messages.css";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ct } from "@/lib/chat/text";
import { resolveBundledEmojiData, toEmojiData } from "@/lib/chat/v2/composer/emoji-data";
import { emojiGroupOf, type EmojiGroup } from "@/lib/chat/v2/composer/emoji-groups";
import { cardRowDelayMs } from "@/lib/chat/v2/menu/phone-menu";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { useIsDesktop } from "@/lib/chat/v2/use-media";
import { ZAKI_EMOJIS, ZAKI_EMOJI_CATEGORIES, ZAKI_TASK_STICKERS, zakiCode, zakiSrc } from "@/lib/chat/zaki-emoji";

/**
 * C2.5 — the emoji picker (`frimousse`, already a dependency), drawn like Telegram's: a rounded search field, a row of round category tabs with outline
 * icons (the active one in the accent: it follows the scrolling and a press scrolls to its group), the person's recent emojis, then a grid of large emojis
 * (40 px cells, 28 px glyphs) under quiet group titles. A popover over the box on the computer, a bottom sheet on the phone (recent emojis are kept on this
 * device, `recent-emoji.ts`). The data is Emojibase's English set read from the package we already ship (`emoji-data.ts`: no third-party address is asked); the
 * group names on screen are the dictionary's.
 *
 * The owner's Zaki pack (the dolphin stickers, `zaki-emoji.ts`) is the FIRST tab «ذكي» while the company's switch `zakiEmojis` is on (the `zaki` prop): it swaps the
 * grid for the stickers (56 px, under «مشاعر» and «حركات»), and a press hands the picker the sticker's short text code (`:zaki_smile:`), exactly as an emoji is handed.
 * S5.6: the 16 task-status stickers are the tab beside it (`data-emoji-tab="task"`, «حالات المهام»), under the same switch; they are picked like any sticker (only the picker: the work
 * pages do not use them as status marks).
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

/** The tabs, in the order of the data (`emoji-data.ts` lists the nine groups in this order). */
export const EMOJI_TABS: ReadonlyArray<{ group: EmojiGroup; icon: LucideIcon }> = [
  { group: "smileys", icon: Smile },
  { group: "people", icon: ThumbsUp },
  { group: "animals", icon: PawPrint },
  { group: "food", icon: Utensils },
  { group: "travel", icon: Car },
  { group: "activities", icon: Dumbbell },
  { group: "objects", icon: Lightbulb },
  { group: "symbols", icon: Hash },
  { group: "flags", icon: Flag },
];
const COLUMNS = 8;

const LIST_PARTS = {
  CategoryHeader: ({ category, ...props }: { category: { label: string } } & React.ComponentProps<"div">) => {
    const group = emojiGroupOf(category.label);
    return (
      <div {...props} className="bg-surface-1 px-3 pb-1 pt-2 text-xs font-semibold text-fg-muted">
        {group ? groupLabels()[group] : null}
      </div>
    );
  },
  Row: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props} className="flex scroll-my-1 px-1.5">
      {children}
    </div>
  ),
  Emoji: ({ emoji, ...props }: { emoji: { emoji: string; label: string; isActive: boolean } } & React.ComponentProps<"button">) => (
    <button {...props} type="button" className="flex h-10 flex-1 items-center justify-center rounded-lg text-[28px] leading-none data-[active]:bg-surface-2">
      {emoji.emoji}
    </button>
  ),
};

/**
 * The Zaki stickers: the two headings and a grid of 56 px picture buttons; a press hands over the sticker's text code (the bubble draws it as the picture). `section="task"`
 * (S5.6) is the 16 task-status stickers alone, under their own heading.
 */
export function ZakiStickerGrid({ onPick, section = "chat" }: { onPick: (code: string) => void; section?: "chat" | "task" }) {
  const groups: { heading: string; items: { id: string; name: string }[] }[] =
    section === "task"
      ? [{ heading: ct("chatemoji.tab_task"), items: ZAKI_TASK_STICKERS.map((t) => ({ id: t.emoji, name: t.name })) }]
      : ZAKI_EMOJI_CATEGORIES.map((category) => ({ heading: category, items: ZAKI_EMOJIS.filter((e) => e.category === category).map((e) => ({ id: e.id, name: e.name })) }));
  return (
    <div data-zaki-grid data-zaki-section={section} className="min-h-0 flex-1 overflow-y-auto pb-1">
      {groups.map(({ heading: category, items }) => (
        <section key={category}>
          <h3 className="px-3 pb-1 pt-2 text-xs font-semibold text-fg-muted">{category}</h3>
          <ul className="grid grid-cols-5 gap-0.5 px-1.5">
            {items.map((e) => (
              <li key={e.id} className="flex justify-center">
                <button type="button" data-zaki-pick={e.id} title={e.name} aria-label={e.name} onClick={() => onPick(zakiCode(e.id))} className="flex size-14 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack */}
                  <img src={zakiSrc(e.id)} alt="" loading="lazy" decoding="async" draggable={false} className="size-12 object-contain" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The offsets (px from the top of the grid) at which each of the nine groups starts, from the group sizes and the picker's own measured row and header heights. */
function offsetsOf(counts: readonly number[], rowHeight: number, headerHeight: number): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const n of counts) {
    offsets.push(at);
    at += headerHeight + Math.ceil(n / COLUMNS) * rowHeight;
  }
  return offsets;
}

/** The picker itself (search, the tabs, the recents, the grid). */
export function EmojiPanel({ recents, onPick, zaki = false }: { recents: string[]; onPick: (emoji: string) => void; zaki?: boolean }) {
  const root = React.useRef<HTMLDivElement | null>(null);
  const viewport = React.useRef<HTMLDivElement | null>(null);
  const [counts, setCounts] = React.useState<number[]>([]);
  const [tab, setTab] = React.useState(0);
  // the sticker tab shown instead of the grid: the 32 chat stickers, the 16 task stickers, or none
  const [sticker, setSticker] = React.useState<"chat" | "task" | null>(null);
  const stickers = sticker !== null;
  const pending = React.useRef<number | null>(null);
  const goToRef = React.useRef<(index: number) => void>(() => undefined);
  // a tab pressed while the stickers are shown: the grid comes back first, then it scrolls to the group
  React.useEffect(() => {
    if (stickers || pending.current === null) return;
    const index = pending.current;
    pending.current = null;
    const frame = requestAnimationFrame(() => goToRef.current(index));
    return () => cancelAnimationFrame(frame);
  }, [stickers]);
  React.useEffect(() => {
    let live = true;
    void import("emojibase-data/en/data.json").then((set) => {
      const data = toEmojiData(set.default as unknown as Parameters<typeof toEmojiData>[0]);
      if (!live) return;
      const sizes = new Map<number, number>();
      for (const e of data.emojis) sizes.set(e.category, (sizes.get(e.category) ?? 0) + 1);
      setCounts(data.categories.map((c) => sizes.get(c.index) ?? 0));
    });
    return () => {
      live = false;
    };
  }, []);
  const heights = () => {
    const style = root.current ? getComputedStyle(root.current) : null;
    const row = style ? Number.parseFloat(style.getPropertyValue("--frimousse-row-height")) : NaN;
    const header = style ? Number.parseFloat(style.getPropertyValue("--frimousse-category-header-height")) : NaN;
    return Number.isFinite(row) && Number.isFinite(header) ? { row, header } : null;
  };
  const goTo = (index: number) => {
    if (stickers) {
      pending.current = index;
      setTab(index);
      setSticker(null);
      return;
    }
    const h = heights();
    const view = viewport.current;
    if (!h || !view || counts.length === 0) return;
    setTab(index);
    view.scrollTo({ top: offsetsOf(counts, h.row, h.header)[index] ?? 0 });
  };
  goToRef.current = goTo;
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const h = heights();
    if (!h || counts.length === 0) return;
    const top = event.currentTarget.scrollTop + 1;
    let active = 0;
    offsetsOf(counts, h.row, h.header).forEach((offset, i) => {
      if (offset <= top) active = i;
    });
    setTab((now) => (now === active ? now : active));
  };
  const labels = groupLabels();
  return (
    <div data-emoji-panel className="flex flex-col gap-1.5">
      <EmojiPicker.Root ref={root} onEmojiSelect={({ emoji }) => onPick(emoji)} resolveEmojiData={resolveBundledEmojiData} columns={COLUMNS} className="flex h-[min(22rem,60vh)] w-full flex-col gap-1.5">
        {stickers ? null : (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
            <EmojiPicker.Search
              placeholder={ct("chatui.composer.emoji_search")}
              aria-label={ct("chatui.composer.emoji_search")}
              className="h-10 w-full rounded-full bg-surface-2 ps-10 pe-3 text-base text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </div>
        )}
        <div role="tablist" aria-label={ct("chatui.composer.emoji")} data-emoji-tabs className="flex items-center justify-between gap-0.5 overflow-x-auto border-b border-border pb-1.5">
          {zaki ? (
            <button
              type="button"
              role="tab"
              aria-selected={sticker === "chat"}
              aria-label={ct("chatui.composer.emoji_zaki")}
              title={ct("chatui.composer.emoji_zaki")}
              data-emoji-tab="zaki"
              onClick={() => setSticker("chat")}
              className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${sticker === "chat" ? "bg-accent/10" : "hover:bg-surface-2"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the dolphin of the owner's pack, a small local picture */}
              <img src={zakiSrc("smile")} alt="" draggable={false} className="size-6 object-contain" />
            </button>
          ) : null}
          {zaki ? (
            <button
              type="button"
              role="tab"
              aria-selected={sticker === "task"}
              aria-label={ct("chatemoji.tab_task")}
              title={ct("chatemoji.tab_task")}
              data-emoji-tab="task"
              onClick={() => setSticker("task")}
              className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${sticker === "task" ? "bg-accent/10" : "hover:bg-surface-2"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a task sticker of the owner's pack, a small local picture */}
              <img src={zakiSrc("task_done")} alt="" draggable={false} className="size-6 object-contain" />
            </button>
          ) : null}
          {EMOJI_TABS.map(({ group, icon: Icon }, i) => (
            <button
              key={group}
              type="button"
              role="tab"
              aria-selected={!stickers && tab === i}
              aria-label={labels[group]}
              title={labels[group]}
              data-emoji-tab={group}
              onClick={() => goTo(i)}
              className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${!stickers && tab === i ? "bg-accent/10 text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
            >
              <Icon aria-hidden="true" className="size-5" />
            </button>
          ))}
        </div>
        {sticker !== null ? <ZakiStickerGrid onPick={onPick} section={sticker} /> : null}
        {!stickers && recents.length > 0 ? (
          <div data-emoji-recents>
            <p className="px-3 pb-0.5 text-xs font-semibold text-fg-muted">{ct("chatui.composer.emoji_recent")}</p>
            <ul className="flex px-1.5">
              {recents.slice(0, COLUMNS).map((emoji) => (
                <li key={emoji} className="flex-1">
                  <button type="button" className="flex h-10 w-full items-center justify-center rounded-lg text-[28px] leading-none hover:bg-surface-2" onClick={() => onPick(emoji)}>
                    {emoji}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <EmojiPicker.Viewport ref={viewport} onScroll={onScroll} className={stickers ? "hidden" : "min-h-0 flex-1 overflow-y-auto"}>
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
export function EmojiPopover({ open, onClose, recents, onPick, zaki = false }: { open: boolean; onClose: () => void; recents: string[]; onPick: (emoji: string) => void; zaki?: boolean }) {
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
              zaki={zaki}
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
    <div ref={ref} role="dialog" aria-label={ct("chatui.composer.emoji")} data-emoji-popover className="absolute bottom-full start-0 z-20 mb-2 w-[22rem] max-w-full rounded-xl bg-surface-1 p-2 shadow-lg">
      <EmojiPanel recents={recents} onPick={onPick} zaki={zaki} />
    </div>
  );
}

/* ═══ «تيليجرام على التلفون» (the switch `tgPhone`) ══════════════════════════════════════════════════════════════════════════════════════════════
 * One grid for the two places of the phone that offer the whole set: the reaction card («⌄») and the panel that stands where the keyboard stood. On top
 * the PACKS (the emojis, our stickers, the task stickers), then the search, the categories and the grid.
 */
export type PackId = "emoji" | "zaki" | "task";

const EMPTY_CHOICE: ReadonlySet<string> = new Set();
const SelectedEmojis = React.createContext<ReadonlySet<string>>(EMPTY_CHOICE);

function TgEmoji({ emoji, ...props }: { emoji: { emoji: string; label: string; isActive: boolean } } & React.ComponentProps<"button">) {
  const chosen = React.useContext(SelectedEmojis).has(emoji.emoji);
  return (
    <button {...props} type="button" aria-label={emoji.emoji} {...(chosen ? { "data-tg-chosen": "" } : {})} className={`flex h-10 flex-1 items-center justify-center rounded-lg text-[28px] leading-none data-[active]:bg-surface-2 ${chosen ? "bg-surface-2" : ""}`}>
      {emoji.emoji}
    </button>
  );
}

/** frimousse measures the headers' height from one with NO name: it keeps a line, or every name would be cut to its padding. */
function TgCategoryHeader({ category, ...props }: { category: { label: string } } & React.ComponentProps<"div">) {
  const group = emojiGroupOf(category.label);
  return (
    <div {...props} className="bg-surface-1 px-3 pb-1 pt-2 text-xs font-semibold text-fg-muted">
      {group ? groupLabels()[group] : " "}
    </div>
  );
}

const TG_PARTS = {
  CategoryHeader: TgCategoryHeader,
  Row: ({ children, style, ...props }: React.ComponentProps<"div">) => (
    // each row carries its own turn in the fill (frimousse numbers the rows)
    <div {...props} data-tg-row="" style={{ ...style, "--tg-row-delay": `${cardRowDelayMs(Number(props["aria-rowindex"] ?? 0))}ms` } as React.CSSProperties} className="flex scroll-my-1 px-1.5">
      {children}
    </div>
  ),
  Emoji: TgEmoji,
};

const SKELETON_ROWS = 6;

/** Grey squares where the emojis are about to be. `staggered`: each row leaves at the moment its emojis arrive. */
export function EmojiSkeleton({ staggered }: { staggered: boolean }) {
  return (
    <div aria-hidden="true" data-tg-skeleton="" className="pointer-events-none absolute inset-0 overflow-hidden px-1.5 pt-1">
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <div key={row} className={`flex ${staggered ? "zk-tg-skeleton" : ""}`} style={{ "--tg-row-delay": `${cardRowDelayMs(row)}ms` } as React.CSSProperties}>
          {Array.from({ length: COLUMNS }, (_, column) => (
            <span key={column} className="flex h-10 flex-1 items-center justify-center">
              <span className="size-7 rounded-lg bg-surface-2" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

const PACK_BUTTON = "flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export function TgEmojiGrid({
  recents,
  onPick,
  zaki = false,
  chosen,
  fill = false,
}: {
  recents: readonly string[];
  /** an emoji or a sticker's code, with the thing that was pressed (the reaction flies from there) */
  onPick: (emoji: string, from: Element | null) => void;
  zaki?: boolean;
  /** the emojis that are mine already: drawn on a grey ground */
  chosen?: ReadonlySet<string>;
  /** the reaction card: grey squares first, then the rows one after the other (about a second) */
  fill?: boolean;
}) {
  const [pack, setPack] = React.useState<PackId>("emoji");
  const [filling, setFilling] = React.useState(fill);
  React.useEffect(() => {
    if (!fill) return;
    const stop = setTimeout(() => setFilling(false), TG_MOTION.reactionCardFillMs);
    return () => clearTimeout(stop);
  }, [fill]);
  const pressed = React.useRef<Element | null>(null);
  const root = React.useRef<HTMLDivElement | null>(null);
  const viewport = React.useRef<HTMLDivElement | null>(null);
  const [counts, setCounts] = React.useState<number[]>([]);
  const [group, setGroup] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void import("emojibase-data/en/data.json").then((set) => {
      const data = toEmojiData(set.default as unknown as Parameters<typeof toEmojiData>[0]);
      if (!live) return;
      const sizes = new Map<number, number>();
      for (const e of data.emojis) sizes.set(e.category, (sizes.get(e.category) ?? 0) + 1);
      setCounts(data.categories.map((c) => sizes.get(c.index) ?? 0));
    });
    return () => {
      live = false;
    };
  }, []);
  const offsets = () => {
    const style = root.current ? getComputedStyle(root.current) : null;
    const row = style ? Number.parseFloat(style.getPropertyValue("--frimousse-row-height")) : NaN;
    const header = style ? Number.parseFloat(style.getPropertyValue("--frimousse-category-header-height")) : NaN;
    return Number.isFinite(row) && Number.isFinite(header) && counts.length > 0 ? offsetsOf(counts, row, header) : null;
  };
  const goTo = (index: number) => {
    const at = offsets();
    if (!at || !viewport.current) return;
    setGroup(index);
    viewport.current.scrollTo({ top: at[index] ?? 0 });
  };
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop + 1;
    let active = 0;
    offsets()?.forEach((offset, i) => {
      if (offset <= top) active = i;
    });
    setGroup((now) => (now === active ? now : active));
  };
  const pick = (emoji: string) => onPick(emoji, pressed.current);
  const labels = groupLabels();
  const packs: { id: PackId; label: string; sticker: string | null }[] = [
    { id: "emoji", label: ct("chatemoji.picker.emoji"), sticker: null },
    ...(zaki
      ? [
          { id: "zaki" as const, label: ct("chatui.composer.emoji_zaki"), sticker: "smile" },
          { id: "task" as const, label: ct("chatemoji.tab_task"), sticker: "task_done" },
        ]
      : []),
  ];
  return (
    <SelectedEmojis.Provider value={chosen ?? EMPTY_CHOICE}>
      <div
        data-tg-emoji-grid=""
        className="flex h-full min-h-0 flex-col gap-1.5"
        onPointerDownCapture={(event) => {
          pressed.current = (event.target as Element).closest?.("button") ?? null;
        }}
      >
        <div role="tablist" aria-label={ct("tgmsg.panel.packs")} data-tg-packs="" className="strip-scroll flex shrink-0 gap-1 overflow-x-auto px-1.5 pt-1.5">
          {packs.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={pack === p.id} aria-label={p.label} data-tg-pack={p.id} onClick={() => setPack(p.id)} className={`${PACK_BUTTON} ${pack === p.id ? "bg-surface-2 text-fg" : "text-fg-muted"}`}>
              {p.sticker === null ? (
                <Smile aria-hidden="true" className="size-6" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
                <img src={zakiSrc(p.sticker)} alt="" draggable={false} className="size-6 object-contain" />
              )}
            </button>
          ))}
        </div>
        {pack !== "emoji" ? (
          <ZakiStickerGrid onPick={pick} section={pack === "task" ? "task" : "chat"} />
        ) : (
          <EmojiPicker.Root ref={root} onEmojiSelect={({ emoji }) => pick(emoji)} resolveEmojiData={resolveBundledEmojiData} columns={COLUMNS} className="flex min-h-0 w-full flex-1 flex-col gap-1.5">
            <div className="relative shrink-0 px-1.5">
              <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
              <EmojiPicker.Search placeholder={ct("chatui.composer.emoji_search")} aria-label={ct("chatui.composer.emoji_search")} className="h-10 w-full rounded-full bg-surface-2 ps-10 pe-3 text-base text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent/40" />
            </div>
            <div role="tablist" aria-label={ct("chatui.composer.emoji")} data-tg-categories="" className="strip-scroll flex shrink-0 items-center justify-between gap-0.5 overflow-x-auto px-1.5">
              {EMOJI_TABS.map(({ group: key, icon: Icon }, i) => (
                <button key={key} type="button" role="tab" aria-selected={group === i} aria-label={labels[key]} data-emoji-tab={key} onClick={() => goTo(i)} className={`${PACK_BUTTON} ${group === i ? "text-accent" : "text-fg-muted"}`}>
                  <Icon aria-hidden="true" className="size-5" />
                </button>
              ))}
            </div>
            {recents.length > 0 ? (
              <ul data-tg-recents="" aria-label={ct("tgmsg.card.recent")} className="flex shrink-0 px-1.5">
                {recents.slice(0, COLUMNS).map((emoji) => (
                  <li key={emoji} className="flex-1">
                    <button type="button" aria-label={emoji} onClick={() => pick(emoji)} {...(chosen?.has(emoji) ? { "data-tg-chosen": "" } : {})} className={`flex h-10 w-full items-center justify-center rounded-lg text-[28px] leading-none ${chosen?.has(emoji) ? "bg-surface-2" : ""}`}>
                      {emoji}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="relative flex min-h-0 flex-1 flex-col" {...(filling ? { "data-tg-fill": "" } : {})}>
              {/* frimousse sets `position: relative` on its viewport itself: its height comes from the column, never from an absolute box */}
              <EmojiPicker.Viewport ref={viewport} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <EmojiPicker.Loading>
                  <span role="status" className="sr-only">
                    {ct("chatui.composer.emoji_loading")}
                  </span>
                </EmojiPicker.Loading>
                <EmojiPicker.Empty>
                  <span className="block p-3 text-center text-sm text-fg-muted">{ct("chatui.composer.emoji_empty")}</span>
                </EmojiPicker.Empty>
                <EmojiPicker.List components={TG_PARTS} />
              </EmojiPicker.Viewport>
              {counts.length === 0 ? <EmojiSkeleton staggered={false} /> : filling ? <EmojiSkeleton staggered /> : null}
            </div>
          </EmojiPicker.Root>
        )}
      </div>
    </SelectedEmojis.Provider>
  );
}

/**
 * The panel that stands where the phone's keyboard stood, under the box (not a sheet over the chat: it stays while several are picked). Under it the two
 * tabs «الرموز التعبيرية» and «الملصقات» (the second only while our pack is on) and «⌫». An emoji goes into the box; a sticker of the second tab is sent
 * by itself when the box is empty (the composer decides). Nothing here focuses the box, so the keyboard stays closed.
 */
export function EmojiKeyboard({ recents, onEmoji, onSticker, onBackspace, zaki = false }: { recents: readonly string[]; onEmoji: (emoji: string) => void; onSticker: (code: string) => void; onBackspace: () => void; zaki?: boolean }) {
  const [tab, setTab] = React.useState<"emoji" | "stickers">("emoji");
  const tabs = [
    { id: "emoji" as const, label: ct("tgmsg.panel.emoji") },
    ...(zaki ? [{ id: "stickers" as const, label: ct("tgmsg.panel.stickers") }] : []),
  ];
  return (
    <div data-emoji-keyboard="" role="group" aria-label={ct("tgmsg.panel.label")} style={tgMotionVars(["barSlideMs", "cardRowFadeMs"]) as React.CSSProperties} className="zk-tg-panel zk-tg-slide-up flex min-w-0 flex-col border-t border-border bg-surface-1">
      <div className="min-h-0 flex-1">
        {tab === "emoji" ? (
          <TgEmojiGrid recents={recents} onPick={(emoji) => onEmoji(emoji)} zaki={zaki} />
        ) : (
          <div data-tg-stickers="" className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain [&>[data-zaki-grid]]:flex-none [&>[data-zaki-grid]]:overflow-visible">
            <ZakiStickerGrid onPick={onSticker} />
            <ZakiStickerGrid onPick={onSticker} section="task" />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1">
        <div role="tablist" aria-label={ct("tgmsg.panel.label")} className="flex min-w-0 flex-1 justify-center gap-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-tg-panel-tab={t.id} onClick={() => setTab(t.id)} className={`min-h-11 rounded-full px-3 text-sm font-semibold ${tab === t.id ? "bg-surface-2 text-fg" : "text-fg-muted"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" data-tg-backspace="" aria-label={ct("tgmsg.panel.backspace")} onClick={onBackspace} className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted">
          <Delete aria-hidden="true" className="size-6" />
        </button>
      </div>
    </div>
  );
}
