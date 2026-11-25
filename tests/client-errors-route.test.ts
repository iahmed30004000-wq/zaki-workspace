import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/client-errors — the Android app's crash reports (M2 N0). They go to the server's log and nowhere else, only for a
 * signed-in person, capped in size and in number.
 */
const { who } = vi.hoisted(() => ({ who: { id: "u1" as string | null } }));

vi.mock("@/server/auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/auth")>("@/server/auth");
  return {
    ...actual,
    requireUser: async () => {
      if (!who.id) throw new actual.UnauthorizedError();
      return { id: who.id };
    },
  };
});

import { POST } from "@/app/api/client-errors/route";

const report = (over: Record<string, unknown> = {}) => ({
  kind: "CRASH",
  message: "java.lang.IllegalStateException: boom [main]",
  stack: "at io.zakiai.workspace.App.onCreate(App.kt:12)",
  screen: "chat",
  appVersion: "4.0.0",
  versionCode: 5,
  device: "Google Pixel 6",
  osVersion: "Android 14 (API 34)",
  occurredAt: "2026-11-24T10:00:00Z",
  ...over,
});

const send = (body: unknown) =>
  POST(new Request("http://localhost/api/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

const logged = () => warn.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.event === "android.client_error");

describe("POST /api/client-errors", () => {
  it("writes one log line per report, with the person and the report, and answers how many it took", async () => {
    who.id = "u-log";
    const res = await send({ reports: [report(), report({ kind: "ANR", message: "main thread blocked 4s" })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 2 });
    const lines = logged();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: "warn", userId: "u-log", kind: "CRASH", screen: "chat", appVersion: "4.0.0", versionCode: 5 });
    expect(lines[1]).toMatchObject({ kind: "ANR", message: "main thread blocked 4s" });
  });

  it("cuts a long stack in the log line", async () => {
    who.id = "u-stack";
    await send({ reports: [report({ stack: "x".repeat(15_000) })] });
    expect(logged()[0].stack).toHaveLength(4000);
  });

  it("refuses somebody who is not signed in, and logs nothing", async () => {
    who.id = null;
    const res = await send({ reports: [report()] });
    expect(res.status).toBe(401);
    expect(logged()).toHaveLength(0);
  });

  it("refuses an empty list, more than 20, an unknown kind, an unknown field and an oversized message — and logs nothing", async () => {
    who.id = "u-bad";
    for (const body of [
      {},
      { reports: [] },
      { reports: Array.from({ length: 21 }, () => report()) },
      { reports: [report({ kind: "PANIC" })] },
      { reports: [report({ phone: "0790000000" })] },
      { reports: [report({ message: "m".repeat(2001) })] },
      { reports: [report()], extra: true },
    ]) {
      const res = await send(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
    expect(logged()).toHaveLength(0);
  });

  it("takes ten calls an hour from one person, then answers 429", async () => {
    who.id = "u-busy";
    for (let i = 0; i < 10; i++) expect((await send({ reports: [report()] })).status).toBe(200);
    const res = await send({ reports: [report()] });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // somebody else is not held back by it
    who.id = "u-other";
    expect((await send({ reports: [report()] })).status).toBe(200);
  });
});
