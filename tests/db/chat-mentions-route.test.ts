/**
 * C3b.6 — `GET /api/chat/conversations/[id]/mentions?after=&limit=`: the ids of the UNREAD messages of this conversation that mention me (or «@الكل»),
 * oldest first, in pages. It is what the «@» button walks. The rules it must keep:
 *  - the same reading rule as opening the conversation (404 for what is not mine; a guest has topics only);
 *  - the same «unread» as the chat list (C1.2): after MY read mark, never my own message, never a deleted one, never a system line, never an archived
 *    conversation, and only with a read mark of my own (no row = nothing counted) — so the number of the list and the length of this list agree;
 *  - the silent eye (oversight, no row of his own) gets an EMPTY list and the call writes nothing: no read row, no event;
 *  - ids and a cursor only: no text, no author, nothing of a deleted message.
 */
import { describe, expect, it } from "vitest";
import * as mentionsRoute from "@/app/api/chat/conversations/[id]/mentions/route";
import { openDm } from "@/server/chat/dm";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import type { SpaceTopicsDto } from "@/server/chat/dto";
import type { OrgAccessContext } from "@/server/auth";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const SECRET = "نصسرياتذكرك";
let at = Date.parse("2026-11-18T10:00:00.000Z");
const nextAt = () => new Date((at += 60_000));

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const bee = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: bee.id }, { userId: t.guest.id }], "Alpha");
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: bee.id }] } } });
  const ctx = (u: { id: string }, orgRole: OrgAccessContext["orgRole"]): OrgAccessContext => ({ orgId, userId: u.id, orgRole });
  const dm = await openDm(ctx(t.member, "MEMBER"), bee.id, space.id);
  const say = (conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId, conversationId, authorId, body, createdAt: nextAt(), ...extra } });
  const rowFor = (conversationId: string, userId: string, lastReadAt: Date) =>
    db.conversationMember.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { conversationId, userId, lastReadAt }, update: { lastReadAt } });
  return { t, bee, outsider, space, topic, restricted, dm: dm.id, ctx, say, rowFor };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

/** the number the forum view of the space shows beside a topic (the chat list's rule, C1.2) */
const listed = async (userId: string, spaceId: string, topicId: string): Promise<number> => {
  await loginAs(userId);
  const res = await call(topicsRoute.GET, { url: `http://localhost/api/chat/spaces/${spaceId}/topics`, params: { spaceId } });
  return (res.json as unknown as SpaceTopicsDto).rows.find((x) => x.id === topicId)?.mentionsUnread ?? 0;
};

const get = async (userId: string, id: string, query = "") => {
  await loginAs(userId);
  const res = await call(mentionsRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/mentions${query}`, params: { id } });
  return { status: res.status, ids: (res.json?.["ids"] ?? null) as string[] | null, next: (res.json?.["next"] ?? null) as string | null, json: res.json, text: res.text };
};

describe("the unread messages that mention me", () => {
  it("oldest first: by name and by «@الكل»; never mine, deleted, system, read, or about somebody else", async () => {
    const w = await getWorld();
    const me = w.t.member.id;
    const before = await w.say(w.topic.id, w.bee.id, "old mention", { mentions: [me] }); // before the read mark: read
    await w.rowFor(w.topic.id, me, new Date(before.createdAt.getTime() + 1));
    const first = await w.say(w.topic.id, w.bee.id, "by name", { mentions: [me] });
    await w.say(w.topic.id, w.bee.id, "someone else", { mentions: [w.outsider.id] });
    const everyone = await w.say(w.topic.id, w.bee.id, "all", { mentions: ["*"] });
    await w.say(w.topic.id, me, "mine", { mentions: [me] });
    await w.say(w.topic.id, w.bee.id, `${SECRET} deleted`, { mentions: [me], deletedAt: new Date() });
    await w.say(w.topic.id, w.bee.id, "joined", { mentions: [me], kind: "SYSTEM" });
    const last = await w.say(w.topic.id, w.bee.id, "last", { mentions: [me, w.bee.id] });

    const r = await get(me, w.topic.id);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual([first.id, everyone.id, last.id]);
    expect(r.next).toBeNull();
    // ids and a cursor, nothing else: no text, no author, nothing of the deleted message
    expect(Object.keys(r.json ?? {}).sort()).toEqual(["ids", "next"]);
    for (const word of ["by name", "all", "last", SECRET]) expect(r.text).not.toContain(word);
  });

  it("the number of the chat list and the length of this list are the same (C1.2's rule is not changed by this door)", async () => {
    const w = await getWorld();
    const me = w.t.member.id;
    const number = await listed(me, w.space.id, w.topic.id);
    const r = await get(me, w.topic.id);
    expect(number).toBeGreaterThan(0);
    expect(r.ids).toHaveLength(number);
    // asking is not reading: the mark did not move and the number stays
    expect(await listed(me, w.space.id, w.topic.id)).toBe(number);
  });

  it("pages of `limit` with the last id as `next` (and as `after`): walking the pages gives the whole list once, ties in time included", async () => {
    const w = await getWorld();
    const me = w.t.member.id;
    const conv = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Paged" } });
    await w.rowFor(conv.id, me, new Date("2026-11-18T09:00:00.000Z"));
    const same = nextAt(); // two messages written in the same instant: ordered by id, neither skipped nor shown twice
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await w.say(conv.id, w.bee.id, `m${i}`, { mentions: [me], createdAt: i === 1 || i === 2 ? same : nextAt() }));
    const expectedOrder = [...made].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).map((m) => m.id);

    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await get(me, conv.id, `?limit=2${after ? `&after=${after}` : ""}`);
      expect(page.status).toBe(200);
      expect(page.ids!.length).toBeLessThanOrEqual(2);
      seen.push(...page.ids!);
      if (!page.next) break;
      expect(page.next).toBe(page.ids!.at(-1));
      after = page.next;
    }
    expect(seen).toEqual(expectedOrder);
    // `after` is a message of THIS conversation: another conversation's id (or nothing) is «not found»
    expect((await get(me, conv.id, `?after=${w.topic.id}`)).status).toBe(404);
    expect((await get(me, conv.id, "?after=no-such-message")).status).toBe(404);
  });

  it("bad paging is refused (validation, 422) (limit 0, 101, text)", async () => {
    const w = await getWorld();
    for (const q of ["?limit=0", "?limit=101", "?limit=abc"]) expect((await get(w.t.member.id, w.topic.id, q)).status, q).toBe(422);
  });

  it("no read mark of my own, nothing counted (a member who never opened the topic): an empty list, and the call makes no row", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Never opened" } });
    await w.say(conv.id, w.bee.id, "hey", { mentions: [w.t.member.id, "*"] });
    const events = await db.realtimeEvent.count();
    const r = await get(w.t.member.id, conv.id);
    expect(r).toMatchObject({ status: 200, ids: [], next: null });
    expect(await db.conversationMember.count({ where: { conversationId: conv.id, userId: w.t.member.id } })).toBe(0);
    expect(await db.realtimeEvent.count()).toBe(events);
    // and the list agrees: nothing counted there either
    expect(await listed(w.t.member.id, w.space.id, conv.id)).toBe(0);
  });

  it("an archived topic counts nothing (the list's rule) and says so with an empty list", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Old", archivedAt: new Date(), closedAt: new Date() } });
    await w.rowFor(conv.id, w.t.member.id, new Date("2026-11-18T09:00:00.000Z"));
    await w.say(conv.id, w.bee.id, "late", { mentions: [w.t.member.id] });
    expect(await get(w.t.member.id, conv.id)).toMatchObject({ status: 200, ids: [] });
  });

  it("a private chat: the other person's mention counts for me, from my own mark", async () => {
    const w = await getWorld();
    await w.rowFor(w.dm, w.t.member.id, new Date("2026-11-18T09:00:00.000Z"));
    const m = await w.say(w.dm, w.bee.id, "dm", { mentions: [w.t.member.id] });
    const r = await get(w.t.member.id, w.dm);
    expect(r.ids).toContain(m.id);
    // Bee never sees my mention rows: her own list has none of the messages she wrote
    expect((await get(w.bee.id, w.dm)).ids).not.toContain(m.id);
  });

  it("refusals: not mine is 404 (a restricted topic, somebody else's chat, another company, nothing); a guest has topics only", async () => {
    const w = await getWorld();
    await w.say(w.restricted.id, w.bee.id, "secret", { mentions: [w.t.member.id, "*"] });
    expect((await get(w.t.member.id, w.restricted.id)).status).toBe(404);
    expect((await get(w.outsider.id, w.topic.id)).status).toBe(404);
    expect((await get(w.outsider.id, w.dm)).status).toBe(404);
    expect((await get(w.t.guest.id, w.dm)).status).toBe(404);
    expect((await get(w.t.member.id, "no-such-conversation")).status).toBe(404);
    const other = await makeTeam();
    expect((await get(other.owner.id, w.topic.id)).status).toBe(404);
    expect((await get(w.t.guest.id, w.topic.id)).status).toBe(200); // a guest reads an open topic
    const refused = await get(w.t.member.id, w.restricted.id);
    expect(refused.text).not.toContain("secret");
  });

  it("silent oversight: the owner who reads with no row of his own gets an empty list and leaves NO trace (no row, no event); with a row of his own he has his own list", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Watched" } });
    const m = await w.say(conv.id, w.bee.id, "hey", { mentions: [w.t.owner.id, "*"] });
    const events = await db.realtimeEvent.count();
    const silent = await get(w.t.owner.id, conv.id);
    expect(silent).toMatchObject({ status: 200, ids: [], next: null });
    expect(await db.conversationMember.count({ where: { conversationId: conv.id, userId: w.t.owner.id } })).toBe(0);
    expect(await db.realtimeEvent.count()).toBe(events);
    // the same silent reader in a restricted topic of other people: still readable, still empty and silent
    const silentRestricted = await get(w.t.owner.id, w.restricted.id);
    expect(silentRestricted).toMatchObject({ status: 200, ids: [] });
    expect(await db.conversationMember.count({ where: { conversationId: w.restricted.id, userId: w.t.owner.id } })).toBe(0);
    // he joined (a row of his own, older than the message): the list is his, like the chat list's number
    await w.rowFor(conv.id, w.t.owner.id, new Date("2026-11-18T09:00:00.000Z"));
    expect((await get(w.t.owner.id, conv.id)).ids).toEqual([m.id]);
  });

  it("asking twice changes nothing: the read mark stays where it was", async () => {
    const w = await getWorld();
    const mark = new Date("2026-11-18T09:30:00.000Z");
    const conv = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Twice" } });
    await w.rowFor(conv.id, w.t.member.id, mark);
    await w.say(conv.id, w.bee.id, "x", { mentions: [w.t.member.id] });
    const a = await get(w.t.member.id, conv.id);
    const b = await get(w.t.member.id, conv.id);
    expect(b.ids).toEqual(a.ids);
    const row = await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: conv.id, userId: w.t.member.id } } });
    expect(row.lastReadAt.getTime()).toBe(mark.getTime());
  });
});
