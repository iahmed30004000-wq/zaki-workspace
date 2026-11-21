/**
 * S5.5 — «إشارة التوثيق» on the real doors.
 *
 *  - ONLY the OWNER rank grants or takes the badge (an admin who holds `users.manage`, a lead, a member: 403, nothing changes); it needs the company's switch `verifiedBadge` (off: 404);
 *  - a guest is never verified; a person who is not ACTIVE is not given a first badge (taking one back works); the other company's owner reaches nothing;
 *  - every real change is an audit line (who, whom, in which company); repeating what is already true writes none;
 *  - the chat carries `verified` as a yes only: the list's private rows, the header's peer, the members and the «@» list, the author of a message; never the time and never who granted it;
 *  - a GUEST is sent nothing of it (the badge is not a way to read ranks), and the switch off sends it to nobody while the grants stay stored and come back.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as verifyRoute from "@/app/api/organizations/[id]/members/[userId]/verify/route";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import * as listRoute from "@/app/api/chat/list/route";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as detailRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { openDm } from "@/server/chat/dm";
import { resetPresenceForTests } from "@/server/realtime/presence";
import type { ChatListDto, ConversationDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { call, db, loginAs, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  resetPresenceForTests();
  const t = await makeTeam();
  const orgId = t.org.id;
  const star = await makeUser({ orgId, role: "MEMBER", name: "Star" });
  const plain = await makeUser({ orgId, role: "MEMBER", name: "Plain" });
  const lead = await makeUser({ orgId, role: "LEAD", name: "Lead" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: star.id }, { userId: plain.id }, { userId: t.guest.id, role: "GUEST" }, { userId: t.admin.id, role: "ADMIN" }], "Space");
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const dmStar = await openDm({ orgId, userId: t.member.id, orgRole: "MEMBER" }, star.id, space.id);
  const dmPlain = await openDm({ orgId, userId: t.member.id, orgRole: "MEMBER" }, plain.id, space.id);
  return { ...t, orgId, star, plain, lead, space, open, dmStar: dmStar.id, dmPlain: dmPlain.id };
}
type World = Awaited<ReturnType<typeof world>>;
let w: World;
beforeAll(async () => {
  w = await world();
});

const verifyUrl = (orgId: string, userId: string) => `http://localhost/api/organizations/${orgId}/members/${userId}/verify`;
const setVerified = async (as: string, userId: string, verified: boolean, orgId = w.orgId) => {
  await loginAs(as);
  return call(verifyRoute.POST, { url: verifyUrl(orgId, userId), body: { verified }, params: { id: orgId, userId } });
};
const stateOf = async (as: string, userId: string, orgId = w.orgId) => {
  await loginAs(as);
  return call(verifyRoute.GET, { url: verifyUrl(orgId, userId), params: { id: orgId, userId } });
};
const stored = async (userId: string, orgId = w.orgId) => (await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { verifiedAt: true } }))!.verifiedAt;
const setSwitch = (on: boolean, orgId = w.orgId) => db.organization.update({ where: { id: orgId }, data: { settings: { features: { verifiedBadge: on } } } });
const audits = (action: string, target: string) => db.auditLog.findMany({ where: { orgId: w.orgId, action, target }, orderBy: { createdAt: "asc" } });

let tick = 0;
async function written(conversationId: string, authorId: string, body: string) {
  tick += 1;
  return db.chatMessage.create({ data: { orgId: w.orgId, conversationId, authorId, body, createdAt: new Date(Date.now() - 3_600_000 + tick * 1000) } });
}
const readMessages = async (userId: string, conversationId: string): Promise<MessageDto[]> => {
  await loginAs(userId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}/messages`, params: { id: conversationId } });
  expect(res.status).toBe(200);
  return res.json?.["messages"] as MessageDto[];
};
const readList = async (userId: string): Promise<ChatListDto> => {
  await loginAs(userId);
  const res = await call(listRoute.GET, { url: "http://localhost/api/chat/list" });
  expect(res.status).toBe(200);
  return res.json as unknown as ChatListDto;
};
const readHeader = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/header`, params: { id } });
  return { status: res.status, dto: res.json as unknown as ConversationHeaderDto, text: res.text };
};
const readDetail = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(detailRoute.GET, { url: `http://localhost/api/chat/conversations/${id}?limit=5`, params: { id } });
  return { status: res.status, dto: res.json as unknown as ConversationDto, text: res.text };
};

describe("who may grant and take away the badge", () => {
  it("the OWNER grants it: the answer is a yes, the column is set, and the audit says who, whom, which company", async () => {
    const res = await setVerified(w.owner.id, w.star.id, true);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, verified: true });
    expect(await stored(w.star.id)).toBeInstanceOf(Date);
    const lines = await audits("org.member_verified", w.star.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actorId: w.owner.id, orgId: w.orgId, target: w.star.id });
  });

  it("repeating a grant changes nothing and writes no second audit line", async () => {
    const before = await stored(w.star.id);
    const res = await setVerified(w.owner.id, w.star.id, true);
    expect(res.status).toBe(200);
    expect(await stored(w.star.id)).toEqual(before);
    expect(await audits("org.member_verified", w.star.id)).toHaveLength(1);
  });

  it("an ADMIN who holds users.manage, a lead and a member are refused — the rank decides, not a capability — and nothing is written", async () => {
    for (const who of [w.admin, w.lead, w.member]) {
      const res = await setVerified(who.id, w.plain.id, true);
      expect(res.status, who.name).toBe(403);
      expect(res.text).toContain("verified.e.owner_only");
    }
    // even an admin the owner gave EVERY capability to
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.admin.id }, data: { capabilities: ["users.manage", "archive.view", "directory.view"] } });
    expect((await setVerified(w.admin.id, w.plain.id, true)).status).toBe(403);
    expect(await stored(w.plain.id)).toBeNull();
    expect(await audits("org.member_verified", w.plain.id)).toHaveLength(0);
    // and he may not take one away either, nor read the state
    expect((await setVerified(w.admin.id, w.star.id, false)).status).toBe(403);
    expect(await stored(w.star.id)).not.toBeNull();
    expect((await stateOf(w.admin.id, w.star.id)).status).toBe(403);
  });

  it("the owner reads the state, and takes the badge back: the column is empty again and the audit has a second line", async () => {
    expect((await stateOf(w.owner.id, w.star.id)).json).toEqual({ verified: true });
    const res = await setVerified(w.owner.id, w.star.id, false);
    expect(res.json).toEqual({ ok: true, verified: false });
    expect(await stored(w.star.id)).toBeNull();
    expect((await stateOf(w.owner.id, w.star.id)).json).toEqual({ verified: false });
    const lines = await audits("org.member_unverified", w.star.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actorId: w.owner.id, orgId: w.orgId });
    // taking back what is not there changes nothing
    expect((await setVerified(w.owner.id, w.star.id, false)).status).toBe(200);
    expect(await audits("org.member_unverified", w.star.id)).toHaveLength(1);
    // grant again for the rest of the file
    expect((await setVerified(w.owner.id, w.star.id, true)).status).toBe(200);
  });

  it("a guest is never verified; a suspended person is not given a first badge but may lose one", async () => {
    const guest = await setVerified(w.owner.id, w.guest.id, true);
    expect(guest.status).toBe(422);
    expect(await stored(w.guest.id)).toBeNull();
    const gone = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Gone" });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: gone.id }, data: { status: "SUSPENDED" } });
    expect((await setVerified(w.owner.id, gone.id, true)).status).toBe(422);
    expect(await stored(gone.id)).toBeNull();
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: gone.id }, data: { verifiedAt: new Date() } });
    expect((await setVerified(w.owner.id, gone.id, false)).status).toBe(200);
    expect(await stored(gone.id)).toBeNull();
  });

  it("another company's owner reaches nothing here, and a person who is not in the company is not found", async () => {
    const other = await makeOrg();
    const otherOwner = await makeUser({ orgId: other.id, role: "OWNER", name: "OtherOwner" });
    expect((await setVerified(otherOwner.id, w.plain.id, true, w.orgId)).status).toBe(403);
    // his own company's route with a person of ours: «not found»
    expect((await setVerified(otherOwner.id, w.plain.id, true, other.id)).status).toBe(404);
    expect(await stored(w.plain.id)).toBeNull();
  });

  it("the switch off: the door answers «not found» and nothing is written; the grant already made stays stored", async () => {
    await setSwitch(false);
    try {
      expect((await setVerified(w.owner.id, w.plain.id, true)).status).toBe(404);
      expect((await stateOf(w.owner.id, w.star.id)).status).toBe(404);
      expect(await stored(w.plain.id)).toBeNull();
      expect(await stored(w.star.id)).not.toBeNull();
    } finally {
      await setSwitch(true);
    }
    expect((await stateOf(w.owner.id, w.star.id)).json).toEqual({ verified: true });
  });
});

describe("the people list", () => {
  it("carries `verified` as a yes for the verified (never the time), nothing for the others, and drops it while the switch is off", async () => {
    await loginAs(w.owner.id);
    const on = await call(membersRoute.GET, { url: `http://localhost/api/organizations/${w.orgId}/members`, params: { id: w.orgId } });
    const rows = on.json?.["members"] as { id: string; verified?: boolean }[];
    expect(rows.find((r) => r.id === w.star.id)?.verified).toBe(true);
    expect(rows.find((r) => r.id === w.plain.id)?.verified).toBeUndefined();
    expect(on.text).not.toContain("verifiedAt");
    await setSwitch(false);
    try {
      await loginAs(w.owner.id);
      const off = await call(membersRoute.GET, { url: `http://localhost/api/organizations/${w.orgId}/members`, params: { id: w.orgId } });
      for (const r of off.json?.["members"] as { verified?: boolean }[]) expect(r.verified).toBeUndefined();
    } finally {
      await setSwitch(true);
    }
  });
});

describe("what the chat carries", () => {
  it("the author of a message: a yes for staff, never for a guest, and nothing about the time or the granter", async () => {
    const mine = await written(w.open.id, w.star.id, "من النجم");
    const other = await written(w.open.id, w.plain.id, "من العادي");
    for (const viewer of [w.member, w.owner, w.admin]) {
      const msgs = await readMessages(viewer.id, w.open.id);
      expect(msgs.find((m) => m.id === mine.id)?.authorVerified, viewer.name).toBe(true);
      expect(msgs.find((m) => m.id === other.id)?.authorVerified, viewer.name).toBeUndefined();
    }
    // the guest reads the very same messages and is told nothing
    await loginAs(w.guest.id);
    const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.open.id}/messages`, params: { id: w.open.id } });
    expect(res.status).toBe(200);
    expect(res.text).toContain("من النجم");
    expect(res.text).not.toContain("authorVerified");
    expect(res.text).not.toContain("verified");
    // nothing of the grant's time or its granter in what staff reads either
    await loginAs(w.member.id);
    const staff = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.open.id}/messages`, params: { id: w.open.id } });
    expect(staff.text).not.toContain("verifiedAt");
  });

  it("a private chat: the list row and the header's peer say `verified` for the verified person only; a guest's list and header say nothing", async () => {
    const list = await readList(w.member.id);
    const star = list.rows.find((r) => r.id === w.dmStar)!;
    const plain = list.rows.find((r) => r.id === w.dmPlain)!;
    expect(star.verified).toBe(true);
    expect(plain.verified).toBeUndefined();
    // a topic's row never carries it
    expect(list.rows.find((r) => r.id === w.space.id)?.verified).toBeUndefined();
    const hStar = await readHeader(w.member.id, w.dmStar);
    expect(hStar.dto.peer).toMatchObject({ id: w.star.id, verified: true });
    const hPlain = await readHeader(w.member.id, w.dmPlain);
    expect(hPlain.dto.peer?.verified).toBeUndefined();
    // the guest has no private chats at all: his list has no row with the mark and no `verified` anywhere
    await loginAs(w.guest.id);
    const guestList = await call(listRoute.GET, { url: "http://localhost/api/chat/list" });
    expect(guestList.text).not.toContain("verified");
  });

  it("the conversation's members and the «@» list carry it for staff; a guest's lists carry nothing", async () => {
    const asMember = await readDetail(w.member.id, w.open.id);
    expect(asMember.dto.mentionables?.find((m) => m.id === w.star.id)?.verified).toBe(true);
    expect(asMember.dto.mentionables?.find((m) => m.id === w.plain.id)?.verified).toBeUndefined();
    const asGuest = await readDetail(w.guest.id, w.open.id);
    expect(asGuest.status).toBe(200);
    expect(asGuest.text).not.toContain("verified");
  });

  it("the switch off: no `verified` anywhere in the chat; the grants stay stored and every mark comes back with the switch", async () => {
    await setSwitch(false);
    try {
      const msgs = await readMessages(w.member.id, w.open.id);
      expect(msgs.every((m) => m.authorVerified === undefined)).toBe(true);
      const list = await readList(w.member.id);
      expect(list.rows.every((r) => r.verified === undefined)).toBe(true);
      expect((await readHeader(w.member.id, w.dmStar)).dto.peer?.verified).toBeUndefined();
      const detail = await readDetail(w.member.id, w.open.id);
      expect(detail.text).not.toContain("verified");
      expect(await stored(w.star.id)).not.toBeNull();
    } finally {
      await setSwitch(true);
    }
    const back = await readMessages(w.member.id, w.open.id);
    expect(back.some((m) => m.authorVerified === true)).toBe(true);
    expect((await readList(w.member.id)).rows.find((r) => r.id === w.dmStar)?.verified).toBe(true);
  });

  it("a person who is no longer ACTIVE has no mark on their old messages or in the lists; the stored grant is kept and comes back with them", async () => {
    const quiet = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Quiet" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: quiet.id } });
    expect((await setVerified(w.owner.id, quiet.id, true)).status).toBe(200);
    const m = await written(w.open.id, quiet.id, "رسالة قديمة");
    expect((await readMessages(w.member.id, w.open.id)).find((x) => x.id === m.id)?.authorVerified).toBe(true);
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: quiet.id }, data: { status: "SUSPENDED" } });
    expect((await readMessages(w.member.id, w.open.id)).find((x) => x.id === m.id)?.authorVerified).toBeUndefined();
    expect(await stored(quiet.id)).not.toBeNull();
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: quiet.id }, data: { status: "ACTIVE" } });
    expect((await readMessages(w.member.id, w.open.id)).find((x) => x.id === m.id)?.authorVerified).toBe(true);
  });

  it("taking the badge back removes it from every surface at once", async () => {
    expect((await setVerified(w.owner.id, w.star.id, false)).status).toBe(200);
    try {
      expect((await readMessages(w.member.id, w.open.id)).filter((m) => m.authorId === w.star.id).every((m) => m.authorVerified === undefined)).toBe(true);
      expect((await readList(w.member.id)).rows.find((r) => r.id === w.dmStar)?.verified).toBeUndefined();
    } finally {
      await setVerified(w.owner.id, w.star.id, true);
    }
  });
});
