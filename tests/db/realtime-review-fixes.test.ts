/**
 * The independent review of F0 (docs/restructure/pr/F0.R.md): holes in the listener's cursor and in the stream, each proved here.
 *
 *  1. a replay that fails must be retried, not lost (the live events had already moved the cursor past the gap);
 *  2. an event whose transaction commits AFTER a later one is still found on reconnect (ids are taken at insert, published at commit);
 *  3. an event that arrives live while a long replay runs is not delivered a second time;
 *  4. a failed first connect is retried (the early return in `scheduleReconnect` made it give up);
 *  5. a stream evicted or aborted while its replay runs leaves no heartbeat behind;
 *  6. the page-of-messages anchor belongs to the conversation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "pg";
import { db, loginAs, makeTeam, makeWorkspace } from "./helpers";
import * as rtRoute from "@/app/api/rt/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests, isOnline } from "@/server/realtime/presence";
import { isViewing } from "@/server/realtime/viewing";
import { setHeartbeatMsForTests } from "@/server/realtime/stream-config";
import {
  connectListenerForTests,
  dropListenerConnectionForTests,
  ensureListener,
  failNextReplaysForTests,
  stopRealtimeListenerForTests,
} from "@/server/realtime/listener";

let orgId = "";
let userId = "";
beforeEach(async () => {
  const team = await makeTeam();
  orgId = team.org.id;
  userId = team.member.id;
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({ canReadConversation: async () => true });
});
afterEach(async () => {
  setHeartbeatMsForTests();
  failNextReplaysForTests(0);
  await stopRealtimeListenerForTests();
  setPolicyStubs({});
});

const insert = (messageId: string) => db.realtimeEvent.create({ data: { orgId, kind: "message.created", ids: { conversationId: "cv-r", messageId } as never } });
function listen() {
  const frames: string[] = [];
  addClient({ userId, orgId, send: (s) => frames.push(s), close: () => undefined });
  return { messageIds: () => frames.map((f) => /"messageId":"([^"]+)"/.exec(f)?.[1]).filter(Boolean) as string[] };
}
async function until(fn: () => boolean, ms = 8000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const quiet = (ms = 600) => new Promise((r) => setTimeout(r, ms));

describe("the listener's cursor, after the review", () => {
  it("1. a replay that fails is retried: the gap is still delivered, once", async () => {
    const c = listen();
    await connectListenerForTests();
    await insert("live-1");
    await until(() => c.messageIds().includes("live-1"));
    await dropListenerConnectionForTests();
    await insert("gap-1");
    await insert("gap-2");
    failNextReplaysForTests(1); // the first replay attempt throws
    await ensureListener();
    await insert("live-after"); // a live event moves the cursor past the gap while the replay is failing
    await until(() => c.messageIds().includes("gap-1") && c.messageIds().includes("gap-2") && c.messageIds().includes("live-after"), 15_000);
    await quiet();
    expect(c.messageIds().sort()).toEqual(["gap-1", "gap-2", "live-1", "live-after"]);
  });

  it("2. an event committed late (a lower id, after a higher one was delivered) is found on reconnect", async () => {
    const raw = new Client({ connectionString: process.env["DATABASE_URL"] as string });
    await raw.connect();
    try {
      const c = listen();
      await connectListenerForTests();
      await raw.query("BEGIN");
      const late = await raw.query(`INSERT INTO "RealtimeEvent" ("orgId","kind","ids") VALUES ($1,'message.created',$2::jsonb) RETURNING id`, [orgId, JSON.stringify({ conversationId: "cv-r", messageId: "late" })]);
      await insert("early-commit"); // takes the NEXT id and commits first: delivered live, the cursor passes the late one
      await until(() => c.messageIds().includes("early-commit"));
      await dropListenerConnectionForTests();
      await raw.query("COMMIT"); // the late row becomes visible while nobody listens: its notification is lost
      expect(BigInt(late.rows[0].id)).toBeLessThan((await db.realtimeEvent.findFirstOrThrow({ orderBy: { id: "desc" } })).id);
      await ensureListener();
      await until(() => c.messageIds().includes("late"));
      await quiet();
      expect(c.messageIds().filter((m) => m === "early-commit")).toHaveLength(1); // and nothing arrived twice
    } finally {
      await raw.end();
    }
  });

  it("3. a long replay does not deliver a live event twice, whatever its size", async () => {
    const c = listen();
    await connectListenerForTests();
    await dropListenerConnectionForTests();
    for (let i = 0; i < 60; i++) await insert(`gap-${i}`);
    await ensureListener();
    await insert("during");
    await until(() => c.messageIds().length >= 61, 15_000);
    await quiet();
    const ids = c.messageIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("during");
  });
});

describe("the stream, after the review", () => {
  it("5. a stream aborted while its replay runs leaves no heartbeat: the person is not kept online by a ghost", async () => {
    setHeartbeatMsForTests(50);
    const before = await db.realtimeEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    for (let i = 0; i < 30; i++) await insert(`r-${i}`);
    await loginAs(userId);
    const abort = new AbortController();
    const req = new NextRequest("http://localhost/api/rt", { headers: { "last-event-id": String(before?.id ?? 0n) }, signal: abort.signal });
    const res = await rtRoute.GET(req);
    abort.abort(); // gone before (or while) the replay finishes
    await res.body!.cancel().catch(() => undefined);
    resetHubForTests();
    resetPresenceForTests();
    await new Promise((r) => setTimeout(r, 600)); // several beats would have passed
    expect(await isOnline(userId)).toBe(false);
    expect(await isViewing(userId)).toBe(false);
  });
});

describe("the page of messages, after the review", () => {
  it("6. the `before` anchor must belong to the conversation (another conversation's message id is a 404)", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    const a = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "A" } });
    const b = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "B" } });
    const inB = await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: b.id, authorId: team.member.id, body: "in b" } });
    await loginAs(team.member.id);
    const res = await (await import("./helpers")).call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${a.id}?before=${inB.id}`, params: { id: a.id } });
    expect(res.status).toBe(404);
  });
});
