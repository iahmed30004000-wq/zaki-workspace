/**
 * C1.8 — «يكتب الآن…» is cheap. The typing route used to ask the policy ~12 questions per ping; it now remembers the facts of
 * (person, conversation) for 30 s (`src/server/chat/typing-gate.ts`). What the memory must never do:
 *  - let a person who CANNOT read send typing (nothing is remembered for them: a refusal is never cached, and a remembered «yes» belongs to one
 *    person and one conversation only);
 *  - keep a person who WAS removed typing for longer than 30 s (and `forgetTypingFacts` ends it at once for a caller that revokes);
 *  - let the owner's silent oversight ever emit (the owner is never remembered: he is asked every time);
 *  - let a person who cannot read RECEIVE typing (the fan-out's own gate is unchanged: tested again here).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as typingRoute from "@/app/api/rt/typing/route";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { canReadConversation } from "@/server/policy/conversation";
import { forgetTypingFacts, resetTypingGateForTests, TYPING_FACTS_TTL_MS } from "@/server/chat/typing-gate";
import { call, db, loginAs, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

let asked = 0;

beforeEach(() => {
  resetHubForTests();
  resetTypingGateForTests();
  asked = 0;
  // the real policy, counted: each question the route puts to it is one `asked`
  setPolicyStubs({
    canReadConversation: async (userId, conversationId) => {
      asked++;
      return canReadConversation(userId, conversationId);
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  setPolicyStubs({});
  resetHubForTests();
});

async function world() {
  const t = await makeTeam();
  const a = t.member;
  const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
  const out = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Out" });
  const ws = await makeWorkspace(t.org.id, [{ userId: a.id }, { userId: b.id }, { userId: out.id }]);
  const topic = await db.conversation.create({
    data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "Private", restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } },
  });
  return { t, a, b, out, ws, topic };
}
const tick = (ms: number) => vi.setSystemTime(Date.now() + ms);
const ping = async (userId: string, conversationId: string) => {
  await loginAs(userId);
  return call(typingRoute.POST, { method: "POST", body: { conversationId } });
};
const stream = (userId: string, orgId: string) => {
  const frames: string[] = [];
  addClient({ userId, orgId, send: (f) => frames.push(f), close: () => undefined });
  return frames;
};
const typingFrames = (frames: string[]) => frames.filter((f) => f.includes('"kind":"typing"'));

describe("C1.8: the typing route remembers the policy's facts for 30 s", () => {
  it("five pings cost ONE policy question, not five (and every one is accepted)", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) {
      expect((await ping(w.a.id, w.topic.id)).status, `ping ${i}`).toBe(204);
      tick(2_100); // past the 2 s throttle, well inside the 30 s memory
    }
    expect(asked).toBe(1);
  });

  it("the memory ends after 30 s: the next ping asks again", async () => {
    const w = await world();
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    tick(TYPING_FACTS_TTL_MS - 1_000);
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    expect(asked).toBe(1);
    tick(2_000);
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    expect(asked).toBe(2);
  });

  it("a person removed from the audience loses typing within 30 s", async () => {
    const w = await world();
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    // taken out of the restricted topic (and of nothing else): he can no longer read it
    await db.conversationMember.deleteMany({ where: { conversationId: w.topic.id, userId: w.a.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.a.id } });
    expect(await canReadConversation(w.a.id, w.topic.id)).toBe(false);
    tick(TYPING_FACTS_TTL_MS + 1_000);
    expect((await ping(w.a.id, w.topic.id)).status).toBe(404);
  });

  it("forgetTypingFacts ends it at once for a caller that revokes", async () => {
    const w = await world();
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    await db.conversationMember.deleteMany({ where: { conversationId: w.topic.id, userId: w.a.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.a.id } });
    forgetTypingFacts(w.a.id, w.topic.id);
    tick(2_100);
    expect((await ping(w.a.id, w.topic.id)).status).toBe(404);
  });
});

describe("C1.8: the memory never lets a person who cannot read send or receive typing", () => {
  it("somebody who cannot read the topic is refused every time, and never remembered", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) {
      expect((await ping(w.out.id, w.topic.id)).status, `ping ${i}`).toBe(404);
      tick(2_100);
    }
    expect(asked).toBe(3);
  });

  it("a «yes» remembered for one person is not used for another person in the same conversation", async () => {
    const w = await world();
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    tick(2_100);
    expect((await ping(w.out.id, w.topic.id)).status).toBe(404);
    expect(asked).toBe(2);
  });

  it("a «yes» remembered for one conversation is not used for another one", async () => {
    const w = await world();
    const other = await db.conversation.create({
      data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Other", restricted: true, members: { create: [{ userId: w.b.id }] } },
    });
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    tick(2_100);
    expect((await ping(w.a.id, other.id)).status).toBe(404);
  });

  it("a person of another company is a 404 for a conversation of this one", async () => {
    const w = await world();
    const otherOrg = await makeOrg();
    const stranger = await makeUser({ orgId: otherOrg.id, role: "MEMBER", name: "Stranger" });
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    tick(2_100);
    expect((await ping(stranger.id, w.topic.id)).status).toBe(404);
  });

  it("the frame reaches the people who may read the topic and nobody else (the fan-out's gate is unchanged)", async () => {
    const w = await world();
    const reader = stream(w.b.id, w.t.org.id);
    const outsider = stream(w.out.id, w.t.org.id);
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    tick(2_100);
    expect((await ping(w.a.id, w.topic.id)).status).toBe(204);
    expect(typingFrames(reader).length).toBeGreaterThanOrEqual(1);
    expect(typingFrames(outsider)).toHaveLength(0);
  });
});

describe("C1.8: the owner's silent oversight never emits typing, and is never remembered", () => {
  it("in oversight (no row) it is a 204 with no frame, asked every time; once he has joined, it emits at once", async () => {
    const w = await world();
    const reader = stream(w.b.id, w.t.org.id);
    for (let i = 0; i < 2; i++) {
      expect((await ping(w.t.owner.id, w.topic.id)).status, `oversight ${i}`).toBe(204);
      tick(2_100);
    }
    expect(typingFrames(reader)).toHaveLength(0);
    expect(asked).toBe(2); // not remembered
    // he joins («شارك بالمحادثة»): a row of his own, and the very next ping is a normal member's
    await db.conversationMember.create({ data: { conversationId: w.topic.id, userId: w.t.owner.id } });
    expect((await ping(w.t.owner.id, w.topic.id)).status).toBe(204);
    expect(typingFrames(reader)).toHaveLength(1);
    // …and if he leaves again, the very next ping is silent again (nothing remembered that he was a member)
    await db.conversationMember.deleteMany({ where: { conversationId: w.topic.id, userId: w.t.owner.id } });
    tick(2_100);
    expect((await ping(w.t.owner.id, w.topic.id)).status).toBe(204);
    expect(typingFrames(reader)).toHaveLength(1);
  });
});
