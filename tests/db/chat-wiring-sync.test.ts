/**
 * C3w.1 — the sync gaps C1.2 recorded (and C3a.1, C1.3 repeated), against a real database.
 *
 *  - deleting an EMPTY topic writes an event that names the conversation, so the sync feed's `removed` says it for the people who knew it (the space-only event stays: it is what
 *    wakes the other tabs; the hub drops a frame that names a conversation that is gone)
 *  - a person who is suspended or offboarded gets events that name every conversation they had a place in (a row of their own, or an open topic of a space of theirs), so the other
 *    people's rows (the member count) refresh and the person's own `removed` can say it; and one event for the person alone, so the live line forgets what they may read
 *  - the same helper for a person taken out of a space with no row in a topic: their sync says `removed` for the topics they can no longer read
 *  - `forgetTypingFacts` ends typing at once when a person is taken out of a topic or leaves it
 */
import { describe, expect, it } from "vitest";
import { deleteTopic, leaveTopic, removeMember } from "@/server/chat/topics";
import { emitPersonGone } from "@/server/chat/moderation";
import { syncFeed } from "@/server/chat/sync";
import { typingFacts, resetTypingGateForTests } from "@/server/chat/typing-gate";
import { changeWorkspaceMembers } from "@/server/services/workspaces";
import { accountsApi } from "./accounts-helpers";
import { db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
const ctxOf = (orgId: string, userId: string, orgRole: Role = "MEMBER") => ({ orgId, userId, orgRole });

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const m = await makeUser({ orgId, role: "MEMBER", name: "Leaver" });
  const n = await makeUser({ orgId, role: "MEMBER", name: "Stayer" });
  const space = await makeWorkspace(orgId, [{ userId: m.id }, { userId: n.id }, { userId: t.admin.id, role: "ADMIN" }], "Alpha");
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: m.id }, { userId: n.id }] } } });
  const group = await db.conversation.create({ data: { orgId, kind: "GROUP", title: "Group", members: { create: [{ userId: m.id }, { userId: n.id }] } } });
  return { t, orgId, m, n, space, open, restricted, group };
}
type World = Awaited<ReturnType<typeof world>>;

const cursorOf = async (w: World, userId: string, role: Role = "MEMBER") => (await syncFeed(ctxOf(w.orgId, userId, role))).cursor;
const eventsAfter = async (cursor: string) => db.realtimeEvent.findMany({ where: { id: { gt: BigInt(cursor) } }, orderBy: { id: "asc" } });
const ids = (e: { ids: unknown }) => e.ids as { conversationId?: string; userId?: string; targetUserId?: string; spaceId?: string };

describe("deleting an empty topic names the conversation", () => {
  it("the event carries the topic's id, and a person who knew it gets it in `removed`", async () => {
    const w = await world();
    const empty = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Empty" } });
    const cursor = await cursorOf(w, w.n.id);
    await deleteTopic(ctxOf(w.orgId, w.t.admin.id, "ADMIN"), empty.id);
    expect(await db.conversation.count({ where: { id: empty.id } })).toBe(0);
    const events = await eventsAfter(cursor);
    expect(events.some((e) => ids(e).conversationId === empty.id)).toBe(true);
    // the space-only event is still there (it wakes the other tabs)
    expect(events.some((e) => ids(e).conversationId === undefined && ids(e).spaceId === w.space.id)).toBe(true);
    const feed = await syncFeed(ctxOf(w.orgId, w.n.id), { after: BigInt(cursor) });
    expect(feed.removed).toContain(empty.id);
  });
});

describe("an id of a conversation the person never knew is not told to them (review)", () => {
  it("a deleted topic of a space the person is not in is not in their `removed`; a person of that space still gets it", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Outsider" });
    const empty = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Empty", restricted: true } });
    const cursorOut = await cursorOf(w, outsider.id);
    const cursorIn = await cursorOf(w, w.n.id);
    await deleteTopic(ctxOf(w.orgId, w.t.owner.id, "OWNER"), empty.id);
    expect((await syncFeed(ctxOf(w.orgId, outsider.id), { after: BigInt(cursorOut) })).removed).not.toContain(empty.id);
    expect((await syncFeed(ctxOf(w.orgId, w.n.id), { after: BigInt(cursorIn) })).removed).toContain(empty.id);
  });

  it("removing somebody who has no row there writes no event, so their feed never names the restricted topic", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Outsider" });
    const cursor = await cursorOf(w, outsider.id);
    await removeMember(ctxOf(w.orgId, w.t.owner.id, "OWNER"), w.restricted.id, outsider.id);
    expect((await eventsAfter(cursor)).filter((e) => e.kind === "membership.changed" && ids(e).userId === outsider.id)).toHaveLength(0);
    expect((await syncFeed(ctxOf(w.orgId, outsider.id), { after: BigInt(cursor) })).removed).not.toContain(w.restricted.id);
    // a person who HAD a row still gets the event and the id
    const cursorM = await cursorOf(w, w.m.id);
    await removeMember(ctxOf(w.orgId, w.t.owner.id, "OWNER"), w.restricted.id, w.m.id);
    expect((await syncFeed(ctxOf(w.orgId, w.m.id), { after: BigInt(cursorM) })).removed).toContain(w.restricted.id);
  });
});

describe("a person who is suspended or offboarded: events that name what they had", () => {
  it("suspending names the open topic of their space, the topic they have a row in and the group; and one event for the person alone", async () => {
    const w = await world();
    const cursor = await cursorOf(w, w.n.id);
    await loginAs(w.t.owner.id);
    expect((await accountsApi.status(w.orgId, w.m.id, { action: "suspend" })).status).toBe(200);
    const events = (await eventsAfter(cursor)).filter((e) => e.kind === "membership.changed" && ids(e).userId === w.m.id);
    const named = new Set(events.map((e) => ids(e).conversationId).filter(Boolean));
    expect(named).toEqual(new Set([w.open.id, w.restricted.id, w.group.id]));
    expect(events.some((e) => ids(e).conversationId === undefined && ids(e).targetUserId === w.m.id)).toBe(true);
    // the people who stay get the rows whose numbers moved (an open topic's reach counts ACTIVE people only)
    const feed = await syncFeed(ctxOf(w.orgId, w.n.id), { after: BigInt(cursor) });
    expect(feed.rows.map((r) => r.id)).toEqual(expect.arrayContaining([w.open.id, w.restricted.id]));
  });

  it("offboarding does the same (before the rows and the space are taken away)", async () => {
    const w = await world();
    const cursor = await cursorOf(w, w.n.id);
    await loginAs(w.t.owner.id);
    expect((await accountsApi.status(w.orgId, w.m.id, { action: "offboard" })).status).toBe(200);
    const named = new Set((await eventsAfter(cursor)).filter((e) => e.kind === "membership.changed" && ids(e).userId === w.m.id).map((e) => ids(e).conversationId).filter(Boolean));
    expect(named).toEqual(new Set([w.open.id, w.restricted.id, w.group.id]));
  });

  it("reactivating names nothing (nobody left)", async () => {
    const w = await world();
    await loginAs(w.t.owner.id);
    await accountsApi.status(w.orgId, w.m.id, { action: "suspend" });
    const cursor = await cursorOf(w, w.n.id);
    await accountsApi.status(w.orgId, w.m.id, { action: "reactivate" });
    expect((await eventsAfter(cursor)).filter((e) => e.kind === "membership.changed" && ids(e).userId === w.m.id)).toHaveLength(0);
  });
});

describe("a person taken out of a space with no row in a topic", () => {
  it("the helper (called before the space row goes) makes the person's own client start over: one event for them alone", async () => {
    const w = await world();
    const cursor = await cursorOf(w, w.m.id);
    await db.$transaction(async (tx) => {
      await emitPersonGone(tx, w.orgId, w.m.id);
      await tx.workspaceMember.deleteMany({ where: { workspaceId: w.space.id, userId: w.m.id } });
      await tx.conversationMember.deleteMany({ where: { userId: w.m.id, conversation: { spaceId: w.space.id } } });
    });
    const feed = await syncFeed(ctxOf(w.orgId, w.m.id), { after: BigInt(cursor) });
    // the person's own targeted event: their client reloads the list and the open chat (a reset names no ids)
    expect(feed.reset).toBe(true);
  });

  it("the named events alone give `removed` for the topics the person can no longer read", async () => {
    const w = await world();
    const cursor = await cursorOf(w, w.m.id);
    await db.$transaction(async (tx) => {
      await tx.workspaceMember.deleteMany({ where: { workspaceId: w.space.id, userId: w.m.id } });
      await tx.conversationMember.deleteMany({ where: { userId: w.m.id, conversation: { spaceId: w.space.id } } });
      for (const id of [w.open.id, w.restricted.id]) await tx.realtimeEvent.create({ data: { orgId: w.orgId, kind: "membership.changed", ids: { conversationId: id, userId: w.m.id, spaceId: w.space.id } } });
    });
    const feed = await syncFeed(ctxOf(w.orgId, w.m.id), { after: BigInt(cursor) });
    expect(feed.removed).toEqual(expect.arrayContaining([w.open.id, w.restricted.id]));
  });
});

describe("typing facts are forgotten when a person is taken out of a space", () => {
  it("changeWorkspaceMembers (a removal) ends the remembered answer at once", async () => {
    const w = await world();
    resetTypingGateForTests();
    const actor = { userId: w.n.id, orgId: w.orgId, isOwner: false };
    expect(await typingFacts(actor, w.open.id)).not.toBeNull(); // an open topic: the space's people read it
    await changeWorkspaceMembers({ userId: w.t.owner.id, orgRole: "OWNER" }, w.space.id, { remove: [w.n.id] });
    expect(await typingFacts(actor, w.open.id)).toBeNull();
  });
});

describe("typing facts are forgotten when a person is taken out of a topic", () => {
  it("removeMember and leaveTopic end the remembered answer at once", async () => {
    const w = await world();
    resetTypingGateForTests();
    const actor = (userId: string) => ({ userId, orgId: w.orgId, isOwner: false });
    expect(await typingFacts(actor(w.m.id), w.restricted.id)).not.toBeNull(); // remembered for 30 s
    await removeMember(ctxOf(w.orgId, w.t.owner.id, "OWNER"), w.restricted.id, w.m.id);
    expect(await typingFacts(actor(w.m.id), w.restricted.id)).toBeNull(); // asked again: no longer a reader

    expect(await typingFacts(actor(w.n.id), w.restricted.id)).not.toBeNull();
    await leaveTopic(ctxOf(w.orgId, w.n.id), w.restricted.id);
    expect(await typingFacts(actor(w.n.id), w.restricted.id)).toBeNull();
  });
});
