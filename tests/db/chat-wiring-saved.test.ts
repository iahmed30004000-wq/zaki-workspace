/**
 * C3w.1 — the saved chat («الرسائل المحفوظة», a DM with oneself) and the person's pins, the leftovers of C3a.1 and C3a.3, against a real database.
 *
 *  - the live line's readers (`realtime/readers.ts`) build the SAME facts as `loadConversationFacts` for a self-DM: the person is a reader of their own saved chat (their other tabs get
 *    the frame), and nobody else is (another person, a guest, a suspended person, the silent eye without `archive.view`)
 *  - the calls door refuses a call in a self key (nobody else is there to ring); an ordinary chat still goes on to the next gate
 *  - the search results and the owner's oversight list title a self key from the dictionary (never an empty title, never the person's own name)
 *  - `PUT /api/chat/order` accepts the scope `pins`: only the person's OWN pins are saved, in the order sent, the ones not sent follow; nobody else's pins, nobody else's list
 */
import { describe, expect, it } from "vitest";
import * as orderRoute from "@/app/api/chat/order/route";
import { startConversationCall } from "@/server/calls/calls";
import { listOversight } from "@/server/chat/oversight";
import { searchChat } from "@/server/chat/search";
import { hqSpaceId } from "@/server/chat/hq";
import { openDm, openSavedMessages } from "@/server/chat/dm";
import { setMyChatState } from "@/server/chat/read-state";
import { readersAmong } from "@/server/realtime/readers";
import { canReadConversation } from "@/server/policy/conversation";
import { AR } from "@/lib/i18n/dict";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
const ctxOf = (orgId: string, userId: string, orgRole: Role = "MEMBER") => ({ orgId, userId, orgRole });

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const suspended = await makeUser({ orgId, role: "MEMBER", name: "Suspended" });
  const blind = await makeUser({ orgId, role: "OWNER", name: "Blind partner" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: blind.id } }, data: { primaryOwner: false, revokedCapabilities: ["archive.view"] } });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: suspended.id }, { userId: t.guest.id }], "Alpha");
  const saved = await openSavedMessages(ctxOf(orgId, a.id));
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: suspended.id } }, data: { status: "SUSPENDED" } });
  return { t, orgId, a, b, suspended, blind, space, saved: saved.id };
}
type World = Awaited<ReturnType<typeof world>>;

describe("the live line's readers know a self-DM", () => {
  it("the person is a reader of their own saved chat; nobody else is", async () => {
    const w = await world();
    const everyone = [w.a.id, w.b.id, w.t.guest.id, w.suspended.id, w.t.admin.id, w.t.owner.id, w.blind.id];
    const { readers, kind } = await readersAmong(w.saved, everyone);
    expect(kind).toBe("DM");
    expect(readers.has(w.a.id)).toBe(true);
    // the silent eye (the primary owner holds archive.view) reads it under the SAME rule as every private chat; nobody else does
    expect(readers.has(w.t.owner.id)).toBe(true);
    expect(readers.has(w.b.id)).toBe(false);
    expect(readers.has(w.t.guest.id)).toBe(false);
    expect(readers.has(w.suspended.id)).toBe(false);
    expect(readers.has(w.t.admin.id)).toBe(false);
    expect(readers.has(w.blind.id)).toBe(false);
  });

  it("it is the SAME answer as the policy's own `canReadConversation`, person by person", async () => {
    const w = await world();
    const everyone = [w.a.id, w.b.id, w.t.guest.id, w.suspended.id, w.t.admin.id, w.t.owner.id, w.blind.id];
    const { readers } = await readersAmong(w.saved, everyone);
    for (const id of everyone) expect(readers.has(id), id).toBe(await canReadConversation(id, w.saved));
  });

  it("a guest's own self key is nobody's reader (a guest has no private chats)", async () => {
    const w = await world();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", dmKey: `${w.t.guest.id}|${w.t.guest.id}`, members: { create: [{ userId: w.t.guest.id }] } } });
    expect((await readersAmong(conv.id, [w.t.guest.id])).readers.has(w.t.guest.id)).toBe(false);
  });
});

describe("the calls door refuses a call in a saved chat", () => {
  it("a self key: refused before anything is started; an ordinary private chat goes on to the next gate", async () => {
    const w = await world();
    await expect(startConversationCall(ctxOf(w.orgId, w.a.id), w.saved, { video: false, ring: true })).rejects.toMatchObject({ message: "calls.e.cannot_start" });
    expect(await db.call.count({ where: { conversationId: w.saved } })).toBe(0);
    expect(await db.chatMessage.count({ where: { conversationId: w.saved, kind: "SYSTEM" } })).toBe(0);
    // the control: a private chat of two people is not refused by this gate (it stops later, where this test environment has no calls server)
    const dm = await openDm(ctxOf(w.orgId, w.a.id), w.b.id, w.space.id);
    await expect(startConversationCall(ctxOf(w.orgId, w.a.id), dm.id, { video: false, ring: true })).rejects.not.toMatchObject({ message: "calls.e.cannot_start" });
  });
});

describe("a self key is titled from the dictionary", () => {
  const title = AR["chatsaved.title"];

  it("search: a message of the saved chat is found with the dictionary's title, never an empty one", async () => {
    const w = await world();
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.saved, authorId: w.a.id, body: "كلمةمحفوظةسرية للبحث" } });
    const hq = await hqSpaceId(w.orgId);
    const found = await searchChat(ctxOf(w.orgId, w.a.id), { id: hq!, isHq: true }, "كلمةمحفوظةسرية");
    const hit = found.messages.find((m) => m.conversationId === w.saved);
    expect(hit, "the message is found").toBeDefined();
    expect(title).toBeTruthy();
    expect(hit!.conversationTitle).toBe(title);
    // somebody else does not find it at all
    const other = await searchChat(ctxOf(w.orgId, w.b.id), { id: hq!, isHq: true }, "كلمةمحفوظةسرية");
    expect(other.messages.find((m) => m.conversationId === w.saved)).toBeUndefined();
  });

  it("oversight: the owner's list titles it, and still names whose it is", async () => {
    const w = await world();
    const list = await listOversight(ctxOf(w.orgId, w.t.owner.id, "OWNER"), {});
    const item = list.items.find((i) => i.id === w.saved);
    expect(item).toBeDefined();
    expect(item!.title).toBe(title);
    expect(item!.names).toEqual([w.a.name]);
    // an ordinary DM is still listed by its two names with no title
    const dm = await openDm(ctxOf(w.orgId, w.a.id), w.b.id, w.space.id);
    const again = await listOversight(ctxOf(w.orgId, w.t.owner.id, "OWNER"), {});
    expect(again.items.find((i) => i.id === dm.id)?.title).toBe("");
  });
});

describe("`PUT /api/chat/order` saves a dragged pin order", () => {
  const URL_ORDER = "http://localhost/api/chat/order";

  async function pinned(w: World, userId: string, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: `p${i}`, position: i } });
      await setMyChatState(ctxOf(w.orgId, userId), c.id, { pinned: true });
      ids.push(c.id);
    }
    return ids;
  }
  const stored = async (w: World, userId: string) =>
    (await db.userChatOrder.findUnique({ where: { userId_orgId_scope: { userId, orgId: w.orgId, scope: "pins" } } }))?.order;

  it("the order sent is the order kept; a pin not sent follows; an id that is not MY pin is dropped", async () => {
    const w = await world();
    const [p0, p1, p2] = await pinned(w, w.a.id, 3) as [string, string, string];
    const notMine = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "plain" } });
    await loginAs(w.a.id);
    const res = await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "pins", order: [p0, notMine.id, p2] } });
    expect(res.status, res.text).toBe(200);
    // the person's saved chat is pinned for them by default (C3a.3): it is one of their pins and follows the ones sent
    expect(res.json?.["order"]).toEqual([p0, p2, p1, w.saved]);
    expect(await stored(w, w.a.id)).toEqual([p0, p2, p1, w.saved]);
    const read = await call(orderRoute.GET, { url: URL_ORDER });
    expect((read.json?.["orders"] as Record<string, string[]>)["pins"]).toEqual([p0, p2, p1, w.saved]);
  });

  it("somebody else's pins are not mine to order: nothing is saved for them, nothing of mine moves", async () => {
    const w = await world();
    const [q0, q1] = await pinned(w, w.b.id, 2) as [string, string];
    const [p0, p1] = await pinned(w, w.a.id, 2) as [string, string];
    await loginAs(w.a.id);
    const res = await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "pins", order: [q1, q0, p1, p0] } });
    expect(res.status).toBe(200);
    expect(res.json?.["order"]).toEqual([p1, p0, w.saved]);
    expect(await stored(w, w.b.id)).toEqual([q1, q0]); // theirs is unchanged: pins are written newest first by setMyChatState
  });

  it("a person with no pins saves nothing; the reset of the scope forgets the order and keeps the pins", async () => {
    const w = await world();
    await loginAs(w.b.id);
    const none = await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "pins", order: ["whatever"] } });
    expect(none.status).toBe(200);
    expect(none.json?.["order"]).toEqual([]);
    const [p0] = await pinned(w, w.b.id, 1) as [string];
    await loginAs(w.b.id);
    await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "pins", order: [p0] } });
    const del = await call(orderRoute.DELETE, { method: "DELETE", url: `${URL_ORDER}?scope=pins` });
    expect(del.status).toBe(200);
    expect(await stored(w, w.b.id)).toBeUndefined();
    expect((await db.conversationMember.findFirstOrThrow({ where: { conversationId: p0, userId: w.b.id } })).pinnedAt).not.toBeNull();
  });

  it("the old scopes still work and a bad scope is still refused", async () => {
    const w = await world();
    await loginAs(w.a.id);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "dm", order: [] } })).status).toBe(200);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "pins:other", order: [] } })).status).toBe(422);
  });
});
