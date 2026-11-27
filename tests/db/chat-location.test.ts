/**
 * «إرسال الموقع» — the server's rules against a real database.
 *
 *  - it is an ordinary send: only where the person may write, with the same idempotent client id; a CARD message whose words carry no number
 *  - only people who may read the message receive the place; a deleted message gives it to nobody; no bell or push text holds it
 *  - the switch `chatLocation` closes the door and the header stops offering it
 */
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as locationRoute from "@/app/api/chat/conversations/[id]/location/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import { openDm } from "@/server/chat/dm";
import { resetPresenceForTests } from "@/server/realtime/presence";
import type { ConversationDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { withFeature, type FeatureKey } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const PLACE = { lat: 31.95394912, lng: 35.91063488, accuracy: 24.2 };

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  // nobody has a live stream: everybody counts as offline, so the bells are written
  resetPresenceForTests();
  const t = await makeTeam();
  await setSwitch(t.org.id, "chatLayoutV2", true);
  const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.guest.id, role: "GUEST" }]);
  const peer = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Peer" });
  await db.workspaceMember.create({ data: { workspaceId: space.id, userId: peer.id, role: "MEMBER" } });
  const stranger = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Stranger" });
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, title: "General" } });
  return { ...t, space, peer, stranger, topic };
}

const send = (id: string, body: Record<string, unknown>) => call(locationRoute.POST, { params: { id }, body });
const seen = async (conversationId: string, messageId: string) =>
  ((await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}`, params: { id: conversationId } })).json as unknown as ConversationDto).messages.find((m) => m.id === messageId);

describe("sending a place", () => {
  it("a CARD message: the rounded place in the card, two words and no number in the body", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await send(w.topic.id, { ...PLACE, clientId: "loc-1" });
    expect(res.status, res.text).toBe(201);
    const dto = res.json as unknown as MessageDto;
    expect(dto.kind).toBe("CARD");
    expect(dto.body).toBe("📍 موقع");
    expect(dto.card).toEqual({ type: "location", lat: 31.953949, lng: 35.910635, accuracy: 25 });
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: dto.id } });
    expect(row.body).not.toMatch(/\d/);
    expect(row.card).toEqual({ type: "location", lat: 31.953949, lng: 35.910635, accuracy: 25 });
    // a retry after a lost answer is the same message
    const again = await send(w.topic.id, { ...PLACE, clientId: "loc-1" });
    expect((again.json as { id: string }).id).toBe(dto.id);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "CARD" } })).toBe(1);
    await loginAs(w.peer.id);
    expect((await seen(w.topic.id, dto.id))?.card).toEqual(dto.card);
  });

  it("no bell or push line anywhere holds the coordinates", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const dm = await openDm({ orgId: w.org.id, orgRole: "MEMBER", userId: w.member.id }, w.peer.id, w.space.id);
    expect((await send(dm.id, PLACE)).status).toBe(201);
    const bells = await db.notification.findMany({ where: { userId: w.peer.id } });
    expect(bells.length).toBeGreaterThan(0);
    expect(JSON.stringify(bells)).not.toContain("31.95");
    expect(JSON.stringify(bells)).not.toContain("35.91");
    const events = await db.realtimeEvent.findMany({ where: { orgId: w.org.id } });
    expect(JSON.stringify(events.map((e) => e.ids))).not.toContain("31.95");
  });

  it("only where the person may write: an outsider, a closed topic and a muted person send nothing", async () => {
    const w = await world();
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Closed", closedAt: new Date() } });
    await loginAs(w.stranger.id);
    expect((await send(w.topic.id, PLACE)).status).toBeGreaterThanOrEqual(400);
    await loginAs(w.member.id);
    expect((await send(closed.id, PLACE)).status).toBe(403);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.member.id } }, data: { mutedUntil: new Date(Date.now() + 3600_000) } });
    expect((await send(w.topic.id, PLACE)).status).toBe(403);
    expect(await db.chatMessage.count({ where: { orgId: w.org.id, kind: "CARD" } })).toBe(0);
  });

  it("numbers out of range, missing or extra are refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    for (const bad of [{ ...PLACE, lat: 90.5 }, { ...PLACE, lng: -181 }, { ...PLACE, accuracy: -1 }, { lat: 1, lng: 1 }, { ...PLACE, card: { type: "product" } }, { ...PLACE, body: "x" }]) {
      expect((await send(w.topic.id, bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(0);
  });

  it("a deleted message gives the place to nobody, the owner included", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const id = ((await send(w.topic.id, PLACE)).json as { id: string }).id;
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id } })).status).toBeLessThan(300);
    for (const who of [w.member.id, w.peer.id, w.owner.id]) {
      await loginAs(who);
      const dto = await seen(w.topic.id, id);
      expect(dto?.card).toBeUndefined();
      expect(JSON.stringify(dto)).not.toContain("31.95");
    }
  });

  it("«حوّل» keeps the card, for the people of the target", async () => {
    const w = await world();
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Other" } });
    await loginAs(w.member.id);
    const id = ((await send(w.topic.id, PLACE)).json as { id: string }).id;
    const copy = await call(forwardRoute.POST, { params: { id }, body: { conversationId: other.id } });
    expect(copy.status, copy.text).toBeLessThan(300);
    expect((await seen(other.id, (copy.json as { id: string }).id))?.card).toMatchObject({ type: "location", lat: 31.953949 });
  });
});

describe("the switch «إرسال الموقع»", () => {
  const header = async (id: string) => (await call(headerRoute.GET, { params: { id } })).json as unknown as ConversationHeaderDto;

  it("the header offers it to a person who may write, and the switch off closes both the offer and the door; sent cards stay", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await header(w.topic.id)).me.canLocation).toBe(true);
    const id = ((await send(w.topic.id, PLACE)).json as { id: string }).id;
    await setSwitch(w.org.id, "chatLocation", false);
    expect((await header(w.topic.id)).me.canLocation).toBe(false);
    expect((await send(w.topic.id, PLACE)).status).toBe(404);
    expect((await seen(w.topic.id, id))?.card).toMatchObject({ type: "location" });
  });

  it("with the new chat screen off the door is «not found»", async () => {
    const w = await world();
    await setSwitch(w.org.id, "chatLayoutV2", false);
    await loginAs(w.member.id);
    expect((await send(w.topic.id, PLACE)).status).toBe(404);
  });

  it("a closed topic offers nothing", async () => {
    const w = await world();
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Closed", closedAt: new Date() } });
    await loginAs(w.member.id);
    expect((await header(closed.id)).me.canLocation).toBe(false);
  });
});
