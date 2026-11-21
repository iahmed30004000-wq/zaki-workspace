/**
 * A2.2 — the tabs of ONE settings page per space (`/spaces/[id]/settings`, switch `controlPanelV2`): «عام · الناس · المقاطع · الدردشة · الشغل · خطر».
 * PURE (no React, no server imports): the page, the strip and the tests read the same words and the same addresses.
 *
 * Which tabs a person is OFFERED is discoverability only; the page and the routes behind every control decide again on the server.
 * A person sees no tab they cannot use: a plain member of the space reads «الناس» and «المقاطع» (the lists they already read on the projects page); the
 * space's manager gets everything but «خطر»; «خطر» is offered only to whoever can really archive or delete the space (archive: the OWNER and the
 * ADMINs, as `setSpaceArchived`; delete: the OWNER, as `deleteSpaceWithWork`), and an external partner is offered nothing (the page is «not found»).
 *
 * The word of the third tab is today's «المقاطع» (D-N4, «الفرق», is not answered): the label is ONE string (`spset.tab.teams`).
 */

export const SPACE_SETTINGS_TABS = ["general", "people", "teams", "chat", "work", "danger"] as const;
export type SpaceSettingsTab = (typeof SPACE_SETTINGS_TABS)[number];

/** What the server read about the person and the space before the strip is drawn. */
export interface SettingsFacts {
  /** An external partner: never offered the page. */
  external: boolean;
  /** The space's manager (`isSpaceManager`: the OWNER, the space's ADMIN, an org ADMIN who is in it). */
  manager: boolean;
  /** May archive this space (the OWNER and the ADMINs; never «الشركة»). */
  canArchive: boolean;
  /** May delete this space with its work (the OWNER; never «الشركة»). */
  canDelete: boolean;
}

/**
 * The string key of a tab's name (`ar.spaces.json`). `oneDoor` (S3.3, the switch `settingsOneDoor`): «الناس» means the company's people, so the space's own list is «أعضاء المساحة». Left out, today's word.
 */
export const settingsTabLabelKey = (tab: SpaceSettingsTab, oneDoor = false): string => (oneDoor && tab === "people" ? "spset.tab.people.one" : `spset.tab.${tab}`);

/** The tabs a person is offered, in the order of the strip. */
export function settingsTabsFor(facts: SettingsFacts): SpaceSettingsTab[] {
  if (facts.external) return [];
  const offered: SpaceSettingsTab[] = ["people", "teams"];
  if (facts.manager) offered.unshift("general");
  if (facts.manager) offered.push("chat", "work");
  if (facts.manager && (facts.canArchive || facts.canDelete)) offered.push("danger");
  return SPACE_SETTINGS_TABS.filter((tab) => offered.includes(tab));
}

const isTab = (value: string): value is SpaceSettingsTab => (SPACE_SETTINGS_TABS as readonly string[]).includes(value);

/** The tab an address names, when the person is offered it; anything else (unknown, or not offered) is the first offered tab, never an error. */
export function parseSettingsTab(raw: string | string[] | null | undefined, offered: readonly SpaceSettingsTab[]): SpaceSettingsTab | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (isTab(value) && offered.includes(value)) return value;
  return offered[0] ?? null;
}

/** The address of a space's settings page; the first tab is the bare address. */
export function settingsHref(spaceId: string, tab?: SpaceSettingsTab): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}/settings`;
  return tab && tab !== "general" ? `${base}?tab=${tab}` : base;
}
