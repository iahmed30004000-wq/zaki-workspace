/**
 * C3a.3 — «الرسائل المحفوظة»: a DM with oneself. No schema change: `kind = DM`, `dmKey = "<me>|<me>"` (no space suffix: it is the person's, not a space's), ONE
 * `ConversationMember`. `openSavedMessages` creates it or finds it, and two tabs at once end with one conversation (the unique (orgId, dmKey)). The privacy
 * core is `loadConversationFacts`: for a self-DM the «other person is active» fact is the VIEWER being active (and not a guest); nothing else is loosened — an
 * outsider cannot open it, a guest cannot make or open one, and the owner reads it under the SAME oversight rule as every DM (D-C3, default yes), no more.
 */
import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import { chatList } from "@/server/chat/list";
import { dmKeyOf, listDms, openDm, openSavedMessages, savedKeyOf } from "@/server/chat/dm";
import { PINS_MAX, setMyChatState } from "@/server/chat/read-state";
import { canPost, canRead, canPin, canModerate, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { syncFeed } from "@/server/chat/sync";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
type Person = { id: string };
const ctxOf = (orgId: string, who: Person, orgRole: Role = "MEMBER") => ({ orgId, userId: who.id, orgRole });

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const suspended = await makeUser({ orgId, role: "MEMBER", name: "Suspended" });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: outsider.id }, { userId: t.guest.id }], "Alpha");
  return { t, orgId, a, b, outsider, suspended, space };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const savedOf = (w: World, who: Person) => db.conversation.findMany({ where: { orgId: w.orgId, dmKey: savedKeyOf(who.id) } });
const setFeature = (w: World, on: boolean | null) => db.organization.update({ where: { id: w.orgId }, data: { settings: on === null ? {} : { features: { savedMessages: on } } } });

describe("openSavedMessages: create or get, idempotent", () => {
  it("makes a DM with oneself: kind DM, the key «me|me», no space, ONE member row, a title, and it is pinned for the person by default", async () => {
    const w = await getWorld();
    const res = await openSavedMessages(ctxOf(w.orgId, w.a));
    expect(res.created).toBe(true);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: res.id }, include: { members: true } });
    expect(conv.kind).toBe("DM");
    expect(conv.dmKey).toBe(`${w.a.id}|${w.a.id}`);
    expect(conv.dmKey).toBe(dmKeyOf(w.a.id, w.a.id));
    expect(conv.spaceId).toBeNull();
    expect(conv.members).toHaveLength(1);
    expect(conv.members[0]!.userId).toBe(w.a.id);
    expect(conv.title).toBe("الرسائل المحفوظة");
    // pinned on top by default through C3a.1's own column; a person may unpin
    expect(conv.members[0]!.pinnedAt).not.toBeNull();
  });

  it("asking again finds the same conversation (created: false) and never pins it again after the person unpinned it", async () => {
    const w = await getWorld();
    const first = await openSavedMessages(ctxOf(w.orgId, w.a));
    expect(first.created).toBe(false);
    const un = await setMyChatState(ctxOf(w.orgId, w.a), first.id, { pinned: false });
    expect(un.pinned).toBe(false);
    const again = await openSavedMessages(ctxOf(w.orgId, w.a));
    expect(again).toEqual({ id: first.id, created: false });
    expect((await db.conversationMember.findFirstOrThrow({ where: { conversationId: first.id } })).pinnedAt).toBeNull();
    // back to pinned for the rest of the file
    await setMyChatState(ctxOf(w.orgId, w.a), first.id, { pinned: true });
  });

  it("five tabs at once make ONE conversation with ONE member row (the unique (orgId, dmKey) decides, nobody gets an error)", async () => {
    const w = await getWorld();
    const results = await Promise.all(Array.from({ length: 5 }, () => openSavedMessages(ctxOf(w.orgId, w.b))));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await savedOf(w, w.b)).toHaveLength(1);
    expect(await db.conversationMember.count({ where: { conversationId: results[0]!.id } })).toBe(1);
  });

  it("a lost member row is put back (the person is never locked out of their own saved messages)", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.b));
    await db.conversationMember.deleteMany({ where: { conversationId: id } });
    const again = await openSavedMessages(ctxOf(w.orgId, w.b));
    expect(again).toEqual({ id, created: false });
    expect(await db.conversationMember.count({ where: { conversationId: id } })).toBe(1);
  });

  it("a guest has none (403), a suspended person none (404), and two people never share one", async () => {
    const w = await getWorld();
    await expect(openSavedMessages(ctxOf(w.orgId, w.t.guest, "GUEST"))).rejects.toThrow("chat.guest_forbidden");
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.suspended.id } }, data: { status: "SUSPENDED" } });
    await expect(openSavedMessages(ctxOf(w.orgId, w.suspended))).rejects.toThrow("chat.e.not_found");
    expect(await savedOf(w, w.t.guest)).toHaveLength(0);
    const ids = new Set([(await openSavedMessages(ctxOf(w.orgId, w.a))).id, (await openSavedMessages(ctxOf(w.orgId, w.b))).id]);
    expect(ids.size).toBe(2);
  });

  it("the pin machinery's limit is respected: with ten pins already, the saved chat is made but not pinned (nothing is refused)", async () => {
    const w = await getWorld();
    const full = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Full" });
    for (let i = 0; i < PINS_MAX; i++) {
      const c = await db.conversation.create({ data: { orgId: w.orgId, kind: "GROUP", title: `g${i}`, members: { create: [{ userId: full.id, pinnedAt: new Date() }] } } });
      expect(c.id).toBeTruthy();
    }
    const res = await openSavedMessages(ctxOf(w.orgId, full));
    expect(res.created).toBe(true);
    expect((await db.conversationMember.findFirstOrThrow({ where: { conversationId: res.id } })).pinnedAt).toBeNull();
  });

  it("the old DM of two people is untouched by it: the pair key is not the self key", async () => {
    const w = await getWorld();
    const dm = await openDm(ctxOf(w.orgId, w.a), w.b.id, w.space.id);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: dm.id } });
    expect(conv.dmKey).not.toBe(savedKeyOf(w.a.id));
    expect(await db.conversationMember.count({ where: { conversationId: dm.id } })).toBe(2);
    // and opening a DM with oneself through the old door stays refused
    await expect(openDm(ctxOf(w.orgId, w.a), w.a.id, null)).rejects.toThrow("chat.e.not_found");
  });
});

describe("the policy: the self-DM's «other person is active» is the VIEWER being active", () => {
  it("the owner of it reads and writes; the facts say the audience is active", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    const facts = await loadConversationFacts(w.a.id, id);
    expect(facts).toMatchObject({ kind: "DM", viewerIsMember: true, dmOtherActive: true, memberIds: [w.a.id] });
    const org = await loadOrgFacts(w.a.id, w.orgId);
    expect(canRead(facts, org)).toBe(true);
    expect(canPost(facts!, org!)).toBe(true);
    expect(canPin(facts, org)).toBe(true);
    // a DM is nobody's to moderate
    expect(canModerate(facts, org)).toBe(false);
  });

  it("an outsider (a member of the company with no row) cannot read it, post in it or open its header; a refusal says nothing of what it is", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: w.a.id, body: "كلمة-سرية-محفوظة" } });
    const facts = await loadConversationFacts(w.outsider.id, id);
    const org = await loadOrgFacts(w.outsider.id, w.orgId);
    expect(facts?.viewerIsMember).toBe(false);
    expect(canRead(facts, org)).toBe(false);
    expect(canPost(facts!, org!)).toBe(false);
    await loginAs(w.outsider.id);
    const res = await call(headerRoute.GET, { params: { id } });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("كلمة-سرية-محفوظة");
  });

  it("a guest has no saved chat of their own that opens: even a row the data move might have left reads as nobody (the viewer must be a non-guest ACTIVE person)", async () => {
    const w = await getWorld();
    const own = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", dmKey: savedKeyOf(w.t.guest.id), members: { create: [{ userId: w.t.guest.id }] } } });
    const ownFacts = await loadConversationFacts(w.t.guest.id, own.id);
    expect(ownFacts?.dmOtherActive).toBe(false);
    expect(canRead(ownFacts, await loadOrgFacts(w.t.guest.id, w.orgId))).toBe(false);
  });

  it("a suspended person is nobody: their own saved chat does not open for them", async () => {
    const w = await getWorld();
    const gone = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Gone" });
    const { id } = await openSavedMessages(ctxOf(w.orgId, gone));
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: gone.id } }, data: { status: "SUSPENDED" } });
    const facts = await loadConversationFacts(gone.id, id);
    expect(facts?.dmOtherActive).toBe(false);
    expect(canRead(facts, await loadOrgFacts(gone.id, w.orgId))).toBe(false);
  });

  it("the owner (silent oversight) reads it under the same rule as every DM — and may NOT write in it", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    const facts = await loadConversationFacts(w.t.owner.id, id);
    const org = await loadOrgFacts(w.t.owner.id, w.orgId);
    expect(org?.oversight).toBe(true);
    expect(canRead(facts, org)).toBe(true);
    expect(facts?.viewerIsMember).toBe(false);
    expect(canPost(facts!, org!, { ownerJoined: facts!.viewerIsMember })).toBe(false);
    expect(canModerate(facts, org)).toBe(false);
  });

  it("a partner WITHOUT archive.view is an ordinary person here: he does not read it", async () => {
    const w = await getWorld();
    const partner = await makeUser({ orgId: w.orgId, role: "OWNER", name: "PartnerNoEye" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: partner.id } }, data: { primaryOwner: false, revokedCapabilities: ["archive.view"] } });
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    expect(canRead(await loadConversationFacts(partner.id, id), await loadOrgFacts(partner.id, w.orgId))).toBe(false);
  });

  it("an ordinary DM is decided exactly as before (the other person's status still counts)", async () => {
    const w = await getWorld();
    const dm = await openDm(ctxOf(w.orgId, w.a), w.b.id, w.space.id);
    const facts = await loadConversationFacts(w.a.id, dm.id);
    expect(facts?.dmOtherActive).toBe(true);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.b.id } }, data: { status: "SUSPENDED" } });
    expect((await loadConversationFacts(w.a.id, dm.id))?.dmOtherActive).toBe(false);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.b.id } }, data: { status: "ACTIVE" } });
  });
});

describe("the door: POST /api/chat/dm {saved: true}", () => {
  it("opens (201 the first time, 200 after) and answers the id; a body with a person still opens that DM", async () => {
    const w = await getWorld();
    const fresh = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Fresh" });
    await loginAs(fresh.id);
    const first = await call(dmRoute.POST, { body: { saved: true } });
    expect(first.status).toBe(201);
    const second = await call(dmRoute.POST, { body: { saved: true } });
    expect(second.status).toBe(200);
    expect(second.json?.["id"]).toBe(first.json?.["id"]);
    const dm = await call(dmRoute.POST, { body: { userId: w.b.id } });
    expect([200, 201]).toContain(dm.status);
    expect(dm.json?.["id"]).not.toBe(first.json?.["id"]);
  });

  it("a guest gets 403, a body with neither is a 422, and with the switch off the door answers 404 (what is stored stays)", async () => {
    const w = await getWorld();
    await loginAs(w.t.guest.id);
    expect((await call(dmRoute.POST, { body: { saved: true } })).status).toBe(403);
    await loginAs(w.a.id);
    expect((await call(dmRoute.POST, { body: {} })).status).toBe(422);
    expect((await call(dmRoute.POST, { body: { saved: false } })).status).toBe(422);
    await setFeature(w, false);
    try {
      expect((await call(dmRoute.POST, { body: { saved: true } })).status).toBe(404);
      // the ordinary DM door is not affected by the switch
      expect([200, 201]).toContain((await call(dmRoute.POST, { body: { userId: w.b.id } })).status);
    } finally {
      await setFeature(w, null);
    }
    expect((await savedOf(w, w.a)).length).toBe(1);
  });
});

describe("the list: the row, pinned on top, in BOTH shapes (D-N2), with nothing a self-chat cannot have", () => {
  it("«قائمة وحدة»: one row, titled «الرسائل المحفوظة», pinned by me, no space chip, and the person is the peer", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    const rows = (await chatList(ctxOf(w.orgId, w.a))).rows;
    const row = rows.find((r) => r.id === id)!;
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ kind: "DM", title: "الرسائل المحفوظة", pinnedByMe: true, space: null, peerId: w.a.id });
    // pinned on top: nothing that is not pinned stands before it
    expect(rows[0]!.id).toBe(id);
  });

  it("«كل مساحة حساب»: the row is in the list of a space that is not «الشركة» too (it belongs to the person, not to a space)", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    const rows = (await chatList(ctxOf(w.orgId, w.a), { spaceId: w.space.id })).rows;
    expect(rows.some((r) => r.id === id)).toBe(true);
    // and in nobody else's list, the owner's included (he reads it through the oversight list, not through his own)
    for (const other of [w.b, w.outsider, w.t.owner]) {
      expect((await chatList(ctxOf(w.orgId, other, other.id === w.t.owner.id ? "OWNER" : "MEMBER"))).rows.some((r) => r.id === id)).toBe(false);
      expect((await chatList(ctxOf(w.orgId, other, other.id === w.t.owner.id ? "OWNER" : "MEMBER"), { spaceId: w.space.id })).rows.some((r) => r.id === id)).toBe(false);
    }
  });

  it("no read ticks on my own message in it (a row's last message has no status), and an unread count of zero for my own words", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: w.a.id, body: "ملاحظة لنفسي" } });
    const row = (await chatList(ctxOf(w.orgId, w.a))).rows.find((r) => r.id === id)!;
    expect(row.lastMessage).toMatchObject({ preview: "ملاحظة لنفسي", mine: true });
    expect(row.lastMessage?.status).toBeUndefined();
    expect(row.unread).toBe(0);
  });

  it("a person may unpin it: it is an ordinary row then", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    await setMyChatState(ctxOf(w.orgId, w.a), id, { pinned: false });
    const row = (await chatList(ctxOf(w.orgId, w.a))).rows.find((r) => r.id === id)!;
    expect(row.pinnedByMe).toBe(false);
    await setMyChatState(ctxOf(w.orgId, w.a), id, { pinned: true });
  });

  it("the sync feed carries the row for its owner (an event aimed at them) and for nobody else", async () => {
    const w = await getWorld();
    const cursor = (await syncFeed(ctxOf(w.orgId, w.a))).cursor;
    const other = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Syncer" });
    const otherCursor = (await syncFeed(ctxOf(w.orgId, other))).cursor;
    const { id } = await openSavedMessages(ctxOf(w.orgId, other));
    const mine = await syncFeed(ctxOf(w.orgId, other), { after: BigInt(otherCursor) });
    expect(mine.rows.some((r) => r.id === id)).toBe(true);
    const theirs = await syncFeed(ctxOf(w.orgId, w.a), { after: BigInt(cursor) });
    expect(JSON.stringify(theirs)).not.toContain(id);
  });

  it("the switch off: the row is gone from the list (both shapes), nothing is deleted, and it is back with the switch", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    await setFeature(w, false);
    try {
      expect((await chatList(ctxOf(w.orgId, w.a))).rows.some((r) => r.id === id)).toBe(false);
      expect((await chatList(ctxOf(w.orgId, w.a), { spaceId: w.space.id })).rows.some((r) => r.id === id)).toBe(false);
      expect(await db.conversation.count({ where: { id } })).toBe(1);
    } finally {
      await setFeature(w, null);
    }
    expect((await chatList(ctxOf(w.orgId, w.a))).rows.some((r) => r.id === id)).toBe(true);
  });

  it("the answer says the switch is on (`saved`), so the screen may offer «المحفوظة» before the chat exists, and says it is off with the switch off", async () => {
    const w = await getWorld();
    expect((await chatList(ctxOf(w.orgId, w.outsider))).saved).toBe(true);
    expect((await chatList(ctxOf(w.orgId, w.t.guest, "GUEST"))).saved).toBe(false);
    await setFeature(w, false);
    try {
      expect((await chatList(ctxOf(w.orgId, w.outsider))).saved).toBe(false);
    } finally {
      await setFeature(w, null);
    }
  });

  it("the old DM list never shows it (a nameless peer would be drawn)", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    expect((await listDms(ctxOf(w.orgId, w.a))).some((d) => d.id === id)).toBe(false);
    expect((await listDms(ctxOf(w.orgId, w.a), w.space.id)).some((d) => d.id === id)).toBe(false);
  });
});

describe("forwarding to it, and writing in it", () => {
  it("forwarding a message of another conversation to «المحفوظة» works through the existing forward door; the copy says where it came from", async () => {
    const w = await getWorld();
    const dm = await openDm(ctxOf(w.orgId, w.b), w.a.id, w.space.id);
    const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: dm.id, authorId: w.b.id, body: "خلّيها للحفظ" } });
    const saved = await openSavedMessages(ctxOf(w.orgId, w.a));
    await loginAs(w.a.id);
    const res = await call(forwardRoute.POST, { params: { id: msg.id }, body: { conversationId: saved.id } });
    expect(res.status).toBe(201);
    const copy = await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } });
    expect(copy).toMatchObject({ conversationId: saved.id, authorId: w.a.id, body: "خلّيها للحفظ", forwardedFromId: msg.id });
  });

  it("another person cannot forward into somebody's saved chat (no audience, 404 — the target is not named)", async () => {
    const w = await getWorld();
    const dm = await openDm(ctxOf(w.orgId, w.b), w.a.id, w.space.id);
    const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: dm.id, authorId: w.b.id, body: "محاولة" } });
    const saved = await openSavedMessages(ctxOf(w.orgId, w.a));
    await loginAs(w.b.id);
    const res = await call(forwardRoute.POST, { params: { id: msg.id }, body: { conversationId: saved.id } });
    expect([403, 404]).toContain(res.status);
    expect(await db.chatMessage.count({ where: { conversationId: saved.id, authorId: w.b.id } })).toBe(0);
  });

  it("the header of the person's own saved chat opens and names it", async () => {
    const w = await getWorld();
    const { id } = await openSavedMessages(ctxOf(w.orgId, w.a));
    await loginAs(w.a.id);
    const res = await call(headerRoute.GET, { params: { id } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id, kind: "DM", title: "الرسائل المحفوظة" });
    expect(res.json?.["me"]).toMatchObject({ canPost: true });
  });
});
