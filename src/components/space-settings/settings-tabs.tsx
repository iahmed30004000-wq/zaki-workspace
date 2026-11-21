"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useSettingsOneDoor } from "@/components/shell/nav-options";
import { settingsHref, settingsTabLabelKey, type SpaceSettingsTab } from "./tabs";

/**
 * The tab strip of a space's settings page (A2.2, switch `controlPanelV2`): «عام · الناس · المقاطع · الدردشة · الشغل · خطر», only the ones the person is offered.
 * Every tab is a link (an address: the back button and a pasted link land on the same tab); the current one wears `aria-current="page"` and the soft accent (the same
 * look as a project's tabs). The strip scrolls sideways on a narrow screen instead of wrapping, and every target is at least 44px high on a phone.
 */
export function SettingsTabs({ spaceId, tabs, current }: { spaceId: string; tabs: readonly SpaceSettingsTab[]; current: SpaceSettingsTab }) {
  const { t } = useI18n();
  const oneDoor = useSettingsOneDoor();
  return (
    <nav aria-label={t("spset.tabs")} data-space-settings-tabs>
      <ul className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab === current;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={settingsHref(spaceId, tab)}
                data-space-settings-tab={tab}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center whitespace-nowrap rounded-[9px] px-3.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent md:min-h-9",
                  active ? "bg-accent/10 text-accent" : tab === "danger" ? "text-danger hover:bg-danger/10" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {t(settingsTabLabelKey(tab, oneDoor))}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
