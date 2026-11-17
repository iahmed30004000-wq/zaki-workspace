import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/knowledge/route";
import * as sheetRoute from "@/app/api/knowledge/[id]/route";
import * as statusRoute from "@/app/api/knowledge/[id]/status/route";
import * as settingsRoute from "@/app/api/knowledge/settings/route";
import * as askRoute from "@/app/api/knowledge/[id]/ask/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/** Q1.1 review: the holes the independent review reproduced, against a real PostgreSQL. */
async function world() {
  const team = await makeTeam();
  const named = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Named editor" });
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id }, { userId: team.member.id }, { userId: named.id }], "المعرفة");
  const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
  const settings = withFeature({ ...(org.settings as object), knowledgeSpaceId: space.id, knowledgeEditorIds: [named.id], knowledgeApproverIds: [] }, "knowledgeCards", true);
  await db.organization.update({ where: { id: team.org.id }, data: { settings: settings as Prisma.InputJsonValue } });
  return { ...team, named, space };
}
type World = Awaited<ReturnType<typeof world>>;
type Sheet = { id: string; version: number; status: string; approvedVersion: number | null; name: string; data: { tagline: string } | null };
const sheetOf = (r: { json: Record<string, unknown> | null }) => r.json?.["sheet"] as Sheet;
const BASE = "http://localhost/api/knowledge";
const create = (body: unknown) => call(listRoute.POST, { method: "POST", url: BASE, body });
const get = (id: string) => call(sheetRoute.GET, { url: `${BASE}/${id}`, params: { id } });
const patch = (id: string, body: unknown) => call(sheetRoute.PATCH, { method: "PATCH", url: `${BASE}/${id}`, params: { id }, body });
const del = (id: string) => call(sheetRoute.DELETE, { method: "DELETE", url: `${BASE}/${id}`, params: { id } });
const status = (id: string, to: string, version?: number) => call(statusRoute.PUT, { method: "PUT", url: `${BASE}/${id}/status`, params: { id }, body: { status: to, ...(version !== undefined ? { version } : {}) } });
const data = (tagline: string) => ({ tagline, badges: [], sections: [], faq: [] });

/** An editor writes a sheet; the owner approves it at the version he saw. */
async function approved(w: World, title = "حراك") {
  await loginAs(w.admin.id);
  const made = sheetOf(await create({ title, data: data("القديم") }));
  await loginAs(w.owner.id);
  expect((await status(made.id, "APPROVED", made.version)).status).toBe(200);
  return made.id;
}

describe("a status that takes a sheet away from readers", () => {
  it("archived hides the approved sheet from a reader, in the door and in the list; un-archiving brings the approved version back", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.owner.id);
    const cur = sheetOf(await get(id));
    expect((await status(id, "ARCHIVED", cur.version)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await get(id)).status).toBe(404);
    expect(JSON.stringify((await call(listRoute.GET, { url: BASE })).json)).not.toContain(id);
    await loginAs(w.owner.id);
    expect((await status(id, "DRAFT", cur.version)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await get(id)).status).toBe(200);
  });
});

describe("deleting an approved sheet is the approvers' act", () => {
  it("a named editor who may not approve cannot delete an approved sheet (403) but can delete a draft", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.named.id);
    expect((await del(id)).status).toBe(403);
    const draft = sheetOf(await create({ title: "مسودة" }));
    expect((await del(draft.id)).status).toBe(200);
    await loginAs(w.owner.id);
    expect((await del(id)).status).toBe(200);
  });
});

describe("asking the supervisor", () => {
  it("never carries a title nobody approved: the ticket of a reader names the approved name", async () => {
    const w = await world();
    const id = await approved(w, "حراك");
    await loginAs(w.named.id);
    const cur = sheetOf(await get(id));
    expect((await patch(id, { version: cur.version, title: "اسم جديد غير معتمد" })).status).toBe(200);
    await loginAs(w.member.id);
    const r = await call(askRoute.POST, { method: "POST", url: `${BASE}/${id}/ask`, params: { id }, body: { question: "كم السعر؟" } });
    expect(r.status, r.text).toBe(201);
    const t = await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } });
    expect(t.title).toContain("حراك");
    expect(t.title).not.toContain("غير معتمد");
  });
  it("goes to the next approver who is still active, and to the owner when none is", async () => {
    const w = await world();
    const gone = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Left" });
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: gone.id }, data: { status: "SUSPENDED" } });
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { ...(org.settings as object), knowledgeApproverIds: [gone.id, w.named.id] } as Prisma.InputJsonValue } });
    const id = await approved(w);
    await loginAs(w.admin.id);
    const r = await call(askRoute.POST, { method: "POST", url: `${BASE}/${id}/ask`, params: { id }, body: { question: "هل في كفالة؟" } });
    expect(r.status, r.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } })).assigneeId).toBe(w.named.id);
  });
});

describe("the category", () => {
  it("a category named like a member of Object is an ordinary category", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    for (const category of ["constructor", "toString", "__proto__"]) {
      const made = await create({ title: `س ${category}`, category });
      expect(made.status, category).toBe(201);
      expect((await get(sheetOf(made).id)).status, category).toBe(200);
    }
  });
});

describe("approving the version that was seen", () => {
  it("approving needs the version the approver saw: without it (422), and a version that has moved on (422), nothing is approved", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const made = sheetOf(await create({ title: "س", data: data("v1") }));
    await loginAs(w.owner.id);
    expect((await status(made.id, "APPROVED")).status).toBe(422);
    // an editor edits while the owner has v1 open
    await loginAs(w.admin.id);
    expect((await patch(made.id, { version: made.version, data: data("v2 غير مرئي") })).status).toBe(200);
    await loginAs(w.owner.id);
    expect((await status(made.id, "APPROVED", made.version)).status).toBe(422);
    expect((await db.card.findUniqueOrThrow({ where: { id: made.id } })).approvedVersion).toBeNull();
    const cur = sheetOf(await get(made.id));
    expect((await status(made.id, "APPROVED", cur.version)).status).toBe(200);
    expect((await db.card.findUniqueOrThrow({ where: { id: made.id } })).approvedVersion).toBe(cur.version);
  });
});

describe("saving needs the version that was opened", () => {
  it("a PATCH without a version is refused (422) and changes nothing", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const made = sheetOf(await create({ title: "س", data: data("v1") }));
    expect((await patch(made.id, { data: data("بلا نسخة") })).status).toBe(422);
    expect(sheetOf(await get(made.id)).data!.tagline).toBe("v1");
  });
});

describe("what a reader is told", () => {
  it("a reader's answer does not say a newer edit waits for review", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.admin.id);
    const cur = sheetOf(await get(id));
    await patch(id, { version: cur.version, data: data("جديد") });
    await loginAs(w.member.id);
    const r = sheetOf(await get(id));
    expect(r.status).toBe("APPROVED");
    const l = (await call(listRoute.GET, { url: BASE })).json!["sheets"] as Array<{ status: string }>;
    expect(l[0]!.status).toBe("APPROVED");
  });
});

describe("changing the knowledge space", () => {
  it("takes the sheets with it: nobody loses them", async () => {
    const w = await world();
    const id = await approved(w);
    const other = await makeWorkspace(w.org.id, [{ userId: w.admin.id }, { userId: w.member.id }], "معرفة جديدة");
    await loginAs(w.owner.id);
    const r = await call(settingsRoute.PUT, { method: "PUT", url: `${BASE}/settings`, body: { spaceId: other.id } });
    expect(r.status, r.text).toBe(200);
    expect((await db.card.findUniqueOrThrow({ where: { id } })).workspaceId).toBe(other.id);
    await loginAs(w.member.id);
    expect((await get(id)).status).toBe(200);
  });
});
