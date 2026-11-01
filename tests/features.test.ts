import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_DEFAULTS, featureOn, featuresOf, featuresOff, isFeatureKey, withFeature } from "@/lib/features";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { AR } from "@/lib/i18n/dict";

const owner = { role: "OWNER" as const, caps: [...effectiveCapabilities({ role: "OWNER" })] };

describe("«الميزات»: the owner's switches", () => {
  it("every key has a default and its two lines in Arabic (a key added without them fails here)", () => {
    expect(FEATURES.length).toBeGreaterThan(0);
    expect(new Set(FEATURES).size).toBe(FEATURES.length);
    for (const key of FEATURES) {
      expect(typeof FEATURE_DEFAULTS[key], key).toBe("boolean");
      expect(AR[`features.${key}.name`], key).toMatch(/[؀-ۿ]/);
      expect(AR[`features.${key}.hint`], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("a switch nobody touched is its default; a stored one wins", () => {
    expect(featureOn({}, "watch")).toBe(FEATURE_DEFAULTS.watch);
    expect(featureOn(null, "watch")).toBe(FEATURE_DEFAULTS.watch);
    expect(featureOn({ features: { watch: false } }, "watch")).toBe(false);
    expect(featureOn({ features: { watch: true } }, "watch")).toBe(true);
  });

  it("«حقول مخصصة» is a switch like the others: on until the owner turns it off, and off is only that key", () => {
    expect(FEATURES).toContain("customFields");
    expect(FEATURE_DEFAULTS.customFields).toBe(true);
    expect(featureOn({}, "customFields")).toBe(true);
    expect(featureOn({ features: { customFields: false } }, "customFields")).toBe(false);
    expect(featuresOff({ features: { customFields: false } })).toEqual(["ownerHiddenOnline", "ownerAssistant", "chatAssistant", "customFields", "apiDoor", "dbBackup"]);
  });

  it("a broken stored value is ignored, never read as off", () => {
    for (const settings of [{ features: "nope" }, { features: { watch: "false" } }, { features: { watch: 0 } }, "x", 42]) {
      expect(featureOn(settings, "watch"), JSON.stringify(settings)).toBe(FEATURE_DEFAULTS.watch);
    }
  });

  it("lists every switch with its default filled in, and the ones that are off", () => {
    const all = featuresOf({ features: { watch: false, unknown: true } });
    // exactly the keys of `FEATURES`, each at its default — a key added to the list lands here without
    // editing this test, and a key that exists in one place and not the other fails
    expect(Object.keys(all).sort()).toEqual([...FEATURES].sort());
    for (const key of FEATURES) expect(all[key], key).toBe(key === "watch" ? false : FEATURE_DEFAULTS[key]);
    // «إخفاء المالك من متصل» and «مساعد المالك» are OFF until the owner turns them on, so they are always in the list of the ones that are off
    expect(featuresOff({ features: { watch: false } })).toEqual(["watch", "ownerHiddenOnline", "ownerAssistant", "chatAssistant", "apiDoor", "dbBackup"]);
    expect(featuresOff({})).toEqual(["ownerHiddenOnline", "ownerAssistant", "chatAssistant", "apiDoor", "dbBackup"]);
    expect(featuresOff({ features: { ownerHiddenOnline: true, ownerAssistant: true, chatAssistant: true, apiDoor: true, dbBackup: true } })).toEqual([]);
    expect(FEATURE_DEFAULTS.ownerAssistant).toBe(false);
    // «الرسائل بدون نت» is ON until the owner turns it off (so it is never in the list of the ones that are off)
    expect(FEATURE_DEFAULTS.chatOutbox).toBe(true);
    expect(featuresOff({ features: { chatOutbox: false } })).toContain("chatOutbox");
  });

  it("«طلبات الموافقة والنماذج» (`approvals`) is a switch of its own, on by default, so it is never in the list of the ones that are off", () => {
    expect(FEATURES).toContain("approvals");
    expect(FEATURE_DEFAULTS.approvals).toBe(true);
    expect(featuresOff({})).not.toContain("approvals");
    expect(featuresOff({ features: { approvals: false } })).toContain("approvals");
    expect(featureOn({ features: { approvals: false } }, "approvals")).toBe(false);
    expect(buildNav({ ...owner, off: ["approvals"] }).places.flatMap((p) => p.tabs.map((t) => t.key))).not.toContain("approvals");
    expect(buildNav(owner).places.flatMap((p) => p.tabs.map((t) => t.key))).toContain("approvals");
  });

  it("«باب الربط الخارجي» (`apiDoor`) is OFF until the owner turns it on, named in Arabic, and is only that key", () => {
    expect(FEATURES).toContain("apiDoor");
    expect(FEATURE_DEFAULTS.apiDoor).toBe(false);
    expect(featureOn({}, "apiDoor")).toBe(false);
    expect(featureOn({ features: { apiDoor: true } }, "apiDoor")).toBe(true);
    expect(featuresOff({})).toContain("apiDoor");
    expect(featuresOff({ features: { apiDoor: true } })).not.toContain("apiDoor");
    expect(AR["features.apiDoor.name"]).toBe("باب الربط الخارجي");
  });

  it("setting one switch keeps every other key of the company's settings", () => {
    const before = { transparencyVersion: 3, features: { other: true }, somethingElse: { a: 1 } };
    expect(withFeature(before, "watch", false)).toEqual({ transparencyVersion: 3, features: { other: true, watch: false }, somethingElse: { a: 1 } });
    expect(withFeature(null, "watch", true)).toEqual({ features: { watch: true } });
  });

  it("«آخر ظهور» is a switch, ON by default (a company that never touched it has the feature), named in Arabic", () => {
    expect(FEATURES).toContain("lastSeen");
    expect(FEATURE_DEFAULTS.lastSeen).toBe(true);
    expect(featureOn({}, "lastSeen")).toBe(true);
    expect(featuresOff({ features: { ownerHiddenOnline: true, ownerAssistant: true, chatAssistant: true, apiDoor: true, dbBackup: true, lastSeen: false } })).toEqual(["lastSeen"]);
    expect(AR["features.lastSeen.name"]).toBe("آخر ظهور");
  });

  it("knows its own keys and nothing else", () => {
    expect(isFeatureKey("watch")).toBe(true);
    expect(isFeatureKey("nope")).toBe(false);
    expect(isFeatureKey(1)).toBe(false);
  });
});

describe("«الأداء والتطوير» (teamDevelopment)", () => {
  it("is a switch, on until the owner turns it off, with its name and hint; off, «الهيكل» and «الأداء والتطوير» leave the map for everybody", () => {
    expect(FEATURES).toContain("teamDevelopment");
    expect(FEATURE_DEFAULTS.teamDevelopment).toBe(true);
    expect(featureOn({}, "teamDevelopment")).toBe(true);
    expect(featuresOff({ features: { teamDevelopment: false } })).toContain("teamDevelopment");
    const tabs = (off: string[]) => buildNav({ ...owner, off: off as never[] }).places.flatMap((p) => p.tabs.map((t) => t.key));
    expect(tabs([])).toEqual(expect.arrayContaining(["structure", "development"]));
    expect(tabs(["teamDevelopment"])).not.toContain("structure");
    expect(tabs(["teamDevelopment"])).not.toContain("development");
  });
});

describe("«الميزات»: a switched-off feature is gone from the map and from «جديد»", () => {
  it("«نتفرّج سوا» off: no sixth place, no «جديد» entry; on again: both back", () => {
    expect(buildNav({ ...owner, off: ["watch"] }).places.map((p) => p.key)).not.toContain("watch");
    expect(newActionsFor({ ...owner, off: ["watch"] })).not.toContain("watch");
    expect(buildNav({ ...owner, off: [] }).places.map((p) => p.key)).toContain("watch");
    expect(newActionsFor(owner)).toContain("watch");
  });

  it("«التسجيل اليومي» off: no tab in «الشغل» for anybody, and its place is still there; on again: the tab is back, for staff only", () => {
    const work = (subject: Parameters<typeof buildNav>[0]) => buildNav(subject).places.find((p) => p.key === "work")?.tabs.map((t) => t.key) ?? [];
    expect(work(owner)).toContain("checkins");
    expect(work({ ...owner, off: ["checkins"] })).not.toContain("checkins");
    expect(work({ ...owner, off: ["checkins"] })).toEqual(work(owner).filter((k) => k !== "checkins"));
    expect(buildNav({ ...owner, off: ["checkins"] }).places.map((p) => p.key)).toContain("work");
    // never for an external partner, switch or no switch
    expect(work({ role: "GUEST" as const, caps: [] })).not.toContain("checkins");
    expect(featuresOff({ features: { checkins: false } })).toContain("checkins");
  });

  it("switching a feature off changes nothing else on the map", () => {
    const on = buildNav(owner).places.filter((p) => p.key !== "watch");
    expect(buildNav({ ...owner, off: ["watch"] }).places).toEqual(on);
  });
});
