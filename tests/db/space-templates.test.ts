import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { applySpaceTemplate, createWorkspace } from "@/server/services/workspaces";
import { SPACE_TEMPLATES, spaceTemplateOf, templateTopicIdOf, type SpaceTemplateKey } from "@/lib/spaces/templates";
import { spaceTopicIdOf } from "@/server/chat/space-topics";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { makeSpaceWorld } from "./spaces-helpers";

/**
 * I1.2 — «مساحة جديدة» from a template, against a real PostgreSQL. The template is pure data (`src/lib/spaces/templates.ts`) applied by the EXISTING create
 * service (`createWorkspace`) and `space-topics.ts`: it makes topics and one project INSIDE the new space and nowhere else, a private-by-default topic is
 * restricted to its creator alone, nobody is added beyond the creator (and the people the creator named at creation, as always), applying twice makes
 * nothing twice, «الشركة» never gets a project, and a space made with no template is exactly what it was.
 */

const STARTERS = ["عام", "التنبيهات"];
const create = (body: unknown) => call(workspacesRoute.POST, { body });

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "spaceTemplates", on) as Prisma.InputJsonValue } });
}

const topicsOf = (spaceId: string) =>
  db.conversation.findMany({
    where: { spaceId, kind: "TOPIC" },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, title: true, restricted: true, systemKey: true, position: true, topicType: true, postingPolicy: true, members: { select: { userId: true } } },
  });
const titlesOf = async (spaceId: string) => (await topicsOf(spaceId)).map((t) => t.title);

async function made(key: SpaceTemplateKey, opts: { memberIds?: string[] } = {}) {
  const w = await makeSpaceWorld();
  const { workspace } = await createWorkspace(w.admin.id, { organizationId: w.org.id, name: `T ${key} ${uid()}`, template: key, memberIds: opts.memberIds });
  return { w, space: workspace };
}

describe("a space made from each template has its topics, and only those", () => {
  it.each(SPACE_TEMPLATES.filter((t) => t.key !== "blank").map((t) => [t.key, t.topics.filter((x) => x.key !== "general").map((x) => x.title)] as const))(
    "«%s»: the two starter topics plus its own, nothing twice",
    async (key, own) => {
      const { space } = await made(key);
      const titles = await titlesOf(space.id);
      expect([...titles].sort()).toEqual([...STARTERS, ...own].sort());
      expect(new Set(titles).size).toBe(titles.length);
    },
  );

  it("«عمليات الطلبات» opens on «عام» and «التنبيهات» then «غير مؤكد · مؤكد · مرتجع · شكاوى», in that order, «عام» being the starter and not a copy", async () => {
    const { space } = await made("orders");
    const rows = await topicsOf(space.id);
    expect(rows.map((r) => r.title)).toEqual(["عام", "التنبيهات", "غير مؤكد", "مؤكد", "مرتجع", "شكاوى"]);
    expect(rows.find((r) => r.title === "عام")?.id).toBe(spaceTopicIdOf(space.id, "general"));
    expect(rows.find((r) => r.title === "عام")?.systemKey).toBe("general");
    // the template's own topics are ordinary topics (a manager may rename or remove them), not system ones
    for (const r of rows.filter((x) => !STARTERS.includes(x.title ?? ""))) expect(r.systemKey).toBeNull();
    expect(rows.find((r) => r.title === "مرتجع")?.id).toBe(templateTopicIdOf(space.id, "returns"));
  });

  it("«فاضية» is the old path: only the two starters, no project, no emoji, and the name is whatever was typed", async () => {
    const { space } = await made("blank");
    expect(await titlesOf(space.id)).toEqual(STARTERS);
    expect(await db.project.count({ where: { workspaceId: space.id } })).toBe(0);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: space.id } })).emoji).toBeNull();
  });

  it("the space wears the template's emoji", async () => {
    const { space } = await made("orders");
    expect((await db.workspace.findUniqueOrThrow({ where: { id: space.id } })).emoji).toBe(spaceTemplateOf("orders")?.emoji);
  });

  it("no message is written: nothing from a customer, nothing from a bot, nothing at all", async () => {
    const { space } = await made("orders");
    expect(await db.chatMessage.count({ where: { conversation: { spaceId: space.id } } })).toBe(0);
  });
});

describe("privacy: a private-by-default topic is created restricted with only the creator", () => {
  it("«شكاوى» is restricted and its one member is the creator; every other topic is open to the space (no member rows)", async () => {
    const { w, space } = await made("orders");
    const rows = await topicsOf(space.id);
    const complaints = rows.find((r) => r.title === "شكاوى");
    expect(complaints?.restricted).toBe(true);
    expect(complaints?.members.map((m) => m.userId)).toEqual([w.admin.id]);
    for (const r of rows.filter((x) => x.title !== "شكاوى")) {
      expect(r.restricted, r.title ?? "").toBe(false);
      expect(r.members, r.title ?? "").toEqual([]);
    }
  });

  it("«قرارات» of «الإدارة» is private the same way", async () => {
    const { w, space } = await made("management");
    const decisions = (await topicsOf(space.id)).find((r) => r.title === "قرارات");
    expect(decisions?.restricted).toBe(true);
    expect(decisions?.members.map((m) => m.userId)).toEqual([w.admin.id]);
  });

  it("a person named at creation joins the SPACE, never a private topic: they cannot read «شكاوى» until somebody adds them", async () => {
    const w = await makeSpaceWorld();
    const { workspace } = await createWorkspace(w.admin.id, { organizationId: w.org.id, name: `Named ${uid()}`, template: "orders", memberIds: [w.member.id] });
    const members = await db.workspaceMember.findMany({ where: { workspaceId: workspace.id }, select: { userId: true } });
    expect(members.map((m) => m.userId).sort()).toEqual([w.admin.id, w.member.id].sort());
    const complaints = (await topicsOf(workspace.id)).find((r) => r.title === "شكاوى");
    expect(complaints?.members.map((m) => m.userId)).toEqual([w.admin.id]);
    const { canReadConversation } = await import("@/server/policy/conversation");
    expect(await canReadConversation(w.member.id, complaints!.id)).toBe(false);
    const open = (await topicsOf(workspace.id)).find((r) => r.title === "مؤكد");
    expect(await canReadConversation(w.member.id, open!.id)).toBe(true);
  });
});

describe("no member is added beyond the creator", () => {
  it.each(SPACE_TEMPLATES.map((t) => t.key))("«%s» with no one named: the creator is the space's only member, as its ADMIN", async (key) => {
    const { w, space } = await made(key);
    const members = await db.workspaceMember.findMany({ where: { workspaceId: space.id }, select: { userId: true, role: true } });
    expect(members).toEqual([{ userId: w.admin.id, role: "ADMIN" }]);
  });
});

describe("applying is idempotent", () => {
  it.each(SPACE_TEMPLATES.map((t) => t.key))("«%s» applied again changes nothing: the same topics, the same ids, the same members", async (key) => {
    const { w, space } = await made(key);
    const before = await topicsOf(space.id);
    const projects = await db.project.count({ where: { workspaceId: space.id } });
    await applySpaceTemplate({ orgId: w.org.id, spaceId: space.id, userId: w.admin.id, template: key });
    await applySpaceTemplate({ orgId: w.org.id, spaceId: space.id, userId: w.admin.id, template: key });
    expect(await topicsOf(space.id)).toEqual(before);
    expect(await db.project.count({ where: { workspaceId: space.id } })).toBe(projects);
    expect(await db.board.count({ where: { project: { workspaceId: space.id } } })).toBe(projects);
  });

  it("two at once make each topic once", async () => {
    const { w, space } = await made("orders");
    const other = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Late" });
    await db.workspaceMember.create({ data: { workspaceId: space.id, userId: other.id, role: "ADMIN" } });
    await Promise.all([
      applySpaceTemplate({ orgId: w.org.id, spaceId: space.id, userId: w.admin.id, template: "management" }),
      applySpaceTemplate({ orgId: w.org.id, spaceId: space.id, userId: other.id, template: "management" }),
    ]);
    const titles = await titlesOf(space.id);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("a person who left the private topic is not put back by a second apply, and a topic made public by hand stays public", async () => {
    const { w, space } = await made("orders");
    const complaints = (await topicsOf(space.id)).find((r) => r.title === "شكاوى")!;
    await db.conversationMember.deleteMany({ where: { conversationId: complaints.id } });
    const confirmed = (await topicsOf(space.id)).find((r) => r.title === "مؤكد")!;
    await db.conversation.update({ where: { id: confirmed.id }, data: { restricted: true } });
    await applySpaceTemplate({ orgId: w.org.id, spaceId: space.id, userId: w.admin.id, template: "orders" });
    expect(await db.conversationMember.count({ where: { conversationId: complaints.id } })).toBe(0);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: confirmed.id } })).restricted).toBe(true);
  });
});

describe("«إنتاج المحتوى» has the project «خط الإنتاج» with its stages", () => {
  it("one project, one board, six columns in order, each with its W1.3 stage, the last one «منتهي»", async () => {
    const { space } = await made("content");
    const projects = await db.project.findMany({ where: { workspaceId: space.id }, include: { boards: { include: { columns: { orderBy: { position: "asc" } } } } } });
    expect(projects).toHaveLength(1);
    const project = projects[0]!;
    expect(project.name).toBe("خط الإنتاج");
    expect(project.systemKey).toBeNull();
    expect(project.status).toBe("ACTIVE");
    expect(project.boards).toHaveLength(1);
    const columns = project.boards[0]!.columns;
    expect(columns.map((c) => c.name)).toEqual(["فكرة", "سكربت", "تصوير", "مونتاج", "جاهز", "منشور"]);
    expect(columns.map((c) => c.stage)).toEqual(["TODO", "DOING", "DOING", "DOING", "REVIEW", "DONE"]);
    expect(columns.map((c) => c.done)).toEqual([false, false, false, false, false, true]);
    expect(columns.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5]);
    // a fresh pipeline holds no task and no customer data
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("the topics are روابط · تحميل · سكربتات (+ the starters)", async () => {
    const { space } = await made("content");
    expect((await titlesOf(space.id)).sort()).toEqual([...STARTERS, "روابط", "تحميل", "سكربتات"].sort());
  });

  it.each(["orders", "management", "brand", "blank"] as const)("«%s» makes no project at all", async (key) => {
    const { space } = await made(key);
    expect(await db.project.count({ where: { workspaceId: space.id } })).toBe(0);
  });

  it("«الشركة» gets no project (D-N3), though its topics are made", async () => {
    const w = await makeSpaceWorld();
    const hq = await db.workspace.create({
      data: { organizationId: w.org.id, name: `HQ ${uid()}`, slug: `hq-${uid()}`, kind: "HQ", systemKey: "hq", members: { create: [{ userId: w.admin.id, role: "ADMIN" }] } },
    });
    await applySpaceTemplate({ orgId: w.org.id, spaceId: hq.id, userId: w.admin.id, template: "content" });
    expect(await db.project.count({ where: { workspaceId: hq.id } })).toBe(0);
    expect((await titlesOf(hq.id)).sort()).toEqual([...STARTERS, "روابط", "تحميل", "سكربتات"].sort());
  });
});

describe("a template applied to a space that already has topics", () => {
  it("puts its topics after the last one, in the template's order, and leaves the existing ones where they are", async () => {
    const w = await makeSpaceWorld();
    const { workspace } = await createWorkspace(w.admin.id, { organizationId: w.org.id, name: `Busy ${uid()}`, template: "blank" });
    const mine = await db.conversation.create({ data: { orgId: w.org.id, spaceId: workspace.id, kind: "TOPIC", title: "Mine", position: 9 } });
    await applySpaceTemplate({ orgId: w.org.id, spaceId: workspace.id, userId: w.admin.id, template: "management" });
    const rows = await topicsOf(workspace.id);
    expect(rows.find((r) => r.id === mine.id)?.position).toBe(9);
    const added = rows.filter((r) => ["تقارير وأداء", "أفكار", "قرارات", "إعلانات"].includes(r.title ?? ""));
    expect(added.map((r) => r.title)).toEqual(["تقارير وأداء", "أفكار", "قرارات", "إعلانات"]);
    expect(added.map((r) => r.position)).toEqual([10, 11, 12, 13]);
  });
});

describe("it writes only inside the space it is given", () => {
  it("another space of the same company keeps exactly its rows", async () => {
    const w = await makeSpaceWorld();
    const before = await db.conversation.count({ where: { spaceId: w.ws.id } });
    const projectsBefore = await db.project.count({ where: { workspaceId: w.ws.id } });
    await createWorkspace(w.admin.id, { organizationId: w.org.id, name: `Mine ${uid()}`, template: "content" });
    expect(await db.conversation.count({ where: { spaceId: w.ws.id } })).toBe(before);
    expect(await db.project.count({ where: { workspaceId: w.ws.id } })).toBe(projectsBefore);
  });

  it("a space of ANOTHER company is not found, and nothing is written there", async () => {
    const w = await makeSpaceWorld();
    const other = await makeOrg();
    const stranger = await makeUser({ orgId: other.id, role: "ADMIN", name: "Stranger" });
    const theirs = await makeWorkspace(other.id, [{ userId: stranger.id, role: "ADMIN" }]);
    await expect(applySpaceTemplate({ orgId: w.org.id, spaceId: theirs.id, userId: w.admin.id, template: "content" })).rejects.toMatchObject({ message: "workspace.not_found" });
    expect(await db.conversation.count({ where: { spaceId: theirs.id } })).toBe(0);
    expect(await db.project.count({ where: { workspaceId: theirs.id } })).toBe(0);
  });

  it("a creator who is not in the space cannot have a private topic opened in their name: refused, nothing written", async () => {
    const w = await makeSpaceWorld();
    const lone = await makeWorkspace(w.org.id, [{ userId: w.member.id, role: "ADMIN" }]);
    await expect(applySpaceTemplate({ orgId: w.org.id, spaceId: lone.id, userId: w.admin.id, template: "orders" })).rejects.toMatchObject({ message: "teams.member_not_in_space" });
    expect(await db.conversation.count({ where: { spaceId: lone.id } })).toBe(0);
  });
});

describe("POST /api/workspaces with a template", () => {
  const nameOf = (tag: string) => `${tag} ${uid()}`;
  const spaceNamed = (name: string) => db.workspace.findFirst({ where: { name }, select: { id: true, emoji: true, members: { select: { userId: true, role: true } } } });

  it("with the switch OFF (the default) a template is refused as «not found» and no space is made", async () => {
    const w = await makeSpaceWorld();
    const name = nameOf("Off");
    await loginAs(w.owner.id);
    const res = await create({ name, template: "orders" });
    expect(res.status).toBe(404);
    expect(res.json?.["message"]).toBe("features.off");
    expect(await spaceNamed(name)).toBeNull();
  });

  it("with the switch OFF the old create path is exactly what it was: the starters and nothing else", async () => {
    const w = await makeSpaceWorld();
    const name = nameOf("Old");
    await loginAs(w.owner.id);
    const res = await create({ name });
    expect(res.status).toBe(201);
    const id = (res.json?.["workspace"] as { id: string }).id;
    expect(await titlesOf(id)).toEqual(STARTERS);
    expect(await db.project.count({ where: { workspaceId: id } })).toBe(0);
  });

  it("with the switch ON the old create path (no template) is still exactly what it was", async () => {
    const w = await makeSpaceWorld();
    await setSwitch(w.org.id, true);
    const name = nameOf("Old on");
    await loginAs(w.owner.id);
    const res = await create({ name });
    expect(res.status).toBe(201);
    const id = (res.json?.["workspace"] as { id: string }).id;
    expect(await titlesOf(id)).toEqual(STARTERS);
    expect((await spaceNamed(name))?.emoji).toBeNull();
  });

  it.each(["owner", "admin"] as const)("with the switch ON a %s makes «إنتاج المحتوى»: its topics, its pipeline, themselves alone in it", async (who) => {
    const w = await makeSpaceWorld();
    await setSwitch(w.org.id, true);
    const name = nameOf(`From ${who}`);
    await loginAs(w[who].id);
    const res = await create({ name, template: "content" });
    expect(res.status).toBe(201);
    const ws = await spaceNamed(name);
    expect(ws?.members).toEqual([{ userId: w[who].id, role: "ADMIN" }]);
    expect((await titlesOf(ws!.id)).sort()).toEqual([...STARTERS, "روابط", "تحميل", "سكربتات"].sort());
    expect(await db.project.count({ where: { workspaceId: ws!.id, name: "خط الإنتاج" } })).toBe(1);
    expect(ws?.emoji).toBe(spaceTemplateOf("content")?.emoji);
  });

  it("the switch of ANOTHER company does not open it for this one", async () => {
    const mine = await makeSpaceWorld();
    const theirs = await makeTeam();
    await setSwitch(theirs.org.id, true);
    const name = nameOf("Other co");
    await loginAs(mine.owner.id);
    expect((await create({ name, template: "orders" })).status).toBe(404);
    expect(await spaceNamed(name)).toBeNull();
  });

  it("a member who does not hold `spaces.create` is refused before the template is looked at; an anonymous caller is 401", async () => {
    const w = await makeSpaceWorld();
    await setSwitch(w.org.id, true);
    const name = nameOf("Member");
    await loginAs(w.member.id);
    expect((await create({ name, template: "orders" })).status).toBe(403);
    logout();
    expect((await create({ name, template: "orders" })).status).toBe(401);
    expect(await spaceNamed(name)).toBeNull();
  });

  it("a template that does not exist is a 422 and nothing is made", async () => {
    const w = await makeSpaceWorld();
    await setSwitch(w.org.id, true);
    const name = nameOf("Nope");
    await loginAs(w.owner.id);
    const res = await create({ name, template: "telegram" });
    expect([400, 422]).toContain(res.status);
    expect(await spaceNamed(name)).toBeNull();
  });

  it("a template on a space of «لوحات» or «تصنيع» is refused (a template is for an ordinary space) and nothing is made", async () => {
    const w = await makeSpaceWorld();
    await setSwitch(w.org.id, true);
    await loginAs(w.owner.id);
    for (const layout of ["CARDS", "MANUFACTURING"]) {
      const name = nameOf(layout);
      const res = await create({ name, template: "orders", layout });
      expect([400, 422], layout).toContain(res.status);
      // the schema says why, in the key the screen translates
      expect(JSON.stringify(res.json), layout).toContain("spaces.template_layout");
      expect(await spaceNamed(name), layout).toBeNull();
    }
    const ok = nameOf("Standard");
    expect((await create({ name: ok, template: "orders", layout: "STANDARD" })).status).toBe(201);
  });

  it("the people named at creation still join the space, and they get no private topic", async () => {
    const w = await makeSpaceWorld();
    await setSwitch(w.org.id, true);
    const name = nameOf("With people");
    await loginAs(w.owner.id);
    const res = await create({ name, template: "orders", memberIds: [w.member.id] });
    expect(res.status).toBe(201);
    const ws = await spaceNamed(name);
    expect(ws?.members.map((m) => m.userId).sort()).toEqual([w.owner.id, w.member.id].sort());
    const complaints = (await topicsOf(ws!.id)).find((r) => r.title === "شكاوى");
    expect(complaints?.members.map((m) => m.userId)).toEqual([w.owner.id]);
  });
});
