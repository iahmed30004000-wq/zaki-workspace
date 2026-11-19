"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { GripHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavPlace, PlaceKey } from "@/lib/nav/places";
import { NavIcon } from "./nav-icons";
import { PlaceBadge } from "./place-badge";
import { ariaCurrent } from "./current";
import { NavOrderControls, SortableItem, SortableList } from "./nav-sort";

/**
 * The phone's way around: the person's places along the bottom of the screen, an icon over a short
 * label, each a 56px-tall target, the current one highlighted. It is fixed, so the shell pads
 * the content by its height plus the home-indicator inset (`env(safe-area-inset-bottom)`, which the
 * root layout's `viewportFit: "cover"` makes real on an iPhone). From `md` the side menu takes over.
 *
 * C2.8: while a page asks for it (`data-frame-bars="hide-all"`: a chat conversation) the bar is hidden below `md`, so the conversation is the whole screen,
 * like Telegram's; the frame's `group/frame` class and `group-has-*` do it, and the chat is not imported here.
 *
 * `data-tour="places"`: the guide's tour points here on a phone (and at the side menu on a computer).
 *
 * «ترتيب»: a LONG PRESS on the bar (about half a second, the finger hardly moving) starts the reorder mode, so a
 * normal tap or a scroll never does. In the mode each place wears a grip and is dragged instead of followed, and a bar
 * above the bottom bar carries «تم» and «رجّع الترتيب الأصلي».
 */
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10;

export function BottomNav({
  places,
  current,
  pathname,
  badges = {},
  editing = false,
  onEditStart,
  onEditDone,
  onReorder,
  onReset,
  canReset = false,
}: {
  places: readonly NavPlace[];
  current: PlaceKey | null;
  pathname: string;
  badges?: Partial<Record<PlaceKey, number>>;
  editing?: boolean;
  onEditStart?: () => void;
  onEditDone?: () => void;
  onReorder?: (keys: string[]) => void;
  onReset?: () => void;
  canReset?: boolean;
}) {
  const { t } = useI18n();
  // the long press: a timer that a lifted finger, a cancelled touch or a finger that moved puts out
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => stop, []);
  const press = onEditStart && !editing;
  const longPress = press
    ? {
        onPointerDown: (event: React.PointerEvent) => {
          fired.current = false;
          origin.current = { x: event.clientX, y: event.clientY };
          timer.current = setTimeout(() => {
            fired.current = true;
            timer.current = null;
            onEditStart();
          }, LONG_PRESS_MS);
        },
        onPointerMove: (event: React.PointerEvent) => {
          const from = origin.current;
          if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_SLOP) stop();
        },
        onPointerUp: stop,
        onPointerCancel: stop,
        onPointerLeave: stop,
        // the press that started the mode must not also follow the link under the finger, nor open the browser's link menu
        onClickCapture: (event: React.MouseEvent) => {
          if (fired.current) {
            fired.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        },
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      }
    : {};
  return (
    <>
      {editing && onEditDone && onReset ? (
        <div className="fixed end-0 start-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 border-t border-border bg-surface-1 px-3 py-2 md:hidden zk-safe-x">
          <NavOrderControls onDone={onEditDone} onReset={onReset} canReset={canReset} />
        </div>
      ) : null}
    <nav
      aria-label={t("shell.places")}
      data-tour="places"
      className="fixed bottom-0 end-0 start-0 z-40 border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden zk-safe-x group-has-[[data-frame-bars=hide-all]]/frame:max-md:hidden"
      {...longPress}
    >
      {editing && onReorder ? (
        <SortableList
          id="nav-places-bar"
          axis="horizontal"
          entries={places.map((place) => ({ id: place.key, label: t(place.labelKey) }))}
          onReorder={onReorder}
        >
          <ul aria-label={t("navorder.places_label")} className="flex">
            {places.map((place) => {
              const label = t(place.labelKey);
              return (
                <SortableItem key={place.key} id={place.key} className="min-w-0 flex-1">
                  {({ props }) => (
                    // the whole place is the handle here: a 56px cell is the finger-sized target (the grip glyph is its hint)
                    <div
                      {...props}
                      aria-label={t("navorder.grip", { label })}
                      className="flex h-14 touch-none cursor-grab flex-col items-center justify-center px-1 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <GripHorizontal aria-hidden="true" className="size-3 text-fg-muted" />
                      <span className="grid h-6 w-12 place-items-center rounded-full border border-dashed border-border">
                        <NavIcon icon={place.icon} className="size-5" />
                      </span>
                      <span className="max-w-full truncate">{label}</span>
                    </div>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableList>
      ) : (
      <ul className="flex">
        {places.map((place) => {
          const active = place.key === current;
          return (
            <li key={place.key} className="min-w-0 flex-1">
              <Link
                href={place.href}
                aria-current={ariaCurrent(active, place.href, pathname)}
                className={cn(
                  // exactly the 56px the shell pads the content by (3.5rem): 28px pill + 4px + one 12px line fit inside
                  // leading-normal so a truncated label's descenders/clipped letters still render fully
                  "flex h-14 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors",
                  active ? "font-semibold text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <span className={cn("relative grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-accent/15 text-accent")}>
                  <NavIcon icon={place.icon} className="size-5" />
                  <PlaceBadge count={badges[place.key]} className="absolute end-1 top-0" />
                </span>
                <span className="max-w-full truncate">{t(place.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      )}
    </nav>
    </>
  );
}
