/**
 * «حال السيرفر» — the pure part: what is measured, where it turns into a warning, and the verdict. No secret, no path, no customer data:
 * only numbers about the process and the machine it runs on (src/server/services/server-health.ts reads them).
 *
 * ⚠️ The numbers are of the box the container sees: the memory limit comes from the container (cgroup) when there is one, else the machine.
 * 🔧 The limits below are printed on the screen next to the reading, so a warning is never a mystery; they are advice, not a switch:
 *    only the owner turns «وضع التوفير» on.
 */

export interface ServerHealthSample {
  /** the app process, resident memory, bytes */
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  uptimeSec: number;
  /** how late a timer fired (worst of a few samples), milliseconds */
  eventLoopLagMs: number;
  /** the machine load average (1 and 5 minutes; 0 where the OS has none) and its cores */
  loadAvg1: number;
  loadAvg5: number;
  cpus: number;
  totalMemBytes: number;
  freeMemBytes: number;
  /** the container memory limit when it has one, else null */
  memLimitBytes: number | null;
  dbOk: boolean;
  dbLatencyMs: number | null;
  /** bytes of uploaded files kept on this server disk, and how many files; null when it could not be counted */
  uploads: { files: number; bytes: number } | null;
}

export type HealthReason = "rss_high" | "free_low" | "lag_high" | "db_slow" | "db_down" | "load_high";

export interface ServerHealth extends ServerHealthSample {
  /** when it was measured (ISO) */
  at: string;
  verdict: { level: "ok" | "warn"; reasons: HealthReason[] };
}

/** Where a reading turns into a warning. Printed on the screen. */
export const HEALTH_THRESHOLDS = {
  /** the process holds more than this percent of the memory it may use */
  rssPercent: 75,
  /** the machine has less than this percent of its memory free */
  freePercent: 10,
  /** a timer fires this many milliseconds late */
  lagMs: 100,
  /** one simple query to the database takes this long */
  dbMs: 200,
  /** the 1-minute load average per core */
  loadPerCore: 1.5,
} as const;

export function assessHealth(s: ServerHealthSample): ServerHealth["verdict"] {
  const reasons: HealthReason[] = [];
  const memory = s.memLimitBytes && s.memLimitBytes > 0 ? Math.min(s.memLimitBytes, s.totalMemBytes || s.memLimitBytes) : s.totalMemBytes;
  if (memory > 0 && (s.rssBytes / memory) * 100 > HEALTH_THRESHOLDS.rssPercent) reasons.push("rss_high");
  if (s.totalMemBytes > 0 && (s.freeMemBytes / s.totalMemBytes) * 100 < HEALTH_THRESHOLDS.freePercent) reasons.push("free_low");
  if (s.eventLoopLagMs > HEALTH_THRESHOLDS.lagMs) reasons.push("lag_high");
  if (!s.dbOk) reasons.push("db_down");
  else if (s.dbLatencyMs !== null && s.dbLatencyMs > HEALTH_THRESHOLDS.dbMs) reasons.push("db_slow");
  // Windows has no load average (it reports 0): nothing to judge there
  if (s.cpus > 0 && s.loadAvg1 / s.cpus > HEALTH_THRESHOLDS.loadPerCore) reasons.push("load_high");
  return { level: reasons.length > 0 ? "warn" : "ok", reasons };
}
