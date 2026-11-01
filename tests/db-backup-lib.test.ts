import { describe, expect, it } from "vitest";
import {
  BACKUP_DEFAULTS,
  MAX_SCHEDULED_ATTEMPTS,
  RETRY_AFTER_MS,
  STALE_AFTER_MS,
  backupConfigOf,
  backupDue,
  backupFileName,
  freshnessOf,
  selectBackupsToDelete,
  withBackupConfig,
  type RunStamp,
} from "@/lib/db-backup";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { zonedWallTime } from "@/lib/zoned-time";

/**
 * «نسخ احتياطي لقاعدة البيانات»: the rules that need no database: the owner's settings, WHEN a copy is due (in the COMPANY's
 * zone), WHICH copies retention removes, and the 36-hour warning.
 */

const DAMASCUS = "Asia/Damascus"; // UTC+3, no daily saving time
const NEW_YORK = "America/New_York"; // saving time: a day with 23 or 25 hours

const at = (iso: string) => new Date(iso);
const stamp = (iso: string, status: RunStamp["status"], trigger: RunStamp["trigger"] = "SCHEDULED"): RunStamp => ({ startedAt: at(iso), status, trigger });

describe("the switch", () => {
  it("is OFF until the owner turns it on, and has its two Arabic lines", () => {
    expect(FEATURES).toContain("dbBackup");
    expect(FEATURE_DEFAULTS.dbBackup).toBe(false);
    expect(featureOn({}, "dbBackup")).toBe(false);
    expect(featureOn({ features: { dbBackup: true } }, "dbBackup")).toBe(true);
    expect(AR["features.dbBackup.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.dbBackup.hint"]).toContain("⚠️");
    expect(AR["features.dbBackup.hint"]).toContain("🔧");
  });
});

describe("the settings", () => {
  it("default to 03:00, 14 days and 4 weeks", () => {
    expect(backupConfigOf({})).toEqual(BACKUP_DEFAULTS);
    expect(backupConfigOf(null)).toEqual({ hour: 3, daily: 14, weekly: 4 });
    expect(backupConfigOf({ dbBackup: "nope" })).toEqual(BACKUP_DEFAULTS);
  });

  it("keep a stored value and replace a broken one by its own default only", () => {
    expect(backupConfigOf({ dbBackup: { hour: 22, daily: 7, weekly: 0 } })).toEqual({ hour: 22, daily: 7, weekly: 0 });
    expect(backupConfigOf({ dbBackup: { hour: 24, daily: 0, weekly: 99 } })).toEqual(BACKUP_DEFAULTS);
    expect(backupConfigOf({ dbBackup: { hour: 5.5, daily: "9", weekly: 2 } })).toEqual({ hour: 3, daily: 14, weekly: 2 });
  });

  it("are written beside every other key of the company's settings", () => {
    const next = withBackupConfig({ transparencyVersion: 2, features: { okr: false } }, { hour: 1, daily: 10, weekly: 2 });
    expect(next).toEqual({ transparencyVersion: 2, features: { okr: false }, dbBackup: { hour: 1, daily: 10, weekly: 2 } });
    expect(withBackupConfig("junk", { hour: 1, daily: 10, weekly: 2 })).toEqual({ dbBackup: { hour: 1, daily: 10, weekly: 2 } });
  });
});

describe("when a copy is due (the company's clock)", () => {
  it("not before the chosen hour, in the COMPANY's zone: 00:30 UTC is already 03:30 in Damascus", () => {
    expect(backupDue({ now: at("2026-11-10T00:30:00Z"), zone: DAMASCUS, hour: 3, runs: [] })).toBe(true);
    expect(backupDue({ now: at("2026-11-09T23:30:00Z"), zone: DAMASCUS, hour: 3, runs: [] })).toBe(false); // 02:30 there
    // 05:30 UTC is half past midnight in New York: not due at hour 3 there
    expect(backupDue({ now: at("2026-11-10T05:30:00Z"), zone: NEW_YORK, hour: 3, runs: [] })).toBe(false);
    expect(backupDue({ now: at("2026-11-10T09:00:00Z"), zone: NEW_YORK, hour: 3, runs: [] })).toBe(true); // 04:00 there
  });

  it("only once a company day: a success today (scheduled or pressed by hand) settles it", () => {
    const now = at("2026-11-10T09:00:00Z"); // 12:00 in Damascus
    expect(backupDue({ now, zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-10T00:10:00Z", "SUCCESS")] })).toBe(false);
    expect(backupDue({ now, zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-10T05:00:00Z", "SUCCESS", "MANUAL")] })).toBe(false);
    // yesterday's success does not
    expect(backupDue({ now, zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-09T00:10:00Z", "SUCCESS")] })).toBe(true);
  });

  it("the day is the company's: a success at 22:30 UTC is already TOMORROW in Damascus", () => {
    // 2026-11-09T22:30Z is 01:30 on the 10th there: it counts for the 10th
    expect(backupDue({ now: at("2026-11-10T09:00:00Z"), zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-09T22:30:00Z", "SUCCESS")] })).toBe(false);
    // ...but in New York that same success is the 9th, so the 10th is still due
    expect(backupDue({ now: at("2026-11-10T09:00:00Z"), zone: NEW_YORK, hour: 3, runs: [stamp("2026-11-09T22:30:00Z", "SUCCESS")] })).toBe(true);
  });

  it("never while a copy is running", () => {
    expect(backupDue({ now: at("2026-11-10T09:00:00Z"), zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-10T08:59:00Z", "RUNNING")] })).toBe(false);
    // even one that started yesterday (the sweep, not the schedule, retires a dead one)
    expect(backupDue({ now: at("2026-11-10T09:00:00Z"), zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-09T01:00:00Z", "RUNNING")] })).toBe(false);
  });

  it("a failed scheduled attempt is retried after 3 hours, at most 3 times a day", () => {
    const first = "2026-11-10T00:10:00Z"; // 03:10 in Damascus
    const failed1 = [stamp(first, "FAILED")];
    expect(backupDue({ now: new Date(at(first).getTime() + RETRY_AFTER_MS - 60_000), zone: DAMASCUS, hour: 3, runs: failed1 })).toBe(false);
    expect(backupDue({ now: new Date(at(first).getTime() + RETRY_AFTER_MS), zone: DAMASCUS, hour: 3, runs: failed1 })).toBe(true);
    const failed3 = [stamp(first, "FAILED"), stamp("2026-11-10T03:15:00Z", "FAILED"), stamp("2026-11-10T06:20:00Z", "FAILED")];
    expect(failed3.length).toBe(MAX_SCHEDULED_ATTEMPTS);
    expect(backupDue({ now: at("2026-11-10T20:00:00Z"), zone: DAMASCUS, hour: 3, runs: failed3 })).toBe(false);
  });

  it("a button pressed by hand that failed costs the schedule nothing", () => {
    expect(backupDue({ now: at("2026-11-10T09:00:00Z"), zone: DAMASCUS, hour: 3, runs: [stamp("2026-11-10T08:00:00Z", "FAILED", "MANUAL")] })).toBe(true);
  });

  it("survives the clocks changing (New York, 2026-11-01: a 25-hour day)", () => {
    // 2026-11-01 05:00 UTC is 01:00 EDT that day; 06:30 UTC is 01:30 EST (the hour repeated): hour 1 is reached, hour 3 is not
    expect(backupDue({ now: at("2026-11-01T06:30:00Z"), zone: NEW_YORK, hour: 1, runs: [] })).toBe(true);
    expect(backupDue({ now: at("2026-11-01T06:30:00Z"), zone: NEW_YORK, hour: 3, runs: [] })).toBe(false);
    expect(backupDue({ now: at("2026-11-01T08:30:00Z"), zone: NEW_YORK, hour: 3, runs: [] })).toBe(true); // 03:30 EST
    // a success at 23:30 EDT on the 31st is not "today" on the 1st
    const lateOct31 = zonedWallTime({ year: 2026, month: 10, day: 31, hour: 23, minute: 30 }, NEW_YORK);
    expect(backupDue({ now: at("2026-11-01T08:30:00Z"), zone: NEW_YORK, hour: 3, runs: [{ startedAt: lateOct31, status: "SUCCESS", trigger: "SCHEDULED" }] })).toBe(true);
  });
});

describe("retention", () => {
  /** One copy per day at 03:10 Damascus, `n` days ending on `last` (ids d0 = the newest). */
  function daily(n: number, last = "2026-11-30T00:10:00Z") {
    return Array.from({ length: n }, (_, i) => ({ id: `d${i}`, startedAt: new Date(at(last).getTime() - i * 86_400_000) }));
  }

  it("keeps the newest 14 days and one copy of each of the 4 weeks before them, and removes the rest", () => {
    const runs = daily(60);
    const removed = selectBackupsToDelete(runs, { zone: DAMASCUS, daily: 14, weekly: 4 });
    const kept = runs.filter((r) => !removed.includes(r.id));
    expect(kept.length).toBe(14 + 4);
    // the 14 newest days are all there
    for (let i = 0; i < 14; i++) expect(removed).not.toContain(`d${i}`);
    // the weekly ones are older than the window, one per week
    const weekly = kept.filter((r) => !/^d(\d|1[0-3])$/.test(r.id));
    expect(weekly.length).toBe(4);
    // Sunday-to-Saturday weeks in Damascus (1970-01-04 was a Sunday)
    const weeks = new Set(weekly.map((r) => Math.floor((Math.floor((r.startedAt.getTime() + 3 * 3_600_000) / 86_400_000) - 3) / 7)));
    expect(weeks.size).toBe(4);
    // everything older than the weekly set goes
    expect(removed).toContain("d59");
  });

  it("with fewer copies than the limits nothing is removed", () => {
    expect(selectBackupsToDelete(daily(10), { zone: DAMASCUS, daily: 14, weekly: 4 })).toEqual([]);
    expect(selectBackupsToDelete([], { zone: DAMASCUS, daily: 14, weekly: 4 })).toEqual([]);
  });

  it("two copies on one day count as ONE day: the newest of the day stays, the older one goes", () => {
    const runs = [
      { id: "morning", startedAt: at("2026-11-10T00:10:00Z") },
      { id: "noon", startedAt: at("2026-11-10T09:00:00Z") },
      { id: "yesterday", startedAt: at("2026-11-09T00:10:00Z") },
    ];
    expect(selectBackupsToDelete(runs, { zone: DAMASCUS, daily: 2, weekly: 0 })).toEqual(["morning"]);
  });

  it("the day is the company's: 04:30 UTC and 05:30 UTC are one Damascus day, two New York days", () => {
    const runs = [
      { id: "a", startedAt: at("2026-11-10T04:30:00Z") },
      { id: "b", startedAt: at("2026-11-10T05:30:00Z") },
    ];
    expect(selectBackupsToDelete(runs, { zone: DAMASCUS, daily: 5, weekly: 0 })).toEqual(["a"]);
    expect(selectBackupsToDelete(runs, { zone: NEW_YORK, daily: 5, weekly: 0 })).toEqual([]);
  });

  it("weekly 0 keeps only the daily window; daily is never below 1 (the newest copy is always kept)", () => {
    const runs = daily(30);
    expect(selectBackupsToDelete(runs, { zone: DAMASCUS, daily: 7, weekly: 0 }).length).toBe(23);
    const onlyNewest = selectBackupsToDelete(runs, { zone: DAMASCUS, daily: 0, weekly: 0 });
    expect(onlyNewest.length).toBe(29);
    expect(onlyNewest).not.toContain("d0");
  });

  it("a week that already holds a kept day is not counted again as a weekly one", () => {
    // 21 days, daily 10, weekly 2: the weekly picks come from weeks the daily window does not touch
    const runs = daily(21);
    const removed = new Set(selectBackupsToDelete(runs, { zone: DAMASCUS, daily: 10, weekly: 2 }));
    const keptWeekly = runs.filter((r) => !removed.has(r.id) && Number(r.id.slice(1)) >= 10);
    expect(keptWeekly.length).toBeLessThanOrEqual(2);
    expect(keptWeekly.length).toBeGreaterThan(0);
  });
});

describe("the 36-hour warning", () => {
  const now = at("2026-11-10T12:00:00Z");
  it("is fresh, stale or never", () => {
    expect(freshnessOf(null, now)).toBe("never");
    expect(freshnessOf(new Date(now.getTime() - 35 * 3_600_000), now)).toBe("fresh");
    expect(freshnessOf(new Date(now.getTime() - STALE_AFTER_MS), now)).toBe("fresh");
    expect(freshnessOf(new Date(now.getTime() - STALE_AFTER_MS - 1000), now)).toBe("stale");
  });
});

describe("the file name", () => {
  it("is the moment and the run, and carries no company data", () => {
    expect(backupFileName(at("2026-11-10T03:04:05Z"), "ckabcdefghij123456")).toBe("zaki-backup-20261110-030405-123456.zbk");
  });
});
