"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { ArrowUpDown, BookOpen, MoreHorizontal, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The company's order of the menu is set (D-N5): the person's own «ترتيب» screen says so — ⚠️ the order is the company's now, 🔧 ask the manager to
 * change it — instead of offering drag handles. The warning and its fix are drawn together, as AGENTS.md asks. ⚠️ Nothing the person ordered is deleted:
 * `User.navOrder` stays stored and is used again if the owner switches the company order off.
 */
export function OrderLockedNote({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div role="note" data-order-locked="" className={cn("space-y-1 rounded-xl border border-dashed border-border px-3 py-2 text-sm", className)}>
      <p className="flex gap-2 text-fg">
        <span aria-hidden="true">⚠️</span>
        <span>{t("navv2.order.company_locked")}</span>
      </p>
      <p className="flex gap-2 text-fg-muted">
        <span aria-hidden="true">🔧</span>
        <span>{t("navv2.order.company_fix")}</span>
      </p>
    </div>
  );
}

/**
 * S3.1 — is «الإعدادات» ONE door for this company (`settingsOneDoor`, see `settingsOneDoorOf` in src/lib/nav/shell-v2.ts)? The frame provides it once; the drawer, the rail, the side menu and the
 * avatar menu read it, so none of the four takes a new prop and nothing of the old menu changes while it is false (the default).
 */
export const SettingsOneDoorContext = createContext(false);
export const useSettingsOneDoor = (): boolean => useContext(SettingsOneDoorContext);

/**
 * P2.1 — the frame has the new map's DRAWER (`navV2`): below `md` there is no bottom bar and no presence row, the quick chat's bubble is not drawn and the compass lives in the drawer. The frame provides it once;
 * the two lazy floating helpers (`QuickChat`, `SiteGuide`) read it, so their props (pinned by tests/lazy-shell.test.ts) do not change. False (the default): the old bottom bar is there and they float above it as before.
 */
export const DrawerChromeContext = createContext(false);
export const useDrawerChrome = (): boolean => useContext(DrawerChromeContext);

/** The address the ONE row opens: the frame of «إعداداتي» (it also holds «إعدادات الشركة» for whoever manages the company). */
export const SETTINGS_DOOR_HREF = "/settings/me";

const ICON_BUTTON = "relative grid shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * S3.1 — «ترتيب» as ONE small icon button (the drawer's header, the top of the rail, the side menu's header) instead of a row in the foot. It starts the reorder mode (`onEditStart`: the same
 * function the old row called), and carries `data-nav-order-toggle` as the old row did. While the company's order of the menu is set (D-N5) it opens the ⚠️ + 🔧 note instead
 * (`OrderLockedNote`, `data-nav-order-locked`): the mode cannot start, and the person is told why and what to do. Drawn nothing while the mode is on (the shell draws «تم» and «رجّع»).
 * `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function NavOrderButton({ orderLocked = false, onEditStart, className, defaultOpen, portal = true }: { orderLocked?: boolean; onEditStart?: () => void; className?: string; defaultOpen?: boolean; portal?: boolean }) {
  const { t } = useI18n();
  if (orderLocked) {
    return (
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" data-nav-order-locked="" aria-label={t("navorder.toggle")} title={t("settingsOneDoor.order_locked_title")} className={cn(ICON_BUTTON, "size-9", className)}>
            <ArrowUpDown aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent portal={portal} side="bottom" align="end" className="w-64">
          <OrderLockedNote className="m-1" />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (!onEditStart) return null;
  return (
    <button type="button" data-nav-order-toggle="" onClick={onEditStart} aria-label={t("navorder.toggle")} title={t("settingsOneDoor.order_title")} className={cn(ICON_BUTTON, "size-9", className)}>
      <ArrowUpDown aria-hidden="true" className="size-4" />
    </button>
  );
}

/**
 * S3.1 — the ONE row «الإعدادات» that replaces «إعداداتي», «دليل ذكي» and «ترتيب»: it opens the frame of «إعداداتي» (`/settings/me`), where the guide is inside «المساعدة» and, for whoever manages the company,
 * «إعدادات الشركة» is the second group. `drawer` and `sidebar` are rows (the folded side menu keeps the icon and hides the word); `rail` is an icon cell like the «⋯» it replaces.
 */
export function SettingsDoor({ variant, collapsed = false, pathname, onNavigate }: { variant: "drawer" | "sidebar" | "rail"; collapsed?: boolean; pathname?: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  const label = t("settingsOneDoor.door");
  const inside = pathname !== undefined && (pathname === "/settings" || pathname.startsWith("/settings/"));
  const current = inside ? ("page" as const) : undefined;
  if (variant === "rail") {
    return (
      <Link href={SETTINGS_DOOR_HREF} data-settings-me-link="" data-settings-door="" aria-label={label} title={t("settingsOneDoor.door_title")} aria-current={current} className="grid size-11 place-items-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
        <Settings aria-hidden="true" className="size-5" />
      </Link>
    );
  }
  return (
    <Link
      href={SETTINGS_DOOR_HREF}
      onClick={onNavigate}
      data-settings-me-link=""
      data-settings-door=""
      aria-current={current}
      title={collapsed ? label : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-xl text-sm transition-colors hover:bg-surface-2 hover:text-fg [@media(max-height:760px)]:h-9",
        collapsed ? "justify-center px-0" : "px-3",
        inside ? "bg-accent/[0.12] font-semibold text-accent" : "text-fg-muted",
      )}
    >
      <Settings aria-hidden="true" className="size-5 shrink-0" />
      <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
    </Link>
  );
}

/**
 * What the new menu keeps beside its places: «دليل ذكي», «الإعدادات» (when the person has that page) and «ترتيب» — or, while the company's order is
 * set, its ⚠️ + 🔧 note instead of «ترتيب».
 *
 * `rail` is the «⋯» button at the foot of the computer's rail (a menu); `drawer` is the same list drawn open inside the phone's drawer.
 * `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function NavOptions({
  variant,
  orderLocked = false,
  onEditStart,
  settingsHref,
  settingsLabelKey = "nav.settings",
  onNavigate,
  defaultOpen,
  portal = true,
}: {
  variant: "rail" | "drawer";
  /** The company's order is set: no reordering, the note instead. */
  orderLocked?: boolean;
  /** Starts the reorder mode (left out: no «ترتيب»). */
  onEditStart?: () => void;
  /** The person's «الإعدادات» page, when the map offers one. */
  settingsHref?: string;
  settingsLabelKey?: string;
  /** The drawer closes itself when a link in it is followed. */
  onNavigate?: () => void;
  defaultOpen?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();

  if (variant === "drawer") {
    return (
      <div data-shell="nav-options" className="space-y-0.5">
        {settingsHref ? (
          <Link href={settingsHref} onClick={onNavigate} className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
            <Settings aria-hidden="true" className="size-5 shrink-0" />
            {t(settingsLabelKey)}
          </Link>
        ) : null}
        <Link href="/guide" onClick={onNavigate} className="flex h-11 items-center gap-3 rounded-xl border border-dashed border-accent-2 px-3 text-sm font-semibold text-fg transition-colors hover:bg-accent-2/10">
          <BookOpen aria-hidden="true" className="size-5 shrink-0 text-accent-2" />
          {t("shell.guide")}
        </Link>
        {orderLocked ? (
          <OrderLockedNote className="mt-1" />
        ) : onEditStart ? (
          <button
            type="button"
            data-nav-order-toggle=""
            // the drawer stays open: the places to drag are in it, and so is «تم»
            onClick={onEditStart}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ArrowUpDown aria-hidden="true" className="size-5 shrink-0" />
            {t("navorder.toggle")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("navv2.rail.options")}
          title={t("navv2.rail.options")}
          className="grid size-11 place-items-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent portal={portal} side="top" align="start" className="w-64">
        {settingsHref ? (
          <DropdownMenuItem asChild>
            <Link href={settingsHref}>
              <Settings aria-hidden="true" className="size-4 text-muted" />
              {t(settingsLabelKey)}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/guide">
            <BookOpen aria-hidden="true" className="size-4 text-muted" />
            {t("shell.guide")}
          </Link>
        </DropdownMenuItem>
        {orderLocked ? (
          <OrderLockedNote className="m-1" />
        ) : onEditStart ? (
          <DropdownMenuItem data-nav-order-toggle="" onSelect={onEditStart}>
            <ArrowUpDown aria-hidden="true" className="size-4 text-muted" />
            {t("navorder.toggle")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
