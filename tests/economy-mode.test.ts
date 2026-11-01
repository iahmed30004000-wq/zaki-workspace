import { describe, expect, it } from "vitest";
import {
  ECONOMY_FORCED_OFF,
  ECONOMY_POLL_FACTOR,
  FEATURES,
  FEATURE_DEFAULTS,
  economyHeldOff,
  economyOn,
  featureOn,
  featuresOf,
  featuresOff,
  ownChoicesOf,
  withFeature,
  type FeatureKey,
} from "@/lib/features";
import { featureOnSql } from "@/server/features-sql";
import { economyActive, pollMs, setEconomy } from "@/lib/economy";
import { HEALTH_THRESHOLDS, assessHealth, type ServerHealthSample } from "@/lib/server-health";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { AR } from "@/lib/i18n/dict";

const ECO = { features: { economyMode: true } };
const owner = { role: "OWNER" as const, caps: [...effectiveCapabilities({ role: "OWNER" })] };

describe("«وضع التوفير»: the master switch is an overlay, never an overwrite", () => {
  it("is off by default, is a key like the others and has its Arabic name and hint", () => {
    expect(FEATURES).toContain("economyMode");
    expect(FEATURE_DEFAULTS.economyMode).toBe(false);
    expect(economyOn({})).toBe(false);
    expect(economyOn(null)).toBe(false);
    expect(economyOn({ features: { economyMode: "true" } })).toBe(false); // a broken value is never read as on
    expect(economyOn(ECO)).toBe(true);
    expect(AR["features.economyMode.name"]).toBe("وضع التوفير");
    expect(AR["features.economyMode.hint"]).toMatch(/[؀-ۿ]/);
  });

  it("every key it holds off is a real switch that is ON by default (so economy mode changes something), and is named on screen", () => {
    expect(new Set(ECONOMY_FORCED_OFF).size).toBe(ECONOMY_FORCED_OFF.length);
    for (const key of ECONOMY_FORCED_OFF) {
      expect(FEATURES, key).toContain(key);
      expect(FEATURE_DEFAULTS[key], key).toBe(true);
      expect(AR[`features.${key}.name`], key).toMatch(/[؀-ۿ]/);
    }
    // the heavy things the owner named are all in the list
    for (const key of ["calls", "whiteboard", "watch", "callNoiseFilter", "quickChat", "lastSeen", "backgroundNudges"] as const) expect(ECONOMY_FORCED_OFF).toContain(key);
    // chat, files, tasks, voice notes and search are not held off: the company still works
    for (const key of ["chatOutbox", "voiceNotes", "search", "reminders", "recurringTasks", "timeTracking", "checkins", "taskRules", "pushEverything"] as const) expect(ECONOMY_FORCED_OFF).not.toContain(key);
  });

  it("economy ON: the listed switches are off in force, and ONLY those", () => {
    for (const key of FEATURES) {
      const held = (ECONOMY_FORCED_OFF as readonly FeatureKey[]).includes(key);
      expect(featureOn(ECO, key), key).toBe(held ? false : key === "economyMode" ? true : FEATURE_DEFAULTS[key]);
    }
    const all = featuresOf(ECO);
    for (const key of ECONOMY_FORCED_OFF) expect(all[key], key).toBe(false);
    expect(all.economyMode).toBe(true);
    expect(all.chatOutbox).toBe(true);
  });

  it("the owner's own choices are never overwritten: economy off gives back exactly what he had", () => {
    // he turned the whiteboard off himself and left everything else; then economy goes on and off again
    const mine = { features: { whiteboard: false, ownerAssistant: true, quickChat: true } };
    const withEco = withFeature(mine, "economyMode", true);
    const back = withFeature(withEco, "economyMode", false);
    // the stored values of his own keys are exactly as he left them, in both states
    expect(ownChoicesOf(withEco)).toEqual(ownChoicesOf({ features: { ...mine.features, economyMode: true } }));
    expect({ ...ownChoicesOf(withEco), economyMode: false }).toEqual(ownChoicesOf(mine));
    expect(ownChoicesOf(withEco).quickChat).toBe(true);
    expect(ownChoicesOf(withEco).whiteboard).toBe(false);
    expect(featuresOf(back)).toEqual(featuresOf(mine));
    expect(back).toEqual({ features: { ...mine.features, economyMode: false } });
    // in force while economy is on: quickChat is held off, the whiteboard was off anyway
    expect(featureOn(withEco, "quickChat")).toBe(false);
    expect(featureOn(withEco, "whiteboard")).toBe(false);
    expect(featureOn(back, "quickChat")).toBe(true);
    // a switch the owner turned OFF stays off after economy goes away (economy never turns anything ON)
    expect(featureOn(back, "whiteboard")).toBe(false);
    // and a switch he left OFF that is not on the list is not touched
    expect(featureOn(withEco, "ownerAssistant")).toBe(true);
  });

  it("names what is being held off right now (for the badge «مطفية بوضع التوفير»), and nothing when economy is off", () => {
    expect(economyHeldOff({})).toEqual([]);
    expect(economyHeldOff(ECO)).toEqual([...ECONOMY_FORCED_OFF]);
    // one the owner already turned off is simply off, not «held»
    expect(economyHeldOff({ features: { economyMode: true, calls: false } })).not.toContain("calls");
    expect(economyHeldOff({ features: { economyMode: true, calls: false } })).toHaveLength(ECONOMY_FORCED_OFF.length - 1);
  });

  it("the map of places hides what economy holds off, and «وضع التوفير» is never itself listed as an off place", () => {
    expect(featuresOff({})).not.toContain("economyMode");
    expect(featuresOff(ECO)).toEqual(expect.arrayContaining(["watch", "calls", "whiteboard", "quickChat"]));
    expect(featuresOff(ECO)).not.toContain("economyMode");
    const places = (settings: unknown) => buildNav({ ...owner, off: featuresOff(settings) }).places.map((p) => p.key);
    expect(places({})).toContain("watch");
    expect(places(ECO)).not.toContain("watch");
    expect(newActionsFor({ ...owner, off: featuresOff(ECO) })).not.toContain("watch");
    // economy off again: the place is back
    expect(places({ features: { economyMode: false } })).toContain("watch");
  });

  it("the new switches (calls, whiteboard, voice notes, PDF count, search, nudges) are ON by default so nothing changes today", () => {
    for (const key of ["calls", "whiteboard", "voiceNotes", "pdfPageCount", "search", "backgroundNudges"] as const) {
      expect(FEATURE_DEFAULTS[key], key).toBe(true);
      expect(featureOn({}, key), key).toBe(true);
      expect(AR[`features.${key}.name`], key).toMatch(/[؀-ۿ]/);
      expect(AR[`features.${key}.hint`], key).toMatch(/[؀-ۿ]/);
    }
    // off by the owner is off, and only that key
    expect(featuresOff({ features: { calls: false } })).toContain("calls");
    expect(featureOn({ features: { calls: false } }, "whiteboard")).toBe(true);
  });
});

describe("«وضع التوفير» inside SQL (jobs and the presence write)", () => {
  const text = (key: FeatureKey, alias?: string) => featureOnSql(key, alias).sql.replace(/\s+/g, " ");

  it("a key on the list also reads the company's economy switch; a key off the list does not", () => {
    expect(text("lastSeen")).toContain("economyMode");
    expect(text("backgroundNudges")).toContain("economyMode");
    expect(text("reminders")).not.toContain("economyMode");
    expect(text("checkins")).not.toContain("economyMode");
  });

  it("reads only a JSON boolean (a broken stored value is the default), with the default of the key", () => {
    expect(text("lastSeen")).toContain("jsonb_typeof");
    expect(text("lastSeen")).toContain("'boolean'");
    expect(text("lastSeen")).toContain("'{features,lastSeen}'");
    expect(text("lastSeen")).toMatch(/END, true\)/);
    expect(text("economyMode")).toMatch(/END, false\)/); // off by default
  });

  it("refuses an unknown key and an alias that is not a plain identifier (both are written into the statement)", () => {
    expect(() => featureOnSql("nope" as FeatureKey)).toThrow();
    expect(() => featureOnSql("lastSeen", 'o"; DROP TABLE "User"; --')).toThrow();
    expect(() => featureOnSql("lastSeen", "org")).not.toThrow();
  });
});

describe("«وضع التوفير» on the screen: refreshes wait longer", () => {
  it("pollMs is the base period normally and ECONOMY_POLL_FACTOR times longer in economy mode, and only while it is set", () => {
    setEconomy(false);
    expect(economyActive()).toBe(false);
    expect(pollMs(30_000)).toBe(30_000);
    setEconomy(true);
    expect(ECONOMY_POLL_FACTOR).toBeGreaterThan(1);
    expect(pollMs(30_000)).toBe(30_000 * ECONOMY_POLL_FACTOR);
    expect(pollMs(60_000)).toBe(60_000 * ECONOMY_POLL_FACTOR);
    setEconomy(false);
    expect(pollMs(60_000)).toBe(60_000);
  });
});

const calm: ServerHealthSample = {
  rssBytes: 300e6,
  heapUsedBytes: 100e6,
  heapTotalBytes: 150e6,
  uptimeSec: 3600,
  eventLoopLagMs: 5,
  loadAvg1: 0.3,
  loadAvg5: 0.2,
  cpus: 2,
  totalMemBytes: 4e9,
  freeMemBytes: 2e9,
  memLimitBytes: null,
  dbOk: true,
  dbLatencyMs: 4,
  uploads: { files: 3, bytes: 1000 },
};

describe("«حال السيرفر»: when the reading turns into advice", () => {
  it("a calm box is ok and no reason is given", () => {
    expect(assessHealth(calm)).toEqual({ level: "ok", reasons: [] });
  });

  it("each limit names its own reason, and the thresholds are the ones printed on the screen", () => {
    expect(assessHealth({ ...calm, rssBytes: 3.2e9 }).reasons).toEqual(["rss_high"]);
    // the container's limit is the memory that counts when there is one
    expect(assessHealth({ ...calm, rssBytes: 800e6, memLimitBytes: 1e9 }).reasons).toEqual(["rss_high"]);
    expect(assessHealth({ ...calm, rssBytes: 800e6, memLimitBytes: null }).reasons).toEqual([]);
    expect(assessHealth({ ...calm, freeMemBytes: 0.3e9 }).reasons).toEqual(["free_low"]);
    expect(assessHealth({ ...calm, eventLoopLagMs: HEALTH_THRESHOLDS.lagMs + 1 }).reasons).toEqual(["lag_high"]);
    expect(assessHealth({ ...calm, eventLoopLagMs: HEALTH_THRESHOLDS.lagMs }).reasons).toEqual([]);
    expect(assessHealth({ ...calm, dbLatencyMs: HEALTH_THRESHOLDS.dbMs + 1 }).reasons).toEqual(["db_slow"]);
    expect(assessHealth({ ...calm, dbOk: false, dbLatencyMs: null }).reasons).toEqual(["db_down"]);
    expect(assessHealth({ ...calm, loadAvg1: 4 }).reasons).toEqual(["load_high"]); // 2 per core on 2 cores
    expect(assessHealth({ ...calm, loadAvg1: 0, cpus: 8 }).reasons).toEqual([]); // Windows reports no load
    const bad = assessHealth({ ...calm, rssBytes: 3.2e9, eventLoopLagMs: 900, dbOk: false, dbLatencyMs: null });
    expect(bad.level).toBe("warn");
    expect(bad.reasons).toEqual(["rss_high", "lag_high", "db_down"]);
    for (const r of bad.reasons) expect(AR[`health.r.${r}`], r).toMatch(/[؀-ۿ]/);
  });

  it("the advice is only advice: a warning never switches economy mode on by itself", () => {
    // the verdict is a pure function of the reading; nothing in it touches the company's switches
    const before = JSON.stringify(featuresOf({}));
    assessHealth({ ...calm, rssBytes: 3.9e9 });
    expect(JSON.stringify(featuresOf({}))).toBe(before);
  });
});
