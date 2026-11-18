/**
 * C1.8 — read marks are DELTAS. The reader's mark is one small event; the other clients get it in the `reads` list of the sync
 * answer (no refetch of the messages); a mark that changes nothing writes and emits nothing; and the owner's silent reading leaves NO
 * read mark, event or notification (P0.1).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as deliveredRoute from "@/app/api/chat/conversations/[id]/delivered/route";
import { syncFeed } from "@/server/chat/sync";
import { resetHubForTests } from "@/server/realtime/hub";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
});

const send = async (conversationId: string, body: string) => (await call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body: { body } })).json?.["id"] as string;
const read = (conversationId: string, upTo?: string) =>
  call(readRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${conversationId}/read${upTo ? `?upTo=${upTo}` : ""}`, params: { id: conversationId } });
const delivered = (conversationId: string) => call(deliveredRoute.POST, { method: "POST", params: { id: conversationId } });
const events = async (kind: string, conversationId: string) =>
  (await db.realtimeEvent.findMany({ where: { kind }, orderBy: { id: "asc" } })).map((e) => e.ids as Record<string, string>).filter((ids) => ids["conversationId"] === conversationId);

async function dmWorld() {
  const t = await makeTeam();
  const a = t.member;
  const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
  await makeWorkspace(t.org.id, [{ userId: a.id }, { userId: b.id }]);
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  return { t, a, b, dm };
}
const ctxOf = (t: Awaited<ReturnType<typeof makeTeam>>, userId: string, orgRole: "MEMBER" | "OWNER" = "MEMBER") => ({ orgId: t.org.id, userId, orgRole });

describe("C1.8: a read mark reaches the other client as a delta", () => {
  it("the sender's next sync carries the reader's mark in `reads` and no message at all", async () => {
    const w = await dmWorld();
    const m1 = await send(w.dm, "واحد");
    const cursor = (await syncFeed(ctxOf(w.t, w.a.id))).cursor;
    await loginAs(w.b.id);
    expect((await read(w.dm, m1)).status).toBe(200);
    const feed = await syncFeed(ctxOf(w.t, w.a.id), { after: BigInt(cursor) });
    expect(feed.messages).toEqual([]);
    expect(feed.reads).toHaveLength(1);
    expect(feed.reads[0]).toMatchObject({ conversationId: w.dm, userId: w.b.id });
    const mark = await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: w.dm, userId: w.b.id } } });
    expect(feed.reads[0]!.lastReadAt).toBe(mark.lastReadAt.toISOString());
  });

  it("a mark that changes nothing writes nothing and emits nothing (the same message again, or an older one)", async () => {
    const w = await dmWorld();
    const m1 = await send(w.dm, "واحد");
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await send(w.dm, "اتنين");
    await loginAs(w.b.id);
    expect((await read(w.dm, m2)).status).toBe(200);
    const count = async () => (await events("conversation.read", w.dm)).length;
    expect(await count()).toBe(1);
    expect((await read(w.dm, m2)).status).toBe(200); // the same message again
    expect((await read(w.dm, m1)).status).toBe(200); // an older one: never backwards
    expect(await count()).toBe(1);
  });

  it("a delivered mark that has nothing new to say writes nothing and emits nothing", async () => {
    const w = await dmWorld();
    await send(w.dm, "واحد");
    await loginAs(w.b.id);
    expect((await delivered(w.dm)).status).toBeLessThan(300);
    expect((await events("conversation.delivered", w.dm)).length).toBe(1);
    expect((await delivered(w.dm)).status).toBeLessThan(300);
    expect((await delivered(w.dm)).status).toBeLessThan(300);
    expect((await events("conversation.delivered", w.dm)).length).toBe(1);
    // a NEW message from the other person is something to mark again
    await loginAs(w.a.id);
    await new Promise((r) => setTimeout(r, 5));
    await send(w.dm, "اتنين");
    await loginAs(w.b.id);
    expect((await delivered(w.dm)).status).toBeLessThan(300);
    expect((await events("conversation.delivered", w.dm)).length).toBe(2);
  });

  it("the author's own message never counts as «something new» for the author's delivered mark", async () => {
    const w = await dmWorld();
    await send(w.dm, "كتبتها أنا");
    expect((await delivered(w.dm)).status).toBeLessThan(300);
    expect((await events("conversation.delivered", w.dm)).length).toBe(0);
  });
});

describe("C1.8: the owner's silent oversight leaves no read mark, no event and no notification (P0.1)", () => {
  it("reading somebody else's private chat as the owner writes nothing anywhere, and the sender's sync never shows him", async () => {
    const w = await dmWorld();
    const id = await send(w.dm, "سر بين اتنين");
    const cursor = (await syncFeed(ctxOf(w.t, w.a.id))).cursor;
    const eventsBefore = await db.realtimeEvent.count();
    const bellsBefore = await db.notification.count();
    await loginAs(w.t.owner.id);
    expect((await read(w.dm, id)).status).toBe(200);
    expect((await read(w.dm)).status).toBe(200); // «now», without an anchor
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: w.dm, userId: w.t.owner.id } } })).toBeNull();
    expect(await db.realtimeEvent.count()).toBe(eventsBefore);
    expect(await db.notification.count()).toBe(bellsBefore);
    const feed = await syncFeed(ctxOf(w.t, w.a.id), { after: BigInt(cursor) });
    expect(feed.reads).toEqual([]);
    expect(JSON.stringify(feed)).not.toContain(w.t.owner.id);
  });

  it("a delivered mark from the owner in somebody else's DM is refused: he is not one of its people", async () => {
    const w = await dmWorld();
    await send(w.dm, "سر");
    await loginAs(w.t.owner.id);
    expect((await delivered(w.dm)).status).toBe(404);
    expect(await events("conversation.delivered", w.dm)).toEqual([]);
  });

  it("in an open topic he reads with no row, no event, no bell", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    await loginAs(t.member.id);
    const id = await send(topic.id, "للجميع");
    const eventsBefore = await db.realtimeEvent.count({ where: { kind: "conversation.read" } });
    const bellsBefore = await db.notification.count();
    await loginAs(t.owner.id);
    expect((await read(topic.id, id)).status).toBe(200);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: topic.id, userId: t.owner.id } } })).toBeNull();
    expect(await db.realtimeEvent.count({ where: { kind: "conversation.read" } })).toBe(eventsBefore);
    expect(await db.notification.count()).toBe(bellsBefore);
  });
});
