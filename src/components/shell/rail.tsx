"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { InstallAppButton } from "@/components/pwa/install-hint";
import { useI18n } from "@/lib/i18n";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";
import { ariaCurrent } from "./current";
import { NavIcon } from "./nav-icons";
import { NavOptions } from "./nav-options";
import { SortableItem, SortableList } from "./nav-sort";
import { PlaceBadge } from "./place-badge";
import { RAIL_BADGE_POSITION, railCellClass } from "./rail-style";
import { SpaceSwitcher, type ShellSpace } from "./space-switcher";

/**
 * THE RAIL — the computer's menu on the new map (switch `navV2`, from `md`), the owner's mock-up: a 72px column on the START side, the logo (the accent
 * tile with the gold star) at the top, the places as an icon over a 12px label (the current one accent on accent-soft), the unread number as a round
 * badge on «الدردشة», and at the foot «⋯» (the guide, «ترتيب»), the space the person is in (its counts open from it) and the avatar. It is not foldable:
 * there is nothing wider to fold to. The old side menu stays for `navV2` OFF (src/components/shell/sidebar.tsx).
 *
 * On the chat pages the frame draws no global bar (src/lib/nav/shell-v2.ts `chatChromeOf`), so what the bar and the bottom strip carried is drawn HERE, in
 * the same cells: `tools` (the search, «جديد», the bell) and `dock` (who is online), just above the foot.
 *
 * C2's chat shell reuses THIS rail as it is (it must not make a second one): `listSlot` is drawn beside the rail, the column of the chat list, and
 * the rail itself does not change. `data-tour="places"` on the list (the guide's tour stop; the drawer's button carries it on a phone).
 *
 * «ترتيب»: while `editing`, each place is dragged by the whole cell (the grip is its hint); the shell draws «تم» and «رجّع» once, for rail and drawer.
 */
export function Rail({
  nav,
  current,
  pathname,
  user,
  rank,
  isGuest,
  orgName,
  space = null,
  canOverview = false,
  badges = {},
  editing = false,
  onEditStart,
  onReorder,
  orderLocked = false,
  settingsHref,
  listSlot,
  tools,
  dock,
}: {
  nav: NavModel;
  current: PlaceKey | null;
  pathname: string;
  user: AvatarUser;
  rank: NavRole;
  isGuest: boolean;
  /** The company's name, for the mark's name. */
  orgName?: string;
  /** The space the person is in: the switcher wears its mark. */
  space?: ShellSpace | null;
  canOverview?: boolean;
  /** Unread numbers per place (today «الدردشة» only). */
  badges?: Partial<Record<PlaceKey, number>>;
  editing?: boolean;
  onEditStart?: () => void;
  /** The new order of the place keys. */
  onReorder?: (keys: string[]) => void;
  /** The company's order of the menu is set (D-N5): «⋯» shows its ⚠️ + 🔧 note instead of «ترتيب». */
  orderLocked?: boolean;
  settingsHref?: string;
  /** The column of the chat list (C2), drawn beside the rail. Left out: nothing. */
  listSlot?: ReactNode;
  /** The tools of the bar the chat does not draw (the search, «جديد», the bell): rail cells above the foot. Left out: nothing. */
  tools?: ReactNode;
  /** The roster of the bottom strip the chat does not draw (a rail cell). Left out: nothing. */
  dock?: ReactNode;
}) {
  const { t } = useI18n();
  const home = nav.places[0]?.href ?? "/";
  const brand = space?.name ?? orgName ?? t("app.brand");
  return (
    <>
      <aside
        data-shell="rail"
        className="relative hidden h-full min-h-0 w-[72px] shrink-0 flex-col items-center border-e border-border bg-surface-1 py-2 md:flex"
      >
        <Link href={home} aria-label={brand} className="mb-2 grid shrink-0 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span data-brand-mark aria-hidden="true" className="relative grid size-10 place-items-center rounded-xl bg-accent text-[21px] font-extrabold leading-none text-accent-fg">
            {Array.from(t("app.brand"))[0]}
            <span className="zk-star absolute -end-1 -top-1 size-[13px] text-accent-2" />
          </span>
        </Link>

        <nav aria-label={t("shell.places")} data-tour="places" className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain px-1">
          {editing && onReorder ? (
            <SortableList id="nav-places-rail" axis="vertical" entries={nav.places.map((place) => ({ id: place.key, label: t(place.labelKey) }))} onReorder={onReorder}>
              <ul aria-label={t("navorder.places_label")} className="flex flex-col items-center gap-0.5">
                {nav.places.map((place) => {
                  const label = t(place.labelKey);
                  return (
                    <SortableItem key={place.key} id={place.key} className="w-full">
                      {({ props }) => (
                        <div
                          {...props}
                          aria-label={t("navorder.grip", { label })}
                          className="flex min-h-14 w-full touch-none cursor-grab flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-border px-0.5 py-1 text-center text-xs font-semibold leading-tight text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <NavIcon icon={place.icon} className="size-6 shrink-0" />
                          <span className="max-w-full break-words">{label}</span>
                        </div>
                      )}
                    </SortableItem>
                  );
                })}
              </ul>
            </SortableList>
          ) : (
            <ul className="flex flex-col items-center gap-0.5">
              {nav.places.map((place) => {
                const active = place.key === current;
                const label = t(place.labelKey);
                return (
                  <li key={place.key} className="flex w-full justify-center">
                    <Link href={place.href} aria-current={ariaCurrent(active, place.href, pathname)} className={railCellClass(active)}>
                      <NavIcon icon={place.icon} className="size-6 shrink-0" />
                      <PlaceBadge count={badges[place.key]} place={place.key} className={RAIL_BADGE_POSITION} />
                      <span className="max-w-full break-words">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* the foot: it never shrinks and never overlaps the places above it */}
        <div data-shell="rail-foot" className="relative z-10 flex w-full shrink-0 flex-col items-center gap-1 bg-surface-1 px-1 pt-2">
          {tools ? (
            <div data-shell="rail-tools" className="flex flex-col items-center gap-0.5">
              {tools}
            </div>
          ) : null}
          {dock}
          <InstallAppButton collapsed />
          <NavOptions variant="rail" orderLocked={orderLocked} onEditStart={editing ? undefined : onEditStart} settingsHref={settingsHref} />
          <SpaceSwitcher variant="rail" isGuest={isGuest} current={space} canOverview={canOverview} showCounts />
          <AvatarMenu user={user} rank={rank} variant="rail" />
        </div>
      </aside>
      {listSlot ? (
        <div data-shell="list-slot" className="hidden h-full min-h-0 shrink-0 border-e border-border bg-surface md:flex">
          {listSlot}
        </div>
      ) : null}
    </>
  );
}
