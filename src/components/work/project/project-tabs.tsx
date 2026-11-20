"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ProjectTab, TabOffer } from "./tabs";

/**
 * The tab strip of a project page (W1.5, switch `navV2`): «اللوحة · القائمة · التقويم · الجدول الزمني · الحقول والقواعد · الإعدادات». Every tab is a link (an
 * address: the back button and a pasted link land on the same tab); the current one wears `aria-current="page"`. The strip scrolls sideways on a narrow
 * screen instead of wrapping, and every target is at least 44px high (a thumb, not a mouse).
 */
export function ProjectTabs({ tabs, current }: { tabs: readonly TabOffer[]; current: ProjectTab }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("projpage.tabs")} data-project-tabs className="border-b border-border">
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((offer) => {
          const active = offer.tab === current;
          return (
            <li key={offer.tab} className="shrink-0">
              <Link
                href={offer.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  active ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {t(offer.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
