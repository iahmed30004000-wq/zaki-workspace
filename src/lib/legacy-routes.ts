/**
 * Every old address that now lives inside «لوحة التحكم» (A2.1, switch `controlPanelV2`), PURE.
 *
 * `LEGACY_ROUTES` (src/lib/nav/places.ts) lists the addresses the app had before the restructure and a test proves each one is still a page. This is the other half:
 * where each address of the control panel's parts leads while the switch is ON. The page itself stays on disk and still answers: with the switch OFF it is drawn as it
 * always was, and with it ON it redirects to its section ONLY for a person who may open that section (anybody else keeps the page exactly as it was, so no address ever
 * becomes a dead end). `/files` is the library, a page of its own: it stays, and the Google Drive link of «التكاملات» opens the same Drive card as before.
 */
import { panelHref, type PanelSectionKey } from "@/lib/control-panel";

export interface PanelTarget {
  section: PanelSectionKey;
  part?: string;
}

/** The old address → its section (and part). A query the old page understood (`?c=` of the assistant) is carried by `panelRedirectHref`. */
export const PANEL_REDIRECTS: Readonly<Record<string, PanelTarget>> = {
  "/analytics": { section: "reports" },
  "/members": { section: "accounts" },
  "/spaces": { section: "spaces" },
  "/structure": { section: "structure", part: "structure" },
  "/development": { section: "structure", part: "development" },
  "/automation": { section: "integrations", part: "automation" },
  "/telegram": { section: "integrations", part: "telegram" },
  "/archive": { section: "archive" },
  "/owner/assistant": { section: "assistant" },
  "/owner/assistant/settings": { section: "integrations", part: "ai" },
};

/**
 * S3.1 — with «الإعدادات» as ONE door (switch `settingsOneDoor`) the two old addresses of the settings lead into the frame of «إعداداتي» (`/settings/me`): `/profile` to «حسابي» (it always did), `/settings`
 * to the first section of «إعدادات الشركة» the person may open (`firstCompanySection`, a key of src/components/settings-me/sections.ts) and, for a person who has none, to the index of the frame.
 * Nobody lands on a dead end and nothing is removed: with the switch off both pages are exactly what they were.
 */
export const SETTINGS_ME_ROOT = "/settings/me";
export function settingsDoorTarget(address: "/settings" | "/profile", firstCompanySection: string | null = null): string {
  if (address === "/profile") return `${SETTINGS_ME_ROOT}/account`;
  return firstCompanySection ? `${SETTINGS_ME_ROOT}/${firstCompanySection}` : SETTINGS_ME_ROOT;
}

/**
 * The query an old page was opened with, ready to ride to its section: the first value of each key, without the keys the panel uses itself (`s`, `part`, `v`). A link that
 * carries a message (`/automation?google=connected` from Google's callback, `/members?new=person` from «جديد») must still say it after the hop.
 */
export function carriedQuery(searchParams: Readonly<Record<string, string | string[] | undefined>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one !== undefined && one !== "" && key !== "s" && key !== "part" && key !== "v") out[key] = one;
  }
  return out;
}

/** The old addresses, in a fixed order (the walk test opens each of them). */
export const PANEL_REDIRECT_ADDRESSES: readonly string[] = Object.keys(PANEL_REDIRECTS);

/** Where an old address leads inside the panel, or null when it is not one of the moved ones. `extra` carries a query the old page understood. */
export function panelRedirectHref(address: string, extra?: Readonly<Record<string, string | undefined>>): string | null {
  const target = PANEL_REDIRECTS[address];
  return target ? panelHref(target.section, target.part, extra) : null;
}
