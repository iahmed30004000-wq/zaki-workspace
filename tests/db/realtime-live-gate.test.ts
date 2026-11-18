/**
 * C1.3 — the live gate over a real database. The fan-out now asks ONE batched question per event (`readersOf`) instead of one
 * `canReadConversation` per stream, so this file proves the batch is the SAME rule:
 *  - for every kind of conversation and every kind of person, `readersOf` answers exactly what `canReadConversation` answers
 *    (restricted topic, «مقطع», DM, group, guest, suspended, offboarded, the silent eye with and without `archive.view`, another company);
 *  - a real `deliverEvent` reaches only those people, and a conversation that does not exist reaches nobody;
 *  - a person who is taken out is dropped by the next event (`membership.changed` forgets the old answer).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { addClient, deliverEvent, resetHubForTests, type RtEvent } from "@/server/realtime/hub";
import { readersOf, setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { canReadConversation } from "@/server/policy/conversation";
import { db, makeTeam, makeUser, makeWorkspace } from "./helpers";

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({}); // the real policy answers
});

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const spaceAdmin = await makeUser({ orgId, role: "MEMBER" });
  const memberIn2 = await makeUser({ orgId, role: "MEMBER" });
  const memberOut = await makeUser({ orgId, role: "MEMBER" });
  const teamMember = await makeUser({ orgId, role: "MEMBER" });
  const orgAdminOut = await makeUser({ orgId, role: "ADMIN" });
  const suspended = await makeUser({ orgId, role: "MEMBER" });
  const offboarded = await makeUser({ orgId, role: "MEMBER" });
  const partnerWithout = await makeUser({ orgId, role: "OWNER" });
  const foreign = await makeTeam();
  const space = await makeWorkspace(orgId, [
    { userId: spaceAdmin.id, role: "ADMIN" },
    { userId: t.member.id },
    { userId: memberIn2.id },
    { userId: memberOut.id },
    { userId: teamMember.id },
    { userId: t.guest.id },
    { userId: suspended.id },
    { userId: offboarded.id },
  ]);
  // a partner whose silent eye was taken away
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: partnerWithout.id } }, data: { revokedCapabilities: ["archive.view"] } });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: suspended.id } }, data: { status: "SUSPENDED" } });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: offboarded.id } }, data: { status: "OFFBOARDED" } });
  const section = await db.team.create({ data: { workspaceId: space.id, name: "S", members: { create: [{ userId: teamMember.id }] } } });
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "open" } });
  const restricted = await db.conversation.create({
    data: { orgId, kind: "TOPIC", spaceId: space.id, title: "restricted", restricted: true, members: { create: [{ userId: t.member.id }, { userId: memberIn2.id }, { userId: suspended.id }] } },
  });
  const team = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "team", teamId: section.id } });
  const dm = await db.conversation.create({
    data: { orgId, kind: "DM", dmKey: [t.member.id, memberIn2.id].sort().join("|"), members: { create: [{ userId: t.member.id }, { userId: memberIn2.id }] } },
  });
  // a DM whose other person was offboarded: the one who is left reads nothing
  const deadDm = await db.conversation.create({
    data: { orgId, kind: "DM", dmKey: [t.member.id, offboarded.id].sort().join("|"), members: { create: [{ userId: t.member.id }, { userId: offboarded.id }] } },
  });
  const group = await db.conversation.create({
    data: { orgId, kind: "GROUP", title: "group", members: { create: [{ userId: t.member.id }, { userId: t.guest.id }, { userId: memberOut.id }] } },
  });
  const foreignTopic = await db.conversation.create({
    data: { orgId: foreign.org.id, kind: "TOPIC", spaceId: (await makeWorkspace(foreign.org.id, [{ userId: foreign.member.id }])).id, title: "foreign" },
  });
  const people: Record<string, string> = {
    owner: t.owner.id,
    partner: t.admin.id,
    partnerWithout: partnerWithout.id,
    orgAdminOut: orgAdminOut.id,
    spaceAdmin: spaceAdmin.id,
    memberIn: t.member.id,
    memberIn2: memberIn2.id,
    memberOut: memberOut.id,
    teamMember: teamMember.id,
    guest: t.guest.id,
    suspended: suspended.id,
    offboarded: offboarded.id,
    foreignOwner: foreign.owner.id, // somebody of ANOTHER company
    nobody: "no-such-user",
  };
  return { t, orgId, space, people, conv: { open, restricted, team, dm, deadDm, group, foreignTopic } };
}

describe("readersOf is the same rule as canReadConversation", () => {
  it("every kind of conversation, every kind of person", async () => {
    const w = await world();
    const ids = Object.values(w.people);
    const wrong: string[] = [];
    for (const [name, cv] of Object.entries(w.conv)) {
      const { readers, kind } = await readersOf(cv.id, ids);
      expect(kind, name).toBe(cv.kind);
      for (const [who, userId] of Object.entries(w.people)) {
        const want = await canReadConversation(userId, cv.id);
        if (readers.has(userId) !== want) wrong.push(`${name} · ${who}: expected ${want ? "reads" : "does not read"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the table is not trivially empty: somebody reads each kind, and somebody does not", async () => {
    const w = await world();
    const ids = Object.values(w.people);
    for (const key of ["open", "restricted", "team", "dm", "group"] as const) {
      const { readers } = await readersOf(w.conv[key].id, ids);
      expect(readers.size, key).toBeGreaterThan(0);
      expect(readers.size, key).toBeLessThan(ids.length);
    }
    expect((await readersOf(w.conv.deadDm.id, [w.people["memberIn"]!])).readers.size).toBe(0);
  });

  it("a conversation that does not exist has no readers", async () => {
    const w = await world();
    const r = await readersOf("no-such-conversation", Object.values(w.people));
    expect(r.readers.size).toBe(0);
    expect(r.kind).toBeNull();
  });

  it("asks the same few questions however many people are asked about", async () => {
    const w = await world();
    const ops: string[] = [];
    (db as unknown as { $use: (fn: (p: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(async (p, next) => {
      ops.push(`${p.model}.${p.action}`);
      return next(p);
    });
    ops.length = 0;
    await readersOf(w.conv.open.id, Object.values(w.people));
    const many = ops.length;
    ops.length = 0;
    await readersOf(w.conv.open.id, [w.people["memberIn"]!]);
    expect(many).toBe(ops.length);
    expect(many).toBeLessThanOrEqual(5);
  });
});

describe("the real fan-out reaches only the people who may read", () => {
  it("a restricted topic's message reaches its own people (and the silent eye), in every tab, and nobody else", async () => {
    const w = await world();
    const got = new Map<string, string[]>();
    for (const [who, userId] of Object.entries(w.people)) {
      if (who === "nobody") continue;
      for (let tab = 0; tab < 2; tab++) {
        const frames: string[] = [];
        got.set(`${who}#${tab}`, frames);
        const orgId = who === "foreignOwner" ? (await db.organizationMember.findFirstOrThrow({ where: { userId } })).organizationId : w.orgId;
        addClient({ userId, orgId, send: (s) => frames.push(s), close: () => undefined });
      }
    }
    await deliverEvent({ id: "5", orgId: w.orgId, kind: "message.created", ids: { conversationId: w.conv.restricted.id, messageId: "m1" } } as unknown as RtEvent);
    const reached = [...got].filter(([, f]) => f.some((x) => x.includes("message.created"))).map(([k]) => k);
    const want = [];
    for (const [who, userId] of Object.entries(w.people)) {
      if (who === "nobody") continue;
      if (await canReadConversation(userId, w.conv.restricted.id)) want.push(`${who}#0`, `${who}#1`);
    }
    expect(reached.sort()).toEqual(want.sort());
    expect(reached).toContain("memberIn#0");
    expect(reached).not.toContain("memberOut#0");
    expect(reached).not.toContain("guest#0");
    expect(reached).not.toContain("foreignOwner#0");
    expect(reached).not.toContain("suspended#0");
  });

  it("an event for a conversation that is gone reaches nobody", async () => {
    const w = await world();
    const frames: string[] = [];
    addClient({ userId: w.people["owner"]!, orgId: w.orgId, send: (s) => frames.push(s), close: () => undefined });
    await deliverEvent({ id: "6", orgId: w.orgId, kind: "message.created", ids: { conversationId: "gone-cv" } } as unknown as RtEvent);
    expect(frames).toEqual([]);
  });

  it("a person taken out of a restricted topic stops receiving at the next event (membership.changed forgets the old answer)", async () => {
    const w = await world();
    const frames: string[] = [];
    addClient({ userId: w.people["memberIn"]!, orgId: w.orgId, send: (s) => frames.push(s), close: () => undefined });
    const send = (id: string, kind: string, ids: Record<string, string>) => deliverEvent({ id, orgId: w.orgId, kind, ids } as unknown as RtEvent);
    await send("1", "message.created", { conversationId: w.conv.restricted.id });
    expect(frames.filter((f) => f.includes("message.created"))).toHaveLength(1);
    await db.conversationMember.deleteMany({ where: { conversationId: w.conv.restricted.id, userId: w.people["memberIn"]! } });
    await send("2", "membership.changed", { conversationId: w.conv.restricted.id, userId: w.people["memberIn"]! });
    await send("3", "message.created", { conversationId: w.conv.restricted.id });
    expect(frames.filter((f) => f.includes("message.created"))).toHaveLength(1);
  });
});
