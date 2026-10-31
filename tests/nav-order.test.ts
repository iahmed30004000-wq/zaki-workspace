import { describe, expect, it } from "vitest";
import { PLACES, buildNav, type NavSubject } from "@/lib/nav/places";
import {
  NO_ORDER,
  PLACE_KEYS,
  TAB_KEYS_OF,
  applyNavOrder,
  firstUnseen,
  hasOrder,
  navOrderSchema,
  orderKeys,
  pruneNavOrder,
  readNavOrder,
  withPlaceOrder,
  withTabOrder,
} from "@/lib/nav/order";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * «ترتيبي»: the pure rules of a person's own order of the menu (src/lib/nav/order.ts). The default order is the code's;
 * a saved order only reorders what the person may see, never hides or reveals anything, and never breaks when the code
 * adds or removes a place or a tab.
 */

const who = (role: NavSubject["role"], extra: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], ...extra });
const placeKeys = (nav: ReturnType<typeof buildNav>) => nav.places.map((p) => p.key as string);
const tabKeys = (nav: ReturnType<typeof buildNav>, place: string) => nav.places.find((p) => p.key === place)?.tabs.map((t) => t.key as string) ?? [];

const DEFAULT_PLACES = ["today", "chat", "work", "library", "watch", "admin"];

describe("orderKeys: a saved order over the defaults", () => {
  const defaults = ["a", "b", "c", "d"];
  const by = (k: string) => k;

  it("no saved order (or an empty one) is the defaults, untouched", () => {
    expect(orderKeys(defaults, undefined, by)).toEqual(defaults);
    expect(orderKeys(defaults, [], by)).toEqual(defaults);
  });

  it("a full saved order is followed exactly", () => {
    expect(orderKeys(defaults, ["d", "b", "a", "c"], by)).toEqual(["d", "b", "a", "c"]);
  });

  it("an entry the saved order does not know falls in at its default place: right after the entry before it by default", () => {
    // «c» is new: by default it follows «b»
    expect(orderKeys(defaults, ["d", "a", "b"], by)).toEqual(["d", "a", "b", "c"]);
    // «c» follows «b» wherever «b» was put
    expect(orderKeys(defaults, ["b", "a", "d"], by)).toEqual(["b", "c", "a", "d"]);
  });

  it("a new entry first by default stays first; several new entries in a row keep their default order", () => {
    expect(orderKeys(defaults, ["c", "d"], by)).toEqual(["a", "b", "c", "d"]);
    expect(orderKeys(defaults, ["d"], by)).toEqual(["a", "b", "c", "d"]);
    expect(orderKeys(defaults, ["d", "a"], by)).toEqual(["d", "a", "b", "c"]);
  });

  it("an entry the saved order mentions but the person cannot see (or the code removed) is skipped, and a duplicate counts once", () => {
    expect(orderKeys(defaults, ["zzz", "c", "c", "a"], by)).toEqual(["c", "d", "a", "b"]);
    expect(orderKeys(["a", "b"], ["x", "b", "y", "a", "b"], by)).toEqual(["b", "a"]);
  });

  it("never loses or invents an entry, whatever the saved list says", () => {
    const saved = ["q", "d", "d", "a", "zz", "b"];
    const out = orderKeys(defaults, saved, by);
    expect([...out].sort()).toEqual([...defaults].sort());
  });
});

describe("readNavOrder: forgiving reads", () => {
  it("anything that is not an order reads as «none»", () => {
    for (const raw of [null, undefined, 5, "x", [], [1], {}, { places: [], tabs: {} }, { places: "work" }, { tabs: [] }]) {
      expect(readNavOrder(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("keeps what is known and drops the rest: a place or a tab the code no longer has never costs the person their order", () => {
    const order = readNavOrder({
      places: ["admin", "gone", "today", "admin", 7],
      tabs: { work: ["crm", "removed", "crm", "list"], chat: ["x"], nowhere: ["a"], library: "files" },
    });
    expect(order).toEqual({ places: ["admin", "today"], tabs: { work: ["crm", "list"] } });
  });

  it("a tab listed under the wrong place is dropped", () => {
    expect(readNavOrder({ places: [], tabs: { work: ["settings", "crm"], admin: ["crm", "team"] } })).toEqual({ places: [], tabs: { work: ["crm"], admin: ["team"] } });
  });
});

describe("navOrderSchema: strict writes", () => {
  const ok = (value: unknown) => navOrderSchema.safeParse(value);

  it("accepts a real order, and fills the two lists when one is missing", () => {
    expect(ok({ places: ["admin", "today"], tabs: { work: ["crm", "list"] } }).success).toBe(true);
    expect(ok({ places: ["work"] })).toMatchObject({ success: true, data: { places: ["work"], tabs: {} } });
    expect(ok({})).toMatchObject({ success: true, data: { places: [], tabs: {} } });
  });

  it("refuses an unknown place, an unknown tab, a tab of another place, a duplicate, a place with no tabs", () => {
    expect(ok({ places: ["nope"] }).success).toBe(false);
    expect(ok({ places: ["work", "work"] }).success).toBe(false);
    expect(ok({ tabs: { work: ["nope"] } }).success).toBe(false);
    expect(ok({ tabs: { work: ["crm", "crm"] } }).success).toBe(false);
    expect(ok({ tabs: { work: ["settings"] } }).success).toBe(false);
    expect(ok({ tabs: { today: ["crm"] } }).success).toBe(false);
    expect(ok({ tabs: { nowhere: [] } }).success).toBe(false);
  });

  it("refuses a field it does not know and values of the wrong kind", () => {
    expect(ok({ places: [], tabs: {}, extra: 1 }).success).toBe(false);
    expect(ok({ places: "work" }).success).toBe(false);
    expect(ok({ places: [1] }).success).toBe(false);
    expect(ok({ tabs: { work: "crm" } }).success).toBe(false);
    expect(ok(null).success).toBe(false);
    expect(ok([]).success).toBe(false);
  });

  it("is bounded: no more places than the code has, no tab list longer than the place's tabs, no long keys", () => {
    expect(ok({ places: [...PLACE_KEYS, "work"] }).success).toBe(false);
    expect(ok({ places: ["x".repeat(500)] }).success).toBe(false);
    const work = TAB_KEYS_OF.work ?? [];
    expect(ok({ tabs: { work: [...work, ...work] } }).success).toBe(false);
    // the largest valid order passes
    expect(ok({ places: [...PLACE_KEYS], tabs: Object.fromEntries(Object.entries(TAB_KEYS_OF).map(([k, v]) => [k, [...v]])) }).success).toBe(true);
  });

  it("an object key like __proto__ is not a place", () => {
    const parsed = ok(JSON.parse('{"places":[],"tabs":{"__proto__":["crm"],"constructor":["x"]}}'));
    // refused outright, or accepted with nothing of it kept — never a polluted prototype or a stored «__proto__»
    expect(parsed.success && Object.keys(parsed.data.tabs)).not.toContain("__proto__");
    expect(({} as Record<string, unknown>).crm).toBeUndefined();
    expect(ok(JSON.parse('{"places":[],"tabs":{"constructor":["x"]}}')).success).toBe(false);
    expect(readNavOrder(JSON.parse('{"places":[],"tabs":{"__proto__":["crm"],"constructor":["x"]}}'))).toBeNull();
  });
});

describe("the code's order is the default", () => {
  it("no saved order: the map is the very same map", () => {
    const nav = buildNav(who("OWNER"));
    expect(applyNavOrder(nav, null)).toBe(nav);
    expect(applyNavOrder(nav, undefined)).toBe(nav);
    expect(placeKeys(applyNavOrder(nav, NO_ORDER))).toEqual(DEFAULT_PLACES);
  });

  it("the code's places are still «اليوم · الدردشة · الشغل · المكتبة · نتفرّج سوا · الإدارة» (this feature changes no default)", () => {
    expect(PLACES.map((p) => p.key as string)).toEqual(DEFAULT_PLACES);
  });
});

describe("applyNavOrder: over what the person may see", () => {
  it("reorders the places, and «الإدارة» stays in the map wherever it is put, with its own tabs and address", () => {
    const nav = buildNav(who("OWNER"));
    const out = applyNavOrder(nav, { places: ["admin", "watch", "today"], tabs: {} });
    expect(placeKeys(out)).toEqual(["admin", "watch", "today", "chat", "work", "library"]);
    const admin = out.places.find((p) => p.key === "admin");
    const before = nav.places.find((p) => p.key === "admin");
    expect(admin).toEqual(before);
  });

  it("reorders the tabs of a place only, leaving the other places' tabs and every address alone", () => {
    const nav = buildNav(who("OWNER"));
    const out = applyNavOrder(nav, { places: [], tabs: { work: ["crm", "list", "my-work", "projects", "calendar", "goals", "ideas", "production", "departments", "tickets", "campaigns", "approvals", "checkins"] } });
    expect(tabKeys(out, "work").slice(0, 3)).toEqual(["crm", "list", "my-work"]);
    expect([...tabKeys(out, "work")].sort()).toEqual([...tabKeys(nav, "work")].sort());
    expect(tabKeys(out, "admin")).toEqual(tabKeys(nav, "admin"));
    const hrefs = (n: typeof nav) => Object.fromEntries(n.places.flatMap((p) => [[p.key, p.href], ...p.tabs.map((t) => [`${p.key}/${t.key}`, t.href])]));
    expect(hrefs(out)).toEqual(hrefs(nav));
  });

  it("a saved order never reveals: a place or tab the person cannot see stays out, however the order names it", () => {
    const guest = buildNav(who("GUEST"));
    const out = applyNavOrder(guest, { places: ["admin", "watch", "library", "work"], tabs: { work: ["crm", "calendar", "goals", "list", "projects", "my-work"], admin: ["settings"] } });
    expect(placeKeys(out)).not.toContain("admin");
    expect(placeKeys(out)).not.toContain("watch");
    expect(tabKeys(out, "work")).not.toContain("crm");
    expect(tabKeys(out, "work")).not.toContain("goals");
    expect(tabKeys(out, "work")).toEqual(["calendar", "list", "projects", "my-work"]);
    expect([...placeKeys(out)].sort()).toEqual([...placeKeys(guest)].sort());
  });

  it("a saved order never hides: places and tabs it leaves out are still drawn", () => {
    const nav = buildNav(who("OWNER"));
    const out = applyNavOrder(nav, { places: ["watch"], tabs: { admin: ["archive"] } });
    expect(placeKeys(out)).toHaveLength(nav.places.length);
    expect(tabKeys(out, "admin")).toHaveLength(tabKeys(nav, "admin").length);
  });

  it("a place that appears later (access grows) falls in at its default place, not at the end", () => {
    // saved while the person could not see «watch»: [today, chat, work, library, admin] reordered to put admin early
    const saved = { places: ["admin", "today", "chat", "work", "library"], tabs: {} };
    const out = applyNavOrder(buildNav(who("OWNER")), saved);
    // «watch» follows «library» by default
    expect(placeKeys(out)).toEqual(["admin", "today", "chat", "work", "library", "watch"]);
  });

  it("is stable: applying an order twice gives the same map", () => {
    const nav = buildNav(who("OWNER"));
    const order = { places: ["library", "today"], tabs: { work: ["list", "my-work"] } };
    const once = applyNavOrder(nav, order);
    expect(applyNavOrder(once, order)).toEqual(once);
  });
});

describe("what the screen saves", () => {
  const nav = buildNav(who("MEMBER"));

  it("withPlaceOrder / withTabOrder keep the other half and cut everything down to what the person may see", () => {
    const first = withPlaceOrder(null, nav, ["chat", "today"]);
    expect(first).toEqual({ places: ["chat", "today"], tabs: {} });
    const second = withTabOrder(first, nav, "work", ["list", "my-work", "settings", "list"]);
    expect(second.places).toEqual(["chat", "today"]);
    expect(second.tabs).toEqual({ work: ["list", "my-work"] });
  });

  it("pruneNavOrder drops places and tabs the person has no access to (an old entry never makes a save refuse)", () => {
    const stale = { places: ["admin", "chat", "watch"], tabs: { work: ["crm", "projects"], admin: ["settings"] } };
    const pruned = pruneNavOrder(stale, buildNav(who("GUEST")));
    expect(pruned.places).toEqual(["chat"]);
    expect(pruned.tabs).toEqual({ work: ["projects"] });
    expect(firstUnseen(pruned, buildNav(who("GUEST")))).toBeNull();
  });

  it("firstUnseen names the first place or tab outside the person's map", () => {
    const guest = buildNav(who("GUEST"));
    expect(firstUnseen({ places: ["chat", "admin"], tabs: {} }, guest)).toBe("admin");
    expect(firstUnseen({ places: [], tabs: { work: ["projects", "crm"] } }, guest)).toBe("work/crm");
    expect(firstUnseen({ places: [], tabs: { admin: ["team"] } }, guest)).toBe("admin");
    expect(firstUnseen({ places: ["chat"], tabs: { work: ["projects"] } }, guest)).toBeNull();
  });

  it("hasOrder tells a saved order from none (what «رجّع الترتيب الأصلي» is for)", () => {
    expect(hasOrder(null)).toBe(false);
    expect(hasOrder(NO_ORDER)).toBe(false);
    expect(hasOrder({ places: ["chat"], tabs: {} })).toBe(true);
    expect(hasOrder({ places: [], tabs: { work: ["crm"] } })).toBe(true);
  });
});
