import { zonedDayNumber, zonedDayStart, zonedParts } from "@/lib/zoned-time";

/**
 * «نسخ احتياطي لقاعدة البيانات»: the rules that need no database and no server, so a unit test can pin every one of them
 * (src/server/services/db-backup.ts does the work, src/server/jobs/db-backup.ts asks `backupDue` once per tick).
 *
 *  - the OWNER's settings: the hour of the day (in the COMPANY's zone), how many daily copies to keep, how many weekly;
 *  - WHEN a copy is due: once per company day, after the chosen hour, and a failed scheduled attempt is retried a few hours
 *    later (at most three a day), so a Drive that was down at 03:00 does not cost a day;
 *  - WHICH copies retention removes: the newest `daily` days, plus the newest copy of each of the next `weekly` weeks that
 *    are older than that window; everything else goes;
 *  - the warning: nothing succeeded for 36 hours.
 */

export const BACKUP_DEFAULTS = { hour: 3, daily: 14, weekly: 4 } as const;
export const BACKUP_LIMITS = { daily: { min: 1, max: 60 }, weekly: { min: 0, max: 26 } } as const;

export interface BackupConfig {
  /** 0 to 23, the company's clock. */
  hour: number;
  /** How many days of copies to keep (one per company day). */
  daily: number;
  /** How many older weeks to keep one copy of. */
  weekly: number;
}

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** The stored settings of a company, a broken or missing value falling back to its default. */
export function backupConfigOf(settings: unknown): BackupConfig {
  const raw = settings && typeof settings === "object" ? (settings as { dbBackup?: unknown }).dbBackup : null;
  const cfg = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    hour: whole(cfg["hour"], 0, 23, BACKUP_DEFAULTS.hour),
    daily: whole(cfg["daily"], BACKUP_LIMITS.daily.min, BACKUP_LIMITS.daily.max, BACKUP_DEFAULTS.daily),
    weekly: whole(cfg["weekly"], BACKUP_LIMITS.weekly.min, BACKUP_LIMITS.weekly.max, BACKUP_DEFAULTS.weekly),
  };
}

/** The settings object with the backup configuration written (every other key kept). */
export function withBackupConfig(settings: unknown, config: BackupConfig): Record<string, unknown> {
  const base = settings && typeof settings === "object" && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {};
  base["dbBackup"] = { hour: config.hour, daily: config.daily, weekly: config.weekly };
  return base;
}

export type BackupRunStatus = "RUNNING" | "SUCCESS" | "FAILED";
export type BackupTrigger = "SCHEDULED" | "MANUAL";

export interface RunStamp {
  startedAt: Date;
  status: BackupRunStatus;
  trigger: BackupTrigger;
}

/** A scheduled attempt that failed is tried again after this long. */
export const RETRY_AFTER_MS = 3 * 3_600_000;
/** The most scheduled attempts in one company day (the first and two retries). */
export const MAX_SCHEDULED_ATTEMPTS = 3;
/** A run still «RUNNING» after this long died with its process (a restart, a deploy): it is marked failed. */
export const STALE_RUNNING_MS = 90 * 60_000;
/** The screen warns when the last good copy is older than this. */
export const STALE_AFTER_MS = 36 * 3_600_000;

/**
 * Is a scheduled copy due at `now`? Only once the company's clock has reached the chosen hour; never while a copy is
 * running; never when a copy (scheduled or pressed by hand) already succeeded today; a failed scheduled attempt waits
 * `RETRY_AFTER_MS` and there are at most `MAX_SCHEDULED_ATTEMPTS` of them. A failure of a button pressed by hand costs nothing.
 */
export function backupDue(input: { now: Date; zone: string; hour: number; runs: readonly RunStamp[] }): boolean {
  const { now, zone, hour, runs } = input;
  if (zonedParts(now, zone).hour < hour) return false;
  const dayStart = zonedDayStart(now, zone).getTime();
  const today = runs.filter((r) => r.startedAt.getTime() >= dayStart);
  if (runs.some((r) => r.status === "RUNNING")) return false;
  if (today.some((r) => r.status === "SUCCESS")) return false;
  const failed = today.filter((r) => r.trigger === "SCHEDULED" && r.status === "FAILED");
  if (failed.length === 0) return true;
  if (failed.length >= MAX_SCHEDULED_ATTEMPTS) return false;
  const last = Math.max(...failed.map((r) => r.startedAt.getTime()));
  return now.getTime() - last >= RETRY_AFTER_MS;
}

export interface KeptRun {
  id: string;
  startedAt: Date;
}

/**
 * The ids retention removes from Drive. Input: the SUCCESSFUL copies still on Drive. Output: every copy that is neither
 *  - the newest of one of the newest `daily` company days, nor
 *  - the newest of one of the next `weekly` weeks (a week runs from the first day of the company's week, الأحد) older than that window, a week that
 *    already holds a kept day not counting.
 * The newest copy is always kept, whatever the numbers say.
 */
export function selectBackupsToDelete(
  runs: readonly KeptRun[],
  opts: { zone: string; daily: number; weekly: number },
): string[] {
  const daily = Math.max(1, Math.floor(opts.daily));
  const weekly = Math.max(0, Math.floor(opts.weekly));
  const sorted = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (a.id < b.id ? 1 : -1));
  // the newest copy of each company day, newest day first
  const winners: Array<{ run: KeptRun; day: number; week: number }> = [];
  const seenDays = new Set<number>();
  for (const run of sorted) {
    const day = zonedDayNumber(run.startedAt, opts.zone);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    winners.push({ run, day, week: day - zonedParts(run.startedAt, opts.zone).weekday });
  }
  const keep = new Set<string>();
  const dailyWinners = winners.slice(0, daily);
  for (const w of dailyWinners) keep.add(w.run.id);
  const coveredWeeks = new Set(dailyWinners.map((w) => w.week));
  const weeksKept = new Set<number>();
  for (const w of winners.slice(daily)) {
    if (weeksKept.size >= weekly) break;
    if (coveredWeeks.has(w.week) || weeksKept.has(w.week)) continue;
    weeksKept.add(w.week);
    keep.add(w.run.id);
  }
  return sorted.filter((r) => !keep.has(r.id)).map((r) => r.id);
}

export type Freshness = "fresh" | "stale" | "never";

/** «fresh» while the last good copy is newer than 36 hours. */
export function freshnessOf(lastSuccessAt: Date | null, now: Date): Freshness {
  if (!lastSuccessAt) return "never";
  return now.getTime() - lastSuccessAt.getTime() > STALE_AFTER_MS ? "stale" : "fresh";
}

/** The name of the file on Drive: the moment (UTC) and the run, no company data. */
export function backupFileName(at: Date, runId: string): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}`;
  return `zaki-backup-${stamp}-${runId.slice(-6)}.zbk`;
}
