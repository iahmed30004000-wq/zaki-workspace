import { describe, expect, it } from "vitest";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { call, db, loginAs, logout, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { giveSecondHome, setStatus } from "./spaces-helpers";

/**
 * GET /api/workspaces — the workspace switcher. The OWNER lists every space of the organization;
 * everybody else (an ADMIN included) only the spaces they have a row in, and only while they are
 * ACTIVE members.
 */

interface Listing {
  organizations: {
    id: string;
    name: string;
    keyPrefix: string;
    role: string;
    canCreateSpaces: boolean;
    workspaces: { id: string; name: string; slug: string }[];
  }[];
}

async function list() {
  const res = await call(workspacesRoute.GET);
  return { status: res.status, body: res.json as unknown as Listing };
}

const idsOf = (body: Listing, orgId: string) => body.organizations.find((o) => o.id === orgId)?.workspaces.map((w) => w.id).sort();

/** Three spaces: A (member, lead as its admin, guest), B (member, admin), C (nobody at all). */
async function listWorld() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  const a = await makeWorkspace(
    team.org.id,
    [
      { userId: team.member.id },
      { userId: lead.id, role: "ADMIN" },
      { userId: team.guest.id, role: "GUEST" },
    ],
    "A space",
  );
  const b = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.admin.id }], "B space");
  const c = await makeWorkspace(team.org.id, [], "C space");
  return { ...team, lead, a, b, c };
}

describe("GET /api/workspaces: who sees which space", () => {
  it("an anonymous caller is refused", async () => {
    logout();
    expect((await list()).status).toBe(401);
  });

  it("the OWNER lists every space of the organization, in name order, without being in any of them", async () => {
    const w = await listWorld();
    await loginAs(w.owner.id);
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.organizations.find((o) => o.id === w.org.id)?.workspaces.map((s) => s.name)).toEqual(["A space", "B space", "C space"]);
    expect(await db.workspaceMember.count({ where: { userId: w.owner.id } })).toBe(0); // looking makes no row
  });

  it("an ADMIN lists only the spaces they are in: not C, not A, even though they run the company's accounts", async () => {
    const w = await listWorld();
    await loginAs(w.admin.id);
    const { body } = await list();
    expect(idsOf(body, w.org.id)).toEqual([w.b.id]);
    expect(JSON.stringify(body)).not.toContain(w.a.id);
    expect(JSON.stringify(body)).not.toContain(w.c.id);
  });

  it("an ADMIN who is in no space still sees their organization, with an empty list", async () => {
    const w = await listWorld();
    await db.workspaceMember.deleteMany({ where: { userId: w.admin.id } });
    await loginAs(w.admin.id);
    const { body } = await list();
    expect(body.organizations.map((o) => o.id)).toEqual([w.org.id]);
    expect(idsOf(body, w.org.id)).toEqual([]);
  });

  it("a LEAD, a MEMBER and a GUEST each list exactly the spaces they have a row in", async () => {
    const w = await listWorld();
    await loginAs(w.lead.id);
    expect(idsOf((await list()).body, w.org.id)).toEqual([w.a.id]);
    await loginAs(w.member.id);
    expect(idsOf((await list()).body, w.org.id)).toEqual([w.a.id, w.b.id].sort());
    await loginAs(w.guest.id);
    expect(idsOf((await list()).body, w.org.id)).toEqual([w.a.id]);
  });

  it("keeps the shape the switcher reads: organizations with id, name, keyPrefix, role and workspaces with id, name, slug", async () => {
    const w = await listWorld();
    await loginAs(w.member.id);
    const org = (await list()).body.organizations[0]!;
    expect(org).toMatchObject({ id: w.org.id, name: w.org.name, keyPrefix: w.org.keyPrefix, role: "MEMBER" });
    // + holdsProjects (2026-10-25): false for «الشركة», where no project is opened
    // + emoji and unread (2026-10-25, the space you are in): the switcher's face of each space and what waits there
    // + overdue (N1.2): the overdue tasks of the person in that space, for the new shell's switcher
    expect(Object.keys(org.workspaces[0]!).sort()).toEqual(["emoji", "holdsProjects", "id", "name", "overdue", "slug", "unread"]);
  });

  it("never lists another organization's spaces, and a person in two organizations gets each one by its own rule", async () => {
    const w = await listWorld();
    const other = await listWorld();
    await loginAs(w.owner.id);
    expect(JSON.stringify((await list()).body)).not.toContain(other.a.id);

    // a plain member of the first org (in A only), the OWNER of a second one (sees all of it)
    const multi = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Multi" });
    await db.workspaceMember.create({ data: { workspaceId: w.a.id, userId: multi.id, role: "MEMBER" } });
    await db.organizationMember.create({
      data: { organizationId: other.org.id, userId: multi.id, role: "OWNER", createdAt: new Date(Date.now() + 5_000) },
    });
    await loginAs(multi.id);
    const { body } = await list();
    expect(idsOf(body, w.org.id)).toEqual([w.a.id]);
    expect(idsOf(body, other.org.id)).toEqual([other.a.id, other.b.id, other.c.id].sort());
  });
});

describe("GET /api/workspaces: only ACTIVE members, and what they may do", () => {
  it.each(["SUSPENDED", "OFFBOARDED"] as const)(
    "a %s person is signed out at once (401), keeps their rows, and gets everything back when reactivated",
    async (status) => {
      const w = await listWorld();
      await loginAs(w.member.id);
      expect((await list()).status).toBe(200);
      await setStatus(w.org.id, w.member.id, status);
      expect((await list()).status).toBe(401);
      expect(await db.workspaceMember.count({ where: { userId: w.member.id } })).toBe(2);

      await setStatus(w.org.id, w.member.id, "ACTIVE");
      await loginAs(w.member.id);
      expect(idsOf((await list()).body, w.org.id)).toEqual([w.a.id, w.b.id].sort());
    },
  );

  it.each(["SUSPENDED", "OFFBOARDED"] as const)(
    "a person %s in one organization but ACTIVE in another does not get the first one's spaces, nor the organization itself",
    async (status) => {
      const w = await listWorld();
      const second = await giveSecondHome(w.member.id);
      await loginAs(w.member.id); // the session stays valid: they still have an ACTIVE membership
      await setStatus(w.org.id, w.member.id, status, { endSessions: false });
      const { status: code, body } = await list();
      expect(code).toBe(200);
      expect(body.organizations.map((o) => o.id)).toEqual([second.id]);
      expect(JSON.stringify(body)).not.toContain(w.a.id);
      expect(JSON.stringify(body)).not.toContain(w.b.id);
    },
  );

  it("a suspended OWNER does not list the company's spaces either", async () => {
    const w = await listWorld();
    const second = await giveSecondHome(w.owner.id);
    await loginAs(w.owner.id);
    await setStatus(w.org.id, w.owner.id, "SUSPENDED", { endSessions: false });
    const { body } = await list();
    expect(body.organizations.map((o) => o.id)).toEqual([second.id]);
  });

  it("says, per organization, whether the caller may open a new space (canCreateSpaces)", async () => {
    const w = await listWorld();
    // the owner and the admins by rank; a lead, a member and a guest not (the owner's decision, 2026-10-25)
    for (const who of ["owner", "admin"] as const) {
      await loginAs(w[who].id);
      expect((await list()).body.organizations[0]!.canCreateSpaces, who).toBe(true);
    }
    for (const who of ["lead", "member", "guest"] as const) {
      await loginAs(w[who].id);
      expect((await list()).body.organizations[0]!.canCreateSpaces, who).toBe(false);
    }

    // switched on for one person by name: true for them, and the others are not affected
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { capabilities: ["spaces.create"] },
    });
    await loginAs(w.member.id);
    expect((await list()).body.organizations[0]!.canCreateSpaces).toBe(true);
    await loginAs(w.lead.id);
    expect((await list()).body.organizations[0]!.canCreateSpaces).toBe(false);

    // and switched off for an admin: false
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } },
      data: { revokedCapabilities: ["spaces.create"] },
    });
    await loginAs(w.admin.id);
    expect((await list()).body.organizations[0]!.canCreateSpaces).toBe(false);
  });

  it("canCreateSpaces is judged in each organization separately", async () => {
    const w = await listWorld();
    const second = await giveSecondHome(w.member.id, "OWNER");
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { revokedCapabilities: ["spaces.create"] },
    });
    await loginAs(w.member.id);
    const { body } = await list();
    expect(body.organizations.find((o) => o.id === w.org.id)?.canCreateSpaces).toBe(false);
    expect(body.organizations.find((o) => o.id === second.id)?.canCreateSpaces).toBe(true);
  });
});
