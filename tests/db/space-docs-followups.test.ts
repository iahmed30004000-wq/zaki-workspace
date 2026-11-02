import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/documents/route";
import * as docRoute from "@/app/api/documents/[id]/route";
import * as deletedRoute from "@/app/api/documents/deleted/route";
import * as undeleteRoute from "@/app/api/documents/[id]/undelete/route";
import * as shareRoute from "@/app/api/documents/[id]/share/route";
import * as searchRoute from "@/app/api/search/route";
import { withFeature } from "@/lib/features";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «المستندات», the follow-ups the owner asked for (2026-11-02):
 *  - a deleted document comes back: the OWNER (the only one who still reads a deleted document) lists a space's deleted
 *    documents and brings one back, as it was, with its history; for everybody else a deleted document does not exist (404);
 *  - the search box finds documents by their title, in the space the person is in, with the same rule as the list (an external
 *    partner finds only the shared ones, a deleted one is never found, another space's never).
 */

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const colleague = await makeUser({ orgId, role: "MEMBER", name: "Colleague" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(
    orgId,
    [{ userId: team.member.id }, { userId: colleague.id }, { userId: team.guest.id, role: "GUEST" }, { userId: team.admin.id, role: "ADMIN" }],
    `Docs ${uid()}`,
  );
  const other = await makeWorkspace(orgId, [{ userId: outsider.id }, { userId: team.member.id }], `Other ${uid()}`);
  return { ...team, colleague, outsider, space, other };
}

const idOf = (id: string) => ({ params: { id } });
async function make(spaceId: string, title: string, content = "") {
  const res = await call(listRoute.POST, { body: { spaceId, title, content } });
  expect(res.status).toBe(201);
  return (res.json as unknown as { document: { id: string } }).document;
}
const remove = (id: string) => call(docRoute.DELETE, { method: "DELETE", ...idOf(id) });
const read = (id: string) => call(docRoute.GET, idOf(id));
const deleted = (spaceId: string) => call(deletedRoute.GET, { url: `http://localhost/api/documents/deleted?spaceId=${spaceId}` });
const undelete = (id: string) => call(undeleteRoute.POST, { method: "POST", ...idOf(id) });
const titles = async (spaceId: string) =>
  ((await call(listRoute.GET, { url: `http://localhost/api/documents?spaceId=${spaceId}` })).json as unknown as { documents: { title: string }[] }).documents.map(
    (d) => d.title,
  );
async function search(q: string): Promise<{ id: string; title: string }[]> {
  const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` });
  expect(res.status).toBe(200);
  return ((res.json as unknown as { documents?: { id: string; title: string }[] }).documents ?? []);
}

describe("a deleted document comes back", () => {
  it("the owner lists the space's deleted documents and brings one back, as it was, with its history", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const kept = await make(w.space.id, "تبقى");
    const d = await make(w.space.id, "انحذفت بالغلط", "النص الأصلي");
    expect((await call(docRoute.PATCH, { method: "PATCH", ...idOf(d.id), body: { version: 1, content: "نص تاني" } })).status).toBe(200);
    const revisionsBefore = await db.documentRevision.count({ where: { documentId: d.id } });
    expect((await remove(d.id)).status).toBe(200);
    expect(await titles(w.space.id)).toEqual(["تبقى"]);

    await loginAs(w.owner.id);
    const listed = await deleted(w.space.id);
    expect(listed.status).toBe(200);
    const rows = (listed.json as unknown as { documents: { id: string; title: string; deletedAt: string }[] }).documents;
    expect(rows.map((r) => r.id)).toEqual([d.id]);
    expect(rows[0]!.deletedAt).toEqual(expect.any(String));

    const back = await undelete(d.id);
    expect(back.status).toBe(200);
    expect(back.json?.["document"]).toMatchObject({ id: d.id, title: "انحذفت بالغلط", content: "نص تاني", archived: false, version: 2 });
    expect(((await deleted(w.space.id)).json as unknown as { documents: unknown[] }).documents).toEqual([]);

    await loginAs(w.member.id);
    expect((await titles(w.space.id)).sort()).toEqual(["انحذفت بالغلط", "تبقى"].sort());
    expect((await read(d.id)).status).toBe(200);
    // its history is still there, and bringing it back added no version
    expect(await db.documentRevision.count({ where: { documentId: d.id } })).toBe(revisionsBefore);
    expect(await db.document.findUniqueOrThrow({ where: { id: kept.id }, select: { archivedAt: true } })).toEqual({ archivedAt: null });
  });

  it("nobody but the owner sees the deleted list or brings a document back: 404, as for anything that does not exist for them", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "ممسوحة");
    await call(shareRoute.POST, { ...idOf(d.id), body: { shared: true } });
    await remove(d.id);

    for (const who of [w.member.id, w.colleague.id, w.admin.id, w.guest.id, w.outsider.id]) {
      await loginAs(who);
      expect((await deleted(w.space.id)).status, who).toBe(404);
      expect((await undelete(d.id)).status, who).toBe(404);
    }
    expect(await db.document.count({ where: { id: d.id, archivedAt: { not: null } } })).toBe(1);
  });

  it("bringing back a document that is not deleted changes nothing; another company's id is a 404", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "حيّة");
    await loginAs(w.owner.id);
    const res = await undelete(d.id);
    expect(res.status).toBe(200);
    expect(res.json?.["document"]).toMatchObject({ id: d.id, version: 1, archived: false });

    const b = await makeTeam();
    await loginAs(b.owner.id);
    expect((await undelete(d.id)).status).toBe(404);
  });

  it("with «المستندات» off, both doors answer 404 for the owner too", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "تحت المفتاح");
    await remove(d.id);
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "spaceDocs", false) as Prisma.InputJsonValue } });
    await loginAs(w.owner.id);
    expect((await deleted(w.space.id)).status).toBe(404);
    expect((await undelete(d.id)).status).toBe(404);
    expect(await db.document.count({ where: { id: d.id, archivedAt: { not: null } } })).toBe(1);
  });
});

describe("the search box finds documents", () => {
  it("by title, in the space the person is in; a deleted one never; another space's never", async () => {
    const w = await world();
    const token = `دليل${uid().slice(0, 6)}`;
    await loginAs(w.member.id);
    const here = await make(w.space.id, `${token} الموظفين`);
    const gone = await make(w.space.id, `${token} القديم`);
    await remove(gone.id);
    await make(w.other.id, `${token} مساحة تانية`);

    jar().set(SPACE_COOKIE, w.space.id);
    expect((await search(token)).map((d) => d.id)).toEqual([here.id]);
    // a word of the title is enough
    expect((await search("الموظفين")).map((d) => d.id)).toContain(here.id);

    // the outsider is not in this space: entering it by cookie lands them back where they belong, and finds nothing here
    await loginAs(w.outsider.id);
    jar().set(SPACE_COOKIE, w.space.id);
    expect((await search(token)).map((d) => d.id)).not.toContain(here.id);
  });

  it("an external partner finds only what is shared with partners", async () => {
    const w = await world();
    const token = `شراكة${uid().slice(0, 6)}`;
    await loginAs(w.member.id);
    const shared = await make(w.space.id, `${token} للشركاء`);
    await make(w.space.id, `${token} داخلي`);
    await call(shareRoute.POST, { ...idOf(shared.id), body: { shared: true } });

    await loginAs(w.guest.id);
    jar().set(SPACE_COOKIE, w.space.id);
    expect((await search(token)).map((d) => d.id)).toEqual([shared.id]);
  });

  it("with «المستندات» off, the search answers no documents", async () => {
    const w = await world();
    const token = `مفتاح${uid().slice(0, 6)}`;
    await loginAs(w.member.id);
    await make(w.space.id, `${token} مستند`);
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "spaceDocs", false) as Prisma.InputJsonValue } });
    jar().set(SPACE_COOKIE, w.space.id);
    expect(await search(token)).toEqual([]);
  });
});
