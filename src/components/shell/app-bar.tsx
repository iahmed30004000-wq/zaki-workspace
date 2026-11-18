"use client";

import { Menu } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import type { NewActionKey } from "@/lib/nav/new-actions";
import { appBarOf } from "@/lib/nav/shell-v2";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { PageHelpButton } from "@/components/guide/page-help-button";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import type { AvatarUser } from "./avatar-menu";
import { NewWheel } from "./new-wheel";

/**
 * THE APP BAR of a place on the new map (switch `navV2`): the place's name, the search and the actions that make sense in THAT place
 * (`appBarOf`, src/lib/nav/shell-v2.ts), under the notch (`env(safe-area-inset-top)`). The old top bar stays for `navV2` OFF.
 *
 *   phone      «☰» (opens the drawer, which carries the places, the spaces and the avatar) · the place's name and the space the person is in · the
 *              bell · «جديد», and the search on a line of its own under them
 *   computer   the place's name · the search · «ليل / نهار» · «؟» · the bell · the gold «جديد» (the places and the avatar live in the rail)
 *
 * The place's name is NOT a heading: the one `h1` of a page is the page's own. Every control is a 44px target. `data-tour`: "places" on «☰» (the
 * phone's stop of the places tour), "search" around the palette, "inbox" on the bell, "new" on «جديد».
 */
export function AppBar({
  nav,
  place,
  title,
  pathname,
  audience,
  space = null,
  newActions = [],
  onOpenDrawer,
}: {
  nav: NavModel;
  /** The place on screen (null: a page of no place, like the profile). */
  place: PlaceKey | null;
  /** The name of the place. */
  title?: string;
  pathname: string;
  audience: Audience;
  /** Not drawn here (the rail and the drawer carry the person); kept so a caller can pass what the old bar took. */
  user?: AvatarUser;
  rank?: NavRole;
  /** The space the person is in: on a phone its name sits beside the place's. */
  space?: { name: string; emoji: string | null } | null;
  newActions?: readonly NewActionKey[];
  onOpenDrawer: () => void;
}) {
  const { t } = useI18n();
  const slots = appBarOf(place);
  return (
    <header data-shell="app-bar" className="zk-safe-x shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 py-1.5 md:h-16 md:flex-nowrap md:gap-x-2.5 md:px-5 md:py-0">
        <button
          type="button"
          data-shell="drawer-open"
          data-tour="places"
          onClick={onOpenDrawer}
          aria-label={t("navv2.drawer.open")}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-fg transition-colors hover:bg-surface-2 md:hidden"
        >
          <Menu aria-hidden="true" className="size-6" />
        </button>
        {title ? <p className="min-w-0 shrink-0 truncate font-display text-xl leading-tight text-fg md:text-2xl">{title}</p> : null}
        {space ? (
          <p className="min-w-0 max-w-[30vw] shrink truncate text-sm text-fg-muted max-[379px]:hidden md:hidden">
            {space.emoji ? <span aria-hidden="true">{space.emoji} </span> : null}
            <bdi>{space.name}</bdi>
          </p>
        ) : null}
        {slots.search ? (
          <div data-tour="search" className="order-last min-w-0 basis-full md:order-none md:max-w-[440px] md:flex-1 md:basis-auto">
            <CommandPalette nav={nav} />
          </div>
        ) : null}
        <div className="ms-auto flex shrink-0 items-center gap-0.5 md:gap-2">
          {slots.theme ? <ThemeSwitch /> : null}
          {slots.help ? <PageHelpButton pathname={pathname} audience={audience} /> : null}
          {slots.bell ? <NotificationBell /> : null}
          {slots.create ? <NewWheel actions={newActions} v2 /> : null}
        </div>
      </div>
    </header>
  );
}
