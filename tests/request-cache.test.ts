import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F1.1 / F1.2 (= C1.9) the per-request memo, F1.8 one Prisma client, F1.9 the jobs in the worker.
 * The database half of F1.1 is tests/db/layout-calls.test.ts (counted calls); this file pins the rules that need no database.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("react");
  vi.doUnmock("@prisma/client");
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;
  delete (globalThis as { __zkJobsTimer?: unknown }).__zkJobsTimer;
});

describe("perRequest (src/server/env.ts) is React's cache() where there is a request, and the plain function where there is none", () => {
  it("without React's cache (a script, the worker, a test) every call runs the function", async () => {
    vi.resetModules();
    const { perRequest } = await import("@/server/env");
    let n = 0;
    const f = perRequest(async (id: string) => `${id}:${(n += 1)}`);
    expect(await f("a")).toBe("a:1");
    expect(await f("a")).toBe("a:2");
  });

  it("with React's cache() the answer is kept for as long as that cache says (one request), and the key is the arguments", async () => {
    let memory = new Map<string, unknown>();
    const fakeCache = <F extends (...args: never[]) => unknown>(fn: F): F =>
      ((...args: unknown[]) => {
        const key = JSON.stringify(args);
        if (!memory.has(key)) memory.set(key, fn(...(args as never[])));
        return memory.get(key);
      }) as unknown as F;
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      const base = ((actual as { default?: typeof actual }).default ?? actual) as typeof actual;
      return { ...base, default: { ...base, cache: fakeCache }, cache: fakeCache };
    });
    const { perRequest } = await import("@/server/env");
    let n = 0;
    const f = perRequest(async (id: string) => `${id}:${(n += 1)}`);
    expect(await f("a")).toBe("a:1");
    expect(await f("a")).toBe("a:1");
    expect(await f("b")).toBe("b:2");
    memory = new Map(); // the next request
    expect(await f("a")).toBe("a:3");
  });
});

describe("the request scope really exists where Next renders (a silent fallback would undo F1.1 without any error)", () => {
  it("Next's own React (the one a server component gets) exports cache()", () => {
    const serverReact = require("next/dist/compiled/react/react.react-server") as { cache?: unknown };
    expect(typeof serverReact.cache).toBe("function");
  });
});

describe("what is wrapped, and that nothing is remembered between requests", () => {
  const SPOTS: Array<[string, string[]]> = [
    ["src/server/auth.ts", ["currentUser", "pageUser"]],
    ["src/server/policy/actor.ts", ["actorOf"]],
    ["src/app/(app)/_access.tsx", ["pageActor"]],
    ["src/server/services/current-space.ts", ["spacesFor", "spaceFor"]],
    ["src/server/services/features.ts", ["orgSummaryOf"]],
  ];

  it.each(SPOTS)("%s wraps %j in perRequest()", (file, names) => {
    const src = read(file);
    expect(src).toMatch(/import \{[^}]*\bperRequest\b[^}]*\} from "(?:@\/server\/|\.\/)env"/);
    for (const name of names) expect(src, `${file}: ${name}`).toMatch(new RegExp(`\\b${name}\\b[^\\n]*=\\s*perRequest\\(`));
  });

  it("none of them keeps a user, a rank or a switch in module memory (a module-level Map/Set/let is a leak between requests)", () => {
    for (const [file] of SPOTS) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // module level = no indentation
      expect(code, file).not.toMatch(/^(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::[^=\n]+)?=\s*new (?:Map|Set|WeakMap)\b/m);
      expect(code, file).not.toMatch(/^let\s+\w+/m);
    }
  });

  it("requireActor keeps its signature and its order: the person is checked (onboarding) before the membership is read", () => {
    const src = read("src/server/policy/actor.ts");
    const body = src.slice(src.indexOf("export async function requireActor"));
    expect(body.indexOf("requireUser(opts)")).toBeGreaterThan(0);
    expect(body.indexOf("requireUser(opts)")).toBeLessThan(body.indexOf("actorOf("));
  });

  it("the layout reads its independent facts together", () => {
    const src = read("src/app/(app)/layout.tsx");
    expect(src).toMatch(/Promise\.all\(\[[\s\S]*orgSummaryOf[\s\S]*currentSpace[\s\S]*hasActiveReports[\s\S]*\]\)/);
    // the company is read by the cached reader the switches share, not by a private query
    expect(src).not.toMatch(/db\.organization\.findUnique/);
  });
});

describe("F1.8 one Prisma client per process, in production too", () => {
  it("the client is pinned to globalThis whatever NODE_ENV says", () => {
    const src = read("src/server/db.ts");
    expect(src).not.toMatch(/NODE_ENV/);
    expect(src).toMatch(/globalThis\.prisma = db/);
  });

  it("a module evaluated twice in production builds ONE client", async () => {
    let built = 0;
    vi.stubEnv("NODE_ENV", "production");
    vi.doMock("@prisma/client", () => ({
      PrismaClient: class {
        constructor() {
          built += 1;
        }
      },
    }));
    vi.resetModules();
    const first = await import("@/server/db");
    vi.resetModules();
    const second = await import("@/server/db");
    expect(built).toBe(1);
    expect(second.db).toBe(first.db);
  });

  it("connection_limit is documented in .env.example and in the README table", () => {
    expect(read(".env.example")).toMatch(/connection_limit=\d+/);
    const readme = read("README.md");
    const row = readme.split("\n").find((l) => l.startsWith("| `DATABASE_URL`")) ?? "";
    expect(row).toContain("connection_limit");
  });
});

describe("F1.9 the jobs can run in the worker service (JOBS_IN_WORKER), the default is unchanged", () => {
  async function loadEnv(value: string | undefined) {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost:5432/z");
    vi.stubEnv("AUTH_SECRET", "test-secret-at-least-16-chars");
    if (value === undefined) delete process.env["JOBS_IN_WORKER"];
    else vi.stubEnv("JOBS_IN_WORKER", value);
    return import("@/server/env");
  }

  it("unset, blank and 0 mean the app keeps scheduling (today's behaviour)", async () => {
    for (const v of [undefined, "", "  ", "0", "false"]) expect((await loadEnv(v)).env().JOBS_IN_WORKER, String(v)).toBe(false);
  });

  it("1 (or true) moves it to the worker", async () => {
    for (const v of ["1", "true"]) expect((await loadEnv(v)).env().JOBS_IN_WORKER, v).toBe(true);
  });

  it("anything else stops the boot with the variable's name (a typo must not silently leave the jobs nowhere)", async () => {
    const { env } = await loadEnv("yes");
    expect(() => env()).toThrow(/JOBS_IN_WORKER/);
  });

  it("the scheduler reads the flag on its own, without validating the rest of the environment, and never throws", async () => {
    vi.resetModules();
    const { jobsInWorker } = await import("@/server/env");
    expect(jobsInWorker({} as NodeJS.ProcessEnv)).toBe(false);
    expect(jobsInWorker({ JOBS_IN_WORKER: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(jobsInWorker({ JOBS_IN_WORKER: " TRUE " } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(jobsInWorker({ JOBS_IN_WORKER: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    // a typo is refused at boot by env(); here it must not take the scheduler down with it
    expect(jobsInWorker({ JOBS_IN_WORKER: "yes" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("who schedules: the app unless the worker has the jobs, the worker only when it has them", async () => {
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: {} }));
    const { jobsRunHere } = await import("@/server/jobs/scheduler");
    expect(jobsRunHere("web", false)).toBe(true);
    expect(jobsRunHere("web", true)).toBe(false);
    expect(jobsRunHere("worker", false)).toBe(false);
    expect(jobsRunHere("worker", true)).toBe(true);
    vi.doUnmock("@/server/db");
    // the scheduler pulls in every job: loading it fresh takes a while
  }, 30_000);

  it("the web process asks the same question at boot, and says so when the jobs live elsewhere", () => {
    const hook = read("src/instrumentation.ts");
    expect(hook).toContain("startJobRunner()");
    expect(hook).toContain("JOBS_IN_WORKER");
    expect(hook).toContain("boot.jobs_in_worker");
  });

  it("the compose worker runs the scheduler entry and gets the app's whole environment; the app and the worker get the same switch", () => {
    const compose = read("docker-compose.yml");
    const worker = compose.slice(compose.indexOf("  worker:"), compose.indexOf("  migrate:"));
    const app = compose.slice(compose.indexOf("  app:"), compose.indexOf("  worker:"));
    expect(worker).toContain("runJobsWorker");
    for (const key of ["DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY", "APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "UPLOAD_DIR"]) {
      expect(worker, `worker: ${key}`).toMatch(new RegExp(`^\\s+${key}:`, "m"));
    }
    expect(worker).toMatch(/JOBS_IN_WORKER: \$\{JOBS_IN_WORKER:-\}/);
    expect(app).toMatch(/JOBS_IN_WORKER: \$\{JOBS_IN_WORKER:-\}/);
  });

  it("the variable is documented in .env.example and in the README table, with the warning", () => {
    expect(read(".env.example")).toMatch(/^#?\s*JOBS_IN_WORKER=/m);
    const row = read("README.md").split("\n").find((l) => l.startsWith("| `JOBS_IN_WORKER`")) ?? "";
    expect(row).toContain("⚠️");
    expect(row).toContain("🔧");
  });
});

beforeEach(() => {
  vi.resetModules();
});
