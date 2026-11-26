import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { GET as settingsGET } from "@/app/api/spaces/[id]/settings/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * The phone's door to «إعدادات المساحة» (M2 N6 batch 11): `GET /api/spaces/[id]/settings` answers what the page draws (`spaceSettingsFor`): the tabs the
 * person is offered and the read-only parts. The space's manager gets «عام · الدردشة · الشغل»; a plain member «الناس · المقاطع» only; somebody not in
 * the space, a partner, and anybody while the switch is off get «not found».
 */

const get = (id: string) => call(settingsGET, { url: `http://localhost/api/spaces/${id}/settings`, params: { id } });
type S = { id: string; tabs: string[]; facts: { manager: boolean }; starters: unknown[]; work: { columns: unknown[] } };

async function world(on = true) {
  const t = await makeTeam();
  const space = await makeWorkspace(t.org.id, [{ userId: t.admin.id, role: "ADMIN" }, { userId: t.member.id, role: "MEMBER" }, { userId: t.guest.id, role: "MEMBER" }]);
  const other = await makeWorkspace(t.org.id, []);
  const org = await db.organization.findUniqueOrThrow({ where: { id: t.org.id } });
  await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature(org.settings, "controlPanelV2", on) as Prisma.InputJsonValue } });
  return { ...t, space, other };
}

describe("GET /api/spaces/[id]/settings", () => {
  it("the space's manager is offered its settings with the read-only parts; a plain member the people and the teams", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const r = await get(w.space.id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const a = r.json as S;
    expect(a.facts.manager).toBe(true);
    expect(a.tabs).toEqual(expect.arrayContaining(["general", "people", "teams", "chat", "work"]));
    expect(a.starters.length).toBeGreaterThan(0);
    expect(a.work.columns.length).toBeGreaterThan(0);

    await loginAs(w.member.id);
    const m = (await get(w.space.id)).json as S;
    expect(m.facts.manager).toBe(false);
    expect(m.tabs).toEqual(["people", "teams"]);
  });

  it("a space the person is not in, a partner, and the switch off: «not found»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await get(w.other.id)).status).toBe(404);
    await loginAs(w.guest.id);
    expect((await get(w.space.id)).status).toBe(404);
    const off = await world(false);
    await loginAs(off.owner.id);
    expect((await get(off.space.id)).status).toBe(404);
  });
});
