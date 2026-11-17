/**
 * F0.1 — the listener's cursor (docs/restructure/F0-connection-hotfixes.md).
 *
 * Before: `lastId` started at 0 on every boot, so a deploy walked the whole RealtimeEvent table (48 h of events) before LISTEN was
 * "ready", every live stream waited for that walk, and a dropped connection re-delivered EVERY event since boot (a refetch storm)
 * because a live notification never advanced `lastId`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, makeTeam } from "./helpers";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";
import {
  connectListenerForTests,
  dropListenerConnectionForTests,
  ensureListener,
  stopRealtimeListenerForTests,
} from "@/server/realtime/listener";

let orgId = "";
let userId = "";
const WAIT = 5000;

beforeAll(async () => {
  const team = await makeTeam();
  orgId = team.org.id;
  userId = team.member.id;
});
beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({ canReadConversation: async () => true });
});
afterEach(async () => {
  await stopRealtimeListenerForTests();
  setPolicyStubs({});
});
afterAll(async () => {
  await stopRealtimeListenerForTests();
});

const insert = (kind: string, ids: Record<string, unknown>) => db.realtimeEvent.create({ data: { orgId, kind, ids: ids as never } });

function listen() {
  const frames: string[] = [];
  addClient({ userId, orgId, send: (s) => frames.push(s), close: () => undefined });
  const messageIds = () => frames.map((f) => /"messageId":"([^"]+)"/.exec(f)?.[1]).filter(Boolean) as string[];
  return { frames, messageIds };
}
async function until(fn: () => boolean, ms = WAIT) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const quiet = (ms = 500) => new Promise((r) => setTimeout(r, ms));

describe("the listener cursor", () => {
  it("a boot delivers nothing of the rows already in the table", async () => {
    await insert("message.created", { conversationId: "cv-cur", messageId: "old-1" });
    await insert("message.created", { conversationId: "cv-cur", messageId: "old-2" });
    await insert("message.created", { conversationId: "cv-cur", messageId: "old-3" });
    const c = listen();
    await connectListenerForTests();
    await quiet();
    expect(c.messageIds()).toEqual([]);
  });

  it("two live events then a dropped connection: each is delivered exactly once, and what was written while away arrives once too", async () => {
    const c = listen();
    await connectListenerForTests();
    await insert("message.created", { conversationId: "cv-cur2", messageId: "live-1" });
    await insert("message.created", { conversationId: "cv-cur2", messageId: "live-2" });
    await until(() => c.messageIds().length >= 2);
    await dropListenerConnectionForTests();
    await insert("message.created", { conversationId: "cv-cur2", messageId: "while-away" });
    await ensureListener();
    await until(() => c.messageIds().includes("while-away"));
    await quiet();
    expect(c.messageIds().sort()).toEqual(["live-1", "live-2", "while-away"]);
  });

  it("the stream does not wait for a replay: ensureListener resolves once LISTEN is on", async () => {
    // a backlog written while the connection is away is replayed in the background, never inside the awaited connect
    const c = listen();
    await connectListenerForTests();
    await dropListenerConnectionForTests();
    for (let i = 0; i < 40; i++) await insert("message.created", { conversationId: "cv-cur3", messageId: `bk-${i}` });
    await ensureListener();
    const deliveredAtResolve = c.messageIds().length;
    await until(() => c.messageIds().length >= 40);
    expect(deliveredAtResolve).toBeLessThan(40);
    expect(new Set(c.messageIds()).size).toBe(40);
  });
});
