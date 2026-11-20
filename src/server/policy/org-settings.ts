import { z } from "zod";
import { featureOn } from "@/lib/features";
import { MAX_PINNED_TABS, WORK_OPTIONAL_TABS, type TabKey } from "@/lib/nav/places";

/** What the site opens on: the chat (D-N1, the recommended answer, awaiting the owner) or «اليوم». */
export const LANDINGS = ["chat", "today"] as const;
export type Landing = (typeof LANDINGS)[number];
export const DEFAULT_LANDING: Landing = "chat";

/**
 * `Organization.settings` is free-form JSON in the database; this is the shape the code relies on.
 * Unknown keys are kept (other phases add their own) and a broken value falls back to its default.
 */
export const orgSettingsSchema = z
  .object({
    /** Bump it to make everybody accept the transparency notice again. */
    transparencyVersion: z.number().int().min(1).optional(),
    /**
     * N1.8 — the page `/` opens on, for the whole company (D-N1): `chat` or `today`. A broken value reads as «not set», never as a failure of the
     * whole settings object (a bad landing must not cost the company its transparency version).
     */
    landing: z.enum(LANDINGS).optional().catch(undefined),
    /** N1.1 — the optional work tools the owner pinned as tabs («الشغل»): at most two keys of `WORK_OPTIONAL_TABS`. Written by A2.1, read by `workTabsOf`. */
    workTabs: z.array(z.string()).optional().catch(undefined),
    /** N1.1 — the company's own order of the menu (D-N5), the shape of `NavOrder`: written by A2.1, read by `readCompanyMenuOrder` (src/lib/nav/order.ts). */
    menuOrder: z.unknown().optional(),
  })
  .passthrough();

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const DEFAULT_TRANSPARENCY_VERSION = 1;

export function transparencyVersionOf(settings: unknown): number {
  const parsed = orgSettingsSchema.safeParse(settings ?? {});
  return parsed.success ? (parsed.data.transparencyVersion ?? DEFAULT_TRANSPARENCY_VERSION) : DEFAULT_TRANSPARENCY_VERSION;
}

/** What a signed-in person must still do before the app lets them in. */
export interface OnboardingState {
  mustChangePassword: boolean;
  transparencyPending: boolean;
}

export function onboardingStateOf(
  user: { mustChangePassword: boolean; transparencyVersion: number | null },
  orgSettings: unknown,
): OnboardingState {
  return {
    mustChangePassword: user.mustChangePassword,
    transparencyPending: (user.transparencyVersion ?? 0) < transparencyVersionOf(orgSettings),
  };
}

const settingsObject = (settings: unknown): Record<string, unknown> => (settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {});

/** The company's landing page: `landing` when it is a known value, otherwise the default (the chat). */
export function landingOf(settings: unknown): Landing {
  const value = settingsObject(settings)["landing"];
  return typeof value === "string" && (LANDINGS as readonly string[]).includes(value) ? (value as Landing) : DEFAULT_LANDING;
}

/** The tools the owner pinned: only keys of `WORK_OPTIONAL_TABS`, once each, at most `MAX_PINNED_TABS`; anything else in the stored value is ignored. */
export function workTabsOf(settings: unknown): TabKey[] {
  const value = settingsObject(settings)["workTabs"];
  if (!Array.isArray(value)) return [];
  const optional = WORK_OPTIONAL_TABS as readonly string[];
  const seen = new Set<string>();
  for (const key of value) if (typeof key === "string" && optional.includes(key)) seen.add(key);
  return [...seen].slice(0, MAX_PINNED_TABS) as TabKey[];
}

/**
 * What the map needs from the company's settings, ready to spread into a `NavSubject`: `{ ...navSubject, ...navExtrasOf(settings) }` —
 * whether the new map is on (`navV2`, OFF by default), whether «مهامي» is the one screen of tasks (`workMyTasks`, OFF by default: with it on the OLD map stops drawing
 * «القائمة» and «التقويم», which are views of it, W1.1) and the pinned work tabs.
 */
export function navExtrasOf(settings: unknown): { navV2: boolean; workMyTasks: boolean; workTabs: TabKey[] } {
  return { navV2: featureOn(settings, "navV2"), workMyTasks: featureOn(settings, "workMyTasks"), workTabs: workTabsOf(settings) };
}
