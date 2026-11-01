import { mkdtemp, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { Prisma } from "@prisma/client";
import { Client } from "pg";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { encryptionKeyConfigured } from "@/server/crypto";
import { log } from "@/server/log";
import { directPgUrl } from "@/server/realtime/listener";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { DriveStoreError } from "@/server/files/drive-store";
import { backupDrive } from "@/server/backup/drive";
import { dumpDatabase, type DumpStats } from "@/server/backup/dump";
import { encryptBackup } from "@/server/backup/envelope";
import { verifyBackupStream } from "@/server/backup/verify";
import {
  STALE_RUNNING_MS,
  backupConfigOf,
  backupDue,
  backupFileName,
  freshnessOf,
  selectBackupsToDelete,
  withBackupConfig,
  type BackupConfig,
  type BackupRunStatus,
  type BackupTrigger,
  type Freshness,
} from "@/lib/db-backup";
import { resolveTimeZone } from "@/lib/zoned-time";

/**
 * «نسخ احتياطي لقاعدة البيانات»: a daily, encrypted copy of the WHOLE database on the owner's own Google Drive.
 *
 *  - WHO: the OWNER alone (`backup.owner_only`, 403, for anybody else, an ADMIN included), and only the company that owns the
 *    installation (the oldest one): a dump holds EVERY company's rows, so it may only go to the Drive of the company that owns them all.
 *  - WHEN: the job runner (src/server/jobs/db-backup.ts) at the owner's hour in the company's zone, or the button «اعمل نسخة هلأ».
 *    The switch «نسخ احتياطي لقاعدة البيانات» in «الميزات» is OFF until the owner turns it on.
 *  - THE KEY: only `ENCRYPTION_KEY`. A key derived from AUTH_SECRET would rotate with the sessions and orphan every old copy, so
 *    without `ENCRYPTION_KEY` the run is refused (the screen says why). The key is never written anywhere; the file's own key is
 *    HKDF(ENCRYPTION_KEY, a salt in the file) (src/server/backup/envelope.ts).
 *  - WHERE THE BYTES GO: dump (src/server/backup/dump.ts) -> gzip -> AES-256-GCM -> ONE temp file -> Drive. The temp file lives in the
 *    OS temp folder under a folder of its own and is removed in `finally`, success or failure. Drive not connected: nothing is written
 *    to the server's disk at all, the run is recorded as failed with its reason.
 *  - WHAT IS RECORDED: `BackupRun` (times, size, counts, the Drive file id, a machine error key) and an audit row `backup.run` (size,
 *    duration, outcome). No log line and no row ever holds data from the database.
 *  - RETENTION: after a successful copy, the newest `daily` days plus `weekly` older weeks are kept; the rest are deleted from Drive.
 *
 *  ⚠️ The copy holds customer data and every password hash, encrypted. 🔧 It goes only to the owner's Drive, the key never leaves
 *  the server's settings, and a copy can only be opened with the key.
 */

export class BackupConflictError extends Error {
  constructor(public readonly key: string) {
    super(key);
  }
}

/** A refusal with a machine key (becomes the run's `errorKey`). */
class BackupFailure extends Error {
  constructor(public readonly key: string, public readonly detail: string | null = null) {
    super(key);
  }
}

export interface BackupRunDTO {
  id: string;
  trigger: BackupTrigger;
  status: BackupRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  sizeBytes: number | null;
  tables: number | null;
  rows: number | null;
  /** Drive's id of the file (never a link). Null once retention removed it, or when the run did not produce one. */
  driveFileId: string | null;
  pruned: boolean;
  errorKey: string | null;
  errorDetail: string | null;
  verifiedAt: Date | null;
  verifyOk: boolean | null;
  verifyTables: number | null;
  verifyRows: number | null;
  verifyErrorKey: string | null;
}

type RunRow = Prisma.BackupRunGetPayload<Record<string, never>>;

function toDTO(r: RunRow): BackupRunDTO {
  return {
    id: r.id,
    trigger: r.trigger as BackupTrigger,
    status: r.status as BackupRunStatus,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    tables: r.tableCount,
    rows: r.rowCount,
    driveFileId: r.prunedAt ? null : r.driveFileId,
    pruned: r.prunedAt !== null,
    errorKey: r.errorKey,
    errorDetail: r.errorDetail,
    verifiedAt: r.verifiedAt,
    verifyOk: r.verifyOk,
    verifyTables: r.verifyTables,
    verifyRows: r.verifyRows,
    verifyErrorKey: r.verifyErrorKey,
  };
}

/** The key the copies are encrypted with, or null when `ENCRYPTION_KEY` is not set (never AUTH_SECRET: it rotates with the sessions). */
export function backupMasterKey(): string | null {
  if (!encryptionKeyConfigured()) return null;
  const raw = process.env["ENCRYPTION_KEY"] as string;
  return raw.length >= 32 ? raw : null;
}

/** The company that owns the installation: the oldest. A dump holds every company, so only this one may send it to its Drive. */
export async function installationOrgId(): Promise<string | null> {
  const first = await db.organization.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  return first?.id ?? null;
}

function assertOwner(actor: Pick<Actor, "isOwner">): void {
  if (!actor.isOwner) throw new ForbiddenError("backup.owner_only");
}

async function assertInstallation(orgId: string): Promise<void> {
  if ((await installationOrgId()) !== orgId) throw new ForbiddenError("backup.err.not_installation");
}

async function orgOf(orgId: string): Promise<{ timezone: string; settings: unknown }> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true, settings: true } });
  return org;
}

// ---------------------------------------------------------------------------
// the screen
// ---------------------------------------------------------------------------

export interface BackupStatusDTO {
  switchOn: boolean;
  /** `ENCRYPTION_KEY` is set (the only key a copy may use). */
  keyConfigured: boolean;
  /** Drive is connected and may take a file. */
  driveReady: boolean;
  /** This company owns the installation (only it may back up). */
  eligible: boolean;
  config: BackupConfig;
  timezone: string;
  running: boolean;
  lastSuccessAt: Date | null;
  freshness: Freshness;
  runs: BackupRunDTO[];
}

export async function getBackupStatus(actor: Actor, now: Date = new Date()): Promise<BackupStatusDTO> {
  assertOwner(actor);
  const org = await orgOf(actor.orgId);
  const [switchOn, eligible, driveReady, rows, last] = await Promise.all([
    isFeatureOn(actor.orgId, "dbBackup"),
    installationOrgId().then((id) => id === actor.orgId),
    backupDrive().ready(actor.orgId).catch(() => false),
    db.backupRun.findMany({ where: { organizationId: actor.orgId }, orderBy: { startedAt: "desc" }, take: 30 }),
    db.backupRun.findFirst({ where: { organizationId: actor.orgId, status: "SUCCESS" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } }),
  ]);
  const lastSuccessAt = last ? (last.finishedAt ?? last.startedAt) : null;
  return {
    switchOn,
    keyConfigured: backupMasterKey() !== null,
    driveReady,
    eligible,
    config: backupConfigOf(org.settings),
    timezone: resolveTimeZone(org.timezone),
    running: rows.some((r) => r.status === "RUNNING"),
    lastSuccessAt,
    freshness: freshnessOf(lastSuccessAt, now),
    runs: rows.map(toDTO),
  };
}

export async function saveBackupConfig(actor: Actor, input: BackupConfig): Promise<BackupConfig> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "dbBackup");
  await assertInstallation(actor.orgId);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${actor.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
    await tx.organization.update({ where: { id: actor.orgId }, data: { settings: withBackupConfig(org?.settings ?? {}, input) as Prisma.InputJsonValue } });
    await tx.auditLog.create({
      data: { action: "backup.config", actorId: actor.userId, orgId: actor.orgId, target: actor.orgId, meta: { hour: input.hour, daily: input.daily, weekly: input.weekly } },
    });
  });
  return input;
}

// ---------------------------------------------------------------------------
// one run
// ---------------------------------------------------------------------------

/** The column is a 32-bit integer: a clock that disagrees must not overflow it. */
const MAX_DURATION_MS = 2_000_000_000;

const inflight = new Set<Promise<unknown>>();

/** Test hook: resolves when every backup started by this process has finished (never call from server code). */
export async function settleBackupsForTests(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}

function describeFailure(err: unknown): { key: string; detail: string | null } {
  if (err instanceof BackupFailure) return { key: err.key, detail: err.detail };
  if (err instanceof DriveStoreError) {
    return err.step.endsWith("_no_connection") ? { key: "backup.err.drive_not_connected", detail: err.message } : { key: "backup.err.drive_failed", detail: err.message };
  }
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "ENOSPC") return { key: "backup.err.disk_full", detail: "fs.ENOSPC" };
  // PostgreSQL's five-character state (never its message: that can quote a row)
  if (/^[0-9A-Z]{5}$/.test(code)) return { key: "backup.err.dump_failed", detail: `pg.${code}` };
  if (/^E[A-Z]+$/.test(code) && code.startsWith("ECONN")) return { key: "backup.err.dump_failed", detail: `net.${code}` };
  return { key: "backup.err.unknown", detail: err instanceof Error ? err.name : null };
}

/** Streams the dump into `file`: dump -> gzip -> encrypt. Holds one chunk in memory, whatever the size. */
async function writeEncryptedDump(file: string, masterKey: string, stats: DumpStats): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new BackupFailure("backup.err.dump_failed", "no_database_url");
  const client = new Client({ connectionString: directPgUrl(url) });
  // an idle connection that drops must never be an unhandled 'error' event
  client.on("error", () => undefined);
  await client.connect();
  try {
    await pipeline(
      Readable.from(dumpDatabase(client, stats)),
      createGzip({ level: 6 }),
      (plain: AsyncIterable<Buffer>) => encryptBackup(plain, masterKey),
      createWriteStream(file, { mode: 0o600 }),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Does the work of a claimed (RUNNING) run and records the outcome. Never throws for a failed copy: the run says how it failed.
 * Exposed for the tests; callers go through `startBackup`.
 */
export async function executeBackup(runId: string): Promise<BackupRunDTO> {
  const run = await db.backupRun.findUniqueOrThrow({ where: { id: runId } });
  const drive = backupDrive();
  // the duration is measured here (not from `startedAt`, which a test or a late tick may set to another moment)
  const t0 = Date.now();
  const stats: DumpStats = { tables: 0, rows: 0 };
  let dir: string | null = null;
  let driveFileId: string | null = null;
  let sizeBytes: number | null = null;
  let failure: { key: string; detail: string | null } | null = null;
  try {
    const masterKey = backupMasterKey();
    if (!masterKey) throw new BackupFailure("backup.err.no_key");
    // Drive first: with no Drive there is nothing to do, and nothing is written to this server
    if (!(await drive.ready(run.organizationId))) throw new BackupFailure("backup.err.drive_not_connected");
    dir = await mkdtemp(join(tmpdir(), "zaki-backup-"));
    const file = join(dir, "backup.zbk");
    await writeEncryptedDump(file, masterKey, stats);
    sizeBytes = (await stat(file)).size;
    driveFileId = await drive.upload(run.organizationId, { name: backupFileName(run.startedAt, run.id), path: file, size: sizeBytes, runId: run.id });
  } catch (err) {
    failure = describeFailure(err);
  } finally {
    // the one copy on this server goes away whatever happened
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  const finishedAt = new Date();
  const durationMs = Math.min(MAX_DURATION_MS, Math.max(0, Date.now() - t0));
  const ok = failure === null;
  const done = await db.$transaction(async (tx) => {
    const row = await tx.backupRun.update({
      where: { id: run.id },
      data: {
        status: ok ? "SUCCESS" : "FAILED",
        finishedAt,
        durationMs,
        sizeBytes: sizeBytes === null ? null : BigInt(sizeBytes),
        tableCount: ok ? stats.tables : null,
        rowCount: ok ? stats.rows : null,
        driveFileId: ok ? driveFileId : null,
        errorKey: failure?.key ?? null,
        errorDetail: failure?.detail ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "backup.run",
        actorId: run.requestedById,
        orgId: run.organizationId,
        target: run.id,
        meta: { outcome: ok ? "SUCCESS" : "FAILED", trigger: run.trigger, sizeBytes: ok ? sizeBytes : null, durationMs, ...(failure ? { errorKey: failure.key } : {}) },
      },
    });
    return row;
  });
  if (ok) log.info("backup.finished", { runId: run.id, trigger: run.trigger, sizeBytes, durationMs });
  else log.error("backup.failed", { runId: run.id, trigger: run.trigger, errorKey: failure?.key, errorDetail: failure?.detail, durationMs });
  if (ok) await pruneBackups(run.organizationId).catch((err) => log.warn("backup.prune_failed", { runId: run.id, name: err instanceof Error ? err.name : "error" }));
  return toDTO(done);
}

/** Removes from Drive the copies retention retires (after a good copy only), and marks their rows. A copy Drive no longer has counts as removed. */
export async function pruneBackups(orgId: string): Promise<number> {
  const org = await orgOf(orgId);
  const cfg = backupConfigOf(org.settings);
  const kept = await db.backupRun.findMany({
    where: { organizationId: orgId, status: "SUCCESS", prunedAt: null, driveFileId: { not: null } },
    select: { id: true, startedAt: true, driveFileId: true },
  });
  const doomed = new Set(selectBackupsToDelete(kept, { zone: resolveTimeZone(org.timezone), daily: cfg.daily, weekly: cfg.weekly }));
  let removed = 0;
  for (const run of kept) {
    if (!doomed.has(run.id) || !run.driveFileId) continue;
    try {
      await backupDrive().remove(orgId, run.driveFileId);
      await db.backupRun.update({ where: { id: run.id }, data: { prunedAt: new Date() } });
      removed++;
    } catch (err) {
      // the row stays: the next good copy tries again
      log.warn("backup.prune_one_failed", { runId: run.id, detail: err instanceof DriveStoreError ? err.message : "error" });
    }
  }
  return removed;
}

/** A run still «RUNNING» long after it started died with its process: it is marked failed so the next one can start. */
export async function sweepStaleRuns(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_MS);
  const stale = await db.backupRun.findMany({ where: { status: "RUNNING", startedAt: { lt: cutoff } }, select: { id: true, organizationId: true, requestedById: true, trigger: true, startedAt: true } });
  for (const r of stale) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.backupRun.updateMany({
        where: { id: r.id, status: "RUNNING" },
        data: { status: "FAILED", finishedAt: now, durationMs: Math.min(MAX_DURATION_MS, Math.max(0, now.getTime() - r.startedAt.getTime())), errorKey: "backup.err.interrupted" },
      });
      if (count === 1) {
        await tx.auditLog.create({
          data: { action: "backup.run", actorId: r.requestedById, orgId: r.organizationId, target: r.id, meta: { outcome: "FAILED", trigger: r.trigger, errorKey: "backup.err.interrupted" } },
        });
      }
    });
  }
  return stale.length;
}

/**
 * Claims a run (one at a time per company: the company row is locked for the check and the insert) and starts the work WITHOUT
 * waiting for it: a copy takes minutes and the job runner's other jobs must not wait. `done` resolves with the finished run.
 */
export async function startBackup(input: { orgId: string; trigger: BackupTrigger; requestedById: string | null }, now: Date = new Date()): Promise<{ run: BackupRunDTO; done: Promise<BackupRunDTO> }> {
  await sweepStaleRuns(now);
  const row = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${input.orgId} FOR UPDATE`;
    const busy = await tx.backupRun.findFirst({ where: { organizationId: input.orgId, status: "RUNNING" }, select: { id: true } });
    if (busy) throw new BackupConflictError("backup.err.already_running");
    return tx.backupRun.create({ data: { organizationId: input.orgId, trigger: input.trigger, status: "RUNNING", startedAt: now, requestedById: input.requestedById } });
  });
  const done = executeBackup(row.id).catch((err) => {
    // executeBackup records its own failures; this is the row that could not even be written
    log.error("backup.record_failed", { runId: row.id, name: err instanceof Error ? err.name : "error" });
    throw err;
  });
  inflight.add(done);
  const forget = () => inflight.delete(done);
  done.then(forget, forget);
  // nobody may wait on `done` (a scheduled run): it must never become an unhandled rejection
  done.catch(() => undefined);
  return { run: toDTO(row), done };
}

/** «اعمل نسخة هلأ»: the owner starts a copy now. Refused without the key (403) and while another copy runs (409). */
export async function runBackupNow(actor: Actor): Promise<{ run: BackupRunDTO; done: Promise<BackupRunDTO> }> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "dbBackup");
  await assertInstallation(actor.orgId);
  if (!backupMasterKey()) throw new ForbiddenError("backup.err.no_key");
  return startBackup({ orgId: actor.orgId, trigger: "MANUAL", requestedById: actor.userId });
}

/** «تحقّق»: decrypts one copy from Drive and counts its tables and rows, without restoring anything. The result is kept on the run. */
export async function verifyBackup(actor: Actor, runId: string): Promise<BackupRunDTO> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "dbBackup");
  const masterKey = backupMasterKey();
  if (!masterKey) throw new ForbiddenError("backup.err.no_key");
  const run = await db.backupRun.findFirst({ where: { id: runId, organizationId: actor.orgId, status: "SUCCESS", prunedAt: null, driveFileId: { not: null } } });
  if (!run?.driveFileId) throw new NotFoundError("backup.err.run_not_found");
  let verdict: { ok: boolean; tables: number; rows: number; errorKey: string | null };
  try {
    verdict = await verifyBackupStream(await backupDrive().open(actor.orgId, run.driveFileId), masterKey);
  } catch (err) {
    verdict = { ok: false, tables: 0, rows: 0, errorKey: err instanceof DriveStoreError && err.step.startsWith("read_missing") ? "backup.err.verify_missing" : "backup.err.verify_drive" };
  }
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.backupRun.update({
      where: { id: run.id },
      data: { verifiedAt: new Date(), verifyOk: verdict.ok, verifyTables: verdict.ok ? verdict.tables : null, verifyRows: verdict.ok ? verdict.rows : null, verifyErrorKey: verdict.errorKey },
    });
    await tx.auditLog.create({
      data: { action: "backup.verify", actorId: actor.userId, orgId: actor.orgId, target: run.id, meta: { outcome: verdict.ok ? "OK" : "FAILED", ...(verdict.errorKey ? { errorKey: verdict.errorKey } : {}) } },
    });
    return updated;
  });
  return toDTO(row);
}

// ---------------------------------------------------------------------------
// the job runner's step
// ---------------------------------------------------------------------------

export interface BackupsRun {
  /** Copies started this tick (they finish in the background). */
  started: number;
  /** Runs found dead and marked failed. */
  swept: number;
}

/** What the job runner calls every tick: starts the installation company's copy when its hour has come. Cheap when nothing is due. */
export async function runDueBackups(now: Date): Promise<BackupsRun> {
  const swept = await sweepStaleRuns(now);
  const orgId = await installationOrgId();
  if (!orgId) return { started: 0, swept };
  if (!(await isFeatureOn(orgId, "dbBackup"))) return { started: 0, swept };
  // without ENCRYPTION_KEY nothing is attempted (the screen says why); a failed run per tick would only be noise
  if (!backupMasterKey()) return { started: 0, swept };
  const org = await orgOf(orgId);
  const zone = resolveTimeZone(org.timezone);
  const cfg = backupConfigOf(org.settings);
  const since = new Date(now.getTime() - 48 * 3_600_000);
  const recent = await db.backupRun.findMany({
    where: { organizationId: orgId, OR: [{ startedAt: { gte: since } }, { status: "RUNNING" }] },
    select: { startedAt: true, status: true, trigger: true },
  });
  const runs = recent.map((r) => ({ startedAt: r.startedAt, status: r.status as BackupRunStatus, trigger: r.trigger as BackupTrigger }));
  if (!backupDue({ now, zone, hour: cfg.hour, runs })) return { started: 0, swept };
  try {
    await startBackup({ orgId, trigger: "SCHEDULED", requestedById: null }, now);
    return { started: 1, swept };
  } catch (err) {
    // two runners claimed at once: the second finds the first running, which is the right answer
    if (err instanceof BackupConflictError) return { started: 0, swept };
    throw err;
  }
}
