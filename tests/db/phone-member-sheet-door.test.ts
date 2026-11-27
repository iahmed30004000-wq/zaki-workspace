import { describe, expect, it } from "vitest";
import { GET as sheetGET } from "@/app/api/organizations/[id]/members/[userId]/sheet/route";
import { GET as factsGET } from "@/app/api/desks/facts/route";
import { call, loginAs, makeTeam, makeUser } from "./helpers";
import { accountsApi } from "./accounts-helpers";

/**
 * The phone's door to one person's sheet of «الحسابات والصلاحيات» (M2 N6 batch 12): `GET /api/organizations/[id]/members/[userId]/sheet` answers what the
 * site's sheet decides with its own functions: the actions offered, the permission areas with each switch's lock, and the lists a flip sends. A flip
 * sent through the site's own PATCH with those lists lands; nobody acts on the OWNER; somebody without `users.manage` is refused.
 */

type Row = { capability: string; on: boolean; locked: string | null; next: { capabilities: string[]; revokedCapabilities: string[] } };
type Sheet = {
  member: { id: string; role: string };
  acts: { manageable: boolean; suspend: boolean; offboard: boolean; capabilities: string; rankChoices: string[] };
  roles: string[];
  areas: { id: string; rows: Row[]; grid: { section: string; cells: (Row | null)[] }[] }[];
  managers: { id: string }[];
  receivers: { id: string }[];
  explain: { id: string; rows: { capability: string; usable: boolean; why: string }[] }[];
};

const sheet = (orgId: string, userId: string) => call(sheetGET, { url: `http://localhost/api/organizations/${orgId}/members/${userId}/sheet`, params: { id: orgId, userId } });

describe("GET /api/organizations/[id]/members/[userId]/sheet", () => {
  it("the owner gets a member's sheet; flipping a switch with the lists it carries lands", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    const r = await sheet(t.org.id, t.member.id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const s = r.json as Sheet;
    expect(s.acts).toMatchObject({ manageable: true, suspend: true, offboard: true, capabilities: "editable" });
    expect(s.roles).toContain("MEMBER");
    expect(s.receivers.map((p) => p.id)).not.toContain(t.member.id);
    expect(s.managers.map((p) => p.id)).toContain(t.owner.id);
    // «شو بيقدر يعمل؟»: every row says why, in the site's Arabic sentence (never a raw key)
    const why = s.explain.flatMap((a) => a.rows);
    expect(why.length).toBeGreaterThan(0);
    for (const w of why) expect(w.why).not.toMatch(/^perm\.|features\./);

    const row = s.areas.flatMap((a) => a.rows).find((x) => x.capability === "directory.view" && x.locked === null);
    expect(row, "directory.view is a switch the owner may flip").toBeDefined();
    const res = await accountsApi.update(t.org.id, t.member.id, row!.next);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const after = (await sheet(t.org.id, t.member.id)).json as Sheet;
    expect(after.areas.flatMap((a) => a.rows).find((x) => x.capability === "directory.view")!.on).toBe(!row!.on);
  });

  it("the OWNER's sheet is read-only to an admin; no `users.manage`: refused; another company's person: not found", async () => {
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const o = (await sheet(t.org.id, t.owner.id)).json as Sheet;
    expect(o.acts).toMatchObject({ manageable: false, suspend: false, capabilities: "owner" });
    expect(o.areas).toEqual([]);

    const outsider = (await makeTeam()).member;
    expect((await sheet(t.org.id, outsider.id)).status).toBe(404);

    await loginAs(t.member.id);
    expect((await sheet(t.org.id, t.guest.id)).status).toBe(403);
  });

  it("the phone offers «الحسابات» to whoever holds `users.manage` only", async () => {
    const t = await makeTeam();
    const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Lead" });
    const facts = async (id: string) => {
      await loginAs(id);
      return (await call(factsGET)).json as { accounts: boolean; orgId: string };
    };
    expect(await facts(t.owner.id)).toMatchObject({ accounts: true, orgId: t.org.id });
    expect((await facts(t.admin.id)).accounts).toBe(true);
    expect((await facts(lead.id)).accounts).toBe(false);
    expect((await facts(t.guest.id)).accounts).toBe(false);
  });
});
