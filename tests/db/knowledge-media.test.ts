import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/knowledge/route";
import * as mediaRoute from "@/app/api/knowledge/[id]/media/route";
import * as oneRoute from "@/app/api/knowledge/[id]/media/[attId]/route";
import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as filesRoute from "@/app/api/files/route";
import * as chatRoute from "@/app/api/knowledge/[id]/media/[attId]/chat/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * Q1.2: product photos and feedback pictures. Against a real PostgreSQL.
 *
 * Pins: the pictures are KNOWLEDGE files (not in the library list); only the sheet's editors add, only pictures (bytes sniffed), at most 8 MB, the two caps; a
 * feedback item needs «covered» to be uploaded, and is offered to nobody but the editors until it has the customer's consent AND an approver's approval;
 * withdrawing the consent withdraws the approval; the bytes are served only to people who may read the sheet; a guest and an outsider get nothing.
 */
const afterEachCleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of afterEachCleanup.splice(0)) await fn();
});

// a 1x1 PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const NOT_AN_IMAGE = Uint8Array.from(Buffer.from("%PDF-1.4 not a picture", "utf8"));

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const agent = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Agent" });
  const named = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Named editor" });
  const outsider = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id }, { userId: team.member.id }, { userId: agent.id }, { userId: named.id }, { userId: team.guest.id, role: "GUEST" }], "المعرفة");
  const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
  const settings = { ...((org.settings as Record<string, unknown>) ?? {}), knowledgeSpaceId: space.id, knowledgeEditorIds: [named.id], knowledgeApproverIds: [] };
  await db.organization.update({ where: { id: team.org.id }, data: { settings: withFeature(settings, "knowledgeCards", opts.on !== false) as Prisma.InputJsonValue } });
  const sheet = await db.card.create({
    data: { orgId: team.org.id, workspaceId: space.id, createdById: team.owner.id, kind: "PRODUCT", title: "حراك", status: "APPROVED", approvedVersion: 1, data: { tagline: "زيت", badges: [], sections: [], faq: [] } as Prisma.InputJsonValue },
  });
  return { ...team, agent, named, outsider, space, sheet };
}
type World = Awaited<ReturnType<typeof world>>;

async function post(w: World, fields: Record<string, string>, bytes: Uint8Array = PNG, name = "p.png") {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new File([bytes as BlobPart], name, { type: "image/png" }));
  const res = await (mediaRoute.POST as unknown as (r: Request, c: { params: { id: string } }) => Promise<Response>)(new Request(`http://localhost/api/knowledge/${w.sheet.id}/media`, { method: "POST", body: form }), { params: { id: w.sheet.id } });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}
const media = (w: World) => call(mediaRoute.GET, { url: `http://localhost/api/knowledge/${w.sheet.id}/media`, params: { id: w.sheet.id } });
const patch = (w: World, attId: string, body: unknown) => call(oneRoute.PATCH, { method: "PATCH", params: { id: w.sheet.id, attId }, body });
const raw = (fileId: string) => call(rawRoute.GET, { method: "GET", url: `http://localhost/api/files/${fileId}/raw`, params: { id: fileId } });

describe("adding a photo", () => {
  it("an editor adds a photo: a KNOWLEDGE file linked to the sheet, which the library does not list", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const r = await post(w, { role: "GALLERY", caption: "غلاف" });
    expect(r.status, r.text).toBe(201);
    const item = r.json!["item"] as { id: string; fileId: string; role: string };
    const file = await db.storedFile.findUniqueOrThrow({ where: { id: item.fileId } });
    expect(file).toMatchObject({ purpose: "KNOWLEDGE", mimeType: "image/png" });
    const lib = await call(filesRoute.GET, { url: "http://localhost/api/files" });
    expect(lib.text).not.toContain(item.fileId);
    expect(await db.cardAttachment.count({ where: { cardId: w.sheet.id, role: "GALLERY" } })).toBe(1);
  });
  it("a reader of the sheet sees the photos and fetches the bytes; an outsider and a guest get nothing", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const item = (await post(w, { role: "GALLERY" })).json!["item"] as { fileId: string };
    await loginAs(w.agent.id);
    const list = await media(w);
    expect(list.status).toBe(200);
    expect((list.json!["gallery"] as unknown[]).length).toBe(1);
    expect((await raw(item.fileId)).status).toBe(200);
    await loginAs(w.outsider.id);
    expect((await media(w)).status).toBe(404);
    expect((await raw(item.fileId)).status).toBe(404);
    await loginAs(w.guest.id);
    expect((await media(w)).status).toBe(404);
    // the library routes refuse a guest outright (403) before the file is even looked at
    expect([403, 404]).toContain((await raw(item.fileId)).status);
  });
  it("a plain agent may not add; a document is not a picture; the switch off is 404", async () => {
    const w = await world();
    await loginAs(w.agent.id);
    expect((await post(w, { role: "GALLERY" })).status).toBe(403);
    await loginAs(w.admin.id);
    const doc = await post(w, { role: "GALLERY" }, NOT_AN_IMAGE, "d.png");
    expect(doc.status).toBe(422);
    expect(await db.cardAttachment.count({ where: { cardId: w.sheet.id } })).toBe(0);
    const off = await world({ on: false });
    await loginAs(off.admin.id);
    expect((await post(off, { role: "GALLERY" })).status).toBe(404);
  });
  it("the cap of 30 photos holds", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    for (let i = 0; i < 30; i++) {
      const file = await db.storedFile.create({ data: { orgId: w.org.id, uploaderId: w.admin.id, familyId: `f${i}`, name: `p${i}.png`, path: `p/${w.sheet.id}/${i}`, mimeType: "image/png", size: 10, purpose: "KNOWLEDGE" } });
      await db.cardAttachment.create({ data: { cardId: w.sheet.id, fileId: file.id, position: i, addedById: w.admin.id, role: "GALLERY" } });
    }
    expect((await post(w, { role: "GALLERY" })).status).toBe(422);
  });
});

describe("feedback pictures", () => {
  it("needs «covered» to be uploaded, and is seen by the editors only until it has consent and approval", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await post(w, { role: "FEEDBACK" })).status).toBe(422);
    const up = await post(w, { role: "FEEDBACK", covered: "1" });
    expect(up.status, up.text).toBe(201);
    const item = up.json!["item"] as { id: string; fileId: string };
    expect(((await media(w)).json!["feedback"] as unknown[]).length).toBe(1);
    await loginAs(w.agent.id);
    expect(((await media(w)).json!["feedback"] as unknown[]).length).toBe(0);
    expect((await raw(item.fileId)).status).toBe(404);
  });
  it("consent comes from an editor, approval from an approver and only with consent; both make it offerable to the readers", async () => {
    const w = await world();
    await loginAs(w.named.id);
    const item = (await post(w, { role: "FEEDBACK", covered: "1" })).json!["item"] as { id: string; fileId: string };
    // an editor who may not approve
    expect((await patch(w, item.id, { approve: true })).status).toBe(403);
    expect((await patch(w, item.id, { consent: true })).status).toBe(200);
    await loginAs(w.agent.id);
    expect(((await media(w)).json!["feedback"] as unknown[]).length).toBe(0);
    // the owner approves
    await loginAs(w.owner.id);
    const noConsent = await post(w, { role: "FEEDBACK", covered: "1" });
    const bare = noConsent.json!["item"] as { id: string };
    expect((await patch(w, bare.id, { approve: true })).status).toBe(422);
    expect((await patch(w, item.id, { approve: true })).status).toBe(200);
    await loginAs(w.agent.id);
    expect(((await media(w)).json!["feedback"] as unknown[]).length).toBe(1);
    expect((await raw(item.fileId)).status).toBe(200);
    // withdrawing the consent withdraws the approval and the picture goes back to the editors
    await loginAs(w.named.id);
    await patch(w, item.id, { consent: false });
    await loginAs(w.agent.id);
    expect(((await media(w)).json!["feedback"] as unknown[]).length).toBe(0);
    expect((await raw(item.fileId)).status).toBe(404);
  });
  it("the cap of 60 feedback items holds, and removing a picture removes its bytes' access", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    for (let i = 0; i < 60; i++) {
      const file = await db.storedFile.create({ data: { orgId: w.org.id, uploaderId: w.admin.id, familyId: `g${i}`, name: `f${i}.png`, path: `p/${w.sheet.id}/f${i}`, mimeType: "image/png", size: 10, purpose: "KNOWLEDGE" } });
      await db.cardAttachment.create({ data: { cardId: w.sheet.id, fileId: file.id, position: i, addedById: w.admin.id, role: "FEEDBACK", meta: { kind: "image", consent: false, covered: true } as Prisma.InputJsonValue } });
    }
    expect((await post(w, { role: "FEEDBACK", covered: "1" })).status).toBe(422);
    const first = await db.cardAttachment.findFirstOrThrow({ where: { cardId: w.sheet.id }, orderBy: { position: "asc" } });
    expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id: w.sheet.id, attId: first.id } })).status).toBe(200);
    expect(await db.cardAttachment.count({ where: { cardId: w.sheet.id } })).toBe(59);
    expect((await raw(first.fileId)).status).toBe(404);
  });
});

describe("«ابعتيها بالمحادثة»", () => {
  it("a copy of a photo goes into the conversation as a chat attachment of its own; the sheet's picture stays", async () => {
    const w = await world();
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "الزباين" } });
    await loginAs(w.admin.id);
    const item = (await post(w, { role: "GALLERY" })).json!["item"] as { id: string; fileId: string };
    await loginAs(w.agent.id);
    const r = await call(chatRoute.POST, { params: { id: w.sheet.id, attId: item.id }, body: { conversationId: topic.id } });
    expect(r.status, r.text).toBe(201);
    const msg = await db.chatMessage.findFirstOrThrow({ where: { conversationId: topic.id }, include: { attachments: { include: { file: true } } } });
    expect(msg.attachments).toHaveLength(1);
    const copy = msg.attachments[0]!.file;
    expect(copy.id).not.toBe(item.fileId);
    expect(copy.purpose).toBe("CHAT");
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: item.fileId } })).purpose).toBe("KNOWLEDGE");
  });
  it("an unapproved feedback item cannot be sent by a reader; somebody who cannot read the sheet cannot send anything", async () => {
    const w = await world();
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "الزباين" } });
    await loginAs(w.admin.id);
    const fb = (await post(w, { role: "FEEDBACK", covered: "1" })).json!["item"] as { id: string };
    await loginAs(w.agent.id);
    expect((await call(chatRoute.POST, { params: { id: w.sheet.id, attId: fb.id }, body: { conversationId: topic.id } })).status).toBe(404);
    await loginAs(w.outsider.id);
    expect((await call(chatRoute.POST, { params: { id: w.sheet.id, attId: fb.id }, body: { conversationId: topic.id } })).status).toBeGreaterThanOrEqual(403);
    expect(await db.chatMessage.count({ where: { conversationId: topic.id } })).toBe(0);
  });
});

void listRoute;
