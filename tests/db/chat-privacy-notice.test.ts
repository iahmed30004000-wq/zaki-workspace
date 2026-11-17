/**
 * P0.4 — the honest line about oversight (docs/restructure/P0-privacy.md). A private conversation (a DM, a restricted
 * topic, a «مقطع»'s topic) tells its people whether somebody who is NOT in it holds silent oversight (`archive.view`):
 * `oversightNotice`. An open topic says nothing; a conversation whose only oversight holder is one of its people says
 * nothing either (he is not reading silently, he is in it).
 */
import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const open = (id: string) => call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } });
const notice = async (viewerId: string, id: string) => {
  await loginAs(viewerId);
  const res = await open(id);
  expect(res.status).toBe(200);
  return res.json?.["oversightNotice"] as boolean | undefined;
};

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const a = team.member;
  const b = await makeUser({ orgId, role: "MEMBER", name: "B" });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }]);
  const section = await db.team.create({ data: { workspaceId: space.id, name: "X", members: { create: [{ userId: a.id }, { userId: b.id }] } } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Private", restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } } });
  const withOwner = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "With owner", restricted: true, members: { create: [{ userId: a.id }, { userId: team.owner.id }] } } });
  const teamTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Team", teamId: section.id } });
  const openTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  return { ...team, orgId, a, b, space, restricted, withOwner, teamTopic, openTopic, dm };
}

describe("oversightNotice", () => {
  it("is true for a DM, a restricted topic and a «مقطع»'s topic while the owner holds silent oversight and is not in them", async () => {
    const w = await world();
    expect(await notice(w.a.id, w.dm)).toBe(true);
    expect(await notice(w.a.id, w.restricted.id)).toBe(true);
    expect(await notice(w.b.id, w.restricted.id)).toBe(true);
    expect(await notice(w.a.id, w.teamTopic.id)).toBe(true);
  });

  it("is absent for an open topic: nothing private is said there", async () => {
    const w = await world();
    expect(await notice(w.a.id, w.openTopic.id)).toBeFalsy();
  });

  it("is false when the only holder of oversight is one of the conversation's own people", async () => {
    const w = await world();
    expect(await notice(w.a.id, w.withOwner.id)).toBe(false);
  });

  it("follows the permission, not the rank: a partner without archive.view does not count, one with it does", async () => {
    const w = await world();
    // the primary owner is in the conversation; the partner is the only one who could still read it silently
    await loginAs(w.owner.id);
    const patch = (body: Record<string, unknown>) => call(memberRoute.PATCH, { method: "PATCH", params: { id: w.orgId, userId: w.admin.id }, body });
    expect((await patch({ role: "OWNER" })).status).toBe(200);
    expect(await notice(w.a.id, w.withOwner.id)).toBe(true);
    await loginAs(w.owner.id);
    expect((await patch({ revokedCapabilities: ["archive.view"] })).status).toBe(200);
    expect(await notice(w.a.id, w.withOwner.id)).toBe(false);
  });
});
