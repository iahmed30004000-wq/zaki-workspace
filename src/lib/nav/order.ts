/**
 * «ترتيبي» — the person's own order of the menu, PURE (no React, no server imports, like places.ts).
 *
 * The owner's ask (2026-10-30): each person drags the places of the menu (computer side menu and phone bar alike) and the
 * tabs inside each place into the order they like. The order is personal and stored on the account
 * (`User.navOrder`), so it follows them to the phone.
 *
 * The rules, all in this file so the screens and the server share them:
 *   - the CODE's order is the default (`PLACES`); a person without a saved order sees exactly that;
 *   - an order only reorders what the person may SEE: it is applied over the map `buildNav` drew for them, so it never
 *     reveals anything and «الإدارة» keeps its access rules wherever it sits;
 *   - a saved order never hides anything and never breaks: an entry it does not know (a place the code added, a tab that
 *     was hidden when the order was saved) falls in at its default place, and an entry the code removed is ignored;
 *   - writing is strict (`navOrderSchema`: known keys only, no duplicates, bounded sizes), reading is forgiving
 *     (`readNavOrder`: whatever is wrong is dropped, the rest is kept).
 */

import { z } from "zod";
import { CARDS_PLACE, PLACES_V1, PLACES_V2, type NavModel, type NavPlace } from "./places";

export interface NavOrder {
  /** Place keys, in the person's order. */
  places: string[];
  /** Tab keys per place key, in the person's order. */
  tabs: Record<string, string[]>;
}

/** Every place the code knows («اللوحات» of a cards space included), on either map. */
export const PLACE_KEYS: readonly string[] = [...new Set([...PLACES_V1, ...PLACES_V2, CARDS_PLACE].map((place) => place.key as string))];

/**
 * Every tab of each place that has tabs, on either map (the new map's «المزيد» tools count: an order may name them), each key once.
 * A saved order stays valid when the company switches the new map on or off.
 */
export const TAB_KEYS_OF: Readonly<Record<string, readonly string[]>> = (() => {
  const byPlace = new Map<string, string[]>();
  for (const place of [...PLACES_V1, ...PLACES_V2]) {
    const all = [...place.tabs, ...(place.more ?? [])];
    if (all.length === 0) continue;
    const keys = byPlace.get(place.key) ?? [];
    for (const tab of all) if (!keys.includes(tab.key)) keys.push(tab.key);
    byPlace.set(place.key, keys);
  }
  return Object.fromEntries(byPlace);
})();

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const unique = (keys: readonly string[]) => new Set(keys).size === keys.length;

/**
 * What a write may carry: known keys only, no duplicates, no more entries than the code has. A place that has no tabs
 * has no list of tabs either. Strict on purpose; the server also checks it against what the person may see.
 */
export const navOrderSchema = z
  .object({
    places: z.array(z.string().max(32)).max(PLACE_KEYS.length).default([]),
    tabs: z.record(z.string().max(32), z.array(z.string().max(32)).max(64)).default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const bad = (path: (string | number)[]) => ctx.addIssue({ code: "custom", path, message: "navorder.invalid" });
    if (!unique(value.places)) bad(["places"]);
    value.places.forEach((key, i) => {
      if (!PLACE_KEYS.includes(key)) bad(["places", i]);
    });
    for (const [place, keys] of Object.entries(value.tabs)) {
      const known = hasOwn(TAB_KEYS_OF, place) ? (TAB_KEYS_OF[place] ?? []) : null;
      if (!known) {
        bad(["tabs", place]);
        continue;
      }
      if (!unique(keys)) bad(["tabs", place]);
      keys.forEach((key, i) => {
        if (!known.includes(key)) bad(["tabs", place, i]);
      });
    }
  });

/** The empty order: the code's. */
export const NO_ORDER: NavOrder = { places: [], tabs: {} };

/**
 * Reads a stored value forgivingly: anything that is not an order is `null` (the code's order); inside an order, an
 * unknown key, a duplicate or an entry of the wrong kind is dropped and the rest is kept — so a place or a tab the code
 * removed since the order was saved never costs the person the rest of it.
 */
export function readNavOrder(raw: unknown): NavOrder | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as { places?: unknown; tabs?: unknown };
  const clean = (list: unknown, known: readonly string[]): string[] => {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    for (const key of list) if (typeof key === "string" && known.includes(key)) seen.add(key);
    return [...seen];
  };
  const places = clean(source.places, PLACE_KEYS);
  const tabs: Record<string, string[]> = {};
  if (source.tabs && typeof source.tabs === "object" && !Array.isArray(source.tabs)) {
    for (const [place, keys] of Object.entries(source.tabs as Record<string, unknown>)) {
      if (!hasOwn(TAB_KEYS_OF, place)) continue;
      const kept = clean(keys, TAB_KEYS_OF[place] ?? []);
      if (kept.length > 0) tabs[place] = kept;
    }
  }
  return places.length === 0 && Object.keys(tabs).length === 0 ? null : { places, tabs };
}

/**
 * `defaults` (the code's order of what the person may see) put in the order of `saved`. What `saved` does not
 * mention keeps its default place: it goes right after the entry that precedes it by default (or first, when nothing
 * does). What is in `saved` but not in `defaults` (hidden from this person, or removed by the code) is skipped.
 */
export function orderKeys<T>(defaults: readonly T[], saved: readonly string[] | undefined, keyOf: (item: T) => string): T[] {
  if (!saved || saved.length === 0) return [...defaults];
  const byKey = new Map(defaults.map((item) => [keyOf(item), item] as const));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const key of saved) {
    const item = byKey.get(key);
    if (item === undefined || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  defaults.forEach((item, i) => {
    const key = keyOf(item);
    if (seen.has(key)) return;
    // after the nearest earlier default that is already placed; the earlier unknowns were handled first, so they chain
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const before = defaults[j] as T;
      const index = result.indexOf(before);
      if (index >= 0) {
        at = index + 1;
        break;
      }
    }
    result.splice(at, 0, item);
    seen.add(key);
  });
  return result;
}

/** The person's map in the person's order: places, and the tabs of each place. Nothing is added or removed. */
export function applyNavOrder(nav: NavModel, order: NavOrder | null | undefined): NavModel {
  if (!order) return nav;
  const places = orderKeys(nav.places, order.places, (place) => place.key).map(
    (place): NavPlace => {
      const saved = hasOwn(order.tabs, place.key) ? order.tabs[place.key] : undefined;
      return saved ? { ...place, tabs: orderKeys(place.tabs, saved, (tab) => tab.key) } : place;
    },
  );
  return { places };
}

/**
 * `order` cut down to what this person may see (what the screen sends when it saves): the places of `nav`, and for each
 * the tabs of `nav`. A key they cannot see is dropped, so an old entry never makes a save refuse.
 */
export function pruneNavOrder(order: NavOrder | null | undefined, nav: NavModel): NavOrder {
  const placeKeys = nav.places.map((place) => place.key as string);
  const tabs: Record<string, string[]> = {};
  for (const place of nav.places) {
    const saved = order && hasOwn(order.tabs, place.key) ? order.tabs[place.key] : undefined;
    if (!saved) continue;
    const visible = place.tabs.map((tab) => tab.key as string);
    const kept = saved.filter((key, i) => visible.includes(key) && saved.indexOf(key) === i);
    if (kept.length > 0) tabs[place.key] = kept;
  }
  return { places: (order?.places ?? []).filter((key, i, all) => placeKeys.includes(key) && all.indexOf(key) === i), tabs };
}

/** `order` with the places set to `keys` (the new order of what the person sees), cut down to what they may see. */
export function withPlaceOrder(order: NavOrder | null | undefined, nav: NavModel, keys: readonly string[]): NavOrder {
  return pruneNavOrder({ places: [...keys], tabs: order?.tabs ?? {} }, nav);
}

/** `order` with the tabs of one place set to `keys`, cut down to what the person may see. */
export function withTabOrder(order: NavOrder | null | undefined, nav: NavModel, placeKey: string, keys: readonly string[]): NavOrder {
  return pruneNavOrder({ places: order?.places ?? [], tabs: { ...(order?.tabs ?? {}), [placeKey]: [...keys] } }, nav);
}

/**
 * The first thing in `order` that this person may not see, or null: the server refuses a save that names a place or a
 * tab outside their own map (an external partner cannot save an order for the places they do not have).
 */
export function firstUnseen(order: NavOrder, nav: NavModel): string | null {
  const seen = new Map(nav.places.map((place) => [place.key as string, new Set(place.tabs.map((tab) => tab.key as string))] as const));
  for (const key of order.places) if (!seen.has(key)) return key;
  for (const [place, keys] of Object.entries(order.tabs)) {
    const tabs = seen.get(place);
    if (!tabs) return place;
    for (const key of keys) if (!tabs.has(key)) return `${place}/${key}`;
  }
  return null;
}

/** Is this order one that changes anything (it is what «رجّع الترتيب الأصلي» clears)? */
export function hasOrder(order: NavOrder | null | undefined): boolean {
  return !!order && (order.places.length > 0 || Object.keys(order.tabs).length > 0);
}

/**
 * The company's own order of the menu (`Organization.settings.menuOrder`, D-N5), read as forgivingly as a person's: anything that is not an order is
 * `null` (no company order). A2.1 writes it; this only reads it.
 */
export function readCompanyMenuOrder(settings: unknown): NavOrder | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  return readNavOrder((settings as { menuOrder?: unknown }).menuOrder);
}

/**
 * Which order the menu follows (D-N5): the company's when it is set, otherwise the person's own, otherwise the code's. `personalLocked` is what the
 * person's «ترتيب» screen shows as ⚠️ «الترتيب صار للشركة كلها» with 🔧 «اطلب من المدير يغيّره» (`navv2.order.*`).
 * ⚠️ The person's own order is NEVER deleted or rewritten here: `User.navOrder` stays stored and is used again if the owner switches the company order off.
 */
export function menuOrderFor(company: NavOrder | null | undefined, personal: NavOrder | null | undefined): { order: NavOrder | null; source: "company" | "person" | "code"; personalLocked: boolean } {
  if (hasOrder(company)) return { order: company ?? null, source: "company", personalLocked: true };
  if (hasOrder(personal)) return { order: personal ?? null, source: "person", personalLocked: false };
  return { order: null, source: "code", personalLocked: false };
}
