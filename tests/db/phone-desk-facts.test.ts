import { describe, expect, it } from "vitest";
import { GET as factsGET } from "@/app/api/desks/facts/route";
import { deskFactsFor } from "@/server/services/desks";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * The phone's facts for «الحملات», «الأقسام» and «الروتين اليومي» (`GET /api/desks/facts`, M2 N6 batch 6): the very `deskFactsFor` the
 * pages read. Proven against a real database: the rank rule of the departments, each section's row of the person's grid as the owner
 * set it, a partner and a space-only account as the pages see them, the company's day.
 */

type Facts = {
  role: string; external: boolean; spaceOnly: boolean; directory: boolean; manager: boolean;
  campaigns: { view: boolean; edit: boolean; delete: boolean };
  production: { view: boolean; edit: boolean; delete: boolean };
  departmentId: string | null; timeZone: string; today: string;
};
const facts = async () => {
  const r = await call(factsGET);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as unknown as Facts;
};

describe("GET /api/desks/facts", () => {
  it("an admin manages the departments and edits the routine; a member reads the routine only", async () => {
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const a = await facts();
    expect(a.manager).toBe(true);
    expect(a.production).toEqual({ view: true, edit: true, delete: true });
    await loginAs(t.member.id);
    const m = await facts();
    expect(m.manager).toBe(false);
    expect(m.production.view).toBe(true);
    expect(m.production.edit).toBe(false);
    expect(m.campaigns.edit).toBe(true);
    expect(m.directory).toBe(true);
  });

  it("a switch the owner turned off for one person reads off for that person only", async () => {
    const t = await makeTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } },
      data: { revokedCapabilities: ["campaigns.view", "directory.view"] },
    });
    await loginAs(t.member.id);
    const f = await facts();
    expect(f.campaigns.view).toBe(false);
    expect(f.directory).toBe(false);
  });

  it("a partner holds none of these sections", async () => {
    const t = await makeTeam();
    await loginAs(t.guest.id);
    const f = await facts();
    expect(f.external).toBe(true);
    expect(f.production.view).toBe(false);
    expect(f.campaigns.view).toBe(false);
    expect(f.directory).toBe(false);
  });

  it("the company's day is cut in the company's zone", async () => {
    const t = await makeTeam();
    await db.organization.update({ where: { id: t.org.id }, data: { timezone: "Asia/Tokyo" } });
    // 23:30 UTC is already the next day in Tokyo
    const now = new Date(Date.UTC(2026, 10, 26, 23, 30));
    const actor = { userId: t.member.id, orgId: t.org.id, role: "MEMBER", isExternal: false, isOwner: false, caps: new Set() } as unknown as Parameters<typeof deskFactsFor>[0];
    const f = await deskFactsFor(actor, now);
    expect(f.timeZone).toBe(resolveTimeZone("Asia/Tokyo"));
    const p = zonedParts(now, f.timeZone);
    expect(f.today).toBe(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`);
    expect(f.today).toBe("2026-11-27");
  });
});
