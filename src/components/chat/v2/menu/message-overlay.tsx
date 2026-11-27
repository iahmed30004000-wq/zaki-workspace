"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, EyeOff, MoreHorizontal } from "lucide-react";
import "@/components/chat/v2/phone/tg-messages.css";
import type { MessageMenuAction, MessageMenuContext, MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { TgEmojiGrid } from "@/components/chat/v2/composer/emoji-panel";
import { menuIconOf } from "@/components/chat/v2/menu/menu-icons";
import { ReactionBar } from "@/components/chat/v2/menu/reaction-bar";
import { ct } from "@/lib/chat/text";
import { loadRecentEmoji } from "@/lib/chat/v2/composer/recent-emoji";
import { PHONE_MAIN_IDS, placeCard, placeOverlay, sevenReactions, splitPhoneMenu, type Placed, type Rect } from "@/lib/chat/v2/menu/phone-menu";
import { DOUBLE_TAP_MS, type TapPoint } from "@/lib/chat/v2/menu/quick-reactions";
import { isSecondTap } from "@/lib/chat/v2/phone/message-gestures";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { effectOn } from "@/lib/motion/effects";
import { cn } from "@/lib/utils";

export interface MessageOverlayProps {
  open: boolean;
  onClose: () => void;
  context: MessageMenuContext;
  /** what the registry offers this person on this message (`menuFor`): this file draws it, it never adds to it */
  actions: readonly MessageMenuAction[];
  /** the person's six quick reactions; the bar adds the seventh */
  quick: readonly string[];
  /** the reactions on this message that are mine */
  chosen: ReadonlySet<string>;
  /** where the bubble is on the screen now */
  anchor: () => Rect | null;
  /** the tap that opened this (null: a long press or a key) */
  openedBy: () => TapPoint | null;
  /** a second tap came soon and near the first: the person's quick reaction, if he has one */
  onDoubleTap?: () => void;
  onPick: (id: MessageMenuId) => void;
  /** «حذف عندي» (this screen's own item, not the registry's); absent: not offered */
  onHide?: () => void;
  /** a reaction, with the place it was picked from (it flies from there) */
  onReact: (emoji: string, from: Rect | null) => void;
  /** draw in place instead of on <body> (server-render tests) */
  portal?: boolean;
}

const ROW = "flex min-h-11 w-full items-center gap-3 px-4 text-start text-base active:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

/** The menu's rows: the spec's six in its words, the rest of the registry behind «المزيد». */
function MenuRows({ context, actions, view, onView, onPick, onHide }: { context: MessageMenuContext; actions: readonly MessageMenuAction[]; view: "main" | "more"; onView: (view: "main" | "more") => void; onPick: (id: MessageMenuId) => void; onHide?: () => void }) {
  const split = splitPhoneMenu(actions);
  // a person with none of the six (rare) gets the whole offer at once, never a menu of one «المزيد»
  const flat = split.main.length === 0;
  const hasMore = !flat && (split.more.length > 0 || onHide !== undefined);
  const shown = flat ? split.more : view === "main" ? split.main : split.more;
  const labelOf = (a: MessageMenuAction) => (PHONE_MAIN_IDS.includes(a.id) ? ct(`tgmsg.menu.${a.id === "pin" && context.pinned ? "unpin" : a.id}`) : ct(a.labelKey(context)));
  return (
    <>
      {view === "more" && hasMore ? (
        <button type="button" data-menu-back="" onClick={() => onView("main")} className={cn(ROW, "border-b border-border text-fg-muted")}>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
          {ct("tgmsg.menu.back")}
        </button>
      ) : null}
      {shown.map((a) => {
        const Icon = menuIconOf(a.id, context.pinned);
        return (
          <button key={a.id} type="button" data-menu-item={a.id} onClick={() => onPick(a.id)} className={cn(ROW, a.danger && "text-danger")}>
            <Icon aria-hidden="true" className={cn("size-5 shrink-0", !a.danger && "text-fg-muted", (a.id === "reply" || a.id === "forward") && "rtl:-scale-x-100")} />
            <span className="min-w-0 truncate">{labelOf(a)}</span>
          </button>
        );
      })}
      {onHide && (flat || view === "more") ? (
        <button type="button" data-menu-item="hide-for-me" onClick={onHide} className={cn(ROW, "text-danger")}>
          <EyeOff aria-hidden="true" className="size-5 shrink-0" />
          <span className="min-w-0 truncate">{ct("chatparity.hide.menu")}</span>
        </button>
      ) : null}
      {hasMore && view === "main" ? (
        <button type="button" data-menu-more="" onClick={() => onView("more")} className={cn(ROW, "border-t border-border")}>
          <MoreHorizontal aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
          {ct("tgmsg.menu.more")}
        </button>
      ) : null}
    </>
  );
}

interface Spot {
  bar: Placed;
  menu: Placed & { maxHeight: number };
  barSize: { width: number; height: number };
}

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const screenSize = () => ({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight });

/** Mounted with each opening (so every opening starts from the bar and the short list again). */
function OverlayBody(props: MessageOverlayProps & { onFading: () => void }) {
  const { context, actions, quick, chosen, anchor, openedBy, onClose, onPick, onHide, onReact, onDoubleTap, onFading } = props;
  const [view, setView] = React.useState<"main" | "more">("main");
  const [card, setCard] = React.useState(false);
  const [spot, setSpot] = React.useState<Spot | null>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [openedAt] = React.useState(() => Date.now());
  const [first] = React.useState(() => openedBy());
  const closing = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const latest = React.useRef({ anchor, mine: context.mine });
  latest.current = { anchor, mine: context.mine };
  const measure = React.useCallback(() => {
    const bar = barRef.current;
    const menu = menuRef.current;
    const box = latest.current.anchor();
    if (!bar || !menu || !box) return;
    const barSize = { width: bar.offsetWidth, height: bar.offsetHeight };
    // the menu's whole height, whatever the height it was given last time
    const menuSize = { width: menu.offsetWidth, height: menu.scrollHeight };
    // my bubble sits on the left side of this screen, everybody else's on the right: the panels hang from the same side
    const placed = placeOverlay({ anchor: box, viewport: screenSize(), bar: barSize, menu: menuSize, align: latest.current.mine ? "right" : "left", tap: first });
    setSpot({ ...placed, barSize });
  }, [first]);
  // a new size of the screen draws again (the card is sized from it while it is open, when the bar is not there to be measured)
  const [, setResized] = React.useState(0);
  React.useEffect(() => {
    // the keyboard opening or closing moves the messages: the panels follow
    const resized = () => {
      setResized((n) => n + 1);
      measure();
    };
    const visual = window.visualViewport;
    visual?.addEventListener("resize", resized);
    window.addEventListener("resize", resized);
    return () => {
      visual?.removeEventListener("resize", resized);
      window.removeEventListener("resize", resized);
    };
  }, [measure]);
  useBrowserLayoutEffect(() => measure(), [measure, view]);

  const react = (emoji: string, from: Rect | null) => {
    if (closing.current) return;
    closing.current = true;
    onReact(emoji, from);
    // the menu fades while the emoji flies; with the transitions off it is gone at once
    if (!effectOn("transitions")) return onClose();
    onFading();
    timer.current = setTimeout(onClose, TG_MOTION.reactionMenuFadeMs);
  };

  const seven = sevenReactions(quick);
  const recents = card ? [...new Set([...seven, ...(typeof window === "undefined" ? [] : loadRecentEmoji())])].slice(0, 8) : [];
  const cardBox = card && spot ? placeCard(spot.bar, screenSize()) : null;
  const origin = (p: Placed) => `${p.originX}px ${p.originY}px`;
  const hidden = spot === null ? "invisible" : "";

  return (
    <div
      className="absolute inset-0"
      onClickCapture={(event) => {
        // the second tap of a double tap lands here (the menu did not wait for it): it never presses what appeared under the finger
        if (Date.now() - openedAt > DOUBLE_TAP_MS || !first) return;
        event.preventDefault();
        event.stopPropagation();
        if (isSecondTap(first, { at: Date.now(), x: event.clientX, y: event.clientY })) {
          onDoubleTap?.();
          onClose();
        }
      }}
    >
      <div data-overlay-outside="" aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      {card ? null : (
        <div
          ref={barRef}
          data-tg-bar=""
          style={spot ? { top: spot.bar.top, left: spot.bar.left, transformOrigin: origin(spot.bar) } : { top: 0, left: 0 }}
          className={cn("absolute w-max max-w-[calc(100vw-1rem)] rounded-full bg-surface-1 p-1.5 shadow-lg", hidden, spot && "zk-tg-bar")}
        >
          <ReactionBar emojis={seven} chosen={chosen} className="p-0" onPick={(emoji) => react(emoji, rectOf(barRef.current?.querySelector(`[data-quick-reaction="${emoji}"]`) ?? null))} onMore={() => setCard(true)} />
        </div>
      )}
      <div
        ref={menuRef}
        data-tg-menu=""
        style={spot ? { top: spot.menu.top, left: spot.menu.left, maxHeight: spot.menu.maxHeight, transformOrigin: origin(spot.menu) } : { top: 0, left: 0 }}
        className={cn("absolute flex w-56 flex-col overflow-y-auto overscroll-contain rounded-2xl bg-surface-1 py-1 shadow-lg", card ? "hidden" : hidden, spot && "zk-tg-menu")}
      >
        <MenuRows context={context} actions={actions} view={view} onView={setView} onPick={onPick} {...(onHide ? { onHide } : {})} />
      </div>
      {cardBox && spot ? (
        <div
          data-reaction-card=""
          role="group"
          aria-label={ct("tgmsg.card.label")}
          style={
            {
              ...cardBox,
              transformOrigin: `${spot.bar.left - cardBox.left + spot.barSize.width / 2}px ${spot.bar.top - cardBox.top}px`,
              "--tg-from-x": String(Math.min(spot.barSize.width / cardBox.width, 1)),
              "--tg-from-y": String(Math.min(spot.barSize.height / cardBox.height, 1)),
            } as React.CSSProperties
          }
          className="zk-tg-card absolute overflow-hidden rounded-2xl bg-surface-1 shadow-lg"
        >
          <TgEmojiGrid fill zaki recents={recents} chosen={chosen} onPick={(emoji, from) => react(emoji, rectOf(from))} />
        </div>
      ) : null}
    </div>
  );
}

const useBrowserLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * «تيليجرام على التلفون» — a TAP on a message: the chat dims, a bar of seven reactions and «⌄» grows from the message (a little past its size and back),
 * and the menu grows under it. «⌄» turns the bar into the whole reaction card. A pick fades it all away while the emoji flies into the message.
 */
export function MessageOverlay(props: MessageOverlayProps) {
  const { open, onClose, portal = true } = props;
  const [fading, setFading] = React.useState(false);
  // a new opening starts clean BEFORE it is drawn; while it closes the mark stays, or the panels would come back for their exit
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setFading(false);
  }
  const motion = tgMotionVars(["messageDimMs", "messageMenuMs", "reactionCardMs", "reactionMenuFadeMs", "cardRowFadeMs"]) as React.CSSProperties;
  const mark = fading ? { "data-closing": "" } : {};
  const content = (
    <>
      <DialogPrimitive.Overlay style={motion} {...mark} className="zk-tg-dim fixed inset-0 z-50 bg-scrim/35" />
      <DialogPrimitive.Content
        data-tg-message-overlay=""
        dir="rtl"
        style={motion}
        {...mark}
        aria-modal="true"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus?.();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className={cn("zk-tg-overlay fixed inset-0 z-50 text-fg focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0", fading && "pointer-events-none")}
      >
        <DialogPrimitive.Title className="sr-only">{ct("tgmsg.menu.label")}</DialogPrimitive.Title>
        <OverlayBody {...props} onFading={() => setFading(true)} />
      </DialogPrimitive.Content>
    </>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {portal ? <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal> : content}
    </DialogPrimitive.Root>
  );
}
