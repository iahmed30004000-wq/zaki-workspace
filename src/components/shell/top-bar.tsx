"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import type { NavModel, NavRole } from "@/lib/nav/places";
import type { NewActionKey } from "@/lib/nav/new-actions";
import { ZakiMark } from "@/components/logo";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { PageHelpButton } from "@/components/guide/page-help-button";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";
import { NewWheel } from "./new-wheel";

/**
 * The bar over every page («نجمة وطريق»), under the notch (`env(safe-area-inset-top)`):
 *
 *   phone      the «Z» mark (to Today) · «ليل / نهار» · «؟» · the bell · «جديد» · the avatar, and
 *              the search «وين بدك تروح؟» on a line of its own under them
 *   computer   the place's name · the search · «ليل / نهار» · «؟» · the bell · the gold «جديد»
 *              (the mark and the avatar live in the side menu)
 *
 * The place's name is NOT a heading: the one `h1` of a page is the page's own (a screen reader's list of
 * headings starts with what the page is about, not with the frame — GLM's #3 drew two). Every control is
 * a 44px target. `data-tour`: "search" around the palette's button, "inbox" on the bell
 * (notification-bell.tsx), "new" on «جديد» (new-wheel.tsx), "avatar" on the avatar (avatar-menu.tsx).
 */
export function TopBar({
  nav,
  pathname,
  audience,
  user,
  rank,
  title,
  space = null,
  newActions = [],
}: {
  nav: NavModel;
  pathname: string;
  audience: Audience;
  user: AvatarUser;
  rank: NavRole;
  /** The name of the current place, shown on a computer. */
  title?: string;
  /** The space the person is in: on a phone (no side menu) its name sits beside the mark. */
  space?: { name: string; emoji: string | null } | null;
  /** What «جديد» offers this person (computed on the server); none, no button. */
  newActions?: readonly NewActionKey[];
}) {
  const { t } = useI18n();
  // the mark goes home: «اليوم», or «اللوحات» (else the first place) when «اليوم» is not offered (a space of «لوحات»: its home is «اللوحات»)
  const home = nav.places.some((place) => place.key === "today") ? null : (nav.places.find((place) => place.key === "cards") ?? nav.places[0]);
  return (
    <header className="zk-safe-x shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 py-1.5 md:h-16 md:flex-nowrap md:gap-x-2.5 md:px-5 md:py-0">
        <Link href={home?.href ?? "/"} aria-label={t(home?.labelKey ?? "nav.place.today")} className="grid size-11 shrink-0 place-items-center rounded-xl md:hidden">
          <span aria-hidden="true">
            <ZakiMark className="size-8" />
          </span>
        </Link>
        {space ? (
          <p className="min-w-0 max-w-[30vw] shrink truncate text-sm font-semibold text-fg max-[379px]:hidden md:hidden">
            {space.emoji ? <span aria-hidden="true">{space.emoji} </span> : null}
            <bdi>{space.name}</bdi>
          </p>
        ) : null}
        {title ? <p className="hidden shrink-0 font-display text-2xl leading-tight text-fg md:block">{title}</p> : null}
        <div data-tour="search" className="order-last min-w-0 basis-full md:order-none md:max-w-[440px] md:flex-1 md:basis-auto">
          <CommandPalette nav={nav} />
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-0.5 md:gap-2">
          <ThemeSwitch />
          <PageHelpButton pathname={pathname} audience={audience} />
          <NotificationBell />
          <NewWheel actions={newActions} />
          <div className="md:hidden">
            <AvatarMenu user={user} rank={rank} variant="bar" />
          </div>
        </div>
      </div>
    </header>
  );
}
