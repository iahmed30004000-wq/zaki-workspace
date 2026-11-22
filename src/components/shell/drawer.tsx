"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Compass, Settings, X } from "lucide-react";
import { InstallAppButton } from "@/components/pwa/install-hint";
import { Dialog, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GUIDE_OPEN_EVENT } from "@/lib/nav/shell-v2";
import { ThemeIconButton } from "@/components/theme/theme-switch";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import { Initial, SignOutButton, type AvatarUser } from "./avatar-menu";
import { ariaCurrent } from "./current";
import { NavIcon } from "./nav-icons";
import { NavOptions, NavOrderButton, SettingsDoor, useSettingsOneDoor } from "./nav-options";
import { NavOrderControls, SortableItem, SortableList } from "./nav-sort";
import { PlaceBadge } from "./place-badge";
import { SpaceDropdown, type ShellSpace } from "./space-switcher";

/**
 * THE DRAWER — the phone's menu on the new map (switch `navV2`, below `md`), opened by «☰» in the app bar and sliding in from the START edge. Its header
 * is the person (picture, name, rank) and the spaces: every space a row with its unread number and its overdue number, the one the person is in marked
 * (like the accounts of a messaging app). Under it the places in the map's order, then «الإعدادات» and «دليل زاكي», «ترتيب» and the avatar menu.
 * P2.1: the header also holds what the phone's page no longer draws: who is online (`presence`, a green dot and a count) and the light/dark icon; the foot holds «المرشد» (`guide`, the owner's
 * compass: it does not float over a phone's page, it opens from here).
 * The old bottom bar stays for `navV2` OFF (src/components/shell/bottom-nav.tsx).
 *
 * C2's chat shell reuses THIS drawer as it is (it must not make a second one): `listSlot` is drawn under the places, the chat's folders or list.
 * It is a Radix dialog: focus is trapped, Escape and a tap on the dimmed page close it, and following a link closes it. `portal={false}` is for tests.
 */
export function Drawer({
  open,
  onOpenChange,
  nav,
  current,
  pathname,
  user,
  rank,
  isGuest,
  space = null,
  canOverview = false,
  badges = {},
  editing = false,
  onEditStart,
  onEditDone,
  onReset,
  canReset = false,
  onReorder,
  orderLocked = false,
  settingsHref,
  listSlot,
  presence,
  guide = false,
  portal = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: NavModel;
  current: PlaceKey | null;
  pathname: string;
  user: AvatarUser;
  rank: NavRole;
  isGuest: boolean;
  space?: ShellSpace | null;
  canOverview?: boolean;
  badges?: Partial<Record<PlaceKey, number>>;
  editing?: boolean;
  onEditStart?: () => void;
  /** «تم» and «رجّع الترتيب الأصلي» while `editing`: drawn inside the drawer, because the drawer is modal and the page's own bar would sit under it. */
  onEditDone?: () => void;
  onReset?: () => void;
  canReset?: boolean;
  onReorder?: (keys: string[]) => void;
  /** The company's order of the menu is set (D-N5): its ⚠️ + 🔧 note instead of «ترتيب». */
  orderLocked?: boolean;
  settingsHref?: string;
  /** What the chat draws under the places (C2). Left out: nothing. */
  listSlot?: ReactNode;
  /** P2.1: who is online, a dot and a count (the frame hands in `PeopleDock variant="drawer"`). Left out: nothing. */
  presence?: ReactNode;
  /** P2.1: the owner's guide is on: the foot gets «المرشد», which opens the guide's panel. */
  guide?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();
  // S3.1: «الإعدادات» is ONE door: one row in the foot, and «ترتيب» is a small icon button in the header (no «إعداداتي», «دليل زاكي» or «ترتيب» rows)
  const oneDoor = useSettingsOneDoor();
  const close = () => onOpenChange(false);
  // the drawer is hidden from `md` up by CSS; a Radix dialog that stays open would still make the page behind it inert, so it closes when the screen grows
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.matchMedia) return;
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (wide.matches) onOpenChange(false);
    };
    onChange();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open, onOpenChange]);
  const handle = user.username ? `@${user.username}` : (user.email ?? "");

  const panel = (
    <>
      <DialogOverlay className="md:hidden" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        data-shell="drawer"
        className={cn(
          // from the start edge, as wide as a phone's menu is (20rem), never more than 85% of the screen; the sheet's own side keyframes carry it in and out
          "zk-sheet-start fixed inset-y-0 start-0 z-50 flex w-[min(20rem,85vw)] flex-col border-e border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] text-fg shadow-lg focus:outline-none md:hidden",
          "data-[state=open]:animate-[zk-sheet-side-in_220ms_cubic-bezier(0.32,0.72,0,1)_both] data-[state=closed]:animate-[zk-sheet-side-out_160ms_ease-in_both] motion-reduce:animate-none",
        )}
      >
        <DialogTitle className="sr-only">{t("navv2.drawer.title")}</DialogTitle>
        {/* the header: me */}
        {/* the owner's mock-up (`.dh`): the person on the accent, in the accent's own text colour; it runs up under the notch */}
        <div data-shell="drawer-head" className="shrink-0 bg-accent px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] text-accent-fg">
          <div className="flex items-center gap-3">
            <Initial name={user.name} src={user.avatarUrl} large onAccent />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">
                <bdi>{user.name}</bdi>
              </p>
              {/* the owner (2026-11-22): the @name and the rank on ONE line */}
              <div data-shell="drawer-head-id" className="mt-0.5 flex min-w-0 items-center gap-2">
                {handle ? (
                  <span dir="ltr" className="min-w-0 truncate text-xs opacity-85">
                    {handle}
                  </span>
                ) : null}
                <span className="inline-flex shrink-0 rounded-full bg-accent-fg/15 px-2 py-0.5 text-xs font-medium text-accent-fg">{enumLabel("OrgRole", rank)}</span>
              </div>
            </div>
          </div>
          {/* the owner: ONE small row, side by side: who is online (a dot and a count) · «ليل / نهار» · «ترتيب» · «إغلاق» (32px each, nothing pinned to a corner) */}
          <div role="group" aria-label={t("phoneChrome.tools")} data-shell="drawer-head-tools" className="mt-2 flex items-center gap-1.5">
            {presence}
            <ThemeIconButton data-shell="drawer-theme" className="ms-auto size-8" />
            {oneDoor ? (
              // S3.1: «ترتيب» - one small button (the drawer stays open: the places to drag are in it, and so are «تم» and «رجّع»)
              <NavOrderButton
                orderLocked={orderLocked}
                onEditStart={editing ? undefined : onEditStart}
                className="size-8 rounded-full bg-accent-fg/15 text-accent-fg hover:bg-accent-fg/25 hover:text-accent-fg"
              />
            ) : null}
            <DialogPrimitive.Close
              aria-label={t("ui.close")}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-fg/15 text-accent-fg transition-colors hover:bg-accent-fg/25"
            >
              <X aria-hidden="true" className="size-4" />
            </DialogPrimitive.Close>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* …and the spaces, each with what waits in it */}
          <section aria-label={t("navv2.drawer.spaces")} className="border-b border-border px-2 py-2">
            <h2 className="px-2 pb-1 text-xs font-semibold text-fg-muted">{t("navv2.drawer.spaces")}</h2>
            <SpaceDropdown current={space} canOverview={canOverview} isGuest={isGuest} onNavigate={close} />
          </section>

          <nav aria-label={t("shell.places")} data-tour="places" className="px-2 py-2">
            {editing && onReorder ? (
              <SortableList id="nav-places-drawer" axis="vertical" entries={nav.places.map((place) => ({ id: place.key, label: t(place.labelKey) }))} onReorder={onReorder}>
                <ul aria-label={t("navorder.places_label")} className="space-y-0.5">
                  {nav.places.map((place) => {
                    const label = t(place.labelKey);
                    return (
                      <SortableItem key={place.key} id={place.key}>
                        {({ props }) => (
                          <div
                            {...props}
                            aria-label={t("navorder.grip", { label })}
                            className="flex h-12 touch-none cursor-grab items-center gap-3 rounded-xl border border-dashed border-border px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <NavIcon icon={place.icon} className="size-5 shrink-0" />
                            <span className="truncate">{label}</span>
                          </div>
                        )}
                      </SortableItem>
                    );
                  })}
                </ul>
              </SortableList>
            ) : (
              <ul className="space-y-0.5">
                {nav.places.map((place) => {
                  const active = place.key === current;
                  return (
                    <li key={place.key}>
                      <Link
                        href={place.href}
                        onClick={close}
                        aria-current={ariaCurrent(active, place.href, pathname)}
                        className={cn(
                          "flex h-12 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                          active ? "bg-accent/[0.12] font-semibold text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <NavIcon icon={place.icon} className="size-5 shrink-0" />
                        <span className="truncate">{t(place.labelKey)}</span>
                        <PlaceBadge count={badges[place.key]} place={place.key} className="ms-auto" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>

          {listSlot ? (
            <div data-shell="list-slot" className="border-t border-border px-2 py-2">
              {listSlot}
            </div>
          ) : null}
        </div>

        <div data-shell="drawer-foot" className="shrink-0 space-y-0.5 border-t border-border px-2 py-2">
          {editing && onEditDone && onReset ? <NavOrderControls onDone={onEditDone} onReset={onReset} canReset={canReset} className="pb-1" /> : null}
          {guide ? (
            <button
              type="button"
              data-shell="drawer-guide"
              onClick={() => {
                close();
                // the guide is its own lazy chunk: it opens its panel on this event once the drawer has finished closing
                window.setTimeout(() => window.dispatchEvent(new Event(GUIDE_OPEN_EVENT)), 180);
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-info px-3 py-1.5 text-start text-sm text-info-fg shadow-card transition-opacity hover:opacity-90"
            >
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-info-fg/20">
                <Compass className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t("siteGuide.open")}</span>
                <span className="block truncate text-xs opacity-85">{t("phoneChrome.guide_hint")}</span>
              </span>
            </button>
          ) : null}
          {oneDoor ? (
            <SettingsDoor variant="drawer" pathname={pathname} onNavigate={close} />
          ) : (
            <>
              {/* C4.1: «إعداداتي» for everybody (the person's own settings); the company's «الإعدادات», where the person has it, stays in the list below */}
              <Link href="/settings/me" onClick={close} data-settings-me-link className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
                <Settings aria-hidden="true" className="size-5 shrink-0" />
                {t("settingsMe.drawer")}
              </Link>
              <NavOptions variant="drawer" orderLocked={orderLocked} onEditStart={editing ? undefined : onEditStart} settingsHref={settingsHref} onNavigate={close} />
            </>
          )}
          <InstallAppButton />
          {/* the owner: the last thing is «تسجيل الخروج», one tap (the profile row that opened a menu is gone: the person is the header above) */}
          <SignOutButton className="mt-1" />
        </div>
      </DialogPrimitive.Content>
    </>
  );

  return <Dialog open={open} onOpenChange={onOpenChange}>{portal ? <DialogPrimitive.Portal>{panel}</DialogPrimitive.Portal> : panel}</Dialog>;
}
