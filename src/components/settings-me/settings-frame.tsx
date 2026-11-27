"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, Bell, Building2, ChevronLeft, Database, Folder, Keyboard, Languages, LayoutDashboard, LayoutGrid, LifeBuoy, ListOrdered, Lock, MessageCircle, Music, Plug, Smartphone, Sparkles, ToggleRight, UserRound, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useI18n } from "@/lib/i18n";
import { useTgPhoneOn } from "@/components/shell/tg-phone";
import { TgSettingsBar } from "@/components/settings-me/tg-settings-bar";
import { cn } from "@/lib/utils";
import {
  companySectionHintKey,
  companySectionHref,
  companySectionLabelKey,
  companySectionOfPath,
  PANEL_LINK_HREF,
  sectionHintKey,
  sectionHref,
  sectionLabelKey,
  sectionOfPath,
  PHONE_ONLY_SECTIONS,
  SETTINGS_ME_HREF,
  type CompanyGroup,
  type CompanySectionKey,
  type SectionKey,
} from "@/components/settings-me/sections";
import { MeEffects } from "@/components/settings-me/me-effects";
import { useSettingsOneDoor } from "@/components/shell/nav-options";

/**
 * C4.1 — the frame of «إعداداتي». On the computer two columns: the sections on the start side, the open section on the end side. On the phone ONE list that
 * pushes each section as a screen (Telegram's Android): at the index only the list is drawn, inside a section only the section with its «رجوع».
 * The sections are ordinary links: every one is an address of its own (`/settings/me/<section>`), so back, reload and a shared link all work.
 */
const ICONS: Record<SectionKey, LucideIcon> = {
  account: UserRound,
  notifications: Bell,
  sounds: Music,
  privacy: Lock,
  chat: MessageCircle,
  effects: Sparkles,
  speech: AudioLines,
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

/** S3.1 — the icons of the company group (the panel's own sections, drawn here) and of the row that opens the panel. */
const COMPANY_ICONS: Record<CompanySectionKey, LucideIcon> = {
  company: Building2,
  features: ToggleRight,
  integrations: Plug,
  spaces: LayoutGrid,
};

/** One row of the list: a tile, a name, its one line and (on the phone) the chevron. `data-section` is the key the tests and the route use. */
function Row({ href, name, hint, icon: Icon, tile, active, dataKey, extra, phoneOnly = false, computerOnly = false }: { href: string; name: string; hint: string; icon: LucideIcon; tile: string; active: boolean; dataKey: string; extra?: Record<string, string>; phoneOnly?: boolean; computerOnly?: boolean }) {
  return (
    <li className={cn("relative [&+&]:before:absolute [&+&]:before:inset-x-3.5 [&+&]:before:top-0 [&+&]:before:border-t [&+&]:before:border-border [&+&]:before:content-['']", phoneOnly && "md:hidden", computerOnly && "max-md:hidden")}>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        data-section={dataKey}
        {...extra}
        className={cn("flex min-h-14 items-center gap-3 px-3.5 py-2 transition-colors", active ? "bg-accent/15 text-accent" : "text-fg hover:bg-surface-2")}
      >
        <span data-section-tile="" className={cn("grid size-[34px] shrink-0 place-items-center rounded-[10px] text-on-photo", tile)}>
          <Icon aria-hidden="true" className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-[1.45]">{name}</span>
          <span className={cn("block truncate text-[13px] leading-[1.45]", active ? "text-accent/80" : "text-fg-muted")}>{hint}</span>
        </span>
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0 text-fg-muted md:hidden" />
      </Link>
    </li>
  );
}

/**
 * The sections. Without `company` (the switch off) it is the one list of the person's own sections, exactly as it was. With `company` (S3.1, «الإعدادات» as ONE door) it is two groups under their own
 * headings: «إعداداتي» (the same sections) and «إعدادات الشركة» (the control panel's sections the person may open, and the row «لوحة التحكم» that opens the panel).
 */
export function SectionList({ sections, current, company = null, currentCompany = null, profileApart = false }: { sections: readonly SectionKey[]; current: SectionKey | null; company?: CompanyGroup | null; currentCompany?: CompanySectionKey | null; profileApart?: boolean }) {
  const { t } = useI18n();
  // S3.3: the theme has ONE home (the section `language`), which wears its new name while «الإعدادات» is ONE door
  const oneDoor = useSettingsOneDoor();
  // a phone-only row takes no turn of the tiles' colours: the other rows keep theirs
  const coloured = sections.filter((key) => !PHONE_ONLY_SECTIONS.has(key));
  const own = sections.map((key) => <Row key={key} href={sectionHref(key)} name={t(sectionLabelKey(key, oneDoor))} hint={t(sectionHintKey(key, oneDoor))} icon={ICONS[key]} tile={PHONE_ONLY_SECTIONS.has(key) ? "bg-cat-4" : (TILES[coloured.indexOf(key) % TILES.length] as string)} phoneOnly={PHONE_ONLY_SECTIONS.has(key)} computerOnly={profileApart && key === "account"} active={key === current} dataKey={key} />);
  if (!company) {
    return (
      <nav aria-label={t("settingsMe.sections")} data-settings-sections>
        <ul>{own}</ul>
      </nav>
    );
  }
  return (
    <nav aria-label={t("settingsMe.sections")} data-settings-sections data-settings-groups="">
      <section aria-labelledby="settings-group-me" data-settings-group-list="me">
        <h2 id="settings-group-me" className="px-3.5 pb-1 pt-3 text-xs font-bold text-accent">
          {t("settingsOneDoor.group.me")}
        </h2>
        <ul>{own}</ul>
      </section>
      <section aria-labelledby="settings-group-company" data-settings-group-list="company" className="border-t border-border">
        <h2 id="settings-group-company" className="px-3.5 pb-1 pt-3 text-xs font-bold text-accent">
          {t("settingsOneDoor.group.company")}
        </h2>
        <ul>
          {company.sections.map((key, at) => (
            <Row key={key} href={companySectionHref(key)} name={t(companySectionLabelKey(key))} hint={t(companySectionHintKey(key))} icon={COMPANY_ICONS[key]} tile={TILES[(at + 2) % TILES.length] as string} active={key === currentCompany} dataKey={key} />
          ))}
          {company.panelLink ? (
            <Row href={PANEL_LINK_HREF} name={t("settingsOneDoor.panel")} hint={t("settingsOneDoor.panel.hint")} icon={LayoutDashboard} tile="bg-cat-1" active={false} dataKey="panel" extra={{ "data-settings-panel-link": "" }} />
          ) : null}
        </ul>
      </section>
    </nav>
  );
}

export function SettingsFrame({ header, sections, company = null, profileApart = false, children }: { header: SettingsHeader; sections: readonly SectionKey[]; /** S3.1: the second group («إعدادات الشركة»); left out, the frame is the person's own sections alone. */ company?: CompanyGroup | null; /** «شريط تيليجرام السفلي»: the profile has its own tab, so a phone draws neither its card nor «حسابي» here */ profileApart?: boolean; children?: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? SETTINGS_ME_HREF;
  const current = sectionOfPath(pathname);
  const currentCompany = company ? companySectionOfPath(pathname) : null;
  const atIndex = current === null && currentCompany === null;
  const tg = useTgPhoneOn();
  return (
    // with the bottom bar the settings are a place of their own, as in his pictures: on a phone the app's top bar steps aside and the page owns the notch
    <div data-settings-me {...(profileApart ? { "data-frame-bars": "hide-top" } : {})} className={cn("mx-auto flex w-full", profileApart && "max-md:pt-[env(safe-area-inset-top)]", currentCompany ? "max-w-6xl" : "max-w-5xl", "md:gap-4 md:p-6")}>
      {/* keeps this device's copy of the person's choices fresh and applies the text size and the wallpaper (the person may land here first) */}
      <MeEffects always />
      <aside className={cn("w-full md:block md:w-80 md:shrink-0", tg && "max-md:relative", atIndex ? "block" : "hidden")}>
        {tg && atIndex ? <TgSettingsBar /> : null}
        <div className="overflow-hidden bg-surface-1 md:rounded-[14px]">
          {profileApart ? <h1 data-settings-title="" className="px-3.5 pb-1 pt-4 text-center text-[17px] font-semibold text-fg md:hidden">{t("settingsMe.tg.title")}</h1> : null}
          <HeaderCard header={header} className={profileApart ? "max-md:hidden" : undefined} />
          <SectionList sections={sections} current={current} company={company} currentCompany={currentCompany} profileApart={profileApart} />
        </div>
      </aside>
      <section key={tg && !atIndex ? pathname : undefined} {...(tg && !atIndex ? { "data-tg-sub": "" } : {})} className={cn("min-w-0 flex-1", atIndex ? "hidden md:block" : "block")}>{children}</section>
    </div>
  );
}
