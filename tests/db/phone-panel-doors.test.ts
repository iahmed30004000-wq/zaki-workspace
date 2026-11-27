import { describe, expect, it } from "vitest";
import { GET as analyticsGET } from "@/app/api/analytics/route";
import { GET as homeGET } from "@/app/api/control-panel/home/route";
import { GET as reportsGET } from "@/app/api/control-panel/reports/route";
import { GET as factsGET } from "@/app/api/desks/facts/route";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * The phone's doors to «التقارير» (`GET /api/analytics`) and to the owner's «لوحة التحكم» (`GET /api/control-panel/home`, `/reports`), and
 * the facts that decide which of them the phone offers (M2 N6 batch 7). Proven against a real database: the reports box of the grid,
 * the panel for the owner alone and «not found» for anybody else, the insight sentences already in Arabic, a partner nowhere.
 */

describe("GET /api/analytics", () => {
  it("the owner reads the numbers; a partner and somebody whose reports box is off are refused", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    const r = await call(analyticsGET);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const body = r.json as { total: number; byPriority: unknown[]; workload: { name: string }[] };
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.byPriority)).toBe(true);
    await loginAs(t.guest.id);
    expect((await call(analyticsGET)).status).toBe(403);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.admin.id } },
      data: { revokedCapabilities: ["reports.view"] },
    });
    await loginAs(t.admin.id);
    expect((await call(analyticsGET)).status).toBe(403);
  });
});

describe("GET /api/control-panel/home and /reports — the owner's panel", () => {
  it("the owner reads the home with each insight written in Arabic, and the reports", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    const r = await call(homeGET);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const home = r.json as { kpis: { staff: number }; insights: { id: string; sentence: string; formula: string }[] };
    expect(home.kpis.staff).toBeGreaterThan(0);
    for (const i of home.insights) {
      expect(i.sentence.length, i.id).toBeGreaterThan(0);
      expect(i.sentence, i.id).not.toContain("cp.i.");
      expect(i.formula, i.id).not.toContain("cp.f.");
    }
    const rep = await call(reportsGET, { url: "http://localhost/api/control-panel/reports" });
    expect(rep.status, JSON.stringify(rep.json)).toBe(200);
    expect((rep.json as { series: unknown[] }).series.length).toBe(8);
  });

  it("an admin, a member and a partner get «not found», and so does the owner with the panel switched off", async () => {
    const t = await makeTeam();
    for (const who of [t.admin, t.member, t.guest]) {
      await loginAs(who.id);
      expect((await call(homeGET)).status, who.name).toBe(404);
      expect((await call(reportsGET, { url: "http://localhost/api/control-panel/reports" })).status, who.name).toBe(404);
    }
    await db.organization.update({ where: { id: t.org.id }, data: { settings: { features: { controlPanel: false } } } });
    await loginAs(t.owner.id);
    expect((await call(homeGET)).status).toBe(404);
  });
});

describe("GET /api/desks/facts — which of these the phone offers", () => {
  it("the owner: the panel and the owner's board; a member: their own page; a partner: none", async () => {
    const t = await makeTeam();
    type F = { board: string | null; panel: boolean; reports: boolean; prices: boolean; crm: { view: boolean } };
    await loginAs(t.owner.id);
    const o = (await call(factsGET)).json as F;
    expect(o.panel).toBe(true);
    expect(o.board).toBe("owner");
    expect(o.prices).toBe(true);
    await loginAs(t.member.id);
    const m = (await call(factsGET)).json as F;
    expect(m.panel).toBe(false);
    expect(m.board).toBe("self");
    await loginAs(t.guest.id);
    const g = (await call(factsGET)).json as F;
    expect(g.board).toBeNull();
    expect(g.panel).toBe(false);
    expect(g.reports).toBe(false);
    expect(g.crm.view).toBe(false);
  });
});
