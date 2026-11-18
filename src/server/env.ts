import * as React from "react";
import { z } from "zod";

/**
 * A memo that lives for ONE server render (one request), never longer: React's `cache()`.
 *
 * Next gives a server-component render a request scope for `cache()`; outside one (a route handler, a server action, the
 * worker, a script, a test) React has no scope and calls the function every time, so nothing is ever remembered between
 * requests. The key is the ARGUMENTS COMPARED BY IDENTITY: wrap a function that takes primitives (`orgId`, `userId`),
 * never one that takes an object a caller builds afresh (an `opts` literal, an actor) - that would never hit.
 *
 * TRAP: this is the ONLY memo allowed around a user, a rank, a permission or a company's switches. A module-level
 * `Map` / `let` of any of them is shared by every request of the process: one person would be served another's answer.
 * (It lives in this file, which no test replaces, so that a test mocking `@/server/db` or `@/server/auth` still gets it.)
 */
export function perRequest<F extends (...args: never[]) => unknown>(fn: F): F {
  const reactCache = (React as unknown as { cache?: <T extends (...args: never[]) => unknown>(f: T) => T }).cache;
  return typeof reactCache === "function" ? reactCache(fn) : fn;
}

/**
 * A variable the platform passes as "" (Coolify does, and so does compose's `${VAR:-}`
 * when it is declared but empty) means "not set". Applied to EVERY optional variable so an
 * empty value falls back to the default instead of stopping the container at boot.
 * DATABASE_URL and AUTH_SECRET stay strict.
 */
const blankToUndefined = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? undefined : v);

const DEFAULT_APP_URL = "http://localhost:3000";

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** `https://x.io/` -> `https://x.io`, so `${APP_URL}/api/...` has exactly one slash. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The public URL of the app, normalised once here: trimmed, http(s) only, no trailing slash. */
const appUrlField = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isHttpUrl, "APP_URL must be a full http(s) URL such as https://your-domain.com")
    .default(DEFAULT_APP_URL)
    .transform(stripTrailingSlashes),
);

const HOURS_MESSAGE = "SESSION_TTL_HOURS must be a positive whole number of hours";
const HOPS_MESSAGE = "TRUSTED_PROXY_HOPS must be a whole number from 1 to 5 (how many reverse proxies sit in front of the app)";

const JOBS_MESSAGE = "JOBS_IN_WORKER must be 1 (the worker service runs the jobs) or 0 / empty (the app runs them, as before)";

/** `1` / `true` = on, `0` / `false` / empty = off; anything else is a typo that must not leave the jobs nowhere. */
const jobsInWorkerField = z.preprocess(
  (v) => {
    const b = blankToUndefined(v);
    return typeof b === "string" ? b.trim().toLowerCase() : b;
  },
  z
    .enum(["0", "1", "true", "false"], { errorMap: () => ({ message: JOBS_MESSAGE }) })
    .default("0")
    .transform((v) => v === "1" || v === "true"),
);

/**
 * Who runs the jobs, read on its own (the scheduler asks this and nothing else, so it never depends on the rest of the
 * environment being valid). A value `env()` would refuse reads as off: the boot has already stopped on it.
 */
export function jobsInWorker(source: NodeJS.ProcessEnv = process.env): boolean {
  const parsed = jobsInWorkerField.safeParse(source["JOBS_IN_WORKER"]);
  return parsed.success && parsed.data === true;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
  // Optional: key for secrets-at-rest (integration tokens), independent of AUTH_SECRET.
  // When present it must be strong: generate with `openssl rand -hex 32`. The message never
  // echoes the value.
  ENCRYPTION_KEY: z.preprocess(
    blankToUndefined,
    z.string().min(32, "ENCRYPTION_KEY must be at least 32 chars (openssl rand -hex 32)").optional(),
  ),
  SESSION_TTL_HOURS: z.preprocess(
    blankToUndefined,
    z.coerce.number({ invalid_type_error: HOURS_MESSAGE }).int(HOURS_MESSAGE).positive(HOURS_MESSAGE).default(168),
  ),
  APP_URL: appUrlField,
  // Any case is accepted (LOG_LEVEL=INFO is a common way to write it).
  LOG_LEVEL: z.preprocess(
    (v) => {
      const b = blankToUndefined(v);
      return typeof b === "string" ? b.trim().toLowerCase() : b;
    },
    z.enum(["debug", "info", "warn", "error"], { errorMap: () => ({ message: "LOG_LEVEL must be one of debug, info, warn, error" }) }).default("info"),
  ),
  // How many reverse proxies sit in front of the app (read by src/server/rate-limit.ts to find the client address).
  TRUSTED_PROXY_HOPS: z.preprocess(
    blankToUndefined,
    z.coerce.number({ invalid_type_error: HOPS_MESSAGE }).int(HOPS_MESSAGE).min(1, HOPS_MESSAGE).max(5, HOPS_MESSAGE).default(1),
  ),
  // F1.9 (D-F1): who runs the background jobs. Off (the default): the app process does, as it always has. On: only the
  // compose `worker` service does (src/server/jobs/scheduler.ts) and the app stops scheduling.
  JOBS_IN_WORKER: jobsInWorkerField,
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | undefined;

/** Validates env at startup; fails fast with the exact missing key . */
export function env(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * The public URL of the app (no trailing slash), normalised exactly like `env().APP_URL` but
 * read from the CURRENT process.env on every call, because `env()` is cached at first use.
 * Build every absolute link and redirect from this, never from the request's own URL: behind
 * a reverse proxy `req.url` is the bind host (https://localhost:3000), not where the user is.
 * Throws on an invalid value rather than guessing a host (boot validation already refuses it).
 */
export function appUrl(): string {
  const parsed = appUrlField.safeParse(process.env["APP_URL"]);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration -> APP_URL: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

/**
 * Settings that are VALID (so boot must not stop) but wrong for a production server. Returned as
 * stable keys; src/instrumentation.ts logs each one as a warning at boot. Never includes values.
 */
export function bootWarnings(source: NodeJS.ProcessEnv = process.env): string[] {
  if (source["NODE_ENV"] !== "production") return [];
  const warnings: string[] = [];
  const raw = (source["APP_URL"] ?? "").trim();
  let host = "";
  try {
    host = raw ? new URL(raw).hostname : "";
  } catch {
    host = "";
  }
  // A blank APP_URL silently becomes http://localhost:3000, and Google redirects, e-mailed links
  // and OAuth redirect URIs are built from it.
  if (!raw || host === "localhost" || host === "127.0.0.1" || host === "[::1]") warnings.push("boot.app_url_missing");
  // Without it, secrets stored in the database are still encrypted with a key derived from AUTH_SECRET.
  if (!(source["ENCRYPTION_KEY"] ?? "").trim()) warnings.push("boot.encryption_key_missing");
  return warnings;
}
