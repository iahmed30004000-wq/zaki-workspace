import { describe, expect, it, vi } from "vitest";

// Keep uploaded test files out of the repo. vi.hoisted runs before the imports, so it must not use any.
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-${process.pid}`;
});

import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as pagesRoute from "@/app/api/files/[id]/pages/route";
import { ingest } from "@/server/services/files";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * The PDF viewer of the library: the bytes come from the authorised download route (inline, with the type the bytes proved), the
 * page count from a sibling door with the SAME rule. A person who may not read the file gets neither, and learns nothing.
 */

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n4 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF\n",
  "latin1",
);
const compressed = Buffer.from("%PDF-1.5\n7 0 obj\n<< /Type /ObjStm /N 3 >>\nstream\n\u0001\u0002\nendstream\nendobj\n", "latin1");

async function world() {
  const team = await makeTeam();
  const outsider = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }]);
  const other = await makeWorkspace(team.org.id, [{ userId: outsider.id }]);
  const ctx = { orgId: team.org.id, orgRole: "MEMBER" as const, userId: team.member.id };
  const pdf = await ingest(ctx, { name: "عقد.pdf", bytes: PDF }, undefined, "LIBRARY", undefined, { workspaceId: space.id });
  const old = await ingest(ctx, { name: "مضغوط.pdf", bytes: compressed }, undefined, "LIBRARY", undefined, { workspaceId: space.id });
  return { ...team, outsider, space, other, ctx, pdf, old };
}
const pages = (id: string) => call(pagesRoute.GET, { params: { id } });
const raw = (id: string) => call(rawRoute.GET, { params: { id } });

describe("a PDF opens inline for the people who may read it, with its page count", () => {
  it("serves the bytes inline as application/pdf, nosniff, never cached for others; the count comes from the same door", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await raw(w.pdf.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("private");
    expect((await pages(w.pdf.id)).json).toEqual({ pages: 2 });
    // a file whose pages are not readable from the bytes has no count, and still opens
    expect((await pages(w.old.id)).json).toEqual({ pages: null });
    expect((await raw(w.old.id)).status).toBe(200);
    // the owner reads it silently from a space he is not in
    await loginAs(w.owner.id);
    expect((await pages(w.pdf.id)).json).toEqual({ pages: 2 });
  });

  it("a person who is not in the space, another company's member, a guest and a signed-out caller get nothing", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    expect((await pages(w.pdf.id)).status).toBe(404);
    expect((await raw(w.pdf.id)).status).toBe(404);

    const foreign = await makeTeam();
    await loginAs(foreign.owner.id);
    expect((await pages(w.pdf.id)).status).toBe(404);
    expect((await raw(w.pdf.id)).status).toBe(404);

    await loginAs(w.guest.id); // a partner never reads the library
    expect((await pages(w.pdf.id)).status).toBe(403);
    expect((await raw(w.pdf.id)).status).toBe(403);
  });

  it("a deleted file and a file still being written are not served or counted; the count of a non-PDF is null", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await db.storedFile.update({ where: { id: w.old.id }, data: { deletedAt: new Date() } });
    expect((await pages(w.old.id)).status).toBe(404);
    const pending = await db.storedFile.create({
      data: { orgId: w.org.id, uploaderId: w.member.id, familyId: "p", name: "p.pdf", path: "pending", mimeType: "application/pdf", size: 10, workspaceId: w.space.id },
    });
    expect((await pages(pending.id)).status).toBe(404);
    expect((await raw(pending.id)).status).toBe(404);
    const png = await ingest(w.ctx, { name: "x.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]) }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect((await pages(png.id)).json).toEqual({ pages: null });
  });

  it("a chat attachment that is a PDF is only for the readers of its conversation, count included", async () => {
    const w = await world();
    const chatPdf = await ingest(w.ctx, { name: "chat.pdf", bytes: PDF }, undefined, "CHAT");
    await loginAs(w.member.id); // its uploader, before any message claims it
    expect((await pages(chatPdf.id)).json).toEqual({ pages: 2 });
    await loginAs(w.admin.id);
    expect((await pages(chatPdf.id)).status).toBe(404);
    expect((await raw(chatPdf.id)).status).toBe(404);
  });
});
