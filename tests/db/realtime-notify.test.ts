import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { db, makeOrg, makeTeam, makeUser } from "./helpers";
import {
  addClient,
  deliverEvent,
  resetHubForTests,
} from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";
import {
  connectListenerForTests,
  dropListenerConnectionForTests,
  ensureListener,
  purgeRealtimeEvents,
  stopRealtimeListenerForTests,
} from "@/server/realtime/listener";

let orgId = "";
let userId = "";
let admin: Client | null = null;
// Advisory locks are scoped to a database, so the lock holder must connect to the SAME db the purge uses.
let locker: Client | null = null;

const PG_TIMEOUT_MS = 5000;

beforeAll(async () => {
  const team = await makeTeam();
  orgId = team.org.id;
  userId = team.member.id;
  const { Client } = await import("pg");
  const url = new URL(process.env["DATABASE_URL"] as string);
  url.pathname = "/postgres";
  admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  locker = new Client({ connectionString: (process.env["DATABASE_URL"] as string) });
  await locker.connect();
});

afterAll(async () => {
  await locker?.end();
  locker = null;
  await admin?.end();
  admin = null;
});

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({});
});
afterEach(() => {
  setPolicyStubs({});
});

function frames(client: { userId: string; frames: string[] }) {
  return client.frames.map((f) => {
    const line = f.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse((line ?? "").slice("data: ".length) || "{}") as Record<string, unknown>;
  });
}

async function insertEvent(kind: string, ids: Record<string, unknown>): Promise<bigint> {
  const row = await db.realtimeEvent.create({ data: { orgId, kind, ids: ids as never } });
  return row.id;
}

describe("Postgres LISTEN/NOTIFY realtime (real database)", () => {
  it("inserting a RealtimeEvent row delivers the notification to a connected SSE client within a second", async () => {
    const member = { userId, frames: [] as string[] };
    const client = { userId: member.userId, orgId, send: (s: string) => member.frames.push(s), close: () => undefined };
    deliverEventStub(client);
    await connectListenerForTests();
    const id = await insertEvent("message.created", { conversationId: "cv-db-1", messageId: "m-db-1" });
    await vi_waitFor(() => member.frames.length >= 1, PG_TIMEOUT_MS);
    const payload = frames(member)[0] as Record<string, unknown>;
    const idLine = member.frames[0]!.split("\n").find((l) => l.startsWith("id: "));
    expect(idLine).toBe(`id: ${id.toString()}`);
    expect(payload).toMatchObject({ kind: "message.created", conversationId: "cv-db-1", messageId: "m-db-1" });
    await stopRealtimeListenerForTests();
  });

  it("on reconnect it replays events with an id greater than the last seen so nothing is lost", async () => {
    const member = { userId, frames: [] as string[] };
    deliverEventStub({ userId: member.userId, orgId, send: (s: string) => member.frames.push(s), close: () => undefined });
    await connectListenerForTests();
    const firstId = await insertEvent("conversation.changed", { conversationId: "cv-db-2" });
    await vi_waitFor(() => member.frames.length >= 1, PG_TIMEOUT_MS);
    // F0.1: a lost connection keeps the cursor (a process boot no longer replays the table), so the reconnect replays only the gap
    await dropListenerConnectionForTests();
    const before = member.frames.length;
    // rows written while nobody is listening
    const secondId = await insertEvent("message.edited", { conversationId: "cv-db-2", messageId: "m-db-2" });
    expect(secondId).toBeGreaterThan(firstId);
    await ensureListener();
    await vi_waitFor(() => member.frames.length >= before + 1, PG_TIMEOUT_MS);
    const seen = frames(member).map((p) => p["messageId"]);
    expect(seen).toContain("m-db-2");
    await stopRealtimeListenerForTests();
  });

  it("an event of another organization never reaches this org's clients", async () => {
    const other = await makeOrg();
    const outsider = await makeUser({ orgId: other.id });
    const member = { userId, frames: [] as string[] };
    deliverEventStub({ userId: member.userId, orgId, send: (s: string) => member.frames.push(s), close: () => undefined });
    await connectListenerForTests();
    // Replay on connect may deliver earlier same-org rows; baseline before the foreign event.
    await new Promise((r) => setTimeout(r, 400));
    const before = member.frames.length;
    await db.realtimeEvent.create({ data: { orgId: other.id, kind: "message.created", ids: { conversationId: "cv-x" } } });
    await new Promise((r) => setTimeout(r, 400));
    expect(member.frames.length).toBe(before);
    await stopRealtimeListenerForTests();
    void outsider;
  });

  it("purge removes only rows older than 48 h, skips while the advisory lock is held elsewhere", async () => {
    // Earlier tests in this file leave same-org rows behind; count deltas, not absolutes.
    const before = await db.realtimeEvent.count({ where: { orgId } });
    await db.realtimeEvent.createMany({
      data: [
        { orgId, kind: "message.created", ids: {}, createdAt: new Date(Date.now() - 49 * 3600_000) },
        { orgId, kind: "message.created", ids: {}, createdAt: new Date(Date.now() - 1 * 3600_000) },
      ],
    });
    // someone else holds the lock: nothing may be deleted
    await locker!.query("SELECT pg_advisory_lock(742271)");
    try {
      await purgeRealtimeEvents();
      expect(await db.realtimeEvent.count({ where: { orgId } })).toBe(before + 2);
    } finally {
      await locker!.query("SELECT pg_advisory_unlock(742271)");
    }
    const removed = await purgeRealtimeEvents();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await db.realtimeEvent.count({ where: { orgId } })).toBe(before + 1);
  });
});

import { vi } from "vitest";

function deliverEventStub(client: { userId: string; orgId: string; send: (s: string) => void; close: () => void }) {
  setPolicyStubs({ canReadConversation: async () => true });
  // register the client in the hub (the route would do this; the hub module owns the registry)
  addClient(client);
}

async function vi_waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
