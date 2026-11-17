import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as recallRoute from "@/app/api/chat/recall/route";
import * as sendRecallRoute from "@/app/api/chat/conversations/[id]/recall/route";
import * as editRoute from "@/app/api/chat/messages/[id]/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * Q1.3: «/» in the composer — a product card sent into a conversation, and approved answers found for the composer.
 * Against a real PostgreSQL.
 *
 * Pins: the switch off = 404; only staff who may read the sheet and may post in the conversation can send it; an unapproved sheet cannot be sent;
 * the stored message holds NO price (a readable line and `{ type, cardId }`), so a guest reading the conversation gets none; the card message cannot
 * be edited; a reply search finds only APPROVED answers (the approved version, never a newer unapproved one).
 */
async function setSettings(orgId: string, patch: Record<string, unknown>, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: Record<string, unknown> = { ...((org.settings as Record<string, unknown> | null) ?? {}), ...patch };
  for (const [k, on] of Object.entries(features)) s = withFeature(s, k as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const outsider = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Outsider" });
  const knowledge = await makeWorkspace(team.org.id, [{ userId: team.admin.id }, { userId: team.member.id }], "المعرفة");
  // the conversation's space: the member, the admin and the guest are in it; the outsider is not
  const chatSpace = await makeWorkspace(team.org.id, [{ userId: team.admin.id }, { userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], "الشات");
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: chatSpace.id, title: "أسئلة الزباين" } });
  await setSettings(team.org.id, { knowledgeSpaceId: knowledge.id }, { knowledgeCards: true, quickRecall: opts.on !== false });
  const sheet = await db.card.create({
    data: {
      orgId: team.org.id,
      workspaceId: knowledge.id,
      createdById: team.owner.id,
      kind: "PRODUCT",
      title: "حراك",
      category: "العناية بالبشرة والجسم",
      status: "APPROVED",
      approvedVersion: 1,
      data: { tagline: "زيت دافي", badges: [], sections: [], faq: [{ q: "هل بينفع للأطفال؟", a: "لا، للكبار بس.", keywords: ["طفل"] }] } as Prisma.InputJsonValue,
      external: { id: "p1", code: "H-1", name: "حراك", price: 20, currency: "USD", offers: [], stockStatus: "in_stock", fetchedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });
  return { ...team, outsider, knowledge, chatSpace, topic, sheet };
}
type World = Awaited<ReturnType<typeof world>>;

const BASE = "http://localhost/api/chat";
const send = (w: World, cardId: string, convId = w.topic.id, clientId?: string) => call(sendRecallRoute.POST, { method: "POST", url: `${BASE}/conversations/${convId}/recall`, params: { id: convId }, body: { cardId, ...(clientId ? { clientId } : {}) } });
const search = (q: string, kind = "product") => call(recallRoute.GET, { url: `${BASE}/recall?q=${encodeURIComponent(q)}&kind=${kind}` });

describe("the switch and who may send", () => {
  it("with the switch off both doors answer 404", async () => {
    const w = await world({ on: false });
    await loginAs(w.member.id);
    expect((await send(w, w.sheet.id)).status).toBe(404);
    expect((await search("حراك")).status).toBe(404);
  });
  it("a staff member who may read the sheet and post here sends it: a CARD message with no price in it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await send(w, w.sheet.id);
    expect(r.status, r.text).toBe(201);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: r.json!["id"] as string } });
    expect(row).toMatchObject({ kind: "CARD", body: "كرت منتج: حراك", conversationId: w.topic.id, authorId: w.member.id });
    expect(row.card).toEqual({ type: "product", cardId: w.sheet.id });
    // what is stored about the product is its address and a name: no price, no currency, no number at all
    expect(row.body).not.toMatch(/[0-9]|price|USD/);
    expect(Object.keys(row.card as object).sort()).toEqual(["cardId", "type"]);
    expect(r.json).toMatchObject({ kind: "CARD", card: { type: "product", cardId: w.sheet.id } });
    expect(JSON.stringify(r.json)).not.toMatch(/price|USD/);
  });
  it("an unapproved sheet cannot be sent (404), and neither can an archived one", async () => {
    const w = await world();
    const draft = await db.card.create({ data: { orgId: w.org.id, workspaceId: w.knowledge.id, createdById: w.owner.id, kind: "PRODUCT", title: "مسودة", status: "DRAFT", data: {} } });
    await loginAs(w.member.id);
    expect((await send(w, draft.id)).status).toBe(404);
    await db.card.update({ where: { id: w.sheet.id }, data: { status: "ARCHIVED" } });
    expect((await send(w, w.sheet.id)).status).toBe(404);
  });
  it("somebody who may not read the knowledge space cannot send its sheet (404)", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.chatSpace.id, userId: w.outsider.id } });
    await loginAs(w.outsider.id);
    expect((await send(w, w.sheet.id)).status).toBe(404);
  });
  it("somebody who may not post in the conversation cannot (not found or forbidden), and nothing is stored", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    const r = await send(w, w.sheet.id);
    expect([403, 404]).toContain(r.status);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "CARD" } })).toBe(0);
  });
  it("an external partner cannot send a card, and the sheet is not theirs to find", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    expect((await send(w, w.sheet.id)).status).toBe(404);
    expect((await search("حراك")).status).toBe(404);
  });
});

describe("what a reader of the conversation gets", () => {
  it("a guest in the conversation reads the line and the card address, never a price; the sheet itself is not theirs", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const sent = await send(w, w.sheet.id);
    await loginAs(w.guest.id);
    const list = await call(conversationRoute.GET, { url: `${BASE}/conversations/${w.topic.id}`, params: { id: w.topic.id } });
    expect(list.status, list.text).toBe(200);
    expect(list.text).not.toMatch(/price|USD/);
    expect(list.text).toContain("كرت منتج: حراك");
    void sent;
  });
});

describe("a card message is not edited", () => {
  it("editing is refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const id = (await send(w, w.sheet.id)).json!["id"] as string;
    const r = await call(editRoute.PATCH, { method: "PATCH", url: `${BASE}/messages/${id}`, params: { id }, body: { body: "كرت منتج: غير حراك" } });
    expect(r.status).toBe(403);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id } })).body).toBe("كرت منتج: حراك");
  });
  it("a forward keeps it a card, resolved again for its new readers", async () => {
    const w = await world();
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.chatSpace.id, title: "تاني" } });
    await loginAs(w.member.id);
    const id = (await send(w, w.sheet.id)).json!["id"] as string;
    const r = await call(forwardRoute.POST, { method: "POST", url: `${BASE}/messages/${id}/forward`, params: { id }, body: { conversationId: other.id } });
    expect(r.status, r.text).toBeLessThan(300);
    const copy = await db.chatMessage.findFirstOrThrow({ where: { conversationId: other.id, kind: "CARD" } });
    expect(copy.card).toEqual({ type: "product", cardId: w.sheet.id });
  });
});

describe("the search of the composer", () => {
  it("finds approved products by the Arabic folding, with the live price, and nothing unapproved", async () => {
    const w = await world();
    await db.card.create({ data: { orgId: w.org.id, workspaceId: w.knowledge.id, createdById: w.owner.id, kind: "PRODUCT", title: "حراك مسودة", status: "DRAFT", data: {} } });
    await loginAs(w.member.id);
    const r = await search("حراك");
    expect(r.status, r.text).toBe(200);
    const results = r.json!["results"] as Array<{ id: string; name: string; price: number | null }>;
    expect(results.map((x) => x.name)).toEqual(["حراك"]);
    expect(results[0]!.price).toBe(20);
    expect(((await search("غسالة")).json!["results"] as unknown[]).length).toBe(0);
  });
  it("«/رد» finds the answers of the APPROVED version, never a newer unapproved one", async () => {
    const w = await world();
    // a newer edit that waits for review: the old approved answer stays the one that is found
    await db.cardRevision.create({ data: { cardId: w.sheet.id, version: 1, title: "حراك", category: "العناية بالبشرة والجسم", tags: [], editorId: w.owner.id, data: { tagline: "زيت دافي", badges: [], sections: [], faq: [{ q: "هل بينفع للأطفال؟", a: "لا، للكبار بس." }] } as Prisma.InputJsonValue } });
    await db.card.update({
      where: { id: w.sheet.id },
      data: { version: 2, status: "REVIEW", data: { tagline: "زيت دافي", badges: [], sections: [], faq: [{ q: "هل بينفع للأطفال؟", a: "نعم للجميع (غير معتمد)" }] } as Prisma.InputJsonValue },
    });
    await loginAs(w.member.id);
    const r = await search("اطفال", "reply");
    expect(r.status, r.text).toBe(200);
    const answers = r.json!["results"] as Array<{ answer: string; sheetName: string }>;
    expect(answers.map((a) => a.answer)).toEqual(["لا، للكبار بس."]);
    expect(r.text).not.toContain("غير معتمد");
  });
});

describe("a repeated tap", () => {
  it("the same clientId sends the card once (a lost answer then a second tap does not post it twice)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await send(w, w.sheet.id, w.topic.id, "recall-client-1");
    const b = await send(w, w.sheet.id, w.topic.id, "recall-client-1");
    expect(a.status, a.text).toBe(201);
    expect(b.status, b.text).toBeLessThan(300);
    expect(b.json!["id"]).toBe(a.json!["id"]);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "CARD" } })).toBe(1);
  });
});
