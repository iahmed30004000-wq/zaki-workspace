"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronLeft, Database, Folder, Keyboard, Languages, LifeBuoy, ListOrdered, Lock, MessageCircle, Smartphone, UserRound, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { sectionHintKey, sectionHref, sectionLabelKey, sectionOfPath, SETTINGS_ME_HREF, type SectionKey } from "@/components/settings-me/sections";
import { MeEffects } from "@/components/settings-me/me-effects";

/**
 * C4.1 — the frame of «إعداداتي». On the computer two columns: the sections on the start side, the open section on the end side. On the phone ONE list that
 * pushes each section as a screen (Telegram's Android): at the index only the list is drawn, inside a section only the section with its «رجوع».
 * The sections are ordinary links: every one is an address of its own (`/settings/me/<section>`), so back, reload and a shared link all work.
 */
const ICONS: Record<SectionKey, LucideIcon> = {
  account: UserRound,
  notifications: Bell,
  privacy: Lock,
  chat: MessageCircle,
  folders: Folder,
  data: Database,
  devices: Smartphone,
  language: Languages,
  menu: ListOrdered,
  shortcuts: Keyboard,
  help: LifeBuoy,
};

/** The round-cornered tile behind each section's icon (the mockup's coloured squares): the categorical theme tokens, never a raw colour. */
const TILES = ["bg-cat-4", "bg-cat-1", "bg-cat-6", "bg-cat-3", "bg-cat-5", "bg-cat-2"] as const;

export interface SettingsHeader {
  name: string;
  username: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
}

export function HeaderCard({ header, className }: { header: SettingsHeader; className?: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={sectionHref("account")}
      data-settings-header
      aria-label={t("settingsMe.header.open")}
      className={cn("flex items-center gap-3 border-b border-border px-3.5 py-4 transition-colors hover:bg-surface-2", className)}
    >
      <Avatar name={header.name} src={header.avatarUrl} className="size-16 text-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold text-fg">
          <bdi>{header.name}</bdi>
        </span>
        {header.username ? (
          <span dir="ltr" className="block truncate text-end text-[13px] text-fg-muted">
            @{header.username}
          </span>
        ) : null}
        {header.jobTitle ? <span className="block truncate text-[13px] text-fg-muted">{header.jobTitle}</span> : null}
      </span>
    </Link>
  );
}

export function SectionList({ sections, current }: { sections: readonly SectionKey[]; current: SectionKey | null }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("settingsMe.sections")} data-settings-sections>
      <ul>
        {sections.map((key, at) => {
          const Icon = ICONS[key];
          const active = key === current;
          return (
            <li key={key} className="relative [&+&]:before:absolute [&+&]:before:inset-x-3.5 [&+&]:before:top-0 [&+&]:before:border-t [&+&]:before:border-border [&+&]:before:content-['']">
              <Link
                href={sectionHref(key)}
                aria-current={active ? "page" : undefined}
                data-section={key}
                className={cn(
                  "flex min-h-14 items-center gap-3 px-3.5 py-2 transition-colors",
                  active ? "bg-accent/15 text-accent" : "text-fg hover:bg-surface-2",
                )}
              >
                <span data-section-tile="" className={cn("grid size-[34px] shrink-0 place-items-center rounded-[10px] text-on-photo", TILES[at % TILES.length])}>
                  <Icon aria-hidden="true" className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium leading-[1.45]">{t(sectionLabelKey(key))}</span>
                  <span className={cn("block truncate text-[13px] leading-[1.45]", active ? "text-accent/80" : "text-fg-muted")}>{t(sectionHintKey(key))}</span>
                </span>
                <ChevronLeft aria-hidden="true" className="size-4 shrink-0 text-fg-muted md:hidden" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SettingsFrame({ header, sections, children }: { header: SettingsHeader; sections: readonly SectionKey[]; children?: React.ReactNode }) {
  const pathname = usePathname() ?? SETTINGS_ME_HREF;
  const current = sectionOfPath(pathname);
  const atIndex = current === null;
  return (
    <div data-settings-me className="mx-auto flex w-full max-w-5xl md:gap-4 md:p-6">
      {/* keeps this device's copy of the person's choices fresh and applies the text size and the wallpaper (the person may land here first) */}
      <MeEffects always />
      <aside className={cn("w-full md:block md:w-80 md:shrink-0", atIndex ? "block" : "hidden")}>
        <div className="overflow-hidden bg-surface-1 md:rounded-[14px]">
          <HeaderCard header={header} />
          <SectionList sections={sections} current={current} />
        </div>
      </aside>
      <section className={cn("min-w-0 flex-1", atIndex ? "hidden md:block" : "block")}>{children}</section>
    </div>
  );
}
