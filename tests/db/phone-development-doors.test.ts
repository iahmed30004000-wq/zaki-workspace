import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { GET as homeGET } from "@/app/api/team-development/home/route";
import { GET as personGET } from "@/app/api/team-development/people/[id]/route";
import { GET as factsGET } from "@/app/api/desks/facts/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";

/**
 * The phone's doors to «الأداء والتطوير» (M2 N6 batch 9): `GET /api/team-development/home` (who the viewer reads, and the periods named)
 * and `GET /api/team-development/people/[id]` (one person's header). The same services as the pages, so the same reach: the owner
 * everybody, a supervisor their people, anybody else only themselves; outside that 404, never 403; a partner and a switched-off feature 404.
 */

async function world(on = true) {
  const t = await makeTeam();
  const orgId = t.org.id;
  const sup = await makeUser({ orgId, role: "LEAD", name: "المسؤول" });
  const report = await makeUser({ orgId, role: "MEMBER", name: "تحت المسؤول" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: report.id } }, data: { managerId: sup.id } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "teamDevelopment", on) as Prisma.InputJsonValue } });
  return { ...t, sup, report };
}

const home = () => call(homeGET, { url: "http://localhost/api/team-development/home" });
const person = (id: string) => call(personGET, { url: `http://localhost/api/team-development/people/${id}`, params: { id } });
type Home = { home: { mode: string; viewerId: string; people: { userId: string }[] }; periods: { key: string; kind: string; label: string }[] };

describe("GET /api/team-development/home", () => {
  it("the owner reads everybody, a supervisor their people, anybody else only themselves; the periods come named", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const o = (await home()).json as Home;
    expect(o.home.mode).toBe("owner");
    expect(o.home.people.map((p) => p.userId)).toContain(w.report.id);
    expect(o.periods.length).toBe(17);
    expect(o.periods.filter((p) => p.kind === "quarter").length).toBe(5);
    for (const p of o.periods) {
      expect(p.label.length, p.key).toBeGreaterThan(0);
      expect(p.label, p.key).not.toContain("teamdev.");
    }

    await loginAs(w.sup.id);
    const s = (await home()).json as Home;
    expect(s.home.mode).toBe("supervisor");
    expect(s.home.people.map((p) => p.userId)).toEqual([w.report.id]);

    await loginAs(w.member.id);
    const m = (await home()).json as Home;
    expect(m.home.mode).toBe("self");
    expect(m.home.viewerId).toBe(w.member.id);
    expect(m.home.people).toEqual([]);
  });

  it("a partner, and anybody while the feature is switched off, get «not found»", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    expect((await home()).status).toBe(404);
    const off = await world(false);
    await loginAs(off.owner.id);
    expect((await home()).status).toBe(404);
  });
});

describe("GET /api/desks/facts — whether the phone offers these sections", () => {
  it("development: on for staff while the switch is on, never for a partner; spaces: the owner and the admins", async () => {
    const w = await world();
    type F = { development: boolean; spaces: boolean };
    const facts = async (id: string) => {
      await loginAs(id);
      return (await call(factsGET)).json as F;
    };
    expect(await facts(w.owner.id)).toMatchObject({ development: true, spaces: true });
    expect(await facts(w.admin.id)).toMatchObject({ development: true, spaces: true });
    expect(await facts(w.member.id)).toMatchObject({ development: true, spaces: false });
    expect(await facts(w.guest.id)).toMatchObject({ development: false, spaces: false });
    const off = await world(false);
    expect(await facts(off.owner.id)).toMatchObject({ development: false, spaces: true });
  });
});

describe("GET /api/team-development/people/[id]", () => {
  it("the person, their supervisor and the owner open the header; another employee gets «not found»", async () => {
    const w = await world();
    type P = { person: { userId: string; isSelf: boolean; canEnter: boolean; supervisor: { userId: string } | null }; periods: unknown[] };
    await loginAs(w.report.id);
    const self = (await person(w.report.id)).json as P;
    expect(self.person.isSelf).toBe(true);
    expect(self.person.canEnter).toBe(false);
    expect(self.person.supervisor?.userId).toBe(w.sup.id);
    expect(self.periods.length).toBe(17);

    await loginAs(w.owner.id);
    const r = await person(w.report.id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((r.json as P).person.isSelf).toBe(false);

    await loginAs(w.sup.id);
    expect((await person(w.report.id)).status).toBe(200);

    await loginAs(w.member.id);
    expect((await person(w.report.id)).status).toBe(404);
    await loginAs(w.guest.id);
    expect((await person(w.report.id)).status).toBe(404);
  });
});
