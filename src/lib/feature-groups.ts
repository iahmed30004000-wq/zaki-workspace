/**
 * A1.4 — «الميزات» grouped: the order of the groups, the two presets and the small pure helpers the screen and the server share.
 * Pure (no React, no server imports). The metadata itself (`group`, `dependsOn`) lives with the keys in src/lib/features.ts.
 */
import { COMPANY_CHAT_GROUP, FEATURES, FEATURE_DEFAULTS, FEATURE_GROUPS, FEATURE_META, type FeatureGroup, type FeatureKey } from "./features";

/**
 * The order the groups are drawn in. The spec lists work, library, chat, people, owner, platform; C4.3 made the chat group the FIRST group after the economy
 * panel (its tests pin it), and A1.4 reuses that group instead of rebuilding it, so the chat group heads the list and the other five keep the spec's order.
 */
export const FEATURE_GROUP_ORDER: readonly FeatureGroup[] = ["chat", ...FEATURE_GROUPS.filter((g) => g !== "chat")];

/** «وضع التوفير» has its own panel at the top and is in no group of the list. */
const OWN_PANEL: ReadonlySet<FeatureKey> = new Set<FeatureKey>(["economyMode"]);

/** The switches of one group, in the order they are drawn: the chat group opens with C4.3's fourteen, in the spec's order; the rest follow `FEATURES`. */
export function groupKeys(group: FeatureGroup): FeatureKey[] {
  const head = group === "chat" ? COMPANY_CHAT_GROUP.map((g) => g.key) : [];
  const inHead = new Set<FeatureKey>(head);
  const rest = FEATURES.filter((key) => FEATURE_META[key].group === group && !inHead.has(key) && !OWN_PANEL.has(key));
  return [...head, ...rest];
}

// ---------- presets ----------

/**
 * «الوضع البسيط» switches OFF exactly these ten keys and nothing else. Goals, production, campaigns and CRM are PERMISSIONS, not switches: this preset
 * does not hide their tabs (that is the company tab settings of A2.1, which do not exist yet).
 */
export const SIMPLE_MODE_OFF = ["okr", "checkins", "customFields", "taskRules", "taskRewards", "milestones", "taskLinks", "watch", "whiteboard", "timeTracking"] as const satisfies readonly FeatureKey[];

export const FEATURE_PRESETS = ["simple", "all"] as const;
export type FeaturePreset = (typeof FEATURE_PRESETS)[number];

export function isFeaturePreset(value: unknown): value is FeaturePreset {
  return typeof value === "string" && (FEATURE_PRESETS as readonly string[]).includes(value);
}

type State = Readonly<Record<FeatureKey, boolean>> | ReadonlyArray<{ key: FeatureKey; on: boolean }>;

function stateOf(current: State): Record<FeatureKey, boolean> {
  const out = { ...FEATURE_DEFAULTS };
  if (Array.isArray(current)) {
    for (const { key, on } of current as ReadonlyArray<{ key: FeatureKey; on: boolean }>) out[key] = on;
    return out;
  }
  return { ...out, ...(current as Record<FeatureKey, boolean>) };
}

/**
 * The keys a preset sets: «الوضع البسيط» = the ten OFF; «كل شي» = every switch that is ON in a company nobody touched (its default is ON) set ON.
 * A switch that STARTS off (a model that reads text, the backup, the outside door, economy mode, an owner-hiding switch, a rollout switch awaiting the
 * owner's own check) is never switched on by a button: it needs a key, a setup or a decision, and the owner turns it on one at a time.
 */
export function presetTarget(preset: FeaturePreset): ReadonlyArray<{ key: FeatureKey; on: boolean }> {
  if (preset === "simple") return SIMPLE_MODE_OFF.map((key) => ({ key, on: false }));
  return FEATURES.filter((key) => FEATURE_DEFAULTS[key]).map((key) => ({ key, on: true }));
}

/** Only what would CHANGE: the keys of the preset whose value now differs. Nothing else is ever listed or written. */
export function presetChanges(preset: FeaturePreset, current: State): { key: FeatureKey; on: boolean }[] {
  const now = stateOf(current);
  return presetTarget(preset).filter((c) => now[c.key] !== c.on).map((c) => ({ key: c.key, on: c.on }));
}

/** Is this preset's whole target already in force? */
export function presetActive(preset: FeaturePreset, current: State): boolean {
  return presetChanges(preset, current).length === 0;
}

// ---------- dependencies ----------

/** The parents of a switch that are OFF right now (the owner's own choices), in the order the metadata names them. */
export function missingParents(key: FeatureKey, current: State): FeatureKey[] {
  const now = stateOf(current);
  return (FEATURE_META[key].dependsOn ?? []).filter((parent) => !now[parent]);
}

// ---------- search ----------

/** Arabic search form: no vowel marks or tatweel, the hamza and alef variants as one, ta marbuta as ha, alef maqsura as ya, lower case, single spaces. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query is found in one of the texts (an empty query matches everything). */
export function matchesSearch(texts: readonly string[], query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.map(normalizeSearch).join(" ");
  return words.every((word) => hay.includes(word));
}
