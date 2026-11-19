/**
 * A1.2: «شو بيقدر يعمل؟» shows exactly what the server enforces (the acceptance line of docs/restructure/A1-permissions-and-panels.md),
 * and the «قائد الفرقة» picker writes `Team.leadId` through the teams door.
 *
 * `explainCapabilities` is pure and compared with `effectiveCapabilities` in tests/policy-capabilities.test.ts; here the same view is
 * compared with what the REAL server decides for REAL rows: the member list's own `effectiveCapabilities`, `memberCan` (the check every
 * service uses) and the door of «ضبط التصعيد», which also answers for the company's switch behind it.
 */
import { describe, expect, it } from "vitest";
import * as problemSettingsRoute from "@/app/api/tickets/problem-settings/route";
import * as teamRoute from "@/app/api/workspaces/[id]/teams/[teamId]/route";
import * as teamsRoute from "@/app/api/workspaces/[id]/teams/route";
import { CAPABILITIES, explainCapabilities } from "@/server/policy/capabilities";
import { memberCan } from "@/server/policy/actor";
import { listOrgMembers } from "@/server/services/org-members";
import { requireAccountsActor } from "@/server/services/accounts";
import { call, db, loginAs, makeOrg, makeUser } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

async function rowOf(orgId: string, userId: string) {
  return db.organizationMember.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true, capabilities: true, revokedCapabilities: true, primaryOwner: true, organization: { select: { settings: true } } },
  });
}

/** One company with a person of every shape worth checking: a stored extra, a stored removal, a partner, a guest with a stored extra. */
async function world() {
  const org = await makeOrg();
  const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
  const partner = await makeUser({ orgId: org.id, role: "OWNER", name: "Partner" });
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: org.id, userId: partner.id } },
    data: { primaryOwner: false, revokedCapabilities: ["prices.view", "archive.view", "tasks.view"] },
  });
  const admin = await makeUser({ orgId: org.id, role: "ADMIN", name: "Admin" });
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
    data: { revokedCapabilities: ["prices.view", "calls.view"], capabilities: ["board.team"] },
  });
  const lead = await makeUser({ orgId: org.id, role: "LEAD", name: "Lead" });
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: org.id, userId: lead.id } },
    data: { capabilities: ["users.manage", "goals.edit"], revokedCapabilities: ["tasks.view", "crm.edit"] },
  });
  const member = await makeUser({ orgId: org.id, role: "MEMBER", name: "Member" });
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
    data: { capabilities: ["integrations.manage", "announce.send"], revokedCapabilities: ["files.view", "directory.view"] },
  });
  const guest = await makeUser({ orgId: org.id, role: "GUEST", name: "Guest" });
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: org.id, userId: guest.id } },
    data: { capabilities: ["crm.view", "prices.view"] },
  });
  return { org, owner, partner, admin, lead, member, guest, everyone: [owner, partner, admin, lead, member, guest] };
}

async function setFeatures(orgId: string, features: Record<string, boolean>) {
  await db.organization.update({ where: { id: orgId }, data: { settings: { features } } });
}

describe("«شو بيقدر يعمل؟» agrees with the real server", () => {
  for (const gridOn of [true, false]) {
    it(`for every person of the company, with «صلاحيات الأقسام» ${gridOn ? "on" : "off"}: held = the member list's own answer = memberCan`, async () => {
      const w = await world();
      await setFeatures(w.org.id, { sectionPermissions: gridOn });

      await loginAs(w.owner.id);
      const listed = await listOrgMembers(await requireAccountsActor(w.org.id));
      expect(listed.sectionGrid).toBe(gridOn);

      for (const person of w.everyone) {
        const row = await rowOf(w.org.id, person.id);
        const explained = explainCapabilities(row, row.organization.settings);
        const held = explained.filter((e) => e.held).map((e) => e.capability).sort();

        const fromList = listed.members.find((m) => m.id === person.id);
        expect(fromList, person.name).toBeTruthy();
        expect(held, `${person.name}: the list`).toEqual([...(fromList?.effectiveCapabilities ?? [])].sort());

        for (const capability of CAPABILITIES) {
          const server = await memberCan({ orgId: w.org.id, userId: person.id }, capability);
          expect(server, `${person.name}: ${capability}`).toBe(explained.find((e) => e.capability === capability)?.held);
        }
      }
    }, 120_000);
  }

  it("the company's switch behind «ضبط التصعيد»: the view says unusable exactly while the door answers 404, and a removed box exactly while it answers 403", async () => {
    const w = await world();
    const explainFor = async (userId: string) => {
      const row = await rowOf(w.org.id, userId);
      return explainCapabilities(row, row.organization.settings).find((e) => e.capability === "escalation.configure")!;
    };

    // the switch starts OFF: the admin holds the box, the view says it is not usable, the door says «not found»
    await loginAs(w.admin.id);
    expect(await explainFor(w.admin.id)).toMatchObject({ held: true, usable: false, reason: "feature_off", feature: "autoTickets" });
    expect((await call(problemSettingsRoute.GET)).status).toBe(404);

    // switched on: usable, and the door opens
    await setFeatures(w.org.id, { autoTickets: true });
    expect(await explainFor(w.admin.id)).toMatchObject({ held: true, usable: true, reason: "rank_default" });
    expect((await call(problemSettingsRoute.GET)).status).toBe(200);

    // a member without the box: the view says the rank does not give it, the door says 403
    await loginAs(w.lead.id);
    expect(await explainFor(w.lead.id)).toMatchObject({ held: false, usable: false, reason: "rank_lacks" });
    expect((await call(problemSettingsRoute.GET)).status).toBe(403);

    // the owner takes the box away from the admin: «removed» in the view, 403 at the door
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } },
      data: { revokedCapabilities: ["escalation.configure"] },
    });
    await loginAs(w.admin.id);
    expect(await explainFor(w.admin.id)).toMatchObject({ held: false, usable: false, reason: "removed" });
    expect((await call(problemSettingsRoute.GET)).status).toBe(403);
  }, 120_000);
});

describe("«قائد الفرقة»: Team.leadId through the teams door", () => {
  it("a space manager chooses one of the team's own people, then none; the answer carries it", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    const set = await call(teamRoute.PATCH, { method: "PATCH", params: { id: w.s.id, teamId: w.x.id }, body: { leadId: w.alice.id } });
    expect(set.status).toBe(200);
    expect((await db.team.findUniqueOrThrow({ where: { id: w.x.id }, select: { leadId: true } })).leadId).toBe(w.alice.id);
    const listed = await call(teamsRoute.GET, { params: { id: w.s.id } });
    expect((listed.json?.["teams"] as { id: string; leadId: string | null }[]).find((t) => t.id === w.x.id)?.leadId).toBe(w.alice.id);

    const cleared = await call(teamRoute.PATCH, { method: "PATCH", params: { id: w.s.id, teamId: w.x.id }, body: { leadId: null } });
    expect(cleared.status).toBe(200);
    expect((await db.team.findUniqueOrThrow({ where: { id: w.x.id }, select: { leadId: true } })).leadId).toBeNull();
  });

  it("somebody who is not in the team can not lead it, and a member of the space can not choose a lead", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    const outsider = await call(teamRoute.PATCH, { method: "PATCH", params: { id: w.s.id, teamId: w.x.id }, body: { leadId: w.bob.id } });
    expect(outsider.status).toBe(403);
    expect(outsider.json?.["message"]).toBe("teams.lead_not_member");

    await loginAs(w.alice.id);
    const byMember = await call(teamRoute.PATCH, { method: "PATCH", params: { id: w.s.id, teamId: w.x.id }, body: { leadId: w.alice.id } });
    expect(byMember.status).toBe(403);
    expect((await db.team.findUniqueOrThrow({ where: { id: w.x.id }, select: { leadId: true } })).leadId).toBeNull();
  });

  it("a suspended or offboarded person is not made the lead (they would still read as the lead on «لوحة الفريق»)", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    for (const status of ["SUSPENDED", "OFFBOARDED"] as const) {
      await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.alice.id } }, data: { status } });
      const res = await call(teamRoute.PATCH, { method: "PATCH", params: { id: w.s.id, teamId: w.x.id }, body: { leadId: w.alice.id } });
      expect(res.status, status).toBe(403);
      expect(res.json?.["message"], status).toBe("teams.lead_not_active");
      expect((await db.team.findUniqueOrThrow({ where: { id: w.x.id }, select: { leadId: true } })).leadId, status).toBeNull();
    }
  });
});
