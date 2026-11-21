"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NavPlace, TabKey } from "@/lib/nav/places";
import { ariaCurrent } from "./current";
import { Grip, SortableItem, SortableList } from "./nav-sort";

/**
 * The tabs of the place on screen: «مهامي · المشاريع · القائمة …» inside «الشغل». On the new map (`embedded`) they sit INSIDE the page bar beside the
 * place's name, as in the owner's mock-up (`.pbar`: on a computer pills, the current one accent on accent-soft; on a phone, on a row of their own, an
 * underline in the accent); on the old map they are their own strip under the top bar. It scrolls sideways on a narrow screen and brings the current tab into
 * view; a place with a single tab (or none) has no strip at all — one tab is not a choice.
 *
 * In the reorder mode («ترتيب», `editing`) each tab wears a grip and is dragged instead of followed; the new order of the
 * tab keys goes to `onReorder`.
 *
 * `end` is pinned at the end of the strip, outside the part that scrolls (the phone's space switcher).
 * `data-tour="tabs"`: the guide's tour stop.
 */
export function PlaceTabs({
  place,
  tab,
  pathname,
  end,
  editing = false,
  onReorder,
  embedded = false,
}: {
  place: NavPlace | null;
  tab: TabKey | null;
  pathname: string;
  end?: ReactNode;
  editing?: boolean;
  onReorder?: (placeKey: string, keys: string[]) => void;
  /** Drawn inside the page bar (the new map): no strip of its own, its own place in the bar's row. */
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);

  useRosary(listRef);
  useEffect(() => {
    // instant, and only as far as needed (nothing moves when the tab is already visible)
    listRef.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [place?.key, tab]);

  // one tab alone is not a choice; but «المزيد» beside a tab (the new map) is
  if (!place || place.tabs.length + ((place.more?.length ?? 0) > 0 ? 1 : 0) < 2) return null;
  const listClass = cn("flex min-w-0 flex-1 cursor-grab gap-0.5 overflow-x-auto active:cursor-grabbing max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden", embedded ? "px-0" : "px-2 py-1 md:px-4");

  return (
    <nav
      aria-label={t("shell.tabs", { place: t(place.labelKey) })}
      data-tour="tabs"
      className={cn(
        "flex items-center",
        // in the bar: a row of its own under the title on a phone, the rest of the bar's row on a computer; alone: its own strip
        embedded ? "order-last min-w-0 basis-full md:order-none md:basis-auto md:flex-1" : "shrink-0 border-b border-border bg-surface",
      )}
    >
      {editing && onReorder ? (
        <SortableList
          id={`nav-tabs-${place.key}`}
          axis="horizontal"
          entries={place.tabs.map((item) => ({ id: item.key, label: t(item.labelKey) }))}
          onReorder={(keys) => onReorder(place.key, keys)}
        >
          <ul ref={listRef} aria-label={t("navorder.tabs_label", { place: t(place.labelKey) })} className={listClass}>
            {place.tabs.map((item) => {
              const label = t(item.labelKey);
              return (
                <SortableItem key={item.key} id={item.key} className="shrink-0">
                  {({ props }) => (
                    <div className="inline-flex h-11 items-center gap-0.5 whitespace-nowrap rounded-[9px] border border-dashed border-border ps-0.5 pe-3 text-sm text-fg">
                      <Grip handle={props} label={label} />
                      {label}
                    </div>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableList>
      ) : (
        <ul ref={listRef} className={listClass}>
          {/* the rosary: the tabs AND what the place keeps beyond them, in ONE strip that runs sideways (wheel, finger, or a pressed mouse): no menu */}
          {[...place.tabs, ...(place.more ?? [])].map((item, i) => {
            const active = item.key === tab;
            const firstMore = i === place.tabs.length;
            return (
              <li key={item.key} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={ariaCurrent(active, item.href, pathname)}
                  data-current={active ? "" : undefined}
                  data-shell={firstMore ? "more-tabs" : undefined}
                  draggable={false}
                  className={tabClass(active)}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {end}
    </nav>
  );
}

/**
 * The strip as a rosary: the mouse WHEEL moves it sideways (when it is wider than the screen), a pressed mouse drags it, a finger swipes it by itself (the
 * browser's own scroll). A drag that moved is not a click, so letting go over a tab does not open it.
 */
function useRosary(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rtl = () => getComputedStyle(el).direction === "rtl";
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollBy({ left: rtl() ? -e.deltaY : e.deltaY });
    };
    let startX = 0;
    let startLeft = 0;
    let down = false;
    let moved = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 5) moved = true;
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      down = false;
    };
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, [ref]);
}

/**
 * One tab, the mock-up's `.tab`: semibold, 9 px corners; the current one accent on accent-soft. On a phone the pill is an underline (3 px, the accent) on a
 * 44 px target. Theme tokens only.
 */
function tabClass(active: boolean): string {
  return cn(
    "inline-flex h-11 items-center whitespace-nowrap px-3 text-sm font-semibold transition-colors md:h-9 md:rounded-[9px] md:px-[13px]",
    "max-md:rounded-none max-md:border-b-[3px]",
    active ? "bg-accent/[0.12] text-accent max-md:border-accent max-md:bg-transparent" : "text-fg-muted hover:bg-surface-2 hover:text-fg max-md:border-transparent max-md:hover:bg-transparent",
  );
}

/**
 * «المزيد» — the new map's last tab: what the place keeps beyond its four tabs (`NavPlace.more`), as a menu of links. It is the current tab when the page on
 * screen is one of them. A place with nothing under it draws nothing (the old map never has `more`). `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function MoreTabs({
  place,
  tab,
  pathname,
  defaultOpen,
  portal = true,
}: {
  place: NavPlace | null;
  tab: TabKey | null;
  pathname: string;
  defaultOpen?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();
  const more = place?.more ?? [];
  if (!place || more.length === 0) return null;
  const active = more.some((item) => item.key === tab);
  return (
    <div className="shrink-0 px-1 md:px-0">
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-shell="more-tabs"
            aria-label={t("navv2.more.open", { place: t(place.labelKey) })}
            aria-current={active ? "true" : undefined}
            className={cn(tabClass(active), "gap-1")}
          >
            {t("nav.tab.more")}
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent portal={portal} align="end" className="w-56">
          {more.map((item) => (
            <DropdownMenuItem key={item.key} asChild>
              <Link href={item.href} aria-current={item.key === tab ? ariaCurrent(true, item.href, pathname) : undefined} className={cn(item.key === tab && "font-semibold text-fg")}>
                {t(item.labelKey)}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
