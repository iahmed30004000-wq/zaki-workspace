/**
 * C1.2 — `GET /api/chat/conversations/[id]/header`: everything of the old detail except the messages and the member list, split out.
 * It must not change who may read what (404 for what is not theirs), says what the person may do here (the same answers as the old detail), and reads
 * the company's settings ONCE for the request.
 */
import { describe, expect, it } from "vitest";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as detailRoute from "@/app/api/chat/conversations/[id]/route";
import { openDm } from "@/server/chat/dm";
import type { ConversationDto, ConversationHeaderDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const counts: string[] = [];
let counting = false;
(db as unknown as { $use: (fn: (p: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(async (params, next) => {
  if (counting) counts.push(`${params.model ?? "raw"}.${params.action}`);
  return next(params);
});

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const spaceAdmin = await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" });
  const space = await makeWorkspace(orgId, [{ userId: spaceAdmin.id, role: "ADMIN" }, { userId: t.member.id }, { userId: b.id }, { userId: t.guest.id }], "Alpha");
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open", emoji: "💬" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: t.member.id }, { userId: spaceAdmin.id }] } } });
  const team = await db.team.create({ data: { workspaceId: space.id, name: "Section", members: { create: [{ userId: b.id }] } } });
  const teamTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "TeamOnly", teamId: team.id } });
  const dm = await openDm({ orgId, userId: t.member.id, orgRole: "MEMBER" }, b.id, space.id);
  const pin = await db.chatMessage.create({ data: { orgId, conversationId: open.id, authorId: b.id, body: "pinned line", pinned: true } });
  const gone = await db.chatMessage.create({ data: { orgId, conversationId: open.id, authorId: b.id, body: "deleted pinned", pinned: true, deletedAt: new Date() } });
  return { t, b, outsider, spaceAdmin, space, open, restricted, teamTopic, dm: dm.id, pin, gone };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const header = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/header`, params: { id } });
  return { status: res.status, dto: res.json as unknown as ConversationHeaderDto };
};
const detail = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(detailRoute.GET, { url: `http://localhost/api/chat/conversations/${id}?limit=5`, params: { id } });
  return { status: res.status, dto: res.json as unknown as ConversationDto };
};

describe("the header: what the screen needs to draw the top of a conversation", () => {
  it("an open topic: title, emoji, kind, space, audience, what I may do, the pinned bar — and no messages, no member list", async () => {
    const w = await getWorld();
    const { status, dto } = await header(w.t.member.id, w.open.id);
    expect(status).toBe(200);
    expect(dto).toMatchObject({ id: w.open.id, kind: "TOPIC", title: "Open", emoji: "💬", closed: false, restricted: false });
    expect(dto.space).toMatchObject({ id: w.space.id, name: "Alpha" });
    // the audience of an open topic is its whole space (member, Bee, the admin, the guest), whatever rows the topic has
    expect(dto.audience).toEqual({ type: "SPACE", count: 4 });
    expect(dto.memberCount).toBe(4);
    expect(dto.me).toMatchObject({ canPost: true, canModerate: false, muted: false, oversight: false });
    // a deleted pinned message is not on the bar, and its words are not in the header
    expect(dto.pinnedMessages).toEqual([{ id: w.pin.id, authorName: "Bee", preview: "pinned line" }]);
    expect(JSON.stringify(dto)).not.toContain("deleted pinned");
    expect(Object.keys(dto)).not.toContain("messages");
    expect(Object.keys(dto)).not.toContain("members");
    expect(Object.keys(dto)).not.toContain("readers");
    expect(dto).toMatchObject({ chatBubbles: true, chatOutbox: true, calls: true, whiteboard: true, voiceNotes: true });
  });

  it("a private chat: the other person is the title, the audience is the pair; a restricted topic counts its people; a «مقطع» its team", async () => {
    const w = await getWorld();
    const dm = (await header(w.t.member.id, w.dm)).dto;
    expect(dm).toMatchObject({ kind: "DM", title: "Bee", audience: { type: "PAIR", count: 2 }, peer: { id: w.b.id, name: "Bee" } });
    expect(typeof dm.oversightNotice).toBe("boolean");
    const restricted = (await header(w.t.member.id, w.restricted.id)).dto;
    expect(restricted.audience).toEqual({ type: "PEOPLE", count: 2 });
    const team = (await header(w.b.id, w.teamTopic.id)).dto;
    expect(team.audience).toEqual({ type: "TEAM", count: 1 });
  });

  it("the moderator of the space is told so; a guest posts nowhere he may not", async () => {
    const w = await getWorld();
    expect((await header(w.spaceAdmin.id, w.open.id)).dto.me.canModerate).toBe(true);
    const guest = await header(w.t.guest.id, w.open.id);
    expect(guest.status).toBe(200);
    expect(guest.dto.me.canMakeWork).toBe(false);
    expect(guest.dto.me.canMentionAll).toBe(false);
  });
});

describe("the header refuses what the old detail refuses", () => {
  it("not readable → 404 (a restricted topic, a team's topic, somebody else's private chat); a guest has topics only; another company's conversation does not exist", async () => {
    const w = await getWorld();
    expect((await header(w.b.id, w.restricted.id)).status).toBe(404);
    expect((await header(w.outsider.id, w.teamTopic.id)).status).toBe(404);
    expect((await header(w.outsider.id, w.dm)).status).toBe(404);
    // a guest asking for a private chat he is not in: «not found», never a hint that it exists
    expect((await header(w.t.guest.id, w.dm)).status).toBe(404);
    const other = await makeTeam();
    expect((await header(other.owner.id, w.open.id)).status).toBe(404);
    expect((await header(w.t.member.id, "no-such-id")).status).toBe(404);
  });

  it("the silent eye reads any topic and says so: oversight, and may join; it never reads a private chat of two others through a joined row", async () => {
    const w = await getWorld();
    const r = await header(w.t.owner.id, w.restricted.id);
    expect(r.status).toBe(200);
    expect(r.dto.me).toMatchObject({ oversight: true, canJoin: true, canPost: false, canModerate: true });
    // the DM is read (the policy says the silent eye reads everything) and nothing in the header says «you may post»
    const dm = await header(w.t.owner.id, w.dm);
    expect(dm.status).toBe(200);
    expect(dm.dto.me).toMatchObject({ oversight: true, canPost: false, canJoin: false, canModerate: false });
  });
});

describe("the header answers like the old detail (the split changed nothing)", () => {
  it("the same «me» for every kind of person on every kind of conversation", async () => {
    const w = await getWorld();
    // the switches that change the answers are on, so the comparison covers them too
    await db.organization.update({
      where: { id: w.t.org.id },
      data: { settings: { features: { quickRecall: true, knowledgeCards: true, orderStatus: true, omsLink: true, mustRead: true, autoTickets: true, orderTemplateHint: true } } },
    });
    await db.integration.upsert({ where: { orgId_type: { orgId: w.t.org.id, type: "OMS" } }, create: { orgId: w.t.org.id, type: "OMS", connected: true }, update: { connected: true } });
    try {
      const people = [w.t.owner, w.t.admin, w.t.member, w.b, w.spaceAdmin, w.t.guest];
      const wrong: string[] = [];
      for (const id of [w.open.id, w.restricted.id, w.teamTopic.id, w.dm]) {
        for (const p of people) {
          const [h, d] = [await header(p.id, id), await detail(p.id, id)];
          // one deliberate difference: a guest asking for a private chat is told «not found» (the old route told him 403, which says the id exists)
          if (h.status === 404 && d.status === 403) continue;
          if (h.status !== d.status) {
            wrong.push(`${p.name} · ${id}: status ${h.status} vs ${d.status}`);
            continue;
          }
          if (h.status !== 200) continue;
          for (const key of ["canPost", "canModerate", "muted", "oversight", "canJoin", "canMakeWork", "canCall", "canMakeTask", "canMakeTicket", "canRemind", "canTranslate", "canMentionAll", "canPoll", "canRecall", "recallKinds", "canOrderState", "canMustRead", "orderHints", "problemKinds"] as const) {
            if (JSON.stringify(h.dto.me[key]) !== JSON.stringify(d.dto.me[key])) wrong.push(`${p.name} · ${id} · me.${key}: ${JSON.stringify(h.dto.me[key])} vs ${JSON.stringify(d.dto.me[key])}`);
          }
          for (const key of ["kind", "title", "emoji", "closed", "pinned", "archived", "restricted", "teamId", "oversightNotice", "chatBubbles", "calls", "whiteboard", "voiceNotes", "imageOcr", "digest", "assistantCall"] as const) {
            if (JSON.stringify(h.dto[key]) !== JSON.stringify(d.dto[key])) wrong.push(`${p.name} · ${id} · ${key}: ${JSON.stringify(h.dto[key])} vs ${JSON.stringify(d.dto[key])}`);
          }
          if (JSON.stringify(h.dto.pinnedMessages) !== JSON.stringify(d.dto.pinnedMessages)) wrong.push(`${p.name} · ${id} · pinnedMessages`);
        }
      }
      expect(wrong).toEqual([]);
    } finally {
      await db.organization.update({ where: { id: w.t.org.id }, data: { settings: {} } });
      await db.integration.deleteMany({ where: { orgId: w.t.org.id } });
    }
  });
});

describe("carried over from Q1: the chips and the «/» menu are offered by the header", () => {
  it("order chips and «/طلب»: staff get them while the three switches and the linked orders system are on; a guest never", async () => {
    const w = await getWorld();
    await db.organization.update({ where: { id: w.t.org.id }, data: { settings: { features: { quickRecall: true, knowledgeCards: true, orderStatus: true, omsLink: true } } } });
    await db.integration.upsert({ where: { orgId_type: { orgId: w.t.org.id, type: "OMS" } }, create: { orgId: w.t.org.id, type: "OMS", connected: true }, update: { connected: true } });
    try {
      const staff = (await header(w.t.member.id, w.open.id)).dto.me;
      expect(staff.canOrderState).toBe(true);
      expect(staff.canRecall).toBe(true);
      expect(staff.recallKinds).toEqual(["product", "reply", "order"]);
      const guest = (await header(w.t.guest.id, w.open.id)).dto.me;
      expect(guest.canOrderState).toBe(false);
      expect(guest.canRecall).toBe(false);
      expect(guest.recallKinds ?? []).toEqual([]);
      // the orders system not connected: no chip, no «/طلب»
      await db.integration.update({ where: { orgId_type: { orgId: w.t.org.id, type: "OMS" } }, data: { connected: false } });
      const off = (await header(w.t.member.id, w.open.id)).dto.me;
      expect(off.canOrderState).toBe(false);
      expect(off.recallKinds).toEqual(["product", "reply"]);
    } finally {
      await db.organization.update({ where: { id: w.t.org.id }, data: { settings: {} } });
      await db.integration.deleteMany({ where: { orgId: w.t.org.id } });
    }
  });

  it("«لازم ينقرأ»: the moderator and a holder of «إعلانات للجميع» may mark; an ordinary member may not; off, nobody", async () => {
    const w = await getWorld();
    await db.organization.update({ where: { id: w.t.org.id }, data: { settings: { features: { mustRead: true } } } });
    try {
      expect((await header(w.spaceAdmin.id, w.open.id)).dto.me.canMustRead).toBe(true);
      expect((await header(w.t.member.id, w.open.id)).dto.me.canMustRead).toBe(false);
      await db.organizationMember.updateMany({ where: { organizationId: w.t.org.id, userId: w.t.member.id }, data: { capabilities: ["announce.send"] } });
      expect((await header(w.t.member.id, w.open.id)).dto.me.canMustRead).toBe(true);
      expect((await header(w.t.guest.id, w.open.id)).dto.me.canMustRead).toBe(false);
      await db.organization.update({ where: { id: w.t.org.id }, data: { settings: {} } });
      expect((await header(w.spaceAdmin.id, w.open.id)).dto.me.canMustRead).toBe(false);
    } finally {
      await db.organizationMember.updateMany({ where: { organizationId: w.t.org.id, userId: w.t.member.id }, data: { capabilities: [] } });
      await db.organization.update({ where: { id: w.t.org.id }, data: { settings: {} } });
    }
  });
});

describe("the company's settings are read ONCE for the request (F1.1 finding: `cache()` has no scope in a route handler)", () => {
  it("the old detail reads them again and again; the header reads them once", async () => {
    const w = await getWorld();
    const tally = async (fn: () => Promise<unknown>) => {
      counts.length = 0;
      counting = true;
      try {
        await fn();
      } finally {
        counting = false;
      }
      return counts.filter((c) => c === "Organization.findUnique").length;
    };
    await loginAs(w.t.member.id);
    const old = await tally(() => call(detailRoute.GET, { url: `http://localhost/api/chat/conversations/${w.open.id}?limit=5`, params: { id: w.open.id } }));
    const fresh = await tally(() => call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${w.open.id}/header`, params: { id: w.open.id } }));
    console.info(`Organization.findUnique per request: old detail ${old}, header ${fresh}`);
    expect(old).toBeGreaterThan(3);
    expect(fresh).toBe(1);
  });
});
