import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/documents/route";
import * as docRoute from "@/app/api/documents/[id]/route";
import * as revisionsRoute from "@/app/api/documents/[id]/revisions/route";
import * as restoreRoute from "@/app/api/documents/[id]/restore/route";
import * as shareRoute from "@/app/api/documents/[id]/share/route";
import { withFeature } from "@/lib/features";
import { SNAPSHOT_GAP_MS } from "@/lib/docs/versions";
import { flushPushesForTests } from "@/server/notify";
import { call, db, loginAs, makeOrg, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «المستندات»: the text documents of a space. Authorization is proven against a real database: a person outside the space gets
 * 404 (never 403), the people in it read and write, an external partner reads ONLY what is marked «مشاركة مع الشركاء» and never
 * writes or sees the history, the owner reads silently, a save from an older version is a 409, a restore is a new version, the
 * history is append-only, nothing is ever deleted, and the switch turns it all off.
 */

interface Doc {
  id: string;
  title: string;
  content: string;
  version: number;
  sharedWithPartners: boolean;
  authorName: string | null;
  lastEditorName: string | null;
  canWrite: boolean;
  canManage: boolean;
  internal: boolean;
  people: { id: string; name: string }[];
  archived: boolean;
}
type Listed = { documents: { id: string; title: string; excerpt: string; authorName: string | null }[]; canCreate: boolean };

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const colleague = await makeUser({ orgId, role: "MEMBER", name: "Colleague" });
  const space = await makeWorkspace(
    orgId,
    [{ userId: team.member.id }, { userId: colleague.id }, { userId: team.guest.id, role: "GUEST" }, { userId: team.admin.id, role: "ADMIN" }],
    `Docs ${uid()}`,
  );
  const other = await makeWorkspace(orgId, [{ userId: outsider.id }], `Other ${uid()}`);
  return { ...team, outsider, colleague, space, other };
}

const idOf = (id: string) => ({ params: { id } });
const list = (spaceId: string) => call(listRoute.GET, { url: `http://localhost/api/documents?spaceId=${spaceId}` });
const titles = async (spaceId: string) => ((await list(spaceId)).json as unknown as Listed).documents.map((d) => d.title);
async function make(spaceId: string, title: string, content = "") {
  const res = await call(listRoute.POST, { body: { spaceId, title, content } });
  expect(res.status).toBe(201);
  return (res.json as unknown as { document: Doc }).document;
}
const read = (id: string) => call(docRoute.GET, idOf(id));
const save = (id: string, body: Record<string, unknown>) => call(docRoute.PATCH, { method: "PATCH", ...idOf(id), body });
const share = (id: string, shared: boolean) => call(shareRoute.POST, { ...idOf(id), body: { shared } });
const history = (id: string) => call(revisionsRoute.GET, { ...idOf(id), url: `http://localhost/api/documents/${id}/revisions` });
const restore = (id: string, body: Record<string, unknown>) => call(restoreRoute.POST, { ...idOf(id), body });
const doc = (res: { json: Record<string, unknown> | null }) => (res.json as unknown as { document: Doc }).document;

describe("a space's documents belong to the people in it", () => {
  it("a member writes and reads; a person outside the space gets 404, never 403, on every door", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = await make(w.space.id, "خطة الأسبوع", "# خطة\n- بند");
    expect(await titles(w.space.id)).toEqual(["خطة الأسبوع"]);
    expect(mine).toMatchObject({ version: 1, canWrite: true, canManage: true, sharedWithPartners: false });

    await loginAs(w.outsider.id);
    expect((await list(w.space.id)).status).toBe(404);
    expect((await call(listRoute.POST, { body: { spaceId: w.space.id, title: "sneaky" } })).status).toBe(404);
    expect((await read(mine.id)).status).toBe(404);
    expect((await save(mine.id, { version: 1, content: "mine now" })).status).toBe(404);
    expect((await share(mine.id, true)).status).toBe(404);
    expect((await history(mine.id)).status).toBe(404);
    expect((await restore(mine.id, { version: 1 })).status).toBe(404);
    expect((await call(docRoute.DELETE, { method: "DELETE", ...idOf(mine.id) })).status).toBe(404);
    expect(await db.document.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ title: "خطة الأسبوع", content: "# خطة\n- بند", archivedAt: null });
    // their own space has its own (empty) list
    expect(await titles(w.other.id)).toEqual([]);
  });

  it("another company's owner sees nothing of this company's documents (404)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = await make(w.space.id, "ours");
    const foreign = await makeTeam();
    await loginAs(foreign.owner.id);
    expect((await read(mine.id)).status).toBe(404);
    expect((await list(w.space.id)).status).toBe(404);
  });

  it("every colleague of the space edits it, and the list shows who wrote and when it was last touched", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "مشترك", "نص أول");
    await loginAs(w.colleague.id);
    const saved = await save(d.id, { version: 1, content: "نص ثاني" });
    expect(saved.status).toBe(200);
    expect(doc(saved)).toMatchObject({ version: 2, content: "نص ثاني", lastEditorName: "Colleague", authorName: "Member" });
    const listed = (await list(w.space.id)).json as unknown as Listed;
    expect(listed.documents[0]).toMatchObject({ title: "مشترك", excerpt: "نص ثاني", authorName: "Member" });
  });
});

describe("an external partner reads only what is shared with partners", () => {
  it("an unshared document does not exist for the guest; a shared one is readable, without the staff names, the people or the history", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const secret = await make(w.space.id, "داخلي", "أسعارنا الداخلية");
    const open = await make(w.space.id, "للشركاء", "# أهلا بالشريك");

    await loginAs(w.guest.id);
    expect(await titles(w.space.id)).toEqual([]);
    expect((await read(secret.id)).status).toBe(404);
    expect((await history(secret.id)).status).toBe(404);

    await loginAs(w.member.id);
    expect((await share(open.id, true)).status).toBe(200);

    await loginAs(w.guest.id);
    expect(await titles(w.space.id)).toEqual(["للشركاء"]);
    const listed = (await list(w.space.id)).json as unknown as Listed;
    expect(listed.canCreate).toBe(false);
    expect(listed.documents[0]?.authorName).toBeNull();
    const seen = doc(await read(open.id));
    expect(seen).toMatchObject({ content: "# أهلا بالشريك", canWrite: false, canManage: false, internal: false, authorName: null, lastEditorName: null, people: [] });
    // never writes, never marks, never deletes, never reads the history
    expect((await save(open.id, { version: 1, content: "x" })).status).toBe(403);
    expect((await share(open.id, false)).status).toBe(403);
    expect((await call(docRoute.DELETE, { method: "DELETE", ...idOf(open.id) })).status).toBe(403);
    expect((await history(open.id)).status).toBe(404);
    expect((await restore(open.id, { version: 1 })).status).toBe(403);
    expect((await call(listRoute.POST, { body: { spaceId: w.space.id, title: "x" } })).status).toBe(403);

    // taking the mark off closes it again
    await loginAs(w.member.id);
    await share(open.id, false);
    await loginAs(w.guest.id);
    expect((await read(open.id)).status).toBe(404);
  });

  it("a guest of ANOTHER space, shared or not, reads nothing of this one", async () => {
    const w = await world();
    const guest2 = await makeUser({ orgId: w.org.id, role: "GUEST", name: "Guest2" });
    await makeWorkspace(w.org.id, [{ userId: guest2.id, role: "GUEST" }], "partner space");
    await loginAs(w.member.id);
    const d = await make(w.space.id, "shared elsewhere");
    await share(d.id, true);
    await loginAs(guest2.id);
    expect((await read(d.id)).status).toBe(404);
    expect((await list(w.space.id)).status).toBe(404);
  });

  it("who may mark a document shared: its author, a manager of the space, the owner; not another colleague", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "mine");
    await loginAs(w.colleague.id);
    const denied = await share(d.id, true);
    expect(denied.status).toBe(403);
    expect(denied.json?.["message"]).toBe("docs.manage_denied");
    await loginAs(w.admin.id); // ADMIN of the space
    expect((await share(d.id, true)).status).toBe(200);
    await loginAs(w.owner.id);
    expect((await share(d.id, false)).status).toBe(200);
  });
});

describe("the owner reads silently and a person never sees what is not theirs", () => {
  it("the owner opens a space he is not in: no row, no notification, no trace; the archive is his alone", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "للمراجعة");
    const gone = await make(w.space.id, "ممسوحة");
    await call(docRoute.DELETE, { method: "DELETE", ...idOf(gone.id) });

    const rowsBefore = await db.workspaceMember.count({ where: { workspaceId: w.space.id } });
    await loginAs(w.owner.id);
    expect(await titles(w.space.id)).toEqual(["للمراجعة"]);
    expect(doc(await read(d.id))).toMatchObject({ canWrite: true });
    expect((await read(gone.id)).status).toBe(200); // the owner still reads what was deleted
    expect(await db.workspaceMember.count({ where: { workspaceId: w.space.id } })).toBe(rowsBefore);
    expect(await db.notification.count({ where: { workspaceId: w.space.id } })).toBe(0);

    await loginAs(w.colleague.id);
    expect((await read(gone.id)).status).toBe(404);
  });
});

describe("saving: versions, 409 and the history", () => {
  it("a save from an older version is refused with 409 carrying the document as it is now; nothing is overwritten", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "تنافس", "أصل");
    await loginAs(w.colleague.id);
    expect((await save(d.id, { version: 1, content: "نسخة زميلي" })).status).toBe(200);
    await loginAs(w.member.id);
    const late = await save(d.id, { version: 1, content: "نسختي القديمة" });
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({ error: "conflict", message: "docs.conflict", current: { content: "نسخة زميلي", version: 2, lastEditorName: "Colleague" } });
    expect((await db.document.findUniqueOrThrow({ where: { id: d.id } })).content).toBe("نسخة زميلي");
    // «آخر حفظ بيفوز»: the person who chooses to keep theirs saves again from the version they just learned
    expect((await save(d.id, { version: 2, content: "نسختي القديمة" })).status).toBe(200);
  });

  it("a save that changes nothing writes nothing; a save without a version, or with an empty title, is refused (422)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "ثابت", "نص");
    const same = await save(d.id, { version: 1, title: "ثابت", content: "نص" });
    expect(same.status).toBe(200);
    expect(doc(same).version).toBe(1);
    expect((await save(d.id, { content: "no version" })).status).toBe(422);
    expect((await save(d.id, { version: 1, title: "   " })).status).toBe(422);
    expect((await save(d.id, { version: 1, content: "x".repeat(100_001) })).status).toBe(422);
    expect((await call(listRoute.POST, { body: { spaceId: w.space.id, title: "" } })).status).toBe(422);
    expect(await db.documentRevision.count({ where: { documentId: d.id } })).toBe(0);
  });

  it("a run of quick saves by one person is ONE history row; another person's save, and a pause, each add one", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "تاريخ", "v1");
    await save(d.id, { version: 1, content: "v2" });
    await save(d.id, { version: 2, content: "v3" });
    await save(d.id, { version: 3, content: "v4" });
    // the author typing: the creation counted as the first save, so nothing was worth keeping yet
    expect(await db.documentRevision.count({ where: { documentId: d.id } })).toBe(0);

    await loginAs(w.colleague.id);
    await save(d.id, { version: 4, content: "colleague" });
    const afterColleague = await db.documentRevision.findMany({ where: { documentId: d.id }, orderBy: { version: "asc" } });
    // the colleague's save kept what the author had written (v4)
    expect(afterColleague.map((r) => [r.version, r.content, r.cause, r.editorId])).toEqual([[4, "v4", "EDIT", w.member.id]]);

    // a pause longer than the gap makes the next save by the same person worth keeping too
    await db.document.update({ where: { id: d.id }, data: { updatedAt: new Date(Date.now() - SNAPSHOT_GAP_MS - 60_000) } });
    await save(d.id, { version: 5, content: "colleague later" });
    expect((await db.documentRevision.findMany({ where: { documentId: d.id }, orderBy: { version: "asc" } })).map((r) => r.version)).toEqual([4, 5]);

    // the team reads the history, newest first, with who saved over each
    const seen = (await history(d.id)).json as unknown as { currentVersion: number; revisions: { version: number; editorName: string; size: number }[] };
    expect(seen.currentVersion).toBe(6);
    expect(seen.revisions.map((r) => r.version)).toEqual([5, 4]);
    expect(seen.revisions.map((r) => r.editorName)).toEqual(["Colleague", "Member"]); // who WROTE each kept version
  });

  it("restore brings an old version back as a NEW version; the history only grows, and the table refuses an UPDATE", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "عنوان قديم", "الأصل");
    await loginAs(w.colleague.id);
    await save(d.id, { version: 1, title: "عنوان جديد", content: "تعديل الزميل" }); // keeps v1 (the author's)
    const v1 = (await db.documentRevision.findUniqueOrThrow({ where: { documentId_version: { documentId: d.id, version: 1 } } })).content;
    expect(v1).toBe("الأصل");

    const before = await db.documentRevision.count({ where: { documentId: d.id } });
    await loginAs(w.member.id);
    const restored = await restore(d.id, { version: 1, baseVersion: 2 });
    expect(restored.status).toBe(200);
    expect(doc(restored)).toMatchObject({ version: 3, title: "عنوان قديم", content: "الأصل" });
    const rows = await db.documentRevision.findMany({ where: { documentId: d.id }, orderBy: { version: "asc" } });
    expect(rows.length).toBe(before + 1);
    // the restore kept what it replaced (the colleague's v2) and says it was a restore
    expect(rows.find((r) => r.version === 2)).toMatchObject({ content: "تعديل الزميل", cause: "RESTORE", title: "عنوان جديد", editorId: w.colleague.id });
    // the old row is still there, unchanged
    expect(rows.find((r) => r.version === 1)).toMatchObject({ content: "الأصل", cause: "EDIT" });

    // the full text of one version, for the preview
    const one = await call(revisionsRoute.GET, { ...idOf(d.id), url: `http://localhost/api/documents/${d.id}/revisions?version=2` });
    expect(one.json).toMatchObject({ revision: { version: 2, content: "تعديل الزميل" } });
    expect((await call(revisionsRoute.GET, { ...idOf(d.id), url: `http://localhost/api/documents/${d.id}/revisions?version=99` })).status).toBe(404);
    expect((await restore(d.id, { version: 99 })).status).toBe(404);

    // append-only, by the database itself
    await expect(db.documentRevision.update({ where: { id: rows[0]!.id }, data: { content: "rewritten" } })).rejects.toThrow(/append-only/);
  });

  it("a restore from a stale view is a 409 too", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "t", "a");
    await loginAs(w.colleague.id);
    await save(d.id, { version: 1, content: "b" });
    await loginAs(w.member.id);
    const stale = await restore(d.id, { version: 1, baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ current: { version: 2, content: "b" } });
  });
});

describe("@mentions reuse the chat's rule: a person of the space, a whole word, told once", () => {
  it("the mentioned colleague gets one bell notice; saving again does not repeat it; an outsider, the author and a half-name get none", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "اجتماع");
    await save(d.id, { version: 1, content: "شوف يا @Colleague و @Member و @Outsider و @Collea" });
    await flushPushesForTests();
    const notes = await db.notification.findMany({ where: { type: "doc_mention" } });
    const mine = notes.filter((n) => n.workspaceId === w.space.id);
    expect(mine.map((n) => n.userId)).toEqual([w.colleague.id]);
    expect(mine[0]).toMatchObject({ linkUrl: `/documents/${d.id}`, organizationId: w.org.id });
    expect(mine[0]?.body).toContain("اجتماع");
    expect((await db.document.findUniqueOrThrow({ where: { id: d.id } })).mentions.sort()).toEqual([w.colleague.id, w.member.id].sort()); // the author is named too, and is simply not told

    await save(d.id, { version: 2, content: "شوف يا @Colleague مرة ثانية" });
    await flushPushesForTests();
    expect((await db.notification.findMany({ where: { type: "doc_mention", workspaceId: w.space.id } })).length).toBe(1);

    // taking the name away and putting it back is a new mention
    await save(d.id, { version: 3, content: "بدون اسم" });
    await save(d.id, { version: 4, content: "@Colleague رجعت" });
    await flushPushesForTests();
    expect((await db.notification.findMany({ where: { type: "doc_mention", workspaceId: w.space.id } })).length).toBe(2);
  });

  it("the picker's people are the space's own staff: not the guest, not the outsider, not a suspended colleague", async () => {
    const w = await world();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.colleague.id } }, data: { status: "SUSPENDED" } });
    await loginAs(w.member.id);
    const d = await make(w.space.id, "ناس");
    const names = doc(await read(d.id)).people.map((p) => p.name).sort();
    expect(names).toEqual(["Admin", "Member"]);
  });
});

describe("«حذف» archives; nothing is ever removed", () => {
  it("the author (and a manager) delete; another colleague may not; the row and its history stay", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "للحذف", "نص");
    await loginAs(w.colleague.id);
    const denied = await call(docRoute.DELETE, { method: "DELETE", ...idOf(d.id) });
    expect(denied.status).toBe(403);
    await loginAs(w.member.id);
    expect((await call(docRoute.DELETE, { method: "DELETE", ...idOf(d.id) })).status).toBe(200);
    expect(await titles(w.space.id)).toEqual([]);
    expect((await read(d.id)).status).toBe(404);
    expect((await save(d.id, { version: 1, content: "x" })).status).toBe(404);
    expect(await db.document.count({ where: { id: d.id, archivedAt: { not: null } } })).toBe(1);
  });
});

describe("the switch «المستندات»", () => {
  it("off, every door answers 404 features.off and the documents stay; on again, they are back", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await make(w.space.id, "تبقى", "نص");
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "spaceDocs", false) as Prisma.InputJsonValue } });

    for (const res of [await list(w.space.id), await read(d.id), await save(d.id, { version: 1, content: "x" }), await history(d.id), await share(d.id, true)]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    await loginAs(w.owner.id);
    expect((await read(d.id)).status).toBe(404); // for the owner too

    expect(await db.document.count({ where: { id: d.id } })).toBe(1);
    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "spaceDocs", true) as Prisma.InputJsonValue } });
    await loginAs(w.member.id);
    expect((await read(d.id)).status).toBe(200);
  });
});

describe("documents of two companies never meet", () => {
  it("a document id from another company is a 404 even for a person who is an owner there", async () => {
    const a = await world();
    const b = await makeOrg();
    const ownerB = await makeUser({ orgId: b.id, role: "OWNER" });
    await loginAs(a.member.id);
    const d = await make(a.space.id, "A's");
    await loginAs(ownerB.id);
    expect((await read(d.id)).status).toBe(404);
  });
});
