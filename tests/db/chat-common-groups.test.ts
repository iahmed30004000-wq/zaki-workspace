/**
 * «مجموعات مشتركة» — the groups and topics the two people of a private chat both belong to (the owner's pictures of a profile, 2026-11-22).
 *
 * The rule is stricter than reading: only where BOTH are ordinary members count (a row of the group, the people of an open topic's space, the named people of a
 * restricted topic). The owner's silent eye and his rank add nothing here, in either direction, and the door answers only for a private chat of the asker's own.
 */
import { describe, expect, it } from "vitest";
import * as route from "@/app/api/chat/conversations/[id]/common/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const bee = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const cat = await makeUser({ orgId, role: "MEMBER", name: "Cat" });
  const shared = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: bee.id }], "Shared");
  const mine = await makeWorkspace(orgId, [{ userId: t.member.id }], "OnlyMine");
  const theirs = await makeWorkspace(orgId, [{ userId: bee.id }, { userId: cat.id }], "OnlyTheirs");
  const group = (title: string, ids: string[]) => db.conversation.create({ data: { orgId, kind: "GROUP", title, members: { create: ids.map((userId) => ({ userId })) } } });
  const topic = (title: string, spaceId: string, extra: Record<string, unknown> = {}, ids: string[] = []) =>
    db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId, title, ...extra, members: { create: ids.map((userId) => ({ userId })) } } });
  const dm = (a: string, b: string) => db.conversation.create({ data: { orgId, kind: "DM", dmKey: [a, b].sort().join("|"), members: { create: [{ userId: a }, { userId: b }] } } });

  await group("G-both", [t.member.id, bee.id, cat.id]);
  await group("G-mine", [t.member.id, cat.id]);
  await group("G-theirs", [bee.id, cat.id]);
  await topic("T-open-shared", shared.id);
  await topic("T-open-mine", mine.id);
  await topic("T-open-theirs", theirs.id);
  await topic("T-closed-to-one", shared.id, { restricted: true }, [bee.id]);
  await topic("T-named-both", shared.id, { restricted: true }, [bee.id, t.member.id]);
  await topic("T-archived", shared.id, { archivedAt: new Date() });
  const memberBee = await dm(t.member.id, bee.id);
  const ownerBee = await dm(t.owner.id, bee.id);
  const beeCat = await dm(bee.id, cat.id);
  return { t, orgId, bee, cat, memberBee, ownerBee, beeCat, group, topic };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

type Row = { id: string; kind: string; title: string; emoji: string | null; spaceName: string | null };
const ask = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(route.GET, { url: `http://localhost/api/chat/conversations/${id}/common`, params: { id } });
  return { status: res.status, groups: (res.json?.["groups"] ?? null) as Row[] | null, text: res.text };
};
const titles = (rows: Row[] | null) => (rows ?? []).map((r) => r.title).sort();

describe("the groups two people share", () => {
  it("lists a group and the topics both belong to, with the topic's space; nothing only one of them is in, and no archived topic", async () => {
    const w = await getWorld();
    const r = await ask(w.t.member.id, w.memberBee.id);
    expect(r.status).toBe(200);
    expect(titles(r.groups)).toEqual(["G-both", "T-named-both", "T-open-shared"]);
    expect(r.groups!.find((g) => g.title === "T-open-shared")).toMatchObject({ kind: "TOPIC", spaceName: "Shared" });
    expect(r.groups!.find((g) => g.title === "G-both")).toMatchObject({ kind: "GROUP", spaceName: null });
    for (const hidden of ["G-mine", "G-theirs", "T-open-mine", "T-open-theirs", "T-closed-to-one", "T-archived"]) expect(r.text).not.toContain(hidden);
  });

  it("is the same from the other side", async () => {
    const w = await getWorld();
    expect(titles((await ask(w.bee.id, w.memberBee.id)).groups)).toEqual(["G-both", "T-named-both", "T-open-shared"]);
  });

  it("the owner's silent eye and rank add nothing: only where he belongs himself", async () => {
    const w = await getWorld();
    // the owner is in no space row and no group of this world: nothing is shared, though he could read all of it
    expect((await ask(w.t.owner.id, w.ownerBee.id)).groups).toEqual([]);
    await w.group("G-owner-bee", [w.t.owner.id, w.bee.id]);
    expect(titles((await ask(w.t.owner.id, w.ownerBee.id)).groups)).toEqual(["G-owner-bee"]);
    // and from the other side his rank makes him nobody's neighbour in a space he has no row in
    expect(titles((await ask(w.bee.id, w.ownerBee.id)).groups)).toEqual(["G-owner-bee"]);
  });

  it("answers only for a private chat of the asker's own: somebody else's, a group or an unknown id is 404, the owner included", async () => {
    const w = await getWorld();
    expect((await ask(w.t.member.id, w.beeCat.id)).status).toBe(404);
    expect((await ask(w.t.owner.id, w.beeCat.id)).status).toBe(404);
    const g = await db.conversation.findFirstOrThrow({ where: { orgId: w.orgId, title: "G-both" } });
    expect((await ask(w.t.member.id, g.id)).status).toBe(404);
    expect((await ask(w.t.member.id, "nothing-here")).status).toBe(404);
  });

  it("says nothing about a person who left the company", async () => {
    const w = await getWorld();
    const gone = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Gone" });
    await w.group("G-with-gone", [w.t.member.id, gone.id]);
    const chat = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", dmKey: [w.t.member.id, gone.id].sort().join("|"), members: { create: [{ userId: w.t.member.id }, { userId: gone.id }] } } });
    expect(titles((await ask(w.t.member.id, chat.id)).groups)).toEqual(["G-with-gone"]);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: gone.id } }, data: { status: "SUSPENDED" } });
    const r = await ask(w.t.member.id, chat.id);
    expect(r.status).toBe(200);
    expect(r.groups).toEqual([]);
  });
});
