"use client";

import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Audience } from "@/lib/guide/audience";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import type { NewActionKey } from "@/lib/nav/new-actions";
import { appBarOf } from "@/lib/nav/shell-v2";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { PageHelpButton } from "@/components/guide/page-help-button";
import { useIsDesktop } from "@/lib/chat/v2/use-media";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import type { AvatarUser } from "./avatar-menu";
import { NewWheel } from "./new-wheel";

/**
 * THE APP BAR of a place on the new map (switch `navV2`) — the owner's mock-up's page bar (`.pbar`): one row of at least 56px with the place's name (19px,
 * bold), the tabs of the place (`tabs`: the frame hands its tab strip in, so name and tabs are one bar), the search and the actions that make sense in THAT
 * place (`appBarOf`, src/lib/nav/shell-v2.ts), under the notch (`env(safe-area-inset-top)`). The old top bar stays for `navV2` OFF.
 *
 * `hideOnDesktop`: the chat on a computer has no global bar (its tools live in the rail: `chatChromeOf`); the bar is still drawn for the phone.
 *
 *   phone      ONE row: «☰» (opens the drawer, which carries the places, the spaces, the avatar, the light/dark icon, who is online and the guide) · the place's
 *              name (cut, never wrapped) and the space the person is in · a search ICON (P2.1) · the bell · «جديد»; the tab strip is the only other line.
 *              «؟» is not here: the guide is inside «الإعدادات» «المساعدة».
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
  tabs = null,
  hideOnDesktop = false,
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
  /** The place's tab strip (`PlaceTabs` with `embedded`), drawn in the bar's row. */
  tabs?: ReactNode;
  /** Hidden from `md` up by CSS (the chat's computer layout). */
  hideOnDesktop?: boolean;
}) {
  const { t } = useI18n();
  const slots = appBarOf(place);
  // `null` until the screen is known (server render, first paint): the wrapper's own CSS hides it on a phone meanwhile, and a phone then never mounts the switch's effect code
  const desktop = useIsDesktop();
  return (
    <header data-shell="app-bar" className={cn("zk-safe-x shrink-0 border-b border-border bg-surface-1 pt-[env(safe-area-inset-top)]", hideOnDesktop && "md:hidden")}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0 px-1.5 py-1.5 md:min-h-14 md:flex-nowrap md:gap-x-2.5 md:px-[18px] md:py-1.5">
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
        {title ? <p className="min-w-0 truncate font-sans text-[19px] font-bold leading-tight text-fg md:shrink-0">{title}</p> : null}
        {space ? (
          <p className="min-w-0 max-w-[30vw] shrink truncate text-sm text-fg-muted max-[379px]:hidden md:hidden">
            {space.emoji ? <span aria-hidden="true">{space.emoji} </span> : null}
            <bdi>{space.name}</bdi>
          </p>
        ) : null}
        {tabs}
        {slots.search ? (
          // ONE palette (two would both answer Ctrl+K): an icon on a phone, the wide bar from md up
          <div data-tour="search" className="ms-auto shrink-0 md:ms-0 md:w-60 md:flex-none">
            <CommandPalette nav={nav} variant="compact" />
          </div>
        ) : null}
        <div data-shell="app-bar-actions" className="flex shrink-0 items-center gap-0.5 md:ms-auto md:gap-2">
          {/* the wide toggle (an icon in the drawer's header on a phone) and «؟» (inside «الإعدادات» «المساعدة» on a phone) are for the computer */}
          {slots.theme && desktop !== false ? (
            <div data-phone-hidden="theme" className="max-md:hidden">
              <ThemeSwitch />
            </div>
          ) : null}
          {slots.help ? (
            <div data-phone-hidden="help" className="max-md:hidden">
              <PageHelpButton pathname={pathname} audience={audience} />
            </div>
          ) : null}
          {slots.bell ? <NotificationBell /> : null}
          {slots.create ? <NewWheel actions={newActions} v2 /> : null}
        </div>
      </div>
    </header>
  );
}
