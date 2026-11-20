import { describe, expect, it } from "vitest";
import { hasTeam, loadPeopleScope, managedSpaceIds } from "@/server/policy/people-scope";
import { devAccess } from "@/server/policy/team-development";
import { boardAccess } from "@/server/policy/board";
import { withFeature } from "@/lib/features";
import type { Prisma } from "@prisma/client";
import { db, makeOrg, makeUser, makeWorkspace } from "./helpers";
import { actorOf, setMember, world } from "./today-helpers";

/**
 * A2.3 — «فريقي» has ONE meaning, decided by `loadPeopleScope`: everybody under me in the reporting line (managerId, transitive, ACTIVE,
 * same company, depth ≤ 6). The OWNER rank that still holds `board.team` has the company; nobody under me means NO team (not an empty one).
 */

async function feature(orgId: string, key: Parameters<typeof withFeature>[1], on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

const under = (orgId: string, userId: string, managerId: string | null) => setMember(orgId, userId, { managerId });

describe("loadPeopleScope — who is «my team»", () => {
  it("a person with reports has them, direct and indirect; a person with none has no team", async () => {
    const w = await world();
    await under(w.org.id, w.lead.id, w.admin.id);
    await under(w.org.id, w.member.id, w.lead.id);
    const admin = await loadPeopleScope(await actorOf(w.admin.id));
    expect(admin.kind).toBe("reports");
    expect([...admin.reportIds].sort()).toEqual([w.lead.id, w.member.id].sort());
    const lead = await loadPeopleScope(await actorOf(w.lead.id));
    expect([...lead.reportIds]).toEqual([w.member.id]);
    const member = await loadPeopleScope(await actorOf(w.member.id));
    expect(member.kind).toBe("none");
    expect(hasTeam(member)).toBe(false);
    expect(member.reportIds.size).toBe(0);
  });

  it("the OWNER rank holding board.team has the company; a partner who lost board.team falls back to the people under them", async () => {
    const w = await world();
    const partner = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Partner" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: partner.id } }, data: { primaryOwner: false } });
    expect((await loadPeopleScope(await actorOf(w.owner.id))).kind).toBe("company");
    expect((await loadPeopleScope(await actorOf(partner.id))).kind).toBe("company");

    await setMember(w.org.id, partner.id, { revokedCapabilities: ["board.team"] });
    expect((await loadPeopleScope(await actorOf(partner.id))).kind).toBe("none"); // nobody under them: no team
    await under(w.org.id, w.member.id, partner.id);
    const mine = await loadPeopleScope(await actorOf(partner.id));
    expect(mine.kind).toBe("reports");
    expect([...mine.reportIds]).toEqual([w.member.id]);
  });

  it("users.manage no longer makes a team: a holder with nobody under them has none", async () => {
    const w = await world();
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    expect((await loadPeopleScope(await actorOf(w.member.id))).kind).toBe("none");
    expect((await loadPeopleScope(await actorOf(w.admin.id))).kind).toBe("none");
  });

  it("lists ACTIVE staff only, walks through a suspended person, and never lists a guest", async () => {
    const w = await world();
    const mid = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Mid" });
    const gone = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Gone" });
    await under(w.org.id, mid.id, w.admin.id);
    await under(w.org.id, w.member.id, mid.id);
    await under(w.org.id, gone.id, w.admin.id);
    await under(w.org.id, w.guest.id, w.admin.id);
    await setMember(w.org.id, mid.id, { status: "SUSPENDED" });
    await setMember(w.org.id, gone.id, { status: "OFFBOARDED" });
    const scope = await loadPeopleScope(await actorOf(w.admin.id));
    expect([...scope.reportIds]).toEqual([w.member.id]);
  });

  it("the line is per company: somebody who answers to me in ANOTHER company is not on my team here", async () => {
    const w = await world();
    const other = await makeOrg();
    const both = await makeUser({ orgId: other.id, role: "MEMBER", name: "Both" });
    await db.organizationMember.create({ data: { organizationId: w.org.id, userId: both.id, role: "MEMBER" } });
    // in the OTHER company the admin of this one manages `both`
    const outsider = await makeUser({ orgId: other.id, role: "ADMIN", name: "Outsider" });
    await under(other.id, both.id, outsider.id);
    await under(w.org.id, both.id, w.admin.id);
    await under(other.id, both.id, w.admin.id); // the same user id as a manager in another company: a row of the other company
    const scope = await loadPeopleScope(await actorOf(w.admin.id));
    expect([...scope.reportIds]).toEqual([both.id]); // only through THIS company's row
    expect((await loadPeopleScope(await actorOf(outsider.id))).kind).toBe("none"); // outsider's report row now names somebody else
  });

  it("an external partner has no team, whatever a stored line says", async () => {
    const w = await world();
    await under(w.org.id, w.member.id, w.guest.id);
    expect((await loadPeopleScope(await actorOf(w.guest.id))).kind).toBe("none");
  });
});

describe("managedSpaceIds — the SPACE numbers are a separate thing", () => {
  it("lists the spaces a person manages (their ADMIN row), not the ones they only work in, and not an archived one", async () => {
    const w = await world();
    const managed = await makeWorkspace(w.org.id, [{ userId: w.lead.id, role: "ADMIN" }], "مساحة يديرها");
    const archived = await makeWorkspace(w.org.id, [{ userId: w.lead.id, role: "ADMIN" }], "مؤرشفة");
    await db.workspace.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const actor = await actorOf(w.lead.id);
    expect(await managedSpaceIds(actor)).toEqual([managed.id]);
    // the lead has no reports: managing a space does not make a team
    expect(hasTeam(await loadPeopleScope(actor))).toBe(false);
  });
});

describe("one rule in both policies", () => {
  it("«الأداء والتطوير» (devAccess) reaches exactly the people loadPeopleScope names", async () => {
    const w = await world();
    await feature(w.org.id, "teamDevelopment", true);
    await under(w.org.id, w.lead.id, w.admin.id);
    await under(w.org.id, w.member.id, w.lead.id);
    const actor = await actorOf(w.admin.id);
    const dev = await devAccess(actor);
    const mine = await loadPeopleScope(actor);
    expect([...(dev.reach ?? [])].sort()).toEqual([...mine.reportIds].sort());
    expect(dev.isSupervisor).toBe(true);
  });

  it("«لوحة الفريق» (board.team) can open the people under the viewer (their reporting line), besides their spaces' people", async () => {
    const w = await world();
    await feature(w.org.id, "ownerBoard", true);
    await setMember(w.org.id, w.admin.id, { capabilities: ["board.team"] });
    await under(w.org.id, w.member.id, w.admin.id); // the member works in a space the admin is NOT in
    const access = await boardAccess(await actorOf(w.admin.id));
    expect(access.mode).toBe("team");
    expect([...(access.reach ?? [])]).toContain(w.member.id);
    expect(access.team ? [...access.team] : []).toEqual([w.member.id]);
  });
});
