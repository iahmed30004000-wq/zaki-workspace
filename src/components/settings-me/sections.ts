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

/** The section an address belongs to (`/settings/me/chat/…` → chat), or null for the index and anything else. */
export function sectionOfPath(pathname: string): SectionKey | null {
  const match = /^\/settings\/me\/([^/]+)/.exec(pathname);
  return match && isSectionKey(match[1]) ? match[1] : null;
}
