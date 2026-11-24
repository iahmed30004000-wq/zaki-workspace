import { describe, expect, it } from "vitest";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as pinRoute from "@/app/api/chat/messages/[id]/pin/route";
import * as pinsRoute from "@/app/api/chat/conversations/[id]/pins/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { call, db, loginAs, logout, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «إلغاء تثبيت الكل» (the list «كل المثبّتات» of the pinned bar): DELETE /api/chat/conversations/{id}/pins unpins every pinned message of one conversation in one step, for
 * whoever may pin there (a space admin in a topic, a participant in a private chat). ONE line says so for everybody; nobody else is touched.
 */
async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  const other = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "Other" } });
  return { ...t, ws, topic, other };
}
const say = async (conversationId: string, body: string) => (await call(conversationMessagesRoute.POST, { params: { id: conversationId }, body: { body } })).json?.["id"] as string;
const unpinAll = (id: string) => call(pinsRoute.DELETE, { method: "DELETE", params: { id }, url: `http://localhost/api/chat/conversations/${id}/pins` });
const pinnedCount = (conversationId: string) => db.chatMessage.count({ where: { conversationId, pinned: true } });

describe("DELETE /api/chat/conversations/{id}/pins", () => {
  it("a space admin unpins all the pins of the topic at once, with one line for everybody, and the header carries none", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await say(w.topic.id, "first");
    const b = await say(w.topic.id, "second");
    const c = await say(w.topic.id, "third");
    await loginAs(w.admin.id);
    for (const id of [a, b, c]) expect((await call(pinRoute.POST, { params: { id } })).status).toBeLessThan(300);
    expect(await pinnedCount(w.topic.id)).toBe(3);
    const linesBefore = await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "SYSTEM" } });

    const res = await unpinAll(w.topic.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ unpinned: 3 });
    expect(await pinnedCount(w.topic.id)).toBe(0);
    // ONE line, not three
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "SYSTEM" } })).toBe(linesBefore + 1);
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic.id, kind: "SYSTEM" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(line.body)).toMatchObject({ k: "unpin" });
    const header = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } })).json as { pinnedMessages?: unknown[] };
    expect(header.pinnedMessages ?? []).toEqual([]);
  });

  it("nothing pinned: 200 with 0 and no line", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const before = await db.chatMessage.count({ where: { conversationId: w.topic.id } });
    expect((await unpinAll(w.topic.id)).json).toEqual({ unpinned: 0 });
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(before);
  });

  it("only that conversation: the pins of another topic stay", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const keep = await say(w.other.id, "keep me");
    const drop = await say(w.topic.id, "drop me");
    await call(pinRoute.POST, { params: { id: keep } });
    await call(pinRoute.POST, { params: { id: drop } });
    await unpinAll(w.topic.id);
    expect(await pinnedCount(w.other.id)).toBe(1);
    expect(await pinnedCount(w.topic.id)).toBe(0);
  });

  it("refused: a plain member of a topic (403), a person outside the space (404), a visitor (401) — and the pins stay", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const id = await say(w.topic.id, "pinned");
    await call(pinRoute.POST, { params: { id } });
    await loginAs(w.member.id);
    expect((await unpinAll(w.topic.id)).status).toBe(403);
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Not In Space" });
    await loginAs(stranger.id);
    expect([403, 404]).toContain((await unpinAll(w.topic.id)).status);
    logout();
    expect((await unpinAll(w.topic.id)).status).toBe(401);
    expect(await pinnedCount(w.topic.id)).toBe(1);
  });
});
