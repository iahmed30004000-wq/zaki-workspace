/**
 * F0.2 / F0.3 / F0.4 — the live stream itself (GET /api/rt), read like a browser reads it.
 *
 *  F0.2 a stream that ends says why (`event: bye`) and closes: an evicted one (the 5-per-person cap) and a signed-out one;
 *  F0.3 the heartbeat is a real `ping` event (a comment frame is invisible to a browser);
 *  F0.4 every kind survives a replay under its own name (one list: REALTIME_KINDS).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db, loginAs, makeTeam, makeWorkspace } from "./helpers";
import * as rtRoute from "@/app/api/rt/route";
import { REALTIME_KINDS } from "@/server/realtime/emit";
import { MAX_STREAMS_PER_USER, resetHubForTests } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { setHeartbeatMsForTests } from "@/server/realtime/stream-config";
import { stopRealtimeListenerForTests } from "@/server/realtime/listener";

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({});
});
afterEach(async () => {
  setHeartbeatMsForTests();
  resetHubForTests();
  await stopRealtimeListenerForTests();
});

/** Opens the stream as `userId`; `read()` pulls text until `until` holds, the stream ends, or the time runs out. */
async function open(userId: string, headers: Record<string, string> = {}) {
  await loginAs(userId);
  const res = await rtRoute.GET(new NextRequest("http://localhost/api/rt", { headers }));
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  async function read(until: (text: string) => boolean, ms = 4000): Promise<void> {
    const stop = Date.now() + ms;
    while (!ended && !until(text) && Date.now() < stop) {
      const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 100))]);
      if (next === null) continue;
      if (next.done) {
        ended = true;
        break;
      }
      text += decoder.decode(next.value);
    }
  }
  return { read, text: () => text, ended: () => ended, cancel: () => reader.cancel().catch(() => undefined) };
}

async function world() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  return { team, space, topic, member: team.member };
}

describe("F0.3 — the heartbeat is a ping event", () => {
  it("sends `event: ping` on every beat", async () => {
    const w = await world();
    setHeartbeatMsForTests(80);
    const s = await open(w.member.id);
    await s.read((t) => t.includes("event: ping"));
    expect(s.text()).toContain("event: ping\ndata: ");
    expect(s.text()).not.toContain(": hb");
    await s.cancel();
  });
});

describe("F0.2 — a stream that ends says why and closes", () => {
  it("the oldest stream of a person is told `evicted` and closed when a sixth one opens", async () => {
    const w = await world();
    const first = await open(w.member.id);
    const others = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) others.push(await open(w.member.id));
    await first.read(() => false, 3000); // until it ends
    expect(first.ended()).toBe(true);
    expect(first.text()).toContain("event: bye");
    expect(first.text()).toContain('"reason":"evicted"');
    for (const o of others) await o.cancel();
  });

  it("a person whose sessions were all ended is told `signed_out` and closed at the next beat", async () => {
    const w = await world();
    setHeartbeatMsForTests(80);
    const s = await open(w.member.id);
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await s.read(() => false, 4000);
    expect(s.ended()).toBe(true);
    expect(s.text()).toContain("event: bye");
    expect(s.text()).toContain('"reason":"signed_out"');
  });
});

describe("F0.4 — every kind survives a replay", () => {
  it("each of REALTIME_KINDS comes back under its own name", async () => {
    const w = await world();
    const before = await db.realtimeEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const since = before?.id ?? 0n;
    for (const kind of REALTIME_KINDS) {
      await db.realtimeEvent.create({
        data: { orgId: w.team.org.id, kind, ids: { conversationId: w.topic.id, targetUserId: w.member.id, callId: "c1", spaceId: w.space.id } },
      });
    }
    const s = await open(w.member.id, { "last-event-id": since.toString() });
    await s.read((t) => REALTIME_KINDS.every((k) => t.includes(`"kind":"${k}"`)));
    const missing = REALTIME_KINDS.filter((k) => !s.text().includes(`"kind":"${k}"`));
    expect(missing).toEqual([]);
    await s.cancel();
  });
});
