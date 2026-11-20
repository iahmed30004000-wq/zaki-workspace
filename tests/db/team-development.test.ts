import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

// the pages call notFound(); no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import type { Prisma } from "@prisma/client";
import * as linesRoute from "@/app/api/team-development/lines/route";
import * as lineRoute from "@/app/api/team-development/lines/[userId]/route";
import * as skillsRoute from "@/app/api/team-development/skills/route";
import * as skillRoute from "@/app/api/team-development/skills/[id]/route";
import * as matrixRoute from "@/app/api/team-development/skills/matrix/route";
import * as matrixCsvRoute from "@/app/api/team-development/skills/matrix/csv/route";
import * as personSkillsRoute from "@/app/api/team-development/people/[id]/skills/route";
import * as historyRoute from "@/app/api/team-development/people/[id]/skills/history/route";
import StructurePage from "@/app/(app)/structure/page";
import DevelopmentPage from "@/app/(app)/development/page";
import PersonPage from "@/app/(app)/development/people/[id]/page";
import SkillsPage from "@/app/(app)/development/skills/page";
import { withFeature } from "@/lib/features";
import { MAX_LINE_DEPTH } from "@/lib/team-development";
import { requireActor } from "@/server/policy/actor";
import { visibleNavFor } from "@/server/services/nav-order";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";
import { html } from "./today-helpers";

/**
 * «الأداء والتطوير», part 1 — the reporting lines («الهيكل») and the skills checklist, against a real PostgreSQL.
 *
 * What this pins:
 *  - lines: the owner and a `people.manage_lines` holder set who answers to whom, nobody else; no loop, no chain deeper than 6,
 *    a guest is never a manager or a report, the owner has no manager, a suspended manager is refused; the old account door
 *    (`accounts.assertManager`) holds the same depth rule;
 *  - who reads the tree: the owner everything, a supervisor their own subtree, an employee only their supervisor and the names of
 *    their team mates;
 *  - skills: the catalogue is the owner's and `people.manage_lines`'s, archived and never deleted, at most 100; a level is entered
 *    by the owner, or by a supervisor holding `people.review` for somebody in their subtree (MANUAL), or by the person about
 *    themselves (SELF); both are shown side by side; every change is a history row the database will not let anybody change;
 *  - reach: outside the subtree is 404 (never 403), the owner reads silently, a switched-off feature is 404 and has no tab.
 */

const get = (handler: unknown, init: { params?: Record<string, string>; url?: string } = {}) => call(handler, { url: init.url ?? "http://localhost/api/team-development", params: init.params ?? {} });
const send = (handler: unknown, method: string, body: unknown, params: Record<string, string> = {}) => call(handler, { method, body, params });
const as = (userId: string) => loginAs(userId);
const grant = (orgId: string, userId: string, data: { capabilities?: string[]; revokedCapabilities?: string[] }) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
const under = (orgId: string, userId: string, managerId: string | null) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { managerId } });

/**
 * One company. The shape:   owner ── sup ── (r1 ── rr1), r2        owner ── sup2 ── x        loose (nobody above)
 * plus a partner (a second OWNER), a guest and a stranger from another company.
 */
async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const mk = (name: string, role: "ADMIN" | "LEAD" | "MEMBER" | "OWNER" = "MEMBER") => makeUser({ orgId, role, name });
  const sup = await mk("المسؤول سين", "LEAD");
  const sup2 = await mk("مسؤول آخر", "MEMBER");
  const r1 = await mk("موظف واحد");
  const r2 = await mk("موظف اثنان");
  const rr1 = await mk("موظف تحت الواحد");
  const x = await mk("موظف عند الآخر");
  const loose = await mk("موظف بلا مسؤول");
  const partner = await mk("شريك", "OWNER");
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: partner.id } }, data: { primaryOwner: false } });
  await under(orgId, sup.id, t.owner.id);
  await under(orgId, sup2.id, t.owner.id);
  await under(orgId, r1.id, sup.id);
  await under(orgId, r2.id, sup.id);
  await under(orgId, rr1.id, r1.id);
  await under(orgId, x.id, sup2.id);
  const outsiderTeam = await makeTeam();
  return { ...t, sup, sup2, r1, r2, rr1, x, loose, partner, outsider: outsiderTeam.member, outsiderOwner: outsiderTeam.owner, outsiderOrgId: outsiderTeam.org.id, orgId };
}
type World = Awaited<ReturnType<typeof world>>;

const setFeature = async (w: World, on: boolean) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId } });
  await db.organization.update({ where: { id: w.orgId }, data: { settings: withFeature(org.settings, "teamDevelopment", on) as Prisma.InputJsonValue } });
};
const mkSkill = (w: World, name: string, extra: { category?: string; archivedAt?: Date | null } = {}) =>
  db.skill.create({ data: { organizationId: w.orgId, name, createdById: w.owner.id, ...extra } });

// ───────────────────────────────────────── the reporting lines ─────────────────────────────────────────

describe("«الهيكل»: who sets a line", () => {
  it("the owner and a partner set a supervisor; the line is audited and the person is moved", async () => {
    const w = await world();
    for (const setter of [w.owner, w.partner]) {
      await as(setter.id);
      const res = await send(lineRoute.PUT, "PUT", { managerId: w.sup2.id }, { userId: w.loose.id });
      expect(res.status, setter.name).toBe(200);
      expect((await db.organizationMember.findFirstOrThrow({ where: { organizationId: w.orgId, userId: w.loose.id } })).managerId).toBe(w.sup2.id);
    }
    expect(await db.auditLog.count({ where: { orgId: w.orgId, action: "org.member_updated", target: w.loose.id } })).toBeGreaterThanOrEqual(1);
    await as(w.owner.id);
    expect((await send(lineRoute.PUT, "PUT", { managerId: null }, { userId: w.loose.id })).status).toBe(200);
    expect((await db.organizationMember.findFirstOrThrow({ where: { organizationId: w.orgId, userId: w.loose.id } })).managerId).toBeNull();
  });

  it("a member, a lead, an admin and a guest are refused with 404 (the door is not offered); `people.manage_lines` opens it, `people.review` does not", async () => {
    const w = await world();
    for (const who of [w.member, w.sup, w.admin, w.guest, w.r1]) {
      await as(who.id);
      expect((await send(lineRoute.PUT, "PUT", { managerId: w.sup2.id }, { userId: w.loose.id })).status, who.name).toBe(404);
    }
    await grant(w.orgId, w.admin.id, { capabilities: ["people.review"] });
    await as(w.admin.id);
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.sup2.id }, { userId: w.loose.id })).status).toBe(404);
    await grant(w.orgId, w.admin.id, { capabilities: ["people.manage_lines"] });
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.sup2.id }, { userId: w.loose.id })).status).toBe(200);
    // a person from another company is not found by the owner of this one
    await as(w.owner.id);
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.sup2.id }, { userId: w.outsider.id })).status).toBe(404);
  });

  it("refuses a loop, a person under themselves, a guest on either side, the owner as a report and a suspended manager", async () => {
    const w = await world();
    await as(w.owner.id);
    // sup answers to nobody but the owner: putting sup under rr1 (who is below sup) closes a loop
    const loop = await send(lineRoute.PUT, "PUT", { managerId: w.rr1.id }, { userId: w.sup.id });
    expect(loop.status).toBe(422);
    expect(JSON.stringify(loop.json)).toContain("accounts.manager_cycle");
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.r1.id }, { userId: w.r1.id })).status).toBe(422);
    expect(JSON.stringify((await send(lineRoute.PUT, "PUT", { managerId: w.guest.id }, { userId: w.loose.id })).json)).toContain("accounts.manager_invalid");
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.sup.id }, { userId: w.guest.id })).status).toBe(404);
    const owner = await send(lineRoute.PUT, "PUT", { managerId: w.sup.id }, { userId: w.owner.id });
    expect(owner.status).toBe(422);
    expect(JSON.stringify(owner.json)).toContain("teamdev.owner_no_manager");
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.sup2.id }, data: { status: "SUSPENDED" } });
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.sup2.id }, { userId: w.loose.id })).status).toBe(422);
    // the owner can be somebody's supervisor
    expect((await send(lineRoute.PUT, "PUT", { managerId: w.owner.id }, { userId: w.loose.id })).status).toBe(200);
  });

  it("no chain longer than 6 supervisors: the seventh link is refused, by this door and by the account door", async () => {
    const w = await world();
    const chain = [w.owner.id];
    for (let i = 0; i < MAX_LINE_DEPTH; i++) {
      const p = await makeUser({ orgId: w.orgId, role: "MEMBER", name: `درجة ${i}` });
      await under(w.orgId, p.id, chain[chain.length - 1] as string);
      chain.push(p.id);
    }
    // the last person has MAX_LINE_DEPTH supervisors above them
    await as(w.owner.id);
    const deep = await send(lineRoute.PUT, "PUT", { managerId: chain[chain.length - 1] }, { userId: w.loose.id });
    expect(deep.status).toBe(422);
    expect(JSON.stringify(deep.json)).toContain("accounts.manager_too_deep");
    // moving a whole branch counts too: sup (with two levels below) under the deepest person is refused as well
    expect((await send(lineRoute.PUT, "PUT", { managerId: chain[chain.length - 2] }, { userId: w.sup.id })).status).toBe(422);
    // one level up is fine
    expect((await send(lineRoute.PUT, "PUT", { managerId: chain[chain.length - 2] }, { userId: w.loose.id })).status).toBe(200);
    // the people screen's own door applies the same rule
    const { updateAccount } = await import("@/server/services/accounts");
    await as(w.owner.id);
    const actor = await requireActor();
    await expect(updateAccount(actor, w.x.id, { managerId: chain[chain.length - 1] } as never)).rejects.toMatchObject({ issues: [{ path: "managerId", message: "accounts.manager_too_deep" }] });
  });
});

describe("«الهيكل»: who reads the tree", () => {
  const nodes = (json: Record<string, unknown> | null) => ((json?.["structure"] as { nodes: { userId: string }[] }).nodes ?? []).map((n) => n.userId);

  it("the owner reads the whole company, with the counts and the people nobody answers for", async () => {
    const w = await world();
    await as(w.owner.id);
    const res = await get(linesRoute.GET);
    expect(res.status).toBe(200);
    const s = res.json?.["structure"] as { mode: string; canManage: boolean; roots: string[]; unassigned: string[]; nodes: { userId: string; direct: number; total: number }[] };
    expect(s.mode).toBe("all");
    expect(s.canManage).toBe(true);
    expect(s.roots).toContain(w.owner.id);
    expect(s.unassigned).toContain(w.loose.id);
    expect(s.unassigned).not.toContain(w.r1.id);
    const sup = s.nodes.find((n) => n.userId === w.sup.id);
    expect(sup).toMatchObject({ direct: 2, total: 3 });
    // an external partner and another company's people are not in the tree
    expect(nodes(res.json)).not.toContain(w.guest.id);
    expect(nodes(res.json)).not.toContain(w.outsider.id);
  });

  it("a supervisor reads themselves and the people below them, nobody else; a plain employee only their supervisor and the names of their team mates", async () => {
    const w = await world();
    await as(w.sup.id);
    const mine = await get(linesRoute.GET);
    expect(mine.json?.["structure"]).toMatchObject({ mode: "subtree", canManage: false });
    expect(nodes(mine.json).sort()).toEqual([w.sup.id, w.r1.id, w.r2.id, w.rr1.id].sort());

    await as(w.r1.id);
    const emp = await get(linesRoute.GET);
    const s = emp.json?.["structure"] as { mode: string; nodes: unknown[]; me: { supervisor: { userId: string } | null; teamMates: { userId: string }[]; reports: number } };
    // r1 supervises rr1, so they read their own subtree; r2 is a plain employee
    expect(s.mode).toBe("subtree");
    await as(w.r2.id);
    const plain = (await get(linesRoute.GET)).json?.["structure"] as typeof s;
    expect(plain.mode).toBe("own");
    expect(plain.nodes).toEqual([]);
    expect(plain.me.supervisor?.userId).toBe(w.sup.id);
    expect(plain.me.teamMates.map((m) => m.userId)).toEqual([w.r1.id]);
    // names only: nothing about performance in the answer
    expect(JSON.stringify(plain)).not.toMatch(/score|level|rating/i);
  });

  it("a `people.manage_lines` holder reads the whole tree of names; a guest and the switched-off feature get 404", async () => {
    const w = await world();
    await grant(w.orgId, w.member.id, { capabilities: ["people.manage_lines"] });
    await as(w.member.id);
    const res = await get(linesRoute.GET);
    expect(res.json?.["structure"]).toMatchObject({ mode: "all", canManage: true });
    await as(w.guest.id);
    expect((await get(linesRoute.GET)).status).toBe(404);
    await setFeature(w, false);
    for (const who of [w.owner, w.member, w.sup]) {
      await as(who.id);
      expect((await get(linesRoute.GET)).status, who.name).toBe(404);
    }
  });

  it("a suspended person in the middle does not drop their people out of the tree", async () => {
    const w = await world();
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.r1.id }, data: { status: "SUSPENDED" } });
    await as(w.sup.id);
    const s = (await get(linesRoute.GET)).json?.["structure"] as { nodes: { userId: string; managerId: string | null }[] };
    expect(s.nodes.find((n) => n.userId === w.rr1.id)?.managerId).toBe(w.sup.id);
    expect(s.nodes.map((n) => n.userId)).not.toContain(w.r1.id);
  });
});

// ───────────────────────────────────────── the skills catalogue ─────────────────────────────────────────

describe("«المهارات»: the catalogue", () => {
  it("the owner and a `people.manage_lines` holder add, edit and archive; nobody deletes; a member is refused with 404", async () => {
    const w = await world();
    await as(w.owner.id);
    const made = await send(skillsRoute.POST, "POST", { name: "  التفاوض ", category: "مبيعات", description: "وصف" });
    expect(made.status).toBe(201);
    const id = (made.json?.["skill"] as { id: string; name: string }).id;
    expect((made.json?.["skill"] as { name: string }).name).toBe("التفاوض");
    expect((await send(skillRoute.PATCH, "PATCH", { name: "التفاوض المتقدم" }, { id })).status).toBe(200);
    expect((await send(skillRoute.PATCH, "PATCH", { archived: true }, { id })).status).toBe(200);
    expect(await db.skill.count({ where: { id } })).toBe(1);
    expect((await db.skill.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    // there is no DELETE handler at all
    expect("DELETE" in skillRoute).toBe(false);
    expect("DELETE" in skillsRoute).toBe(false);
    // the archived one is not offered to a plain reader, but those who keep it can list it
    await as(w.member.id);
    expect(((await get(skillsRoute.GET)).json?.["skills"] as unknown[]).length).toBe(0);
    expect((await send(skillsRoute.POST, "POST", { name: "ممنوع" })).status).toBe(404);
    expect((await send(skillRoute.PATCH, "PATCH", { archived: false }, { id })).status).toBe(404);
    await grant(w.orgId, w.member.id, { capabilities: ["people.manage_lines"] });
    expect((await send(skillsRoute.POST, "POST", { name: "الكتابة" })).status).toBe(201);
    const withArchived = await call(skillsRoute.GET, { url: "http://localhost/api/team-development/skills?archived=1" });
    expect((withArchived.json?.["skills"] as { id: string }[]).map((s) => s.id)).toContain(id);
  });

  it("limits: name 60, category 40, description 300, a live name once, at most 100 skills in all", async () => {
    const w = await world();
    await as(w.owner.id);
    expect(JSON.stringify((await send(skillsRoute.POST, "POST", { name: "ا".repeat(61) })).json)).toContain("teamdev.skill_name_long");
    expect(JSON.stringify((await send(skillsRoute.POST, "POST", { name: "س", category: "ا".repeat(41) })).json)).toContain("teamdev.skill_category_long");
    expect(JSON.stringify((await send(skillsRoute.POST, "POST", { name: "س", description: "ا".repeat(301) })).json)).toContain("teamdev.skill_description_long");
    expect((await send(skillsRoute.POST, "POST", { name: "" })).status).toBe(422);
    expect((await send(skillsRoute.POST, "POST", { name: "Excel" })).status).toBe(201);
    expect(JSON.stringify((await send(skillsRoute.POST, "POST", { name: "excel" })).json)).toContain("teamdev.skill_name_taken");
    await db.skill.createMany({ data: Array.from({ length: 98 }, (_, i) => ({ organizationId: w.orgId, name: `م${i}`, createdById: w.owner.id })) });
    const hundredth = await send(skillsRoute.POST, "POST", { name: "المئة" });
    expect(hundredth.status).toBe(201);
    const over = await send(skillsRoute.POST, "POST", { name: "المئة وواحد" });
    expect(over.status).toBe(422);
    expect(JSON.stringify(over.json)).toContain("teamdev.skill_limit");
    // archiving does not free a place (nothing is ever removed), and another company is not counted
    expect(await db.skill.count({ where: { organizationId: w.orgId } })).toBe(100);
  });

  it("an un-archive is refused while a live skill holds the same name", async () => {
    const w = await world();
    const old = await mkSkill(w, "تصوير", { archivedAt: new Date() });
    await mkSkill(w, "تصوير");
    await as(w.owner.id);
    const res = await send(skillRoute.PATCH, "PATCH", { archived: false }, { id: old.id });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain("teamdev.skill_name_taken");
  });
});

// ───────────────────────────────────────── a person's levels ─────────────────────────────────────────

describe("«المهارات»: who enters a level (the matrix of roles)", () => {
  const put = (viewer: string, userId: string, skillId: string, source: "MANUAL" | "SELF", level = 3, note = "") =>
    as(viewer).then(() => send(personSkillsRoute.PUT, "PUT", { skillId, source, level, note }, { id: userId }));

  it("MANUAL: the owner and a partner for anybody; a supervisor only with `people.review` and only inside their subtree; nobody else, never about oneself", async () => {
    const w = await world();
    const skill = await mkSkill(w, "قيادة");
    expect((await put(w.owner.id, w.r1.id, skill.id, "MANUAL")).status).toBe(200);
    expect((await put(w.partner.id, w.x.id, skill.id, "MANUAL")).status).toBe(200);
    // sup is r1's supervisor but holds no `people.review`: inside reach, so 403 (they already read the person)
    const noCap = await put(w.sup.id, w.r1.id, skill.id, "MANUAL", 2);
    expect(noCap.status).toBe(403);
    expect(JSON.stringify(noCap.json)).toContain("teamdev.review_denied");
    await grant(w.orgId, w.sup.id, { capabilities: ["people.review"] });
    expect((await put(w.sup.id, w.r1.id, skill.id, "MANUAL", 2)).status).toBe(200);
    expect((await put(w.sup.id, w.rr1.id, skill.id, "MANUAL", 1)).status).toBe(200); // indirect report
    // outside the subtree: 404, never 403
    expect((await put(w.sup.id, w.x.id, skill.id, "MANUAL")).status).toBe(404);
    expect((await put(w.sup.id, w.loose.id, skill.id, "MANUAL")).status).toBe(404);
    expect((await put(w.sup.id, w.owner.id, skill.id, "MANUAL")).status).toBe(404);
    // a peer, an employee about a colleague, about themselves, a guest, another company
    await grant(w.orgId, w.r2.id, { capabilities: ["people.review"] });
    expect((await put(w.r2.id, w.r1.id, skill.id, "MANUAL")).status).toBe(404);
    expect((await put(w.r2.id, w.r2.id, skill.id, "MANUAL")).status).toBe(404);
    expect((await put(w.guest.id, w.r1.id, skill.id, "MANUAL")).status).toBe(404);
    expect((await put(w.outsiderOwner.id, w.r1.id, skill.id, "MANUAL")).status).toBe(404);
    // the owner of another company does not reach this company's skill either
    expect(await db.personSkill.count({ where: { userId: w.x.id, source: "MANUAL", level: 3 } })).toBe(1);
  });

  it("SELF: the person about themselves only; a supervisor or the owner about somebody else is refused (403), a stranger gets 404", async () => {
    const w = await world();
    const skill = await mkSkill(w, "عرض");
    expect((await put(w.r1.id, w.r1.id, skill.id, "SELF", 2, "أعتقد")).status).toBe(200);
    expect((await put(w.sup.id, w.r1.id, skill.id, "SELF")).status).toBe(403);
    expect((await put(w.owner.id, w.r1.id, skill.id, "SELF")).status).toBe(403);
    expect((await put(w.r2.id, w.r1.id, skill.id, "SELF")).status).toBe(404);
    expect((await put(w.guest.id, w.guest.id, skill.id, "SELF")).status).toBe(404);
    // the owner may estimate himself
    expect((await put(w.owner.id, w.owner.id, skill.id, "SELF", 4)).status).toBe(200);
    expect(await db.personSkill.count({ where: { skillId: skill.id } })).toBe(2);
  });

  it("validation: a level is a whole number from 0 to 4, a note at most 300, an archived skill takes nothing, a skill of another company is not found", async () => {
    const w = await world();
    const skill = await mkSkill(w, "تحليل");
    const archived = await mkSkill(w, "قديمة", { archivedAt: new Date() });
    const foreign = await db.skill.create({ data: { organizationId: w.outsiderOrgId, name: "غريبة", createdById: w.outsiderOwner.id } });
    for (const level of [5, -1, 2.5]) expect((await put(w.owner.id, w.r1.id, skill.id, "MANUAL", level)).status, String(level)).toBe(422);
    expect(JSON.stringify((await put(w.owner.id, w.r1.id, skill.id, "MANUAL", 2, "ا".repeat(301))).json)).toContain("teamdev.note_long");
    expect((await put(w.owner.id, w.r1.id, skill.id, "MANUAL", 0)).status).toBe(200); // 0 is a level: «لا يعرف»
    expect(JSON.stringify((await put(w.owner.id, w.r1.id, archived.id, "MANUAL", 2)).json)).toContain("teamdev.skill_archived");
    expect((await put(w.owner.id, w.r1.id, foreign.id, "MANUAL", 2)).status).toBe(404);
    expect((await put(w.owner.id, w.r1.id, "nonexistent", "MANUAL", 2)).status).toBe(404);
  });

  it("an offboarded person takes no new level; a suspended person's file is the owner's alone", async () => {
    const w = await world();
    const skill = await mkSkill(w, "ترتيب");
    await grant(w.orgId, w.sup.id, { capabilities: ["people.review"] });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.r2.id }, data: { status: "SUSPENDED" } });
    expect((await put(w.sup.id, w.r2.id, skill.id, "MANUAL")).status).toBe(404);
    expect((await put(w.owner.id, w.r2.id, skill.id, "MANUAL")).status).toBe(404);
    await as(w.sup.id);
    expect((await get(personSkillsRoute.GET, { params: { id: w.r2.id } })).status).toBe(404);
    await as(w.owner.id);
    expect((await get(personSkillsRoute.GET, { params: { id: w.r2.id } })).status).toBe(200);
  });
});

describe("«المهارات»: reading, the gap, the history", () => {
  it("the person sees both columns and the gap; the supervisor and the owner see the same; a peer and an outsider get 404", async () => {
    const w = await world();
    const skill = await mkSkill(w, "تواصل");
    await as(w.owner.id);
    await send(personSkillsRoute.PUT, "PUT", { skillId: skill.id, source: "MANUAL", level: 4, note: "ممتاز" }, { id: w.r1.id });
    await as(w.r1.id);
    await send(personSkillsRoute.PUT, "PUT", { skillId: skill.id, source: "SELF", level: 2, note: "" }, { id: w.r1.id });
    for (const viewer of [w.r1, w.sup, w.owner, w.partner]) {
      await as(viewer.id);
      const res = await get(personSkillsRoute.GET, { params: { id: w.r1.id } });
      expect(res.status, viewer.name).toBe(200);
      const rows = res.json?.["skills"] as { skill: { id: string }; manual: { level: number; note: string } | null; self: { level: number } | null; gap: number | null }[];
      const row = rows.find((r) => r.skill.id === skill.id);
      expect(row?.manual).toMatchObject({ level: 4, note: "ممتاز" });
      expect(row?.self).toMatchObject({ level: 2 });
      expect(row?.gap).toBe(2);
    }
    for (const viewer of [w.r2, w.sup2, w.x, w.guest, w.outsiderOwner]) {
      await as(viewer.id);
      expect((await get(personSkillsRoute.GET, { params: { id: w.r1.id } })).status, viewer.name).toBe(404);
      expect((await get(historyRoute.GET, { params: { id: w.r1.id } })).status, viewer.name).toBe(404);
    }
    // the self estimate never replaced the supervisor's level
    expect(await db.personSkill.count({ where: { userId: w.r1.id, skillId: skill.id } })).toBe(2);
  });

  it("every change is a history row (who, when, old → new); a no-op writes none; the database refuses to change one", async () => {
    const w = await world();
    const skill = await mkSkill(w, "برمجة");
    await as(w.owner.id);
    const put = (level: number, note = "") => send(personSkillsRoute.PUT, "PUT", { skillId: skill.id, source: "MANUAL", level, note }, { id: w.r1.id });
    expect((await put(1)).json).toEqual({ changed: true });
    expect((await put(1)).json).toEqual({ changed: false });
    expect((await put(3, "تحسن")).json).toEqual({ changed: true });
    const rows = await db.personSkillHistory.findMany({ where: { userId: w.r1.id, skillId: skill.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.oldLevel, r.newLevel])).toEqual([[null, 1], [1, 3]]);
    expect(rows.every((r) => r.changedById === w.owner.id && r.source === "MANUAL")).toBe(true);
    const listed = await get(historyRoute.GET, { params: { id: w.r1.id } });
    const h = listed.json?.["history"] as { oldLevel: number | null; newLevel: number; changedBy: string }[];
    expect(h.map((x) => [x.oldLevel, x.newLevel])).toEqual([[1, 3], [null, 1]]);
    expect(h[0]?.changedBy).toBe("Owner");
    // append-only at the database
    await expect(db.$executeRaw`UPDATE "PersonSkillHistory" SET "newLevel" = 0 WHERE "id" = ${rows[0]!.id}`).rejects.toThrow(/append-only/);
    // the level itself is checked 0..4 by the database too
    await expect(db.$executeRaw`UPDATE "PersonSkill" SET "level" = 9 WHERE "userId" = ${w.r1.id}`).rejects.toThrow();
  });

  it("two saves at once leave one row and a consistent history", async () => {
    const w = await world();
    const skill = await mkSkill(w, "سرعة");
    await as(w.owner.id);
    const save = (level: number) => send(personSkillsRoute.PUT, "PUT", { skillId: skill.id, source: "MANUAL", level }, { id: w.r1.id });
    const results = await Promise.all([save(1), save(2), save(3), save(4)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db.personSkill.count({ where: { userId: w.r1.id, skillId: skill.id } })).toBe(1);
    const hist = await db.personSkillHistory.findMany({ where: { userId: w.r1.id, skillId: skill.id }, orderBy: { createdAt: "asc" } });
    expect(hist.length).toBe(4);
    // the chain old → new is unbroken: each old level is the previous new one
    for (let i = 1; i < hist.length; i++) expect(hist[i]!.oldLevel).toBe(hist[i - 1]!.newLevel);
  });

  it("reading leaves no trace: owner or not, no audit row, no notification, no write", async () => {
    const w = await world();
    const skill = await mkSkill(w, "هدوء");
    await db.personSkill.create({ data: { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "MANUAL", level: 2, updatedById: w.owner.id } });
    const before = { audit: await db.auditLog.count(), notes: await db.notification.count(), levels: await db.personSkill.count(), history: await db.personSkillHistory.count() };
    for (const viewer of [w.owner, w.partner, w.sup, w.r1]) {
      await as(viewer.id);
      for (const handler of [linesRoute.GET, matrixRoute.GET, skillsRoute.GET]) await get(handler);
      await get(personSkillsRoute.GET, { params: { id: w.r1.id } });
      await get(historyRoute.GET, { params: { id: w.r1.id } });
    }
    expect({ audit: await db.auditLog.count(), notes: await db.notification.count(), levels: await db.personSkill.count(), history: await db.personSkillHistory.count() }).toEqual(before);
  });

  it("a person's own supervisor reads them after the supervisor's rank changes; offboarding makes the history the owner's alone", async () => {
    const w = await world();
    const skill = await mkSkill(w, "ثبات");
    await db.personSkill.create({ data: { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "MANUAL", level: 2, updatedById: w.owner.id } });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.sup.id }, data: { role: "MEMBER" } });
    await as(w.sup.id);
    expect((await get(personSkillsRoute.GET, { params: { id: w.r1.id } })).status).toBe(200);
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.r1.id }, data: { status: "OFFBOARDED" } });
    expect((await get(personSkillsRoute.GET, { params: { id: w.r1.id } })).status).toBe(404);
    await as(w.owner.id);
    expect((await get(personSkillsRoute.GET, { params: { id: w.r1.id } })).status).toBe(200);
  });
});

describe("«المهارات»: the matrix and its CSV", () => {
  it("the owner reads everybody, a supervisor their subtree, an employee without reports and a guest get 404", async () => {
    const w = await world();
    const skill = await mkSkill(w, "إدارة");
    await db.personSkill.createMany({
      data: [
        { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "MANUAL" as const, level: 3, updatedById: w.owner.id },
        { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "SELF" as const, level: 4, updatedById: w.r1.id },
        { organizationId: w.orgId, userId: w.x.id, skillId: skill.id, source: "MANUAL" as const, level: 1, updatedById: w.owner.id },
      ],
    });
    await as(w.owner.id);
    const all = (await get(matrixRoute.GET)).json?.["matrix"] as { people: { userId: string }[]; cells: Record<string, Record<string, { manual: number | null; self: number | null }>> };
    expect(all.people.map((p) => p.userId)).toEqual(expect.arrayContaining([w.r1.id, w.x.id, w.loose.id]));
    expect(all.cells[w.r1.id]?.[skill.id]).toEqual({ manual: 3, self: 4 });
    await as(w.sup.id);
    const mine = (await get(matrixRoute.GET)).json?.["matrix"] as typeof all;
    expect(mine.people.map((p) => p.userId).sort()).toEqual([w.r1.id, w.r2.id, w.rr1.id].sort());
    expect(mine.cells[w.x.id]).toBeUndefined();
    for (const who of [w.r2, w.member, w.guest]) {
      await as(who.id);
      expect((await get(matrixRoute.GET)).status, who.name).toBe(404);
      expect((await get(matrixCsvRoute.GET)).status, who.name).toBe(404);
    }
  });

  it("the CSV is exactly the table the viewer reads: UTF-8 BOM, formula-safe, nobody outside the subtree", async () => {
    const w = await world();
    const bad = await db.skill.create({ data: { organizationId: w.orgId, name: "=HYPERLINK(\"x\")", createdById: w.owner.id } });
    await db.user.update({ where: { id: w.r1.id }, data: { name: "+cmd|' /C calc'!A0" } });
    await db.personSkill.create({ data: { organizationId: w.orgId, userId: w.r1.id, skillId: bad.id, source: "MANUAL", level: 2, updatedById: w.owner.id } });
    await as(w.sup.id);
    const res = await (matrixCsvRoute.GET as (req: Request) => Promise<Response>)(new Request("http://localhost/api/team-development/skills/matrix/csv"));
    expect(res.status).toBe(200);
    const bytes = [...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)];
    expect(bytes).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'+cmd");
    expect(text).not.toMatch(/(^|,|\r\n)[=+\-@]/);
    expect(text).not.toContain("موظف عند الآخر");
    expect(text).toContain("موظف اثنان");
  });
});

describe("«الأداء والتطوير»: the switch", () => {
  it("off, every route is 404 for everybody (the owner included), no tab is drawn and no page opens; on again, all is back with its data", async () => {
    const w = await world();
    const skill = await mkSkill(w, "مفتاح");
    await db.personSkill.create({ data: { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "MANUAL", level: 2, updatedById: w.owner.id } });
    await setFeature(w, false);
    const routes: [unknown, Record<string, string>?][] = [[linesRoute.GET], [skillsRoute.GET], [matrixRoute.GET], [matrixCsvRoute.GET], [personSkillsRoute.GET, { id: w.r1.id }], [historyRoute.GET, { id: w.r1.id }]];
    for (const who of [w.owner, w.sup, w.r1, w.member]) {
      await as(who.id);
      for (const [handler, params] of routes) expect((await get(handler, { params })).status, who.name).toBe(404);
      expect((await send(lineRoute.PUT, "PUT", { managerId: null }, { userId: w.r1.id })).status).toBe(404);
      expect((await send(skillsRoute.POST, "POST", { name: "جديدة" })).status).toBe(404);
      const nav = await visibleNavFor(await requireActor());
      expect(nav.places.flatMap((p) => p.tabs.map((t) => t.key))).not.toContain("structure");
      expect(nav.places.flatMap((p) => p.tabs.map((t) => t.key))).not.toContain("development");
    }
    await as(w.owner.id);
    const pages: (() => unknown)[] = [() => StructurePage({}), () => DevelopmentPage({ searchParams: {} }), () => SkillsPage(), () => html(PersonPage({ params: { id: w.r1.id }, searchParams: {} }))];
    for (const page of pages) {
      await expect(Promise.resolve().then(page)).rejects.toThrow("NEXT_NOT_FOUND");
    }
    await setFeature(w, true);
    expect((await get(personSkillsRoute.GET, { params: { id: w.r1.id } })).status).toBe(200);
    expect(await db.personSkill.count({ where: { userId: w.r1.id } })).toBe(1);
  });

  it("on, the tabs follow the person: the owner sees both, a supervisor both, a plain employee neither; «ملفي» opens from «لوحتي»", async () => {
    const w = await world();
    const tabsOf = async (userId: string) => {
      await as(userId);
      return (await visibleNavFor(await requireActor())).places.flatMap((p) => p.tabs.map((t) => t.key));
    };
    for (const id of [w.owner.id, w.sup.id]) expect(await tabsOf(id)).toEqual(expect.arrayContaining(["structure", "development"]));
    for (const id of [w.r2.id, w.member.id]) {
      const tabs = await tabsOf(id);
      expect(tabs).not.toContain("structure");
      expect(tabs).not.toContain("development");
    }
    // a person holding `people.manage_lines` has both, even without anybody under them
    await grant(w.orgId, w.member.id, { capabilities: ["people.manage_lines"] });
    expect(await tabsOf(w.member.id)).toEqual(expect.arrayContaining(["structure", "development"]));
  });
});

// ───────────────────────────────────────── the screens ─────────────────────────────────────────

describe("the screens render for the right people", () => {
  it("«الهيكل»: the owner sees the tree, the count of reports, the «بدون مسؤول» flag and «غيّر المسؤول»; a plain employee sees only their line", async () => {
    const w = await world();
    await as(w.owner.id);
    const markup = await html(StructurePage({}));
    expect(markup).toContain(`data-node="${w.sup.id}"`);
    expect(markup).toContain(`data-reports-count="${w.sup.id}"`);
    expect(markup).toContain(`data-no-supervisor="${w.loose.id}"`);
    expect(markup).toContain(`data-change-supervisor="${w.r1.id}"`);
    expect(markup).toContain("⚠️");
    expect(markup).toContain("🔧");
    await as(w.r2.id);
    const mine = await html(StructurePage({}));
    expect(mine).toContain("data-my-supervisor");
    expect(mine).toContain(w.sup.name);
    expect(mine).toContain(w.r1.name); // a team mate's name
    expect(mine).not.toContain(w.x.name);
    expect(mine).not.toContain("data-change-supervisor");
    await as(w.guest.id);
    await expect(Promise.resolve().then(() => StructurePage({}))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the person's file: an employee sees both columns for their own skills and an editor only for their own estimate; the supervisor with `people.review` gets the other editor; an outsider gets not-found", async () => {
    const w = await world();
    const skill = await mkSkill(w, "الإلقاء");
    await db.personSkill.createMany({
      data: [
        { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "MANUAL" as const, level: 3, updatedById: w.owner.id },
        { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "SELF" as const, level: 1, updatedById: w.r1.id },
      ],
    });
    await as(w.r1.id);
    const own = await html(PersonPage({ params: { id: w.r1.id }, searchParams: {} }));
    expect(own).toContain('data-column="manual"');
    expect(own).toContain('data-column="self"');
    expect(own).toContain(`data-skill-editor="${skill.id}:SELF"`);
    expect(own).not.toContain(`data-skill-editor="${skill.id}:MANUAL"`);
    expect(own).toContain('data-gap="2"');
    await grant(w.orgId, w.sup.id, { capabilities: ["people.review"] });
    await as(w.sup.id);
    const theirs = await html(PersonPage({ params: { id: w.r1.id }, searchParams: {} }));
    expect(theirs).toContain(`data-skill-editor="${skill.id}:MANUAL"`);
    expect(theirs).not.toContain(`data-skill-editor="${skill.id}:SELF"`);
    await as(w.r2.id);
    await expect(html(PersonPage({ params: { id: w.r1.id }, searchParams: {} }))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the people list is sorted by name, a plain employee lands on their own file, and the matrix page has its legend", async () => {
    const w = await world();
    const skill = await mkSkill(w, "الحوار");
    await db.personSkill.create({ data: { organizationId: w.orgId, userId: w.r1.id, skillId: skill.id, source: "MANUAL", level: 2, updatedById: w.owner.id } });
    await as(w.owner.id);
    const list = await html(DevelopmentPage({ searchParams: {} }));
    expect(list).toContain("data-people-table");
    const order = [...list.matchAll(/data-person-row="([^"]+)"/g)].map((m) => m[1] as string);
    expect(order.length).toBeGreaterThan(5);
    const names = order.map((id) => ({ [w.sup.id]: w.sup.name, [w.r1.id]: w.r1.name, [w.r2.id]: w.r2.name, [w.x.id]: w.x.name })[id]).filter(Boolean) as string[];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ar")));
    const matrix = await html(SkillsPage());
    expect(matrix).toContain("data-matrix-legend");
    expect(matrix).toContain("data-catalogue");
    expect(matrix).toContain(`data-cell="${w.r1.id}:${skill.id}"`);
    await as(w.r2.id);
    const mine = await html(DevelopmentPage({ searchParams: {} }));
    expect(mine).not.toContain("data-people-table");
    expect(mine).toContain("data-person-skills");
    await expect(Promise.resolve().then(() => SkillsPage())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
