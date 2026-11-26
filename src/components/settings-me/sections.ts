import type { PanelSectionKey } from "@/lib/control-panel";

/**
 * C4.1 — the sections of «إعداداتي» (C4 §3), in the order they are listed. Pure: the route, the list and the tests share it.
 * A section that does not apply is not listed and its address is «not found»: «المجلدات» needs the company's switch `chatFolders`.
 */
export const SECTION_KEYS = ["account", "notifications", "sounds", "privacy", "chat", "effects", "folders", "data", "devices", "language", "menu", "shortcuts", "help"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && (SECTION_KEYS as readonly string[]).includes(value);
}

/** What decides which sections exist for this person. */
export interface SectionFacts {
  /** the company's switch `chatFolders` */
  foldersOn: boolean;
  /** «الأصوات», the sounds library: a part of «تيليجرام على التلفون» (`chatLayoutV2` and `tgPhone`); absent: listed */
  soundsOn?: boolean;
}

export function visibleSections(facts: SectionFacts): SectionKey[] {
  return SECTION_KEYS.filter((key) => (key !== "folders" || facts.foldersOn) && (key !== "sounds" || facts.soundsOn !== false));
}

export const SETTINGS_ME_HREF = "/settings/me";
export const sectionHref = (key: SectionKey): string => `${SETTINGS_ME_HREF}/${key}`;
/**
 * The name and the line of a section. `oneDoor` (S3.3, the switch `settingsOneDoor`): the theme has ONE home, «المظهر واللغة» (the section `language`), so that section wears its new name and the
 * chat section's line stops naming the theme. Left out, today's words.
 */
export const sectionLabelKey = (key: SectionKey, oneDoor = false): string => (oneDoor && key === "language" ? "settingsMe.s.language.one" : `settingsMe.s.${key}`);
export const sectionHintKey = (key: SectionKey, oneDoor = false): string => (oneDoor && (key === "language" || key === "chat") ? `settingsMe.s.${key}.one.hint` : `settingsMe.s.${key}.hint`);

/**
 * S3.1 — «إعدادات الشركة»: the second group of the frame while «الإعدادات» is ONE door (switch `settingsOneDoor`). Each one shows the control panel's own section body (MOVED, not rebuilt:
 * src/components/control-panel/sections/*), under an address of the same frame (`/settings/me/<key>`). Pure, like the rest of this file; the route decides again on the server.
 */
export const COMPANY_SECTION_KEYS = ["company", "features", "integrations", "spaces"] as const;
export type CompanySectionKey = (typeof COMPANY_SECTION_KEYS)[number];

export function isCompanySectionKey(value: unknown): value is CompanySectionKey {
  return typeof value === "string" && (COMPANY_SECTION_KEYS as readonly string[]).includes(value);
}

/** The panel section whose body each company section draws (one to one: the key is the same). */
export const PANEL_SECTION_OF: Readonly<Record<CompanySectionKey, PanelSectionKey>> = { company: "company", features: "features", integrations: "integrations", spaces: "spaces" };

/** Where the row «لوحة التحكم» leads (the panel's overview, `panelHref("overview")`: a test keeps the two equal). */
export const PANEL_LINK_HREF = "/owner";

/** What the second group holds for one person: the sections they may open and whether the row «لوحة التحكم» is drawn. */
export interface CompanyGroup {
  sections: CompanySectionKey[];
  panelLink: boolean;
}

/**
 * The group of «إعدادات الشركة» for a person, from the panel sections they may open (`panelSectionsFor`, the capability checks of the panel itself: never a rank check of this file's own),
 * or null when there is none. A section is drawn only when the panel offers its twin to this person.
 *
 * The row «لوحة التحكم» (S3.1) is drawn only for somebody whose menu has no place of that name: an OWNER or an ADMIN holds the place «لوحة التحكم» (S3.2, `oneDoorPanelPlace`), so a second door to the
 * same page inside the settings is a duplicate (S3.3), and an admin who holds nothing of the group has no group at all.
 */
export function companyGroupOf(panelSections: readonly string[], role: string): CompanyGroup | null {
  const sections = COMPANY_SECTION_KEYS.filter((key) => panelSections.includes(PANEL_SECTION_OF[key]));
  const admin = role === "OWNER" || role === "ADMIN";
  const panelLink = !admin && panelSections.length > 0 && sections.length > 0;
  return sections.length > 0 ? { sections: [...sections], panelLink } : null;
}

export const companySectionHref = (key: CompanySectionKey): string => `${SETTINGS_ME_HREF}/${key}`;
export const companySectionLabelKey = (key: CompanySectionKey): string => `settingsOneDoor.s.${key}`;
export const companySectionHintKey = (key: CompanySectionKey): string => `settingsOneDoor.s.${key}.hint`;

/** The company section an address belongs to (`/settings/me/features` → features), or null. */
export function companySectionOfPath(pathname: string): CompanySectionKey | null {
  const match = /^\/settings\/me\/([^/]+)/.exec(pathname);
  return match && isCompanySectionKey(match[1]) ? match[1] : null;
}

/** The section an address belongs to (`/settings/me/chat/…` → chat), or null for the index and anything else. */
export function sectionOfPath(pathname: string): SectionKey | null {
  const match = /^\/settings\/me\/([^/]+)/.exec(pathname);
  return match && isSectionKey(match[1]) ? match[1] : null;
}
