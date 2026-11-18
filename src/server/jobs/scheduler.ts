import { Client } from "pg";
import { bootWarnings, env, jobsInWorker } from "@/server/env";
import { log } from "@/server/log";
import { directPgUrl } from "@/server/realtime/listener";
import { runDueJobs, type JobsRun } from "./run";
import { runOmsDailyCard } from "./oms-daily-card";

/**
 * THE JOB RUNNER. Background work runs INSIDE the app process by default: `instrumentation.ts` starts this once per server
 * process; every 30 seconds it calls `runDueJobs(now)`.
 *
 * F1.9 (D-F1): with `JOBS_IN_WORKER=1` (src/server/env.ts) the app stops scheduling and the compose `worker` service does it
 * instead (`runJobsWorker` below), so the backup, the mailbox, the embeddings and the orders sync no longer share the event loop
 * with the live streams and the API. The variable is unset by default: nothing changes until the owner sets it.
 *
 * Guard: a PostgreSQL ADVISORY LOCK (`pg_try_advisory_lock`) on a connection of its own. With two app processes only the
 * one holding the lock works that tick; the other skips silently. The lock belongs to the connection, so it is dropped
 * the moment the process dies (or the connection does) and the other process takes over on its next tick. The jobs are
 * idempotent anyway, so the lock is for economy, never for correctness.
 *
 * Never during `next build`, never in tests (`NEXT_PHASE`, `NODE_ENV=test`, `VITEST`): a test calls `runDueJobs(now)`
 * or `tickJobs(now)` itself.
 */

/** Any constant bigint, different from the purge job's (src/server/realtime/hub.ts). */
export const JOBS_LOCK_KEY = 742272;
export const JOBS_INTERVAL_MS = 30_000;
/** A tick that has not finished by now is abandoned: its connection is closed, which drops the lock. */
const TICK_TIMEOUT_MS = 5 * 60_000;

/**
 * Who schedules: the web process unless the worker has taken the jobs over, the worker only when it has. With both running
 * for a moment (the switch is flipped on one service before the other restarts) the advisory lock still lets one tick
 * work, and every job is idempotent, so the overlap is harmless.
 */
export function jobsRunHere(role: "web" | "worker", jobsInWorker: boolean): boolean {
  return role === "worker" ? jobsInWorker : !jobsInWorker;
}

/** May the scheduler run in this process? Not while building, not in a test. */
export function schedulerAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NEXT_PHASE"] === "phase-production-build") return false;
  if (env["NODE_ENV"] === "test" || env["VITEST"]) return false;
  return true;
}

/**
 * One tick: take the lock, run what is due, release. Returns null when another process holds the lock (or the
 * database cannot be reached: logged), otherwise what ran.
 */
export async function tickJobs(now: Date = new Date()): Promise<JobsRun | null> {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  const client = new Client({ connectionString: directPgUrl(url) });
  // an idle connection that drops must never be an unhandled 'error' event (that would take the whole process down)
  client.on("error", (err) => log.warn("jobs.lock_connection_error", { message: err.message }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await client.connect();
    const locked = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [JOBS_LOCK_KEY]);
    if (!locked.rows[0]?.locked) return null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("jobs tick timed out")), TICK_TIMEOUT_MS);
      timer.unref?.();
    });
    // I1.1a: the daily numbers card of the orders system's events runs in the same tick, under the same lock (its own failure never fails the tick)
    const work = async (): Promise<JobsRun> => {
      const run = await runDueJobs(now);
      try {
        await runOmsDailyCard(now);
      } catch (err) {
        log.error("jobs.failed", { job: "omsDailyCard", message: err instanceof Error ? err.message : String(err) });
      }
      return run;
    };
    return await Promise.race([work(), timeout]);
  } catch (err) {
    log.error("jobs.tick_failed", { message: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    // closing the connection drops the session lock whether or not the explicit unlock got through
    await client.query("SELECT pg_advisory_unlock($1)", [JOBS_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __zkJobsTimer: ReturnType<typeof setInterval> | undefined;
}

/**
 * Starts the loop (once per process, even when Next loads this module twice). A job that throws never stops it.
 * `role` is where this process runs: the app (the default) or the worker; `JOBS_IN_WORKER` decides which of them schedules.
 */
export function startJobRunner(role: "web" | "worker" = "web"): boolean {
  if (!schedulerAllowed() || globalThis.__zkJobsTimer) return false;
  if (!jobsRunHere(role, jobsInWorker())) return false;
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    void tickJobs()
      .catch((err) => log.error("jobs.loop_failed", { message: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        busy = false;
      });
  };
  globalThis.__zkJobsTimer = setInterval(run, JOBS_INTERVAL_MS);
  globalThis.__zkJobsTimer.unref?.();
  // the first tick shortly after boot (boot is busy), not immediately
  setTimeout(run, 10_000).unref?.();
  return true;
}

/**
 * The entry of the compose `worker` service (`docker-compose.yml`): the same image and the same environment as the app.
 * It validates that environment first (a worker without `DATABASE_URL` or `AUTH_SECRET` fails at once with the key's name),
 * logs the same production warnings as the app (`boot.encryption_key_missing`: the key is optional, but without it the
 * backup job refuses to run and a stored mailbox password cannot be read), starts the scheduler when `JOBS_IN_WORKER` is
 * on, and keeps a one-minute heartbeat that proves the database connection (it is what keeps the process alive: the
 * scheduler's own timers do not).
 */
export async function runJobsWorker(): Promise<void> {
  const settings = env();
  const { db } = await import("@/server/db");
  for (const key of bootWarnings()) console.warn(JSON.stringify({ event: key, level: "warn", where: "worker" }));
  const jobs = startJobRunner("worker");
  console.log(JSON.stringify({ event: "worker.start", jobsInWorker: settings.JOBS_IN_WORKER, jobsStarted: jobs }));
  if (!settings.JOBS_IN_WORKER) {
    console.log(JSON.stringify({ event: "worker.idle", detail: "JOBS_IN_WORKER is off: the app process runs the jobs" }));
  }
  const beat = async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      console.log(JSON.stringify({ event: "worker.tick", jobsInWorker: settings.JOBS_IN_WORKER }));
    } catch (err) {
      console.error(JSON.stringify({ event: "worker.tick_error", message: err instanceof Error ? err.message : String(err) }));
    }
  };
  await beat();
  setInterval(() => void beat(), 60_000);
}

/** Test hook: stop the loop (never call from server code). */
export function stopJobRunnerForTests(): void {
  if (globalThis.__zkJobsTimer) clearInterval(globalThis.__zkJobsTimer);
  globalThis.__zkJobsTimer = undefined;
}
