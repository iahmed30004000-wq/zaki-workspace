import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as templatesRoute from "@/app/api/organizations/[id]/role-templates/route";
import * as applyRoute from "@/app/api/organizations/[id]/role-templates/[templateId]/apply/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as listRoute from "@/app/api/organizations/[id]/members/route";
import { withFeature } from "@/lib/features";
import { STARTER_TEMPLATES, type RoleTemplate } from "@/lib/permission-templates";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { accountsApi, makeRankTeam, memberRow, reason, username } from "./accounts-helpers";

/**
 * A1.1 «قوالب» (switch `permissionTemplates`): a template is a rank, the boxes it adds and the boxes it takes away, kept in
 * `Organization.settings.roleTemplates` (no migration). Applying one goes THROUGH the account service, so it keeps the rank rules,
 * hands out nothing the applier does not hold, and leaves an audit row. A guest template is refused; archive.view is never handed out.
 */

type Shape = { templates: RoleTemplate[]; rev: string; canEdit: boolean };

async function world(opts: { on?: boolean } = {}) {
  const w = await makeRankTeam();
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
  if (opts.on !== false) {
    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "permissionTemplates", true) as Prisma.InputJsonValue } });
  }
  return w;
}

const list = (orgId: string) => call(templatesRoute.GET, { params: { id: orgId } });
const save = (orgId: string, body: unknown) => call(templatesRoute.PUT, { method: "PUT", params: { id: orgId }, body });
const apply = (orgId: string, templateId: string, userId: string) =>
  call(applyRoute.POST, { method: "POST", params: { id: orgId, templateId }, body: { userId } });
const shape = (res: { json: Record<string, unknown> | null }) => res.json as unknown as Shape;

const sales = (t: RoleTemplate[]) => t.find((x) => x.name === "مبيعات وتأكيد طلبات") as RoleTemplate;

/** The company's own list, written straight into the settings (around every check) to prove the readers distrust it. */
async function writeRaw(orgId: string, roleTemplates: unknown) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: { ...(org.settings as object), roleTemplates } as Prisma.InputJsonValue } });
}

async function templateAudits(orgId: string, userId: string) {
  return db.auditLog.findMany({ where: { orgId, action: "org.template_applied", target: userId }, orderBy: { createdAt: "asc" } });
}

describe("the switch permissionTemplates (default OFF)", () => {
  it("off: the list, the save and the apply answer 404, and an account made with a template id is refused before anything is made", async () => {
    const w = await world({ on: false });
    await loginAs(w.owner.id);
    expect((await list(w.org.id)).status).toBe(404);
    expect((await save(w.org.id, { templates: [], rev: "x" })).status).toBe(404);
    expect((await apply(w.org.id, STARTER_TEMPLATES[1]!.id, w.member.id)).status).toBe(404);
    const made = await accountsApi.create(w.org.id, { name: "موظف جديد", username: username("tpl"), templateId: STARTER_TEMPLATES[1]!.id });
    expect(made.status).toBe(404);
    expect(await db.user.count({ where: { username: { startsWith: "tpl." }, memberships: { some: { organizationId: w.org.id } } } })).toBe(0);
  });

  it("off: the roster carries no template for anybody", async () => {
    const w = await world({ on: false });
    await db.auditLog.create({ data: { action: "org.template_applied", orgId: w.org.id, target: w.member.id, meta: { templateId: "x", name: "x", rank: "MEMBER", capabilities: [], revokedCapabilities: [] } } });
    await loginAs(w.owner.id);
    const roster = (await accountsApi.list(w.org.id)).json as unknown as { members: { id: string; template?: unknown }[] };
    expect(roster.members.every((m) => m.template === undefined || m.template === null)).toBe(true);
  });
});

describe("who lists and who edits", () => {
  it("the owner's first open shows the seven starters; a member without users.manage and a guest are refused", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await list(w.org.id);
    expect(res.status).toBe(200);
    expect(shape(res).templates.map((t) => t.name)).toEqual(STARTER_TEMPLATES.map((t) => t.name));
    expect(shape(res).canEdit).toBe(true);
    await loginAs(w.member.id);
    expect((await list(w.org.id)).status).toBe(403);
    await loginAs(w.guest.id);
    expect((await list(w.org.id)).status).toBe(403);
  });

  it("an ADMIN lists and applies but does not edit: the owner names and edits the templates", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const res = await list(w.org.id);
    expect(res.status).toBe(200);
    expect(shape(res).canEdit).toBe(false);
    const saved = await save(w.org.id, { templates: shape(res).templates, rev: shape(res).rev });
    expect(saved.status).toBe(403);
    expect(reason(saved)).toBe("ptemplates.owner_only");
  });

  it("another company's owner cannot open this company's templates", async () => {
    const w = await world();
    const other = await makeTeam();
    await loginAs(other.owner.id);
    expect((await list(w.org.id)).status).toBe(403);
  });
});

describe("saving: valid, bounded, and no save is lost silently", () => {
  it("the owner's edit is kept, in the order he gave, and survives a later read", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const edited = first.templates.map((t) => (t.name === "موظف" ? { ...t, name: "موظف مبيعات" } : t));
    const res = await save(w.org.id, { templates: edited, rev: first.rev });
    expect(res.status).toBe(200);
    expect(shape(res).templates.map((t) => t.name)).toContain("موظف مبيعات");
    expect(shape(res).rev).not.toBe(first.rev);
    expect(shape(await list(w.org.id)).templates.map((t) => t.name)).toContain("موظف مبيعات");
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect(Array.isArray((org.settings as { roleTemplates?: unknown }).roleTemplates)).toBe(true);
    // the other keys of the settings are never touched
    expect((org.settings as { features?: Record<string, boolean> }).features?.["permissionTemplates"]).toBe(true);
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "org.role_templates_saved" } })).toBe(1);
  });

  it("a save made on an old copy is refused 409 and changes nothing; two saves at the same moment: one lands, the other is told", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const a = first.templates.map((t, i) => (i === 0 ? { ...t, name: "اسم من الأول" } : t));
    const b = first.templates.map((t, i) => (i === 0 ? { ...t, name: "اسم من الثاني" } : t));
    const [ra, rb] = await Promise.all([save(w.org.id, { templates: a, rev: first.rev }), save(w.org.id, { templates: b, rev: first.rev })]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(reason(loser)).toBe("ptemplates.stale");
    const winnerName = ra.status === 200 ? "اسم من الأول" : "اسم من الثاني";
    expect(shape(await list(w.org.id)).templates[0]!.name).toBe(winnerName);
    // an old copy later is refused too
    const late = await save(w.org.id, { templates: first.templates, rev: first.rev });
    expect(late.status).toBe(409);
    expect(shape(await list(w.org.id)).templates[0]!.name).toBe(winnerName);
  });

  it("a guest template, an owner template, archive.view, an unknown box, more than 30 and a copy without its rev are all refused and nothing is written", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const one = (over: Record<string, unknown>) => [{ id: "bad", name: "قالب", rank: "MEMBER", caps: [], revoked: [], ...over }];
    const cases: [unknown, number, string][] = [
      [one({ rank: "GUEST", caps: ["prices.view"] }), 422, "ptemplates.guest_refused"],
      [one({ rank: "OWNER" }), 422, "ptemplates.rank_invalid"],
      [one({ caps: ["archive.view"] }), 422, "ptemplates.cap_owner_only"],
      [one({ caps: ["no.such.box"] }), 422, "ptemplates.cap_unknown"],
      [Array.from({ length: 31 }, (_, i) => ({ id: `t${i}`, name: `قالب ${i}`, rank: "MEMBER", caps: [], revoked: [] })), 422, "ptemplates.too_many"],
    ];
    for (const [templates, status, key] of cases) {
      const res = await save(w.org.id, { templates, rev: first.rev });
      expect(res.status, key).toBe(status);
      expect(reason(res), key).toBe(key);
    }
    expect((await save(w.org.id, { templates: first.templates })).status).toBe(422);
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect((org.settings as { roleTemplates?: unknown }).roleTemplates).toBeUndefined();
  });
});

describe("applying a template to a person", () => {
  it("writes the rank and both lists through the account service, audits it, and the sheet says «القالب» then «معدّل» once changed by hand", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const t = sales(shape(await list(w.org.id)).templates);
    const res = await apply(w.org.id, t.id, w.member.id);
    expect(res.status).toBe(200);

    const row = await memberRow(w.org.id, w.member.id);
    expect(row.role).toBe(t.rank);
    expect(row.capabilities).toEqual(t.caps);
    for (const c of t.revoked) expect(row.revokedCapabilities).toContain(c);
    expect(res.json).toMatchObject({ ok: true, role: row.role, capabilities: row.capabilities, revokedCapabilities: row.revokedCapabilities });

    // the audit row: who, whom, which template, what was written
    const audits = await templateAudits(w.org.id, w.member.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: w.owner.id, orgId: w.org.id, target: w.member.id });
    expect(audits[0]!.meta).toMatchObject({ templateId: t.id, name: t.name, rank: t.rank, capabilities: row.capabilities, revokedCapabilities: row.revokedCapabilities });
    // the ordinary account audit is there too: the change went THROUGH the service
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "org.member_updated", target: w.member.id } })).toBe(1);

    const roster = async () =>
      ((await accountsApi.list(w.org.id)).json as unknown as { members: { id: string; template?: { id: string; name: string; modified: boolean } | null }[] }).members.find((m) => m.id === w.member.id)!;
    expect((await roster()).template).toEqual({ id: t.id, name: t.name, modified: false });

    // by hand afterwards: «معدّل»
    expect((await accountsApi.update(w.org.id, w.member.id, { capabilities: [...row.capabilities, "announce.send"] })).status).toBe(200);
    expect((await roster()).template).toEqual({ id: t.id, name: t.name, modified: true });
    // applied again: back to «القالب» alone
    expect((await apply(w.org.id, t.id, w.member.id)).status).toBe(200);
    expect((await roster()).template).toEqual({ id: t.id, name: t.name, modified: false });
    expect(await templateAudits(w.org.id, w.member.id)).toHaveLength(2);
  });

  it("a template can NEVER give more than the applier holds: an extra the ADMIN lacks is refused, the person and the audit stay as they were", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const rich: RoleTemplate = { id: "rich", name: "قالب غني", rank: "MEMBER", caps: ["manufacturing.cost", "prices.view"], revoked: [] };
    expect((await save(w.org.id, { templates: [...first.templates, rich], rev: first.rev })).status).toBe(200);

    await loginAs(w.admin.id);
    const before = await memberRow(w.org.id, w.member.id);
    const res = await apply(w.org.id, "rich", w.member.id);
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("ptemplates.exceeds_applier");
    const after = await memberRow(w.org.id, w.member.id);
    expect(after.capabilities).toEqual(before.capabilities);
    expect(after.revokedCapabilities).toEqual(before.revokedCapabilities);
    expect(await templateAudits(w.org.id, w.member.id)).toHaveLength(0);

    // the owner holds it and may
    await loginAs(w.owner.id);
    expect((await apply(w.org.id, "rich", w.member.id)).status).toBe(200);
    expect((await memberRow(w.org.id, w.member.id)).capabilities).toEqual(["prices.view", "manufacturing.cost"]);
  });

  it("an ADMIN's template leaves what the ADMIN does not hold switched off: nobody ends with more than the one who gave", async () => {
    const w = await world();
    // the admin lost prices.view: a person he puts in a MEMBER template holds no more than he does
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: ["crm.edit"] } });
    await loginAs(w.admin.id);
    const t = shape(await list(w.org.id)).templates.find((x) => x.name === "موظف") as RoleTemplate;
    expect((await apply(w.org.id, t.id, w.member.id)).status).toBe(200);
    const row = await memberRow(w.org.id, w.member.id);
    expect(row.role).toBe("MEMBER");
    expect(row.revokedCapabilities).toContain("crm.edit");
    expect(effectiveCapabilities(row).has("crm.edit")).toBe(false);
  });

  it("the rank rules of the service hold: a rank not strictly below the applier's is refused (an ADMIN template by an ADMIN), the owner may", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const adminTpl: RoleTemplate = { id: "adm", name: "مدير كامل", rank: "ADMIN", caps: [], revoked: [] };
    expect((await save(w.org.id, { templates: [...first.templates, adminTpl], rev: first.rev })).status).toBe(200);

    await loginAs(w.admin.id);
    const res = await apply(w.org.id, "adm", w.member.id);
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("orgm.role_denied");
    expect((await memberRow(w.org.id, w.member.id)).role).toBe("MEMBER");

    // and nobody applies to somebody at or above their own rank
    await loginAs(w.admin.id);
    const otherAdmin = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "مدير تاني" });
    const onAdmin = await apply(w.org.id, first.templates[1]!.id, otherAdmin.id);
    expect(onAdmin.status).toBe(403);
    expect(reason(onAdmin)).toBe("orgm.role_denied");

    await loginAs(w.owner.id);
    expect((await apply(w.org.id, "adm", w.member.id)).status).toBe(200);
    expect((await memberRow(w.org.id, w.member.id)).role).toBe("ADMIN");
  });

  it("a GUEST template is refused at save, and one written around the checks is never applied; a guest is never the target; nobody is made a partner or the owner", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await writeRaw(w.org.id, [
      { id: "g", name: "ضيف", rank: "GUEST", caps: ["prices.view"], revoked: [] },
      { id: "m", name: "موظف", rank: "MEMBER", caps: [], revoked: [] },
    ]);
    // the guest template is not in the list any more, and applying it is «not found»
    expect(shape(await list(w.org.id)).templates.map((t) => t.id)).toEqual(["m"]);
    const guestTpl = await apply(w.org.id, "g", w.member.id);
    expect(guestTpl.status).toBe(404);
    expect((await memberRow(w.org.id, w.member.id)).capabilities).toEqual([]);

    // a guest is not a person a template may be applied to (a promotion to staff is its own step), and neither is a partner
    const onGuest = await apply(w.org.id, "m", w.guest.id);
    expect(onGuest.status).toBe(403);
    expect(reason(onGuest)).toBe("ptemplates.target_guest");
    expect(await memberRow(w.org.id, w.guest.id)).toMatchObject({ role: "GUEST", capabilities: [], revokedCapabilities: [] });
    expect(await templateAudits(w.org.id, w.guest.id)).toHaveLength(0);

    const partner = await makeUser({ orgId: w.org.id, role: "OWNER", name: "شريك" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: partner.id } }, data: { primaryOwner: false } });
    const onPartner = await apply(w.org.id, "m", partner.id);
    expect(onPartner.status).toBe(403);
    expect((await memberRow(w.org.id, partner.id)).role).toBe("OWNER");
    const onSelf = await apply(w.org.id, "m", w.owner.id);
    expect(onSelf.status).toBe(403);
  });

  it("archive.view is never handed out: not at save, and not when a template carrying it was written around the checks", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await writeRaw(w.org.id, [{ id: "spy", name: "مراقب", rank: "MEMBER", caps: ["archive.view", "prices.view"], revoked: [] }]);
    expect((await apply(w.org.id, "spy", w.member.id)).status).toBe(200);
    const row = await memberRow(w.org.id, w.member.id);
    expect(row.capabilities).not.toContain("archive.view");
    expect(row.capabilities).toEqual(["prices.view"]);
    expect(effectiveCapabilities(row).has("archive.view")).toBe(false);
    const audit = (await templateAudits(w.org.id, w.member.id))[0]!;
    expect(JSON.stringify(audit.meta)).not.toContain("archive.view");
  });

  it("a template that is not there, a template of another company and a person of another company are all «not found»", async () => {
    const w = await world();
    const other = await world();
    await loginAs(other.owner.id);
    const theirs = shape(await list(other.org.id));
    const first = shape(await (async () => {
      await loginAs(other.owner.id);
      return save(other.org.id, { templates: [{ id: "only-theirs", name: "قالبهم", rank: "MEMBER", caps: [], revoked: [] }], rev: theirs.rev });
    })());
    expect(first.templates[0]!.id).toBe("only-theirs");

    await loginAs(w.owner.id);
    const missing = await apply(w.org.id, "only-theirs", w.member.id);
    expect(missing.status).toBe(404);
    const strangerPerson = await apply(w.org.id, STARTER_TEMPLATES[1]!.id, other.member.id);
    expect(strangerPerson.status).toBe(404);
    expect(await memberRow(other.org.id, other.member.id)).toMatchObject({ capabilities: [] });
  });

  it("an offboarded person is frozen: no template either", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await accountsApi.status(w.org.id, w.member.id, { action: "offboard" })).status).toBe(200);
    const res = await apply(w.org.id, STARTER_TEMPLATES[1]!.id, w.member.id);
    expect(res.status).toBe(409);
    expect(reason(res)).toBe("accounts.offboarded_frozen");
  });

  it("a partner whose users.manage was taken away cannot apply", async () => {
    const w = await world();
    const partner = await makeUser({ orgId: w.org.id, role: "OWNER", name: "شريك" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: partner.id } }, data: { primaryOwner: false, revokedCapabilities: ["users.manage"] } });
    await loginAs(partner.id);
    const res = await apply(w.org.id, STARTER_TEMPLATES[1]!.id, w.member.id);
    expect(res.status).toBe(403);
  });
});

describe("creating an account with a template and spaces, in one go", () => {
  it("the rank, the lists and the spaces come together, and the audit rows are there", async () => {
    const w = await world();
    const space = await makeWorkspace(w.org.id, [{ userId: w.owner.id }], "مساحة المبيعات");
    await loginAs(w.owner.id);
    const t = sales(shape(await list(w.org.id)).templates);
    const name = username("fresh");
    const res = await accountsApi.create(w.org.id, { name: "موظفة جديدة", username: name, templateId: t.id, workspaceIds: [space.id] });
    expect(res.status).toBe(201);
    const userId = res.json?.["userId"] as string;
    const row = await memberRow(w.org.id, userId);
    expect(row.role).toBe(t.rank);
    expect(row.capabilities).toEqual(t.caps);
    for (const c of t.revoked) expect(row.revokedCapabilities).toContain(c);
    expect(await db.workspaceMember.findMany({ where: { userId, workspaceId: space.id } })).toHaveLength(1);
    const audits = await templateAudits(w.org.id, userId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ templateId: t.id, name: t.name, rank: t.rank });
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "org.member_added", target: userId } })).toBe(1);
  });

  it("the template's rank is the person's rank: a template of a rank the creator may not give is refused and nobody is made", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const adminTpl: RoleTemplate = { id: "adm", name: "مدير كامل", rank: "ADMIN", caps: [], revoked: [] };
    await save(w.org.id, { templates: [...first.templates, adminTpl], rev: first.rev });
    await loginAs(w.admin.id);
    const name = username("deny");
    const res = await accountsApi.create(w.org.id, { name: "ممنوع", username: name, templateId: "adm" });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("orgm.role_denied");
    expect(await db.user.count({ where: { username: name } })).toBe(0);
  });

  it("a creator cannot give through a template what he does not hold, and the rank defaults he lacks start switched off", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = shape(await list(w.org.id));
    const rich: RoleTemplate = { id: "rich", name: "قالب غني", rank: "MEMBER", caps: ["manufacturing.cost"], revoked: [] };
    await save(w.org.id, { templates: [...first.templates, rich], rev: first.rev });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: ["crm.edit"] } });

    await loginAs(w.admin.id);
    const denied = username("rich");
    const res = await accountsApi.create(w.org.id, { name: "غني", username: denied, templateId: "rich" });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("ptemplates.exceeds_applier");
    expect(await db.user.count({ where: { username: denied } })).toBe(0);

    const plain = shape(await list(w.org.id)).templates.find((t) => t.name === "موظف") as RoleTemplate;
    const okName = username("plain");
    const ok = await accountsApi.create(w.org.id, { name: "عادي", username: okName, templateId: plain.id });
    expect(ok.status).toBe(201);
    const row = await memberRow(w.org.id, ok.json?.["userId"] as string);
    expect(row.revokedCapabilities).toContain("crm.edit");
  });

  it("an unknown template id and a guest template are refused before anything is made", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await writeRaw(w.org.id, [{ id: "g", name: "ضيف", rank: "GUEST", caps: [], revoked: [] }]);
    for (const templateId of ["nope", "g"]) {
      const name = username("none");
      const res = await accountsApi.create(w.org.id, { name: "لا قالب", username: name, templateId });
      expect(res.status, templateId).toBe(404);
      expect(await db.user.count({ where: { username: name } })).toBe(0);
    }
  });

  it("creating without a template is exactly what it was", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await accountsApi.create(w.org.id, { name: "بدون قالب", username: username("plain"), role: "LEAD" });
    expect(res.status).toBe(201);
    const row = await memberRow(w.org.id, res.json?.["userId"] as string);
    expect(row.role).toBe("LEAD");
    expect(await templateAudits(w.org.id, row.userId)).toHaveLength(0);
  });
});

describe("what was already true stays true", () => {
  it("the account PATCH still answers as before, and a template's application is one `org.member_updated` and one rank-free change", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await call(memberRoute.PATCH, { method: "PATCH", params: { id: w.org.id, userId: w.member.id }, body: { capabilities: ["announce.send"] } });
    expect(res.status).toBe(200);
    expect(await templateAudits(w.org.id, w.member.id)).toHaveLength(0);
    const roster = (await call(listRoute.GET, { params: { id: w.org.id } })).json as unknown as { members: { id: string; template?: unknown }[] };
    expect(roster.members.find((m) => m.id === w.member.id)?.template ?? null).toBeNull();
  });
});
