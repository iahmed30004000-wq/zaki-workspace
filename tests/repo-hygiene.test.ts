import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static repository hygiene. The repository is PUBLIC: these tests pin the things
 * that must never be in it, so a regression fails here and not in a security review.
 */

const ROOT = resolve(__dirname, "..");

/**
 * The demo owner password that used to be published in lg.json, README.md and
 * prisma/seed.ts. Assembled from halves so this file does not contain it.
 */
const DEMO_PASSWORD = ["owner", "1234"].join("");

const BINARY = /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp[34]|mov|webm|wasm)$/i;

/** Every file git knows about, plus new files that are not ignored (so an uncommitted leak is seen too). */
function repoFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split("\0").filter(Boolean))];
}

describe("the demo owner login is not published", () => {
  it("lg.json (a tracked file that held the login) does not exist", () => {
    expect(existsSync(join(ROOT, "lg.json"))).toBe(false);
  });

  it("no file in the repository contains the demo password", () => {
    const offenders: string[] = [];
    for (const file of repoFiles()) {
      if (BINARY.test(file)) continue;
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // tracked but deleted in the working tree
      }
      text.split(/\r?\n/).forEach((line, i) => {
        if (line.includes(DEMO_PASSWORD)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the seed does not carry a password literal and refuses production", () => {
    const seed = readFileSync(join(ROOT, "prisma", "seed.ts"), "utf8");
    expect(seed).not.toMatch(/hashPassword\(\s*["'`]/);
    expect(seed).toContain("assertSeedAllowed()");
    // the guard must run before the first database call
    expect(seed.indexOf("assertSeedAllowed()")).toBeLessThan(seed.indexOf("db.user.findUnique"));
  });
});

describe("no environment file is committed", () => {
  it("only .env.example (and its siblings) may be tracked", () => {
    const envFiles = repoFiles().filter((f) => /(^|\/)\.env(\.[^/]*)?$/.test(f));
    const allowed = /(^|\/)\.env\.(example|sample|template|dist)$/;
    expect(envFiles.filter((f) => !allowed.test(f))).toEqual([]);
  });

  it(".gitignore keeps ignoring .env and its variants but not .env.example", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
    expect(ignore).toContain(".env");
    expect(ignore).toContain(".env.*");
    expect(ignore).toContain("!.env.example");
  });
});

describe("dead files stay deleted", () => {
  it("the stray SQL copies in prisma/ are gone (the real ones live in prisma/migrations)", () => {
    expect(existsSync(join(ROOT, "prisma", "_d2.sql"))).toBe(false);
    expect(existsSync(join(ROOT, "prisma", "_d3.sql"))).toBe(false);
  });

  it("route.delete.ts is gone, and the real DELETE handler lives in route.ts", () => {
    const dir = join(ROOT, "src", "app", "api", "files", "[id]");
    expect(existsSync(join(dir, "route.delete.ts"))).toBe(false);
    expect(readFileSync(join(dir, "route.ts"), "utf8")).toMatch(/export async function DELETE\b/);
  });
});

describe("every environment variable the code reads is documented", () => {
  /** Provided by the platform, not configuration. */
  const PLATFORM = new Set(["NODE_ENV", "NEXT_RUNTIME", "NEXT_PHASE"]);

  function walkSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkSources(rel, out);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.d\.mts$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  /** `process.env.NAME` / `process.env["NAME"]` in the application, the worker and the scripts, plus the keys of the env schema. */
  function variablesRead(): string[] {
    const names = new Set<string>();
    for (const file of ["src", "worker", "scripts", "prisma"].flatMap((d) => walkSources(d))) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const m of text.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\])/g)) names.add((m[1] ?? m[2]) as string);
    }
    const schema = readFileSync(join(ROOT, "src", "server", "env.ts"), "utf8");
    for (const m of schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)) names.add(m[1] as string);
    return [...names].filter((n) => !PLATFORM.has(n)).sort();
  }

  it("finds the variables it is supposed to find (so the checks below are not vacuous)", () => {
    expect(variablesRead()).toEqual(expect.arrayContaining(["DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY", "UPLOAD_DIR", "TRUSTED_PROXY_HOPS"]));
  });

  it(".env.example mentions each one (commented out when it is optional)", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const missing = variablesRead().filter((name) => !new RegExp(`^#?\\s*${name}=`, "m").test(example));
    expect(missing, "add these to .env.example").toEqual([]);
  });

  it("the README's environment table lists each one", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const missing = variablesRead().filter((name) => !readme.includes(`\`${name}\``));
    expect(missing, "add these to the table in README.md").toEqual([]);
  });
});

describe("documents that claim more than the code does say so", () => {
  const audited = ["ENGINEERING_PROGRESS.md", "SECURITY_AUDIT.md", "DATABASE_AUDIT.md", "PHASE1-REPORT.md", "PROJECT-FULL-REPORT.md"];

  it.each(audited)("docs/%s opens with the warning banner and points at PHASE0-AUDIT.md", (name) => {
    const head = readFileSync(join(ROOT, "docs", name), "utf8").slice(0, 400);
    expect(head).toContain("Written before the 2026-10-22 audit");
    expect(head).toContain("PHASE0-AUDIT.md");
  });

  it("docs/PHASE0-AUDIT.md exists and names each of those documents", () => {
    const audit = readFileSync(join(ROOT, "docs", "PHASE0-AUDIT.md"), "utf8");
    for (const name of audited) expect(audit, name).toContain(name);
  });
});

describe("the Docker image has what it copies", () => {
  it("public/ is tracked (the Dockerfile copies it; git does not keep empty folders)", () => {
    expect(statSync(join(ROOT, "public")).isDirectory()).toBe(true);
    // git keeps files, not folders: public/ survives a clone only while something real lives in it
    // (brand art and fonts today; a .gitkeep would also do)
    expect(readdirSync(join(ROOT, "public")).length).toBeGreaterThan(0);
  });

  it("copies what the container needs at runtime (each of these was missing once)", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    for (const path of ["next.config.mjs", "public", "worker", "prisma", "tsconfig.json", "scripts", ".next", "node_modules"]) {
      expect(dockerfile, `Dockerfile must COPY --from=build /app/${path}`).toMatch(
        new RegExp(`^COPY --from=build /app/${path.replace(/\./g, "\\.")}\\s`, "m"),
      );
    }
  });

  it("uploads: the folder the code writes to is the folder the volume is mounted on, for every service", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");

    const imageDir = /^ENV UPLOAD_DIR=(\S+)\s*$/m.exec(dockerfile)?.[1];
    expect(imageDir).toBe("/app/storage/uploads");
    // created, and owned by the user the container runs as - or the first write fails
    expect(dockerfile).toMatch(/mkdir -p "\$UPLOAD_DIR"/);
    expect(dockerfile).toMatch(/chown -R zaki:zaki \/app\/storage/);
    expect(dockerfile).toMatch(/^USER zaki\s*$/m);

    const mounts = [...compose.matchAll(/^\s+- uploads:(\S+)\s*$/gm)].map((m) => m[1]);
    const envDirs = [...compose.matchAll(/^\s+UPLOAD_DIR:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(mounts.length, "app and worker both mount the uploads volume").toBeGreaterThanOrEqual(2);
    expect(envDirs.length, "app and worker both set UPLOAD_DIR").toBeGreaterThanOrEqual(2);
    for (const target of [...mounts, ...envDirs]) expect(target).toBe(imageDir);
  });

  it("the compose worker does not inherit the web server's HEALTHCHECK (it would be 'unhealthy' for ever)", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
    const block = /^ {2}worker:\r?\n([\s\S]*?)(?=^ {2}\w[\w-]*:\r?$|^volumes:)/m.exec(compose)?.[1] ?? "";
    // the worker runs the job scheduler's entry (F1.9); `npm run worker` is only the local heartbeat
    expect(block, "compose has a worker service").toContain("runJobsWorker");
    expect(block).toMatch(/healthcheck:\r?\n\s+disable:\s*true/);
  });

  it("every directory the Dockerfile copies out of the build stage exists in the repository", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const copies = [...dockerfile.matchAll(/^COPY --from=build \/app\/(\S+)\s/gm)].map((m) => m[1] as string);
    expect(copies.length).toBeGreaterThan(3);
    for (const path of copies) {
      // `.next` and `node_modules` are produced by the build stage itself
      if (path === ".next" || path === "node_modules") continue;
      expect(existsSync(join(ROOT, path)), `COPY --from=build /app/${path} needs ./${path} in the repository`).toBe(true);
    }
  });
});
