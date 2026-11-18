"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NavPlace, TabKey } from "@/lib/nav/places";
import { ariaCurrent } from "./current";
import { Grip, SortableItem, SortableList } from "./nav-sort";

/**
 * The tabs of the place on screen, under the top bar (phone and computer alike): «مهامي · المشاريع ·
 * القائمة …» inside «الشغل». It scrolls sideways on a narrow screen and brings the current tab into
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
}: {
  place: NavPlace | null;
  tab: TabKey | null;
  pathname: string;
  end?: ReactNode;
  editing?: boolean;
  onReorder?: (placeKey: string, keys: string[]) => void;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    // instant, and only as far as needed (nothing moves when the tab is already visible)
    listRef.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [place?.key, tab]);

  // one tab alone is not a choice; but «المزيد» beside a tab (the new map) is
  if (!place || place.tabs.length + ((place.more?.length ?? 0) > 0 ? 1 : 0) < 2) return null;
  const listClass = "flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden md:px-4";

  return (
    <nav
      aria-label={t("shell.tabs", { place: t(place.labelKey) })}
      data-tour="tabs"
      className="flex shrink-0 items-center border-b border-border bg-surface"
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
                    <div className="inline-flex h-11 items-center gap-0.5 whitespace-nowrap rounded-lg border border-dashed border-border ps-0.5 pe-3 text-sm text-fg">
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
          {place.tabs.map((item) => {
            const active = item.key === tab;
            return (
              <li key={item.key} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={ariaCurrent(active, item.href, pathname)}
                  data-current={active ? "" : undefined}
                  className={cn(
                    "inline-flex h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors",
                    active ? "bg-accent/10 font-semibold text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {editing ? null : <MoreTabs place={place} tab={tab} pathname={pathname} />}
      {end}
    </nav>
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
    <div className="shrink-0 px-1 md:pe-4">
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-shell="more-tabs"
            aria-label={t("navv2.more.open", { place: t(place.labelKey) })}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex h-11 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-sm transition-colors",
              active ? "bg-accent/10 font-semibold text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
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
