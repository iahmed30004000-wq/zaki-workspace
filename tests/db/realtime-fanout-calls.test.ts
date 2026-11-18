/**
 * C1.3 — the cost of one message for the database, counted. Every Prisma operation made while the hub fans ONE event out to N open
 * streams is recorded (middleware on the real client); the DM case waits for the delivered ticks' own write (a second later), so the
 * count is the whole bill of the event.
 *
 * Before C1.3 each stream asked the policy for itself (about eight reads) and marked the DM delivered inside the loop; the target is
 * under 60 operations for ten tabs. The numbers are printed so the PR file can quote them.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addClient, deliverEvent, resetHubForTests, type RtEvent } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests, settleLastSeenWrites } from "@/server/realtime/presence";
import { db, makeTeam, makeUser, makeWorkspace } from "./helpers";

const ops: string[] = [];
let counting = false;
beforeAll(() => {
  (db as unknown as { $use: (fn: (params: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(async (params, next) => {
    if (counting) ops.push(`${params.model ?? "raw"}.${params.action}`);
    return next(params);
  });
});
beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({});
});

async function world(people: number) {
  const team = await makeTeam();
  const users = [team.member];
  for (let i = 1; i < people; i++) users.push(await makeUser({ orgId: team.org.id, role: "MEMBER" }));
  const ws = await makeWorkspace(team.org.id, users.map((u) => ({ userId: u.id })));
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: ws.id, title: "T" } });
  const dm = await db.conversation.create({ data: { orgId: team.org.id, kind: "DM", dmKey: [users[0]!.id, team.owner.id].sort().join("|") } });
  await db.conversationMember.createMany({ data: [{ conversationId: dm.id, userId: users[0]!.id }, { conversationId: dm.id, userId: team.owner.id }] });
  const author = await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: dm.id, authorId: team.owner.id, body: "hi" } });
  return { team, users, ws, topic, dm, author };
}

/** Opens `streams` streams over `users` (round robin) and returns the operations one event makes, with the frames each stream got. */
async function bill(w: Awaited<ReturnType<typeof world>>, streams: number, users: { id: string }[], conversationId: string, messageId: string) {
  const sends: string[][] = [];
  for (let i = 0; i < streams; i++) {
    const got: string[] = [];
    sends.push(got);
    addClient({ userId: users[i % users.length]!.id, orgId: w.team.org.id, send: (s) => got.push(s), close: () => undefined });
  }
  await settleLastSeenWrites();
  ops.length = 0;
  counting = true;
  await deliverEvent({ id: "1", orgId: w.team.org.id, kind: "message.created", ids: { conversationId, messageId } } as unknown as RtEvent);
  await new Promise((r) => setTimeout(r, 1500)); // the delivered ticks of a DM are written a second later
  counting = false;
  return { total: ops.length, received: sends.filter((s) => s.some((f) => f.includes("message.created"))).length, ops: [...ops] };
}

describe("the bill of one message", () => {
  it("a topic's message, ten streams of ten people", async () => {
    const w = await world(10);
    const r = await bill(w, 10, w.users, w.topic.id, "m1");
    console.log(`[calls] topic message, 10 streams / 10 people: ${r.total}`);
    expect(r.received).toBe(10);
    expect(r.total).toBeLessThan(60);
  });

  it("a topic's message, ten tabs of TWO people (five each: the cap of streams per person)", async () => {
    const w = await world(2);
    const r = await bill(w, 10, w.users, w.topic.id, "m1");
    console.log(`[calls] topic message, 10 tabs / 2 people: ${r.total}`);
    expect(r.received).toBe(10);
    expect(r.total).toBeLessThan(60);
  });

  it("a DM's message, ten tabs of its two people (the delivered ticks included)", async () => {
    const w = await world(1);
    const r = await bill(w, 10, [w.users[0]!, w.team.owner], w.dm.id, w.author.id);
    console.log(`[calls] DM message, 10 tabs / 2 people: ${r.total}`);
    expect(r.received).toBe(10);
    expect(r.total).toBeLessThan(60);
  });
});
