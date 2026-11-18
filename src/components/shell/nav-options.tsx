"use client";

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
 * What the new menu keeps beside its places: «دليل زاكي», «الإعدادات» (when the person has that page) and «ترتيب» — or, while the company's order is
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
            onClick={() => {
              onNavigate?.();
              onEditStart();
            }}
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
