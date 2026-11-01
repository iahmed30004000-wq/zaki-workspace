import os from "node:os";
import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";
import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { DRIVE_PREFIX } from "@/server/files/drive-store";
import { PENDING_PATH } from "@/server/services/files";
import { assessHealth, type ServerHealth, type ServerHealthSample } from "@/lib/server-health";

/**
 * «حال السيرفر» — a read-only look at how hard the box is working, for the OWNER alone (the one who can switch «وضع التوفير»).
 * Numbers only: the process memory, how late a timer fires, uptime, the machine load and memory, one trivial query to the
 * database, and the bytes of uploads kept on this server disk (one aggregate over the company own rows, never a walk of the disk).
 * No path, no secret, no name: nothing here can identify a person or a file. Nothing is stored and nothing is written.
 */

/** Where a container memory limit is written (cgroup v2, then v1); a plain machine has neither. */
const CGROUP_LIMITS = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"] as const;

async function containerMemoryLimit(): Promise<number | null> {
  for (const file of CGROUP_LIMITS) {
    try {
      const n = Number((await fs.readFile(file, "utf8")).trim());
      // "max" (no limit) is NaN; an unlimited v1 group reports a huge number: both mean no limit
      if (Number.isFinite(n) && n > 0 && n < os.totalmem() * 1.001) return n;
    } catch {
      // not a container with that file: try the next, then give up quietly
    }
  }
  return null;
}

/** The worst lateness of a short timer over a few samples: a busy event loop shows up as a late timer. */
async function eventLoopLagMs(): Promise<number> {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    worst = Math.max(worst, performance.now() - started - 20);
  }
  return Math.round(worst);
}

async function databaseProbe(): Promise<{ ok: boolean; latencyMs: number | null }> {
  const started = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

async function uploadsOnDisk(orgId: string): Promise<{ files: number; bytes: number } | null> {
  try {
    const agg = await db.storedFile.aggregate({
      where: { orgId, path: { not: PENDING_PATH }, NOT: { path: { startsWith: DRIVE_PREFIX } } },
      _count: { _all: true },
      _sum: { size: true },
    });
    return { files: agg._count._all, bytes: agg._sum.size ?? 0 };
  } catch {
    return null;
  }
}

export async function serverHealth(ctx: OrgAccessContext, now: Date = new Date()): Promise<ServerHealth> {
  if (ctx.orgRole !== "OWNER") throw new ForbiddenError("health.owner_only");
  const mem = process.memoryUsage();
  const [lag, probe, uploads, limit] = await Promise.all([eventLoopLagMs(), databaseProbe(), uploadsOnDisk(ctx.orgId), containerMemoryLimit()]);
  const [load1 = 0, load5 = 0] = os.loadavg();
  const sample: ServerHealthSample = {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    uptimeSec: Math.round(process.uptime()),
    eventLoopLagMs: lag,
    loadAvg1: Math.round(load1 * 100) / 100,
    loadAvg5: Math.round(load5 * 100) / 100,
    cpus: os.cpus().length,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    memLimitBytes: limit,
    dbOk: probe.ok,
    dbLatencyMs: probe.latencyMs,
    uploads,
  };
  return { ...sample, at: now.toISOString(), verdict: assessHealth(sample) };
}
