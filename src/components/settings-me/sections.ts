import type { PanelSectionKey } from "@/lib/control-panel";

/**
 * C4.1 — the sections of «إعداداتي» (C4 §3), in the order they are listed. Pure: the route, the list and the tests share it.
 * A section that does not apply is not listed and its address is «not found»: «المجلدات» needs the company's switch `chatFolders`.
 */
export const SECTION_KEYS = ["account", "notifications", "privacy", "chat", "folders", "data", "devices", "language", "menu", "shortcuts", "help"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && (SECTION_KEYS as readonly string[]).includes(value);
}

/** What decides which sections exist for this person. */
export interface SectionFacts {
  /** the company's switch `chatFolders` */
  foldersOn: boolean;
}

export function visibleSections(facts: SectionFacts): SectionKey[] {
  return SECTION_KEYS.filter((key) => key !== "folders" || facts.foldersOn);
}

export const SETTINGS_ME_HREF = "/settings/me";
export const sectionHref = (key: SectionKey): string => `${SETTINGS_ME_HREF}/${key}`;
export const sectionLabelKey = (key: SectionKey): string => `settingsMe.s.${key}`;
export const sectionHintKey = (key: SectionKey): string => `settingsMe.s.${key}.hint`;

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
 * or null when there is none. A section is drawn only when the panel offers its twin to this person. The row «لوحة التحكم» is the way to everything else of the administration
 * (the people, the reports, the archive, the structure, the assistant): it is drawn for whoever holds a section of the group and for an ADMIN or OWNER who holds any section of the panel (their
 * place «الإدارة» is not in the menu, `oneDoorHidesAdmin`).
 */
export function companyGroupOf(panelSections: readonly string[], role: string): CompanyGroup | null {
  const sections = COMPANY_SECTION_KEYS.filter((key) => panelSections.includes(PANEL_SECTION_OF[key]));
  const admin = role === "OWNER" || role === "ADMIN";
  const panelLink = panelSections.length > 0 && (sections.length > 0 || admin);
  return sections.length > 0 || panelLink ? { sections: [...sections], panelLink } : null;
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
