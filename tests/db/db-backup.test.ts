import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as statusRoute from "@/app/api/integrations/db-backup/route";
import * as runRoute from "@/app/api/integrations/db-backup/run/route";
import * as verifyRoute from "@/app/api/integrations/db-backup/[id]/verify/route";
import { selectBackupsToDelete } from "@/lib/db-backup";
import { withFeature } from "@/lib/features";
import { type BackupDrive, setBackupDriveForTests } from "@/server/backup/drive";
import { dumpDatabase } from "@/server/backup/dump";
import { decryptBackup } from "@/server/backup/envelope";
import { DriveStoreError } from "@/server/files/drive-store";
import { directPgUrl } from "@/server/realtime/listener";
import { runDueJobs } from "@/server/jobs/run";
import { requireActor } from "@/server/policy/actor";
import { runBackupNow, saveBackupConfig, settleBackupsForTests, startBackup, sweepStaleRuns } from "@/server/services/db-backup";
import { call, db, loginAs, logout, makeTeam, makeUser } from "./helpers";
import { grantCapabilities } from "./accounts-helpers";

/**
 * «نسخ احتياطي لقاعدة البيانات»: a daily encrypted copy of the whole database on the owner's Google Drive.
 *
 * What this pins, against a real PostgreSQL and a FAKE Drive:
 *  - the copy: gzip + AES-256-GCM, uploaded to Drive, recorded (size, counts, duration), audited with the outcome only; the file opens
 *    with ENCRYPTION_KEY and holds the rows; no log line carries data;
 *  - the dump restores into a NEW empty database, every table identical (awkward text, quotes, newlines, Arabic, arrays, JSON);
 *  - the temp file is gone after success AND after every kind of failure; with no Drive nothing is written to the server's disk;
 *  - Drive disconnected: a failed run with its reason; without ENCRYPTION_KEY the run is refused (a key derived from AUTH_SECRET is never used);
 *  - OWNER only (an ADMIN, a member and a guest get 403), only the company that owns the installation, only while the switch is on;
 *  - one copy at a time (409); the schedule in the COMPANY's zone, once a day, a failed attempt retried after 3 hours, three a day at most;
 *  - a run found dead is marked failed; retention removes the old copies from Drive after a good one;
 *  - «تحقّق» opens a copy from Drive and counts it; a wrong key, a flipped byte and a vanished file each say so.
 */

const KEY = "backup-test-encryption-key-0123456789-abcdef";
const BASE_TMP = tmpdir();
let tmpRoot = "";
const saved: Record<string, string | undefined> = {};

/** A Drive in memory, with the switches a test needs. */
class FakeDrive implements BackupDrive {
  files = new Map<string, Buffer>();
  isReady = true;
  uploadError: Error | null = null;
  gate: Promise<void> | null = null;
  uploads: Array<{ name: string; path: string; dir: string; sawFile: boolean; size: number }> = [];
  removed: string[] = [];
  private n = 0;
  async ready() {
    return this.isReady;
  }
  async upload(_orgId: string, input: { name: string; path: string; size: number; runId: string }) {
    this.uploads.push({ name: input.name, path: input.path, dir: path.dirname(input.path), sawFile: existsSync(input.path), size: input.size });
    if (this.gate) await this.gate;
    if (this.uploadError) throw this.uploadError;
    const id = `fake-${++this.n}`;
    this.files.set(id, readFileSync(input.path));
    return id;
  }
  async remove(_orgId: string, driveId: string) {
    this.removed.push(driveId);
    this.files.delete(driveId);
  }
  async open(_orgId: string, driveId: string) {
    const f = this.files.get(driveId);
    if (!f) throw new DriveStoreError("read_missing", 404);
    return Readable.from([f]) as AsyncIterable<Uint8Array>;
  }
}

let fake = new FakeDrive();
let counter = 0;

beforeAll(() => {
  for (const k of ["ENCRYPTION_KEY", "TMPDIR", "TEMP", "TMP"]) saved[k] = process.env[k];
  tmpRoot = mkdtempSync(path.join(BASE_TMP, "zk-bk-root-"));
  process.env["TMPDIR"] = tmpRoot;
  process.env["TEMP"] = tmpRoot;
  process.env["TMP"] = tmpRoot;
  process.env["ENCRYPTION_KEY"] = KEY;
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setBackupDriveForTests(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await settleBackupsForTests();
  await db.backupRun.deleteMany({});
  fake = new FakeDrive();
  setBackupDriveForTests(fake);
  process.env["ENCRYPTION_KEY"] = KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A company that owns the installation (the oldest), with the switch ON unless told otherwise. */
async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  // each world is older than the one before it, so «the oldest company» is always the one under test
  await db.organization.update({ where: { id: team.org.id }, data: { createdAt: new Date(Date.UTC(2000, 0, 1) - ++counter * 1000) } });
  if (opts.on !== false) await setSwitch(team.org.id, true);
  return team;
}

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "dbBackup", on) as Prisma.InputJsonValue } });
}

type Team = Awaited<ReturnType<typeof world>>;

const URL_BASE = "http://localhost/api/integrations/db-backup";
const status = () => call(statusRoute.GET, { url: URL_BASE });
const runNow = () => call(runRoute.POST, { method: "POST", url: `${URL_BASE}/run` });
const verify = (id: string) => call(verifyRoute.POST, { method: "POST", url: `${URL_BASE}/${id}/verify`, params: { id } });
const runsOf = (orgId: string) => db.backupRun.findMany({ where: { organizationId: orgId }, orderBy: { startedAt: "asc" } });

async function actorOf(userId: string) {
  await loginAs(userId);
  return requireActor();
}

async function collect(it: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const p of it) parts.push(Buffer.from(p));
  return Buffer.concat(parts);
}

/** The SQL a stored copy holds (decrypted with the test key, unzipped). */
async function sqlOf(driveId: string): Promise<string> {
  const file = fake.files.get(driveId) as Buffer;
  return gunzipSync(await collect(decryptBackup(Readable.from([file]), KEY))).toString("utf8");
}

const tmpEntries = () => readdirSync(tmpRoot);

describe("the copy", () => {
  it("the owner's button starts a copy that is gzipped, encrypted, uploaded, recorded and audited", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const started = await runNow();
    expect(started.status, started.text).toBe(202);
    expect((started.json?.["run"] as { status: string }).status).toBe("RUNNING");
    await settleBackupsForTests();

    const [run] = await runsOf(w.org.id);
    expect(run?.status).toBe("SUCCESS");
    expect(run?.trigger).toBe("MANUAL");
    expect(run?.requestedById).toBe(w.owner.id);
    expect(run?.driveFileId).toBe("fake-1");
    expect(run?.errorKey).toBeNull();
    expect(Number(run?.sizeBytes)).toBe(fake.files.get("fake-1")?.length);
    expect(run?.tableCount).toBeGreaterThan(50);
    expect(run?.rowCount).toBeGreaterThan(3);
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);

    // what went to Drive: the name carries no data, and the bytes are not readable without the key
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.name).toMatch(/^zaki-backup-\d{8}-\d{6}-[a-z0-9]{6}\.zbk$/);
    const bytes = fake.files.get("fake-1") as Buffer;
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("ZKBK");
    expect(bytes.includes(Buffer.from(w.owner.email))).toBe(false);

    // opened with the key it holds the rows, the manifest and the end marker; the migration table is left to `migrate deploy`
    const sql = await sqlOf("fake-1");
    expect(sql).toContain("-- complete");
    expect(sql).toContain(`-- table: "User"`);
    expect(sql).toContain(w.owner.email);
    expect(sql).not.toContain(`-- table: "_prisma_migrations"`);
    expect(sql).toMatch(/-- manifest: \{"format":"zaki-sql-v1"/);

    // the audit row carries the outcome, the size and the duration, and nothing else
    const audit = await db.auditLog.findFirst({ where: { orgId: w.org.id, action: "backup.run" } });
    expect(audit?.target).toBe(run?.id);
    expect(audit?.actorId).toBe(w.owner.id);
    expect(Object.keys(audit?.meta as object).sort()).toEqual(["durationMs", "outcome", "sizeBytes", "trigger"]);
    expect((audit?.meta as { outcome: string }).outcome).toBe("SUCCESS");

    // the one temp file the copy needed is gone
    expect(fake.uploads[0]?.sawFile).toBe(true);
    expect(existsSync(fake.uploads[0]?.path as string)).toBe(false);
    expect(tmpEntries()).toEqual([]);
  });

  it("the screen's answer: the history carries the Drive file id (never a link), the last success and no warning", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    const res = await status();
    expect(res.status).toBe(200);
    const json = res.json as { switchOn: boolean; keyConfigured: boolean; driveReady: boolean; eligible: boolean; freshness: string; running: boolean; lastSuccessAt: string; runs: Array<Record<string, unknown>> };
    expect(json).toMatchObject({ switchOn: true, keyConfigured: true, driveReady: true, eligible: true, freshness: "fresh", running: false });
    expect(json.runs).toHaveLength(1);
    expect(json.runs[0]?.["driveFileId"]).toBe("fake-1");
    expect(res.text).not.toMatch(/https?:\/\/(drive|docs)\.google/);
    expect(res.text).not.toContain(KEY);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("no log line carries data from the database", async () => {
    const w = await world();
    const lines: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    fake.uploadError = new DriveStoreError("upload_start", 403);
    await runNow();
    await settleBackupsForTests();
    const logged = lines.join("\n");
    expect(logged).toContain("backup.finished");
    expect(logged).toContain("backup.failed");
    expect(logged).not.toContain(w.owner.email);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("passwordHash");
  });

  it("an upload that Drive refuses is a failed run with its tag, and the temp file is removed", async () => {
    const w = await world();
    fake.uploadError = new DriveStoreError("upload_start", 403);
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    const [run] = await runsOf(w.org.id);
    expect(run?.status).toBe("FAILED");
    expect(run?.errorKey).toBe("backup.err.drive_failed");
    expect(run?.errorDetail).toBe("drive.upload_start_403");
    expect(run?.driveFileId).toBeNull();
    // the file existed while it was uploaded, and neither it nor its folder is left
    expect(fake.uploads[0]?.sawFile).toBe(true);
    expect(existsSync(fake.uploads[0]?.dir as string)).toBe(false);
    expect(tmpEntries()).toEqual([]);
    const audit = await db.auditLog.findFirst({ where: { orgId: w.org.id, action: "backup.run" } });
    expect(audit?.meta).toMatchObject({ outcome: "FAILED", errorKey: "backup.err.drive_failed" });
  });

  it("a dump that cannot start is a failed run, and no temp folder stays behind", async () => {
    const w = await world();
    vi.spyOn(Client.prototype as unknown as { connect: () => Promise<void> }, "connect").mockImplementationOnce(() => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" })));
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    const [run] = await runsOf(w.org.id);
    expect(run?.status).toBe("FAILED");
    expect(run?.errorKey).toBe("backup.err.dump_failed");
    expect(run?.errorDetail).toBe("net.ECONNREFUSED");
    expect(fake.uploads).toHaveLength(0);
    expect(tmpEntries()).toEqual([]);
  });

  it("a dump that dies halfway (the connection drops mid-stream) leaves nothing on disk either", async () => {
    const w = await world();
    const real = Client.prototype.query as unknown as (...a: unknown[]) => Promise<unknown>;
    let n = 0;
    vi.spyOn(Client.prototype as unknown as { query: (...a: unknown[]) => Promise<unknown> }, "query").mockImplementation(function (this: Client, ...args: unknown[]) {
      // let the snapshot and the table list through, then fail on the first cursor
      if (typeof args[0] === "string" && args[0].startsWith("DECLARE") && ++n === 3) return Promise.reject(Object.assign(new Error("server closed the connection"), { code: "57P01" }));
      return real.apply(this, args);
    });
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    const [run] = await runsOf(w.org.id);
    expect(run?.status).toBe("FAILED");
    expect(run?.errorKey).toBe("backup.err.dump_failed");
    expect(run?.errorDetail).toBe("pg.57P01");
    expect(fake.uploads).toHaveLength(0);
    expect(tmpEntries()).toEqual([]);
  });
});

describe("Drive and the key", () => {
  it("Drive not connected: a failed run with the reason, and NOTHING written to the server's disk", async () => {
    const w = await world();
    fake.isReady = false;
    await loginAs(w.owner.id);
    expect((await runNow()).status).toBe(202);
    await settleBackupsForTests();
    const [run] = await runsOf(w.org.id);
    expect(run?.status).toBe("FAILED");
    expect(run?.errorKey).toBe("backup.err.drive_not_connected");
    expect(fake.uploads).toHaveLength(0);
    // not even a temp folder was made: the check for Drive comes before the first byte
    expect(tmpEntries()).toEqual([]);
    const screen = (await status()).json as { driveReady: boolean; freshness: string };
    expect(screen.driveReady).toBe(false);
    expect(screen.freshness).toBe("never");
  });

  it("a Drive that vanishes mid-run (the token revoked) is also «not connected»", async () => {
    const w = await world();
    fake.uploadError = new DriveStoreError("upload_no_connection");
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    expect((await runsOf(w.org.id))[0]?.errorKey).toBe("backup.err.drive_not_connected");
    expect(tmpEntries()).toEqual([]);
  });

  it("without ENCRYPTION_KEY the button is refused (403), nothing is recorded, and AUTH_SECRET is never used instead", async () => {
    const w = await world();
    delete process.env["ENCRYPTION_KEY"];
    expect(process.env["AUTH_SECRET"]).toBeTruthy();
    await loginAs(w.owner.id);
    const res = await runNow();
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("backup.err.no_key");
    expect(await runsOf(w.org.id)).toEqual([]);
    // the screen says why
    const screen = (await status()).json as { keyConfigured: boolean };
    expect(screen.keyConfigured).toBe(false);
    // a key shorter than the boot check allows counts as no key
    process.env["ENCRYPTION_KEY"] = "too-short";
    expect((await runNow()).status).toBe(403);
    // and the scheduler does nothing without it
    const jobs = await runDueJobs(new Date("2026-11-11T09:00:00Z"));
    expect(jobs.backups?.started).toBe(0);
    expect(await runsOf(w.org.id)).toEqual([]);
  });
});

describe("who may", () => {
  it("only the OWNER: an admin, a member and a guest get 403 on every door", async () => {
    const w = await world();
    // make a run so the verify door has something to refuse
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    const [run] = await runsOf(w.org.id);
    for (const who of [w.admin, w.member, w.guest]) {
      await loginAs(who.id);
      for (const res of [
        await status(),
        await call(statusRoute.PUT, { method: "PUT", url: URL_BASE, body: { hour: 4, daily: 14, weekly: 4 } }),
        await runNow(),
        await verify(run?.id as string),
      ]) {
        expect(res.status, `${who.name}: ${res.text}`).toBe(403);
        expect(res.json?.["message"]).toBe("backup.owner_only");
      }
    }
    expect(await runsOf(w.org.id)).toHaveLength(1);
    // nobody who is not signed in either
    logout();
    expect((await status()).status).toBe(401);
  });

  it("a space administrator and a person holding «الربط والأتمتة» are still not the owner", async () => {
    const w = await world();
    await grantCapabilities(w.org.id, w.member.id, ["integrations.manage"]);
    await loginAs(w.member.id);
    expect((await status()).status).toBe(403);
    expect((await runNow()).status).toBe(403);
  });

  it("only the company that owns the installation: a later company is refused, and the owner of the first is not affected", async () => {
    const first = await world();
    const later = await makeTeam();
    await setSwitch(later.org.id, true);
    await loginAs(later.owner.id);
    const screen = (await status()).json as { eligible: boolean };
    expect(screen.eligible).toBe(false);
    const res = await runNow();
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("backup.err.not_installation");
    const put = await call(statusRoute.PUT, { method: "PUT", url: URL_BASE, body: { hour: 4, daily: 14, weekly: 4 } });
    expect(put.status).toBe(403);
    expect(await runsOf(later.org.id)).toEqual([]);
    // the scheduler never copies for it, even with its switch on
    const jobs = await runDueJobs(new Date("2026-11-11T09:00:00Z"));
    await settleBackupsForTests();
    expect(await runsOf(later.org.id)).toEqual([]);
    expect(jobs.backups?.started).toBe(1);
    expect(await runsOf(first.org.id)).toHaveLength(1);
  });

  it("the switch is OFF by default: the button, the settings and the check answer «not found», the history still shows", async () => {
    const w = await world({ on: false });
    await loginAs(w.owner.id);
    const screen = await status();
    expect(screen.status).toBe(200);
    expect((screen.json as { switchOn: boolean }).switchOn).toBe(false);
    expect((await runNow()).status).toBe(404);
    expect((await call(statusRoute.PUT, { method: "PUT", url: URL_BASE, body: { hour: 4, daily: 14, weekly: 4 } })).status).toBe(404);
    // the scheduler makes nothing
    const jobs = await runDueJobs(new Date("2026-11-11T09:00:00Z"));
    expect(jobs.backups?.started).toBe(0);
    expect(await runsOf(w.org.id)).toEqual([]);
    // turned on, it works
    await setSwitch(w.org.id, true);
    expect((await runNow()).status).toBe(202);
    await settleBackupsForTests();
  });

  it("the settings are checked: an hour from 0 to 23, 1 to 60 days, 0 to 26 weeks", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const put = (body: unknown) => call(statusRoute.PUT, { method: "PUT", url: URL_BASE, body });
    expect((await put({ hour: 24, daily: 14, weekly: 4 })).status).toBe(422);
    expect((await put({ hour: 3, daily: 0, weekly: 4 })).status).toBe(422);
    expect((await put({ hour: 3, daily: 14, weekly: 27 })).status).toBe(422);
    expect((await put({ hour: 3.5, daily: 14, weekly: 4 })).status).toBe(422);
    const ok = await put({ hour: 22, daily: 7, weekly: 2 });
    expect(ok.status).toBe(200);
    expect(((await status()).json as { config: unknown }).config).toEqual({ hour: 22, daily: 7, weekly: 2 });
    // every other setting of the company is kept
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    expect((org.settings as { features: { dbBackup: boolean } }).features.dbBackup).toBe(true);
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "backup.config" } })).toBe(1);
  });
});

describe("one copy at a time", () => {
  it("a second press while one runs is 409, and exactly one run is made", async () => {
    const w = await world();
    let open!: () => void;
    fake.gate = new Promise<void>((resolve) => (open = resolve));
    await loginAs(w.owner.id);
    expect((await runNow()).status).toBe(202);
    const second = await runNow();
    expect(second.status).toBe(409);
    expect(second.json?.["message"]).toBe("backup.err.already_running");
    expect(((await status()).json as { running: boolean }).running).toBe(true);
    open();
    await settleBackupsForTests();
    expect(await runsOf(w.org.id)).toHaveLength(1);
    // and it can start again once the first is done
    fake.gate = null;
    expect((await runNow()).status).toBe(202);
    await settleBackupsForTests();
    expect(await runsOf(w.org.id)).toHaveLength(2);
  });

  it("two claims made at the same instant make one run", async () => {
    const w = await world();
    let open!: () => void;
    fake.gate = new Promise<void>((resolve) => (open = resolve));
    const results = await Promise.allSettled([
      startBackup({ orgId: w.org.id, trigger: "SCHEDULED", requestedById: null }),
      startBackup({ orgId: w.org.id, trigger: "SCHEDULED", requestedById: null }),
      startBackup({ orgId: w.org.id, trigger: "MANUAL", requestedById: w.owner.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    open();
    await settleBackupsForTests();
    expect(await runsOf(w.org.id)).toHaveLength(1);
  });

  it("a run found still «running» long after it began is marked failed (it died with its process), and the next can start", async () => {
    const w = await world();
    const dead = await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "SCHEDULED", status: "RUNNING", startedAt: new Date(Date.now() - 3 * 3_600_000) } });
    const fresh = await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "MANUAL", status: "RUNNING", startedAt: new Date(Date.now() - 60_000) } });
    expect(await sweepStaleRuns(new Date())).toBe(1);
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: dead.id } })).errorKey).toBe("backup.err.interrupted");
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe("FAILED");
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("RUNNING");
    expect(await db.auditLog.count({ where: { target: dead.id, action: "backup.run" } })).toBe(1);
  });
});

describe("the schedule, in the company's zone", () => {
  /** Damascus is UTC+3: 00:10 UTC is 03:10 there. */
  const tick = async (iso: string) => {
    const jobs = await runDueJobs(new Date(iso));
    await settleBackupsForTests();
    return jobs.backups;
  };

  it("makes one copy a day, after the hour, never before it, never twice", async () => {
    const w = await world();
    expect((await tick("2026-11-10T22:30:00Z"))?.started).toBe(0); // 01:30 on the 11th in Damascus: not yet
    expect((await tick("2026-11-11T00:10:00Z"))?.started).toBe(1); // 03:10
    const [first] = await runsOf(w.org.id);
    expect(first?.status).toBe("SUCCESS");
    expect(first?.trigger).toBe("SCHEDULED");
    expect(first?.requestedById).toBeNull();
    expect((await tick("2026-11-11T00:40:00Z"))?.started).toBe(0); // the same day
    expect((await tick("2026-11-11T15:00:00Z"))?.started).toBe(0); // evening, still the same day
    expect((await tick("2026-11-12T00:10:00Z"))?.started).toBe(1); // the next day
    expect(await runsOf(w.org.id)).toHaveLength(2);
    expect(fake.uploads).toHaveLength(2);
  });

  it("follows the hour the owner chose", async () => {
    const w = await world();
    await saveBackupConfig(await actorOf(w.owner.id), { hour: 22, daily: 14, weekly: 4 });
    expect((await tick("2026-11-11T18:00:00Z"))?.started).toBe(0); // 21:00 in Damascus
    expect((await tick("2026-11-11T19:30:00Z"))?.started).toBe(1); // 22:30
  });

  it("a failed attempt is retried after 3 hours, and only three times in a day", async () => {
    const w = await world();
    fake.isReady = false;
    expect((await tick("2026-11-11T00:10:00Z"))?.started).toBe(1);
    expect((await tick("2026-11-11T00:40:00Z"))?.started).toBe(0); // too soon
    expect((await tick("2026-11-11T03:11:00Z"))?.started).toBe(1);
    expect((await tick("2026-11-11T06:12:00Z"))?.started).toBe(1);
    expect((await tick("2026-11-11T09:13:00Z"))?.started).toBe(0); // three failures: enough for today
    const runs = await runsOf(w.org.id);
    expect(runs.map((r) => r.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
    // Drive is back: the owner's button works, and the next day the schedule does too
    fake.isReady = true;
    expect((await tick("2026-11-12T00:10:00Z"))?.started).toBe(1);
    expect((await runsOf(w.org.id)).at(-1)?.status).toBe("SUCCESS");
  });
});

describe("retention", () => {
  it("after a good copy, the old ones the rule retires are removed from Drive and marked; the rest stay", async () => {
    const w = await world();
    const owner = await actorOf(w.owner.id);
    await saveBackupConfig(owner, { hour: 3, daily: 3, weekly: 1 });
    const now = Date.now();
    const old = [];
    for (let i = 1; i <= 20; i++) {
      old.push(
        await db.backupRun.create({
          data: { organizationId: w.org.id, trigger: "SCHEDULED", status: "SUCCESS", startedAt: new Date(now - i * 86_400_000), finishedAt: new Date(now - i * 86_400_000 + 60_000), driveFileId: `old-${i}`, sizeBytes: BigInt(10) },
        }),
      );
    }
    // a failed run and one whose file is gone are not part of the retention
    await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "SCHEDULED", status: "FAILED", startedAt: new Date(now - 30 * 86_400_000), errorKey: "backup.err.drive_failed" } });
    await runBackupNow(owner).then((r) => r.done);
    const after = await runsOf(w.org.id);
    const fresh = after.find((r) => r.driveFileId === "fake-1");
    expect(fresh?.status).toBe("SUCCESS");
    expect(fresh?.prunedAt).toBeNull();

    const expected = selectBackupsToDelete(
      [...old.map((r) => ({ id: r.id, startedAt: r.startedAt })), { id: fresh?.id as string, startedAt: fresh?.startedAt as Date }],
      { zone: "Asia/Damascus", daily: 3, weekly: 1 },
    );
    expect(expected.length).toBeGreaterThan(10);
    expect(expected).not.toContain(fresh?.id);
    const pruned = after.filter((r) => r.prunedAt !== null).map((r) => r.id);
    expect(pruned.sort()).toEqual([...expected].sort());
    // Drive was asked to delete exactly those files
    expect(fake.removed.sort()).toEqual(old.filter((r) => expected.includes(r.id)).map((r) => r.driveFileId as string).sort());
    // the newest three days and the new copy are still there
    expect(after.filter((r) => r.status === "SUCCESS" && r.prunedAt === null).length).toBeGreaterThanOrEqual(4);
  });

  it("a failed copy removes nothing (an old copy is only retired by a new good one)", async () => {
    const w = await world();
    const owner = await actorOf(w.owner.id);
    await saveBackupConfig(owner, { hour: 3, daily: 1, weekly: 0 });
    for (let i = 1; i <= 5; i++) {
      await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "SCHEDULED", status: "SUCCESS", startedAt: new Date(Date.now() - i * 86_400_000), driveFileId: `old-${i}` } });
    }
    fake.uploadError = new DriveStoreError("upload_start", 500);
    await runBackupNow(owner).then((r) => r.done);
    expect(fake.removed).toEqual([]);
    expect(await db.backupRun.count({ where: { organizationId: w.org.id, prunedAt: { not: null } } })).toBe(0);
  });

  it("a file Drive refuses to delete stays on the list and is tried again after the next good copy", async () => {
    const w = await world();
    const owner = await actorOf(w.owner.id);
    await saveBackupConfig(owner, { hour: 3, daily: 1, weekly: 0 });
    await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "SCHEDULED", status: "SUCCESS", startedAt: new Date(Date.now() - 2 * 86_400_000), driveFileId: "stubborn" } });
    const real = fake.remove.bind(fake);
    fake.remove = async () => {
      throw new DriveStoreError("delete", 500);
    };
    await runBackupNow(owner).then((r) => r.done);
    expect(await db.backupRun.count({ where: { organizationId: w.org.id, prunedAt: { not: null } } })).toBe(0);
    fake.remove = real;
    await db.backupRun.deleteMany({ where: { organizationId: w.org.id, driveFileId: "fake-1" } });
    await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "SCHEDULED", status: "SUCCESS", startedAt: new Date(Date.now() - 3_600_000), driveFileId: "newest" } });
    await runBackupNow(owner).then((r) => r.done);
    expect(fake.removed).toContain("stubborn");
  });
});

describe("«تحقّق»", () => {
  async function oneCopy() {
    const w = await world();
    await loginAs(w.owner.id);
    await runNow();
    await settleBackupsForTests();
    const [run] = await runsOf(w.org.id);
    return { w, run: run as NonNullable<typeof run> };
  }

  it("opens the copy from Drive, counts its tables and rows, and keeps the verdict on the run", async () => {
    const { w, run } = await oneCopy();
    const res = await verify(run.id);
    expect(res.status, res.text).toBe(200);
    const after = await db.backupRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.verifyOk).toBe(true);
    expect(after.verifyTables).toBe(run.tableCount);
    expect(after.verifyRows).toBe(run.rowCount);
    expect(after.verifyErrorKey).toBeNull();
    expect(after.verifiedAt).not.toBeNull();
    const audit = await db.auditLog.findFirst({ where: { orgId: w.org.id, action: "backup.verify" } });
    expect(audit?.meta).toEqual({ outcome: "OK" });
  });

  it("a wrong key, a flipped byte and a vanished file each say so", async () => {
    const { run } = await oneCopy();
    // a key that is not the one the copy was made with
    process.env["ENCRYPTION_KEY"] = "another-key-0123456789-abcdefghijklmnop";
    expect((await verify(run.id)).status).toBe(200);
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: run.id } })).verifyErrorKey).toBe("backup.err.verify_key");
    process.env["ENCRYPTION_KEY"] = KEY;

    const original = fake.files.get("fake-1") as Buffer;
    const bad = Buffer.from(original);
    bad[Math.floor(bad.length / 2)] = (bad[Math.floor(bad.length / 2)] as number) ^ 0x01;
    fake.files.set("fake-1", bad);
    await verify(run.id);
    let row = await db.backupRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.verifyOk).toBe(false);
    expect(row.verifyErrorKey).toBe("backup.err.verify_key");
    expect(row.verifyTables).toBeNull();

    fake.files.set("fake-1", original.subarray(0, original.length - 40));
    await verify(run.id);
    row = await db.backupRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.verifyOk).toBe(false);

    fake.files.delete("fake-1");
    await verify(run.id);
    row = await db.backupRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.verifyErrorKey).toBe("backup.err.verify_missing");
    // and a good file verifies again
    fake.files.set("fake-1", original);
    await verify(run.id);
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: run.id } })).verifyOk).toBe(true);
  });

  it("only a good copy still on Drive, of this company, can be verified", async () => {
    const { w, run } = await oneCopy();
    const failed = await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "MANUAL", status: "FAILED", errorKey: "backup.err.drive_failed" } });
    const pruned = await db.backupRun.create({ data: { organizationId: w.org.id, trigger: "MANUAL", status: "SUCCESS", driveFileId: "gone", prunedAt: new Date() } });
    for (const id of [failed.id, pruned.id, "nope"]) expect((await verify(id)).status).toBe(404);
    // another company's owner cannot reach this one's copy
    const other = await makeTeam();
    await setSwitch(other.org.id, true);
    await loginAs(other.owner.id);
    expect((await verify(run.id)).status).toBe(404);
  });
});

describe("the dump restores into a NEW empty database", () => {
  it("every table comes back identical, awkward text, arrays and JSON included", async () => {
    const w = await world();
    // awkward values: quotes, backslashes, a newline, a comment marker, Arabic, an emoji, a lone brace
    await makeUser({ orgId: w.org.id, name: "It's a \\ test\n-- not a comment {\"x\":1} — «عربي» 😀" });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { note: "it's \"quoted\" \\ and\nmulti-line", n: 1.5, list: [1, "two", null] } } });
    await setSwitch(w.org.id, true);

    const url = process.env["DATABASE_URL"] as string;
    const source = new Client({ connectionString: directPgUrl(url) });
    await source.connect();
    const stats = { tables: 0, rows: 0 };
    const chunks: string[] = [];
    try {
      for await (const piece of dumpDatabase(source, stats)) chunks.push(piece);
    } finally {
      await source.end();
    }
    const sql = chunks.join("");
    expect(stats.tables).toBeGreaterThan(50);
    expect(sql.endsWith("-- complete\n")).toBe(true);

    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    const name = `zaki_restore_${Date.now().toString(36)}`;
    const targetUrl = new URL(url);
    targetUrl.pathname = `/${name}`;
    const admin = new Client({ connectionString: directPgUrl(adminUrl.toString()) });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    try {
      // the guide's steps 5 and 6: the schema from the migrations, then the data from the script
      execFileSync(process.execPath, [path.resolve(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: targetUrl.toString() },
        stdio: "pipe",
      });
      const target = new Client({ connectionString: directPgUrl(targetUrl.toString()) });
      await target.connect();
      const src = new Client({ connectionString: directPgUrl(url) });
      await src.connect();
      try {
        await target.query(sql);
        const tables = (await src.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`)).rows.map((r) => r.t);
        const fingerprint = (c: Client, t: string) =>
          c.query<{ n: number; h: string }>(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`).then((r) => r.rows[0]);
        const mismatches: string[] = [];
        let total = 0;
        for (const t of tables) {
          const [a, b] = await Promise.all([fingerprint(src, t), fingerprint(target, t)]);
          total += a?.n ?? 0;
          if (a?.n !== b?.n || a?.h !== b?.h) mismatches.push(`${t}: ${a?.n} rows vs ${b?.n}`);
        }
        expect(mismatches).toEqual([]);
        expect(total).toBe(stats.rows);
        // the awkward user really is there, character for character
        const back = await target.query<{ name: string }>(`SELECT name FROM "User" WHERE name LIKE 'It''s a%'`);
        expect(back.rows[0]?.name).toBe("It's a \\ test\n-- not a comment {\"x\":1} — «عربي» 😀");
      } finally {
        await target.end();
        await src.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 240_000);
});
