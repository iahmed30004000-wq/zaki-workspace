/**
 * P0.1 — silent oversight is the capability `archive.view`, never the rank (docs/restructure/P0-privacy.md).
 *
 * Before this step a partner (an OWNER who is not the primary owner) whose `archive.view` was taken away still read
 * every private topic and every DM: the chat decided by `role === "OWNER"`. Now the rank alone reads nothing private.
 * A partner WITHOUT the capability is a normal participant: he reads and writes the OPEN topics of every space like a
 * space manager, but a restricted topic he is not in and other people's DMs do not exist for him (404).
 */
import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { chatHome } from "@/server/chat/home";
import { searchChat } from "@/server/chat/search";
import { unreadTotal } from "@/server/chat/unread";
import { canPostInConversation, canReadConversation } from "@/server/policy/conversation";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const patch = (orgId: string, userId: string, body: Record<string, unknown>) =>
  call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId }, body });
const open = (id: string) => call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } });
const WORD = "كلمةسرية";

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const partner = team.admin; // made a partner below
  const a = team.member;
  const b = await makeUser({ orgId, role: "MEMBER", name: "B" });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }]);
  const restricted = await db.conversation.create({
    data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Private plans", restricted: true, members: { create: [{ userId: a.id }] } },
  });
  const openTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open topic" } });
  await db.chatMessage.create({ data: { orgId, conversationId: restricted.id, authorId: a.id, body: `${WORD} في الموضوع الخاص` } });
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  await call(messagesRoute.POST, { params: { id: dm }, body: { body: `${WORD} بين اثنين` } });
  await loginAs(team.owner.id);
  expect((await patch(orgId, partner.id, { role: "OWNER" })).status).toBe(200);
  return { ...team, orgId, partner, a, b, space, restricted, openTopic, dm };
}

const ctxOf = (orgId: string, userId: string) => ({ orgId, userId, orgRole: "OWNER" as const });

describe("a partner who holds archive.view reads private things silently (today's behaviour stays)", () => {
  it("reads the restricted topic and the DM, and the primary owner too", async () => {
    const w = await world();
    for (const id of [w.restricted.id, w.dm]) {
      expect(await canReadConversation(w.partner.id, id)).toBe(true);
      await loginAs(w.partner.id);
      expect((await open(id)).status).toBe(200);
      expect(await canReadConversation(w.owner.id, id)).toBe(true);
    }
  });
});

describe("after the primary owner takes archive.view away, the partner is an ordinary participant", () => {
  async function revoked() {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await patch(w.orgId, w.partner.id, { revokedCapabilities: ["archive.view"] })).status).toBe(200);
    return w;
  }

  it("a restricted topic he is not in and other people's DM answer 404 and are unreadable", async () => {
    const w = await revoked();
    await loginAs(w.partner.id);
    for (const id of [w.restricted.id, w.dm]) {
      expect(await canReadConversation(w.partner.id, id)).toBe(false);
      expect((await open(id)).status).toBe(404);
      expect(await canPostInConversation(w.partner.id, id)).toBe(false);
    }
    const post = await call(messagesRoute.POST, { params: { id: w.restricted.id }, body: { body: "اقتحام" } });
    // refused (the route says 403 for every person who may not write there, as it did before this step)
    expect(post.status).toBe(403);
    expect(await db.chatMessage.count({ where: { conversationId: w.restricted.id, body: "اقتحام" } })).toBe(0);
  });

  it("the chat home lists neither of them, and the search finds nothing in them", async () => {
    const w = await revoked();
    const home = await chatHome(ctxOf(w.orgId, w.partner.id), { spaceId: w.space.id });
    const text = JSON.stringify(home);
    expect(text).not.toContain(w.restricted.id);
    expect(text).not.toContain(w.dm);
    expect(home.canOversee).toBe(false);
    const found = await searchChat(ctxOf(w.orgId, w.partner.id), { id: w.space.id, isHq: false }, WORD);
    expect(found.messages).toEqual([]);
    expect(await unreadTotal(ctxOf(w.orgId, w.partner.id))).toBe(0);
  });

  it("he still reads and writes the OPEN topics of the space, like a space manager, and leaves a normal read row", async () => {
    const w = await revoked();
    await loginAs(w.partner.id);
    expect(await canReadConversation(w.partner.id, w.openTopic.id)).toBe(true);
    expect((await open(w.openTopic.id)).status).toBe(200);
    expect(await canPostInConversation(w.partner.id, w.openTopic.id)).toBe(true);
  });

  it("the primary owner is unchanged everywhere", async () => {
    const w = await revoked();
    await loginAs(w.owner.id);
    for (const id of [w.restricted.id, w.dm, w.openTopic.id]) {
      expect(await canReadConversation(w.owner.id, id)).toBe(true);
      expect((await open(id)).status).toBe(200);
    }
    const home = await chatHome(ctxOf(w.orgId, w.owner.id), { spaceId: w.space.id });
    expect(home.canOversee).toBe(true);
    const found = await searchChat(ctxOf(w.orgId, w.owner.id), { id: w.space.id, isHq: false }, WORD);
    expect(found.messages.length).toBeGreaterThan(0);
  });
});
