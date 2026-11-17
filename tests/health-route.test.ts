import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => ({ connected: true, ensure: vi.fn() }));
vi.mock("@/server/db", () => ({ db: { $queryRaw: queryRaw } }));
vi.mock("@/server/realtime/listener", () => ({ ensureListener: live.ensure, listenerConnected: () => live.connected }));

import * as health from "../src/app/api/health/route";

describe("/api/health", () => {
  beforeEach(() => {
    queryRaw.mockReset(); // (not returned: vitest would run a returned function as cleanup)
    live.connected = true;
    live.ensure.mockReset();
  });

  it("F0.9: shows the live line — `realtime: ok` when the listener is connected, `down` when not — and never changes the status because of it", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const up = await health.GET();
    expect(up.status).toBe(200);
    expect(await up.json()).toMatchObject({ status: "ok", realtime: "ok" });
    live.connected = false;
    const down = await health.GET();
    expect(down.status).toBe(200); // the database stays the only reason for a 503
    expect(await down.json()).toMatchObject({ status: "ok", realtime: "down", checks: { app: "ok", database: "ok" } });
    expect(live.ensure).toHaveBeenCalled(); // asking brings the listener up after a deploy
  });

  it("is evaluated per request (a build-time snapshot made the Docker health check blind to a database outage)", () => {
    expect(health.dynamic).toBe("force-dynamic");
  });

  it("answers 200 when the database answers", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", checks: { app: "ok", database: "ok" } });
  });

  it("answers 503 when the database is unreachable, so Docker/Coolify can see the outage, without leaking the error", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password authentication failed"));
    const res = await health.GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"database":"fail"');
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("password");
  });
});

describe("docker-compose.yml", () => {
  const compose = readFileSync(path.resolve(__dirname, "../docker-compose.yml"), "utf8");

  /**
   * The `ports:` entries of one top-level service.
   * ⚠️ A Windows checkout (`core.autocrlf=true`, no `.gitattributes`) gives this file CRLF line endings,
   *    and a pattern written with `\n` alone then matched nothing - the check passed on Linux and failed here.
   * 🔧 Every line break is `\r?\n`, so the parse is the same on both checkouts.
   */
  function ports(service: string): string[] {
    const block =
      new RegExp(`\\r?\\n  ${service}:\\r?\\n([\\s\\S]*?)(?=\\r?\\n  [a-z]+:\\r?\\n|\\r?\\nvolumes:|$)`).exec(compose)?.[1] ?? "";
    return [...block.matchAll(/ports:\s*\r?\n((?:\s+-\s+"[^"]+"\s*\r?\n?)+)/g)].flatMap((m) =>
      [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!),
    );
  }

  it("publishes Postgres and Redis on the loopback interface only (they have default passwords / none)", () => {
    for (const service of ["db", "redis"]) {
      const published = ports(service);
      expect(published.length, service).toBeGreaterThan(0);
      for (const p of published) expect(p.startsWith("127.0.0.1:"), `${service}: ${p}`).toBe(true);
    }
  });
});
