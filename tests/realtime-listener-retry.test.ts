import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed connect of the LISTEN client is retried. `scheduleReconnect` returned early while `connecting` was still set, and it was
 * called from inside the very attempt that had just failed — so the listener gave up until somebody opened a stream again.
 */
const attempts = vi.hoisted(() => ({ n: 0, failFirst: 1 }));
vi.mock("pg", () => ({
  Client: class {
    on() {}
    async connect() {
      attempts.n++;
      if (attempts.n <= attempts.failFirst) throw new Error("connection refused");
    }
    async query() {
      return { rows: [] };
    }
    async end() {}
  },
}));
vi.mock("@/server/db", () => ({ db: { realtimeEvent: { findFirst: async () => ({ id: 5n }), findMany: async () => [], findUnique: async () => null } } }));
vi.mock("@/server/realtime/hub", () => ({ deliverEvent: vi.fn() }));

describe("the listener's reconnect", () => {
  let mod: typeof import("@/server/realtime/listener");
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    attempts.n = 0;
    attempts.failFirst = 1;
    process.env["DATABASE_URL"] = "postgresql://u:p@localhost:5432/x";
    globalThis.__zkRtListener = undefined;
    mod = await import("@/server/realtime/listener");
  });
  afterEach(async () => {
    await mod.stopRealtimeListenerForTests();
    vi.useRealTimers();
  });

  it("tries again after a failed first connect, without anybody asking", async () => {
    await mod.ensureListener();
    expect(mod.listenerConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000); // the scheduled retry fires
    // the retry loads its modules with real ticks: wait for them in real time
    vi.useRealTimers();
    for (let i = 0; i < 100 && !mod.listenerConnected(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(attempts.n).toBeGreaterThanOrEqual(2);
    expect(mod.listenerConnected()).toBe(true);
  });
});
