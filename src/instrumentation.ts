/**
 * Runs once when the server process boots (before serving any request).
 * Validates the environment contract eagerly so a misconfigured deployment
 * (e.g. missing AUTH_SECRET or DATABASE_URL on Coolify) fails LOUDLY at boot
 * with an exact key in the container logs — instead of every register/login
 * request dying with an opaque 500 "حدث خطأ. حاول مجددًا."
 *
 * Never logs secret values — only key names and validation messages.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { env, bootWarnings } = await import("./server/env");
    const e = env();
    console.log(
      JSON.stringify({
        event: "boot.env_ok",
        keys: Object.keys(e),
        authSecretLen: e.AUTH_SECRET.length,
      }),
    );
    for (const key of bootWarnings()) {
      console.warn(JSON.stringify({ event: key, level: "warn" }));
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "boot.env_invalid",
        // message contains only the failing key name and rule — never values
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
    // fail fast: a server that cannot mint sessions is worse than a down one
    process.exit(1);
  }

  // ---- Phase 3 realtime (additive; the env contract above is untouched) ----
  // Only a serving nodejs process: never during `next build`, never in Edge middleware.
  // Postgres LISTEN needs no listener at build time and the purge job must not run
  // under the build's temporary Prisma engines.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      const { ensureListener } = await import("./server/realtime/listener");
      const { startPurgeJob } = await import("./server/realtime/purge");
      void ensureListener();
      startPurgeJob();
      console.log(JSON.stringify({ event: "boot.realtime_started" }));
    } catch (err) {
      // The chat still works without realtime (the client falls back to polling);
      // a failed listener must not take the whole boot down.
      console.error(
        JSON.stringify({
          event: "boot.realtime_failed",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // ---- the in-app job runner («ذكّرني» and what follows) ----
  // A tiny scheduler: every 30 s `runDueJobs(now)` under a Postgres advisory lock (one process works, the others skip).
  // `startJobRunner` itself refuses during `next build` and in tests; a failure here never takes the boot down.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      const { startJobRunner } = await import("./server/jobs/scheduler");
      if (startJobRunner()) console.log(JSON.stringify({ event: "boot.jobs_started" }));
      // JOBS_IN_WORKER=1: the compose worker service runs them (F1.9); say so in the log, so "nothing runs the jobs" is never a mystery
      else if ((await import("./server/env")).env().JOBS_IN_WORKER) console.log(JSON.stringify({ event: "boot.jobs_in_worker" }));
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "boot.jobs_failed",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}