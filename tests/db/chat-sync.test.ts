/**
 * C1.2 — `GET /api/chat/sync`: the delta feed. The privacy of it is what matters most: it must never return a message of a conversation the
 * person cannot read (a restricted topic, somebody else's private chat, another team's topic, another company), a topic made private must show in
 * `removed` for the people dropped, a deleted message is a tombstone with no text, and a cursor older than the retention answers `reset`.
 * The last block carries Q1 over: the card kinds, the order chips, the ticket chip and «لازم ينقرأ» all arrive through sync exactly as they do through the
 * message pages.
 */
import { describe, expect, it } from "vitest";
import * as syncRoute from "@/app/api/chat/sync/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { openDm } from "@/server/chat/dm";
import type { ChatRowDto, MessageDto, MessagesPageDto, SyncDto } from "@/server/chat/dto";
import { deleteMessage, markDelivered, markRead, sendLimiter, sendMessage, toggleReact } from "@/server/chat/messages";
import { createTopic, joinTopic, updateTopic } from "@/server/chat/topics";
import { syncFeed } from "@/server/chat/sync";
import { emitRealtime } from "@/server/realtime/emit";
import { setAck, setMustRead } from "@/server/services/must-read";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
type Person = { id: string };

// every database call is counted, so "one query for the whole batch" is a number
const seen: string[] = [];
let counting = false;
(db as unknown as { $use: (fn: (p: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(async (params, next) => {
  if (counting) seen.push(`${params.model ?? "raw"}.${params.action}`);
  return next(params);
});

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const c = await makeUser({ orgId, role: "MEMBER", name: "Cee" });
  const sa = await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const a = t.member;
  const space = await makeWorkspace(orgId, [{ userId: sa.id, role: "ADMIN" }, { userId: a.id }, { userId: b.id }, { userId: c.id }, { userId: t.guest.id }], "Alpha");
  const section = await db.team.create({ data: { workspaceId: space.id, name: "Section", members: { create: [{ userId: b.id }] } } });
  const mk = (title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title, ...extra } });
  const open = await mk("Open");
  const restricted = await mk("Restricted", { restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } });
  const teamTopic = await mk("TeamOnly", { teamId: section.id });
  const dm = (await openDm(ctxOf(orgId, a, "MEMBER"), b.id, space.id)).id;
  const other = await makeTeam();
  const otherSpace = await makeWorkspace(other.org.id, [{ userId: other.member.id }]);
  const foreign = await db.conversation.create({ data: { orgId: other.org.id, kind: "TOPIC", spaceId: otherSpace.id, title: "Foreign" } });
  return { t, a, b, c, sa, outsider, space, section, open, restricted, teamTopic, dm, other, foreign };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

/** A NEW ctx object every time: the request scope lives on it (see `chatScope`), so a call never reads another call's facts. */
function ctxOf(orgId: string, who: Person, orgRole: Role) {
  return { orgId, userId: who.id, orgRole };
}
const as = (w: World, who: Person, role: Role = "MEMBER") => ctxOf(w.t.org.id, who, role);

const now = async (w: World, who: Person, role: Role = "MEMBER") => (await syncFeed(as(w, who, role))).cursor;
const since = (w: World, who: Person, after: string, role: Role = "MEMBER", limit?: number) => syncFeed(as(w, who, role), { after: BigInt(after), ...(limit ? { limit } : {}) });
const say = async (w: World, who: Person, conversationId: string, body: string, role: Role = "MEMBER", internal?: Parameters<typeof sendMessage>[3]) => {
  sendLimiter.reset(`chat.send.${who.id}`);
  return sendMessage(as(w, who, role), conversationId, { body }, internal);
};
const text = (dto: SyncDto) => JSON.stringify(dto);
const rowOf = (dto: SyncDto, id: string): ChatRowDto | undefined => dto.rows.find((r) => r.id === id);

describe("the cursor", () => {
  it("without `after` it only says where «now» is; with it, an answer that has nothing new keeps the same cursor", async () => {
    const w = await getWorld();
    const first = await syncFeed(as(w, w.a));
    expect(first).toMatchObject({ messages: [], reads: [], delivered: [], rows: [], removed: [] });
    expect(first.reset).toBeUndefined();
    expect(first.cursor).toMatch(/^\d+$/);
    const idle = await since(w, w.a, first.cursor);
    expect(idle).toEqual({ cursor: first.cursor, messages: [], reads: [], delivered: [], rows: [], removed: [] });
  });

  it("a message arrives once, presented for the one who asks; its cursor moves on and the next answer is empty", async () => {
    const w = await getWorld();
    const start = await now(w, w.b);
    const sent = await say(w, w.a, w.open.id, "hello team");
    const forB = await since(w, w.b, start);
    expect(forB.messages.map((m) => m.id)).toEqual([sent.id]);
    expect(forB.messages[0]).toMatchObject({ body: "hello team", mine: false, authorName: "Member", kind: "TEXT" });
    expect(BigInt(forB.cursor)).toBeGreaterThan(BigInt(start));
    // the author's own other device gets the same message as «mine»
    expect((await since(w, w.a, start)).messages[0]).toMatchObject({ id: sent.id, mine: true });
    expect(await since(w, w.b, forB.cursor)).toEqual({ cursor: forB.cursor, messages: [], reads: [], delivered: [], rows: [], removed: [] });
  });

  it("an answer stops at `limit` events and says `more`; asking again from its cursor gets every message exactly once", async () => {
    const w = await getWorld();
    const start = await now(w, w.b);
    const made = [] as string[];
    for (let i = 0; i < 5; i++) made.push((await say(w, w.a, w.open.id, `burst ${i}`)).id);
    const got: string[] = [];
    let cursor = start;
    let rounds = 0;
    for (let guard = 0; guard < 10; guard++) {
      const step = await since(w, w.b, cursor, "MEMBER", 2);
      rounds++;
      got.push(...step.messages.map((m) => m.id));
      cursor = step.cursor;
      if (!step.more) break;
    }
    expect(got).toEqual(made);
    expect(rounds).toBeGreaterThanOrEqual(3);
  });
});

describe("sync never returns a message the person cannot read", () => {
  it("a restricted topic, somebody else's private chat, another team's topic and another company's topic stay where they are", async () => {
    const w = await getWorld();
    const starts = { c: await now(w, w.c), b: await now(w, w.b), out: await now(w, w.outsider), guest: await now(w, w.t.guest, "GUEST"), owner: await now(w, w.t.owner, "OWNER"), x: (await syncFeed(ctxOf(w.other.org.id, w.other.owner, "OWNER"))).cursor };
    const inRestricted = await say(w, w.a, w.restricted.id, "WORDS-RESTRICTED");
    const inDm = await say(w, w.a, w.dm, "WORDS-DM");
    const inTeam = await say(w, w.sa, w.teamTopic.id, "WORDS-TEAM");
    const inOpen = await say(w, w.a, w.open.id, "WORDS-OPEN");

    // Cee is in the space but in neither the restricted topic, nor the DM, nor the team: she gets the open topic only
    const forC = await since(w, w.c, starts.c);
    expect(forC.messages.map((m) => m.id)).toEqual([inOpen.id]);
    for (const secret of ["WORDS-RESTRICTED", "WORDS-DM", "WORDS-TEAM"]) expect(text(forC)).not.toContain(secret);
    expect(forC.removed).toEqual([]);
    for (const hidden of [w.restricted.id, w.dm, w.teamTopic.id]) expect(forC.rows.map((r) => r.id)).not.toContain(hidden);

    // Bee is in the restricted topic, the DM and the team: all four
    const forB = await since(w, w.b, starts.b);
    expect(new Set(forB.messages.map((m) => m.id))).toEqual(new Set([inRestricted.id, inDm.id, inTeam.id, inOpen.id]));

    // a space member who is nowhere near them, and a guest (who has topics only and not the team's, not the restricted one)
    expect((await since(w, w.outsider, starts.out)).messages).toEqual([]);
    const forGuest = await since(w, w.t.guest, starts.guest, "GUEST");
    expect(forGuest.messages.map((m) => m.id)).toEqual([inOpen.id]);
    for (const secret of ["WORDS-RESTRICTED", "WORDS-DM", "WORDS-TEAM"]) expect(text(forGuest)).not.toContain(secret);

    // the silent eye gets the topics (it reads them all) but the private chat of two others is not in the feed (its door is the oversight list)
    const forOwner = await since(w, w.t.owner, starts.owner, "OWNER");
    expect(new Set(forOwner.messages.map((m) => m.id))).toEqual(new Set([inRestricted.id, inTeam.id, inOpen.id]));
    expect(text(forOwner)).not.toContain("WORDS-DM");

    // another company never sees this company's events at all
    const forOther = await syncFeed(ctxOf(w.other.org.id, w.other.owner, "OWNER"), { after: BigInt(starts.x) });
    expect(forOther).toEqual({ cursor: starts.x, messages: [], reads: [], delivered: [], rows: [], removed: [] });
  });

  it("an event that names a conversation the person cannot read, with a message in it, returns neither the message nor the row", async () => {
    const w = await getWorld();
    const start = await now(w, w.c);
    const msg = await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: w.restricted.id, authorId: w.a.id, body: "FORGED-EVENT-TARGET" } });
    // an event whose conversation id lies about where the message is: the message is only fetched out of the conversations the person reads
    await emitRealtime(db, w.t.org.id, "message.created", { conversationId: w.open.id, messageId: msg.id });
    const got = await since(w, w.c, start);
    expect(text(got)).not.toContain("FORGED-EVENT-TARGET");
    expect(got.messages).toEqual([]);
  });

  it("an offboarded person's private chat and a conversation of a space they left are no longer theirs", async () => {
    const w = await getWorld();
    const p = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Leaver" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: p.id } });
    const dm = (await openDm(as(w, w.a), p.id, w.space.id)).id;
    const start = await now(w, w.a);
    await db.organizationMember.updateMany({ where: { organizationId: w.t.org.id, userId: p.id }, data: { status: "OFFBOARDED" } });
    await say(w, p, dm, "from a person who left").catch(() => undefined);
    const msg = await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: dm, authorId: p.id, body: "LEFT-BEHIND" } });
    await emitRealtime(db, w.t.org.id, "message.created", { conversationId: dm, messageId: msg.id });
    expect(text(await since(w, w.a, start))).not.toContain("LEFT-BEHIND");
  });
});

describe("a topic made private", () => {
  it("is in `removed` for the people dropped, and stays out of the feed from then on; the people named keep it", async () => {
    const w = await getWorld();
    const topic = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "WasOpen" } });
    await say(w, w.a, topic.id, "before it was private");
    const start = { b: await now(w, w.b), c: await now(w, w.c), a: await now(w, w.a), out: await now(w, w.outsider) };
    await updateTopic(as(w, w.sa), topic.id, { restricted: true, memberIds: [w.a.id] });
    const afterC = await since(w, w.c, start.c);
    expect(afterC.removed).toEqual([topic.id]);
    expect((await since(w, w.b, start.b)).removed).toEqual([topic.id]);
    // the person named keeps it, and gets its row refreshed
    const afterA = await since(w, w.a, start.a);
    expect(afterA.removed).toEqual([]);
    expect(rowOf(afterA, topic.id)).toMatchObject({ kind: "TOPIC", restricted: true });
    // what is said there afterwards reaches the named people only
    await say(w, w.a, topic.id, "PRIVATE-NOW");
    expect(text(await since(w, w.c, afterC.cursor))).not.toContain("PRIVATE-NOW");
    expect((await since(w, w.a, afterA.cursor)).messages.map((m) => m.body)).toEqual(["PRIVATE-NOW"]);
    // somebody outside the space never learns that it exists, changed or not
    expect((await since(w, w.outsider, start.out)).removed).toEqual([]);
  });

  it("a person taken out of a topic (its row removed) is told; a chat that is deleted altogether is removed for everybody who could have known it", async () => {
    const w = await getWorld();
    const topic = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Shrinks", restricted: true, members: { create: [{ userId: w.a.id }, { userId: w.b.id }] } } });
    const start = { a: await now(w, w.a), b: await now(w, w.b) };
    // the topic's moderator removes Bee from it
    await db.conversationMember.delete({ where: { conversationId_userId: { conversationId: topic.id, userId: w.b.id } } });
    await emitRealtime(db, w.t.org.id, "membership.changed", { conversationId: topic.id, userId: w.b.id, spaceId: w.space.id });
    expect((await since(w, w.b, start.b)).removed).toEqual([topic.id]);
    // ... and Ay, who is still in it, is not told he lost it
    expect((await since(w, w.a, start.a)).removed).toEqual([]);
    // deleted altogether
    const gone = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Gone" } });
    const s2 = await now(w, w.c);
    await emitRealtime(db, w.t.org.id, "conversation.changed", { conversationId: gone.id, spaceId: w.space.id });
    await db.conversation.delete({ where: { id: gone.id } });
    expect((await since(w, w.c, s2)).removed).toEqual([gone.id]);
  });

  it("a topic opened (an event with a space and no conversation) arrives as a row, with the row of its space", async () => {
    const w = await getWorld();
    const start = await now(w, w.b);
    const made = await createTopic(as(w, w.sa), { spaceId: w.space.id, title: "BrandNew" });
    const got = await since(w, w.b, start);
    expect(rowOf(got, made.id)).toMatchObject({ kind: "TOPIC", title: "BrandNew" });
    expect(rowOf(got, w.space.id)).toMatchObject({ kind: "SPACE", title: "Alpha" });
    expect(rowOf(got, w.space.id)?.topicChips?.length).toBeGreaterThan(0);
  });
});

describe("a deleted message is a tombstone", () => {
  it("no text, no files, no reactions, no original — for the member, the guest and the silent eye alike", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, "SECRET-TEXT-OF-A-DELETED-ONE");
    await toggleReact(as(w, w.b), sent.id, { emoji: "👍" });
    const start = { b: await now(w, w.b), g: await now(w, w.t.guest, "GUEST"), o: await now(w, w.t.owner, "OWNER") };
    await deleteMessage(as(w, w.a), sent.id);
    for (const [who, role, cursor] of [[w.b, "MEMBER", start.b], [w.t.guest, "GUEST", start.g], [w.t.owner, "OWNER", start.o]] as const) {
      const got = await since(w, who, cursor, role);
      const m = got.messages.find((x) => x.id === sent.id)!;
      expect(m, `${role}`).toMatchObject({ deleted: true, body: null, attachments: [], reactions: [] });
      expect(m.original).toBeUndefined();
      expect(m.history).toBeUndefined();
      expect(text(got)).not.toContain("SECRET-TEXT-OF-A-DELETED-ONE");
    }
    // the row of the topic shows «رسالة محذوفة» (no preview), not the words
    const rows = (await since(w, w.b, start.b)).rows;
    expect(JSON.stringify(rows)).not.toContain("SECRET-TEXT-OF-A-DELETED-ONE");
  });

  it("an edit arrives as the new text and never carries the edit history, even for the silent eye", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, "first draft");
    const start = await now(w, w.t.owner, "OWNER");
    await db.chatMessage.update({ where: { id: sent.id }, data: { body: "second draft", editedAt: new Date() } });
    await db.messageRevision.create({ data: { messageId: sent.id, body: "first draft", editorId: w.a.id } });
    await emitRealtime(db, w.t.org.id, "message.edited", { conversationId: w.open.id, messageId: sent.id });
    const got = (await since(w, w.t.owner, start, "OWNER")).messages[0]!;
    expect(got).toMatchObject({ body: "second draft", edited: true });
    expect(got.history).toBeUndefined();
  });
});

describe("a cursor that is too old, or from nowhere, answers `reset`", () => {
  it("a cursor ahead of anything issued, or behind what the 48 hour purge kept, starts over — once", async () => {
    const w = await getWorld();
    const here = BigInt(await now(w, w.a));
    expect(await since(w, w.a, String(here + 1000n))).toMatchObject({ reset: true, messages: [], rows: [], removed: [] });
    // some history, then the purge takes everything before the newest events
    const start = await now(w, w.a);
    for (let i = 0; i < 3; i++) await say(w, w.b, w.open.id, `old ${i}`);
    const keep = BigInt((await since(w, w.a, start)).cursor);
    await db.realtimeEvent.deleteMany({ where: { id: { lt: keep } } });
    const stale = await since(w, w.a, String(BigInt(start)));
    expect(stale.reset).toBe(true);
    expect(stale.messages).toEqual([]);
    // the answer's cursor is where «now» is: continuing from it is an ordinary answer
    const again = await since(w, w.a, stale.cursor);
    expect(again.reset).toBeUndefined();
    await say(w, w.b, w.open.id, "after the reset");
    expect((await since(w, w.a, stale.cursor)).messages.map((m) => m.body)).toEqual(["after the reset"]);
  });

  it("the whole table purged: any older cursor is a reset, the cursor of «now» is not", async () => {
    const w = await getWorld();
    const old = await now(w, w.a);
    await say(w, w.b, w.open.id, "soon gone");
    await db.realtimeEvent.deleteMany({});
    expect((await since(w, w.a, old)).reset).toBe(true);
    const fresh = await now(w, w.a);
    expect((await since(w, w.a, fresh)).reset).toBeUndefined();
  });

  it("a change to my own rank or permissions (an event for me alone, with no conversation) answers `reset`: what I may read can have changed in ways no id names", async () => {
    const w = await getWorld();
    const start = { b: await now(w, w.b), c: await now(w, w.c) };
    await emitRealtime(db, w.t.org.id, "membership.changed", { userId: w.sa.id, targetUserId: w.b.id });
    expect((await since(w, w.b, start.b)).reset).toBe(true);
    // the same event for somebody else's rank is not Cee's business
    expect(await since(w, w.c, start.c)).toMatchObject({ messages: [], rows: [], removed: [] });
    expect((await since(w, w.c, start.c)).reset).toBeUndefined();
  });
});

describe("what lives on the stream only is not in sync", () => {
  it("typing, a ringing call, a call, the whiteboard and the watch session are skipped; the cursor still moves past them", async () => {
    const w = await getWorld();
    const start = await now(w, w.b);
    const org = w.t.org.id;
    await emitRealtime(db, org, "call.ring", { conversationId: w.open.id, callId: "call-1", targetUserId: w.b.id });
    await emitRealtime(db, org, "call.changed", { conversationId: w.open.id, callId: "call-1" });
    await emitRealtime(db, org, "whiteboard.changed", { conversationId: w.open.id });
    await emitRealtime(db, org, "watch.changed", { conversationId: w.open.id });
    await db.realtimeEvent.create({ data: { orgId: org, kind: "typing", ids: { conversationId: w.open.id, userId: w.a.id } } });
    const got = await since(w, w.b, start);
    expect(got).toMatchObject({ messages: [], reads: [], delivered: [], rows: [], removed: [] });
    expect(BigInt(got.cursor)).toBeGreaterThan(BigInt(start));
  });
});

describe("read and delivery marks, and the rows", () => {
  it("who read up to where arrives as a mark of the person (never the owner's silent reading, never somebody who left)", async () => {
    const w = await getWorld();
    await say(w, w.b, w.open.id, "read me");
    const start = { b: await now(w, w.b), c: await now(w, w.c) };
    await markRead(as(w, w.a), w.open.id);
    // Cee (a space member) sees Ay's mark too: readers are visible to whoever reads the topic
    for (const [who, cursor] of [[w.b, start.b], [w.c, start.c]] as const) {
      const got = await since(w, who, cursor);
      expect(got.reads).toEqual([{ conversationId: w.open.id, userId: w.a.id, lastReadAt: expect.any(String) }]);
    }
    // the owner has a row of his own and an event names him: his mark is not sent
    await joinTopic(as(w, w.t.owner, "OWNER"), w.open.id);
    const s2 = await now(w, w.b);
    await emitRealtime(db, w.t.org.id, "conversation.read", { conversationId: w.open.id, userId: w.t.owner.id });
    expect((await since(w, w.b, s2)).reads).toEqual([]);
    // a person who is no longer ACTIVE is nobody
    await db.organizationMember.updateMany({ where: { organizationId: w.t.org.id, userId: w.a.id }, data: { status: "SUSPENDED" } });
    await emitRealtime(db, w.t.org.id, "conversation.read", { conversationId: w.open.id, userId: w.a.id });
    expect((await since(w, w.b, s2)).reads).toEqual([]);
    await db.organizationMember.updateMany({ where: { organizationId: w.t.org.id, userId: w.a.id }, data: { status: "ACTIVE" } });
  });

  it("the ticks of a private chat: «delivered» and «read» reach the sender, as marks and on the row; nobody else gets the chat", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.dm, "tick me");
    const start = { a: await now(w, w.a), c: await now(w, w.c), o: await now(w, w.t.owner, "OWNER") };
    await markDelivered(as(w, w.b), w.dm);
    const delivered = await since(w, w.a, start.a);
    expect(delivered.delivered).toEqual([{ conversationId: w.dm, userId: w.b.id, lastDeliveredAt: expect.any(String) }]);
    expect(rowOf(delivered, w.dm)?.lastMessage).toMatchObject({ id: sent.id, mine: true, status: "delivered" });
    const s2 = delivered.cursor;
    await markRead(as(w, w.b), w.dm);
    const read = await since(w, w.a, s2);
    expect(read.reads).toEqual([{ conversationId: w.dm, userId: w.b.id, lastReadAt: expect.any(String) }]);
    expect(rowOf(read, w.dm)?.lastMessage?.status).toBe("read");
    // Cee and the silent eye are not in this chat's feed
    for (const [who, role, cursor] of [[w.c, "MEMBER", start.c], [w.t.owner, "OWNER", start.o]] as const) {
      const got = await since(w, who, cursor, role);
      expect(got.delivered).toEqual([]);
      expect(got.reads).toEqual([]);
      expect(got.rows.map((r) => r.id)).not.toContain(w.dm);
    }
  });

  it("a new message moves its topic's row and its space's row (the numbers the list shows), for the people who read it", async () => {
    const w = await getWorld();
    const start = await now(w, w.b);
    await say(w, w.a, w.open.id, "row mover");
    const got = await since(w, w.b, start);
    const topic = rowOf(got, w.open.id)!;
    expect(topic).toMatchObject({ kind: "TOPIC", title: "Open" });
    expect(topic.lastMessage).toMatchObject({ preview: "row mover", authorName: "Member", mine: false });
    expect(topic.unread).toBeGreaterThan(0);
    expect(rowOf(got, w.space.id)).toMatchObject({ kind: "SPACE", title: "Alpha" });
    // a restricted topic's row is only in the feed of the people in it
    const s2 = await now(w, w.c);
    await say(w, w.a, w.restricted.id, "restricted row mover");
    expect((await since(w, w.c, s2)).rows).toEqual([]);
  });
});

describe("one query decides for the whole batch", () => {
  it("the calls do not grow with the number of conversations in the batch", async () => {
    const w = await getWorld();
    const make = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const topic = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: `Batch ${n}-${i}` } });
        const msg = await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: topic.id, authorId: w.a.id, body: `b${i}` } });
        await emitRealtime(db, w.t.org.id, "message.created", { conversationId: topic.id, messageId: msg.id, spaceId: w.space.id });
      }
    };
    const measure = async (n: number) => {
      const start = await now(w, w.b);
      await make(n);
      seen.length = 0;
      counting = true;
      try {
        const got = await since(w, w.b, start);
        expect(got.messages).toHaveLength(n);
        return [...seen];
      } finally {
        counting = false;
      }
    };
    const few = await measure(3);
    const many = await measure(15);
    expect(many).toEqual(few);
    expect(many.length).toBeLessThanOrEqual(9);
    // and the feed never needs the company's settings: no read of them at all
    expect(many.filter((c) => c === "Organization.findUnique")).toEqual([]);
  });
});

describe("the route", () => {
  const get = async (who: Person, query = "") => {
    await loginAs(who.id);
    return call(syncRoute.GET, { url: `http://localhost/api/chat/sync${query}` });
  };

  it("answers the same thing as the service; a cursor that is not a number, or a limit over 500, is refused; no session is 401", async () => {
    const w = await getWorld();
    const base = (await get(w.b)).json as unknown as SyncDto;
    expect(base.cursor).toMatch(/^\d+$/);
    await say(w, w.a, w.open.id, "through the route");
    const res = await get(w.b, `?after=${base.cursor}&limit=100`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((res.json as unknown as SyncDto).messages.map((m) => m.body)).toEqual(["through the route"]);
    expect((await get(w.b, "?after=abc")).status).toBe(422);
    expect((await get(w.b, "?after=-1")).status).toBe(422);
    expect((await get(w.b, `?after=${base.cursor}&limit=501`)).status).toBe(422);
    const { logout } = await import("./helpers");
    logout();
    expect((await call(syncRoute.GET, { url: "http://localhost/api/chat/sync" })).status).toBe(401);
  });
});

describe("carried over from Q1: the cards, the order chips, the ticket chip and «لازم ينقرأ» arrive through sync as they do through the pages", () => {
  /** The same message through the page route, for one person: sync must say exactly what the page says. */
  const pageOf = async (w: World, who: Person, conversationId: string, id: string): Promise<MessageDto> => {
    await loginAs(who.id);
    const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}/messages?around=${id}&limit=4`, params: { id: conversationId } });
    return (res.json as unknown as MessagesPageDto).messages.find((m) => m.id === id)!;
  };
  const strip = (m: MessageDto): MessageDto => {
    const { original: _o, history: _h, ...rest } = m;
    return rest as MessageDto;
  };

  it("a product CARD: only its address travels, the body has no price, and a guest gets the very same thing (what each reader may see of the sheet is decided when it is opened)", async () => {
    const w = await getWorld();
    const start = { b: await now(w, w.b), g: await now(w, w.t.guest, "GUEST") };
    const sent = await say(w, w.a, w.open.id, "كرت منتج: حراك", "MEMBER", { card: { type: "product", cardId: "card-1" } });
    for (const [who, role, cursor] of [[w.b, "MEMBER", start.b], [w.t.guest, "GUEST", start.g]] as const) {
      const got = await since(w, who, cursor, role);
      const m = got.messages.find((x) => x.id === sent.id)!;
      expect(m, role).toMatchObject({ kind: "CARD", card: { type: "product", cardId: "card-1" }, body: "كرت منتج: حراك" });
      expect(text(got)).not.toMatch(/price|سعر|\bJOD\b|\bUSD\b/i);
      expect(JSON.stringify(strip(m))).toBe(JSON.stringify(strip(await pageOf(w, who, w.open.id, sent.id))));
    }
  });

  it("an order CARD (the chip of «/طلب»): the number only, no state, in sync and on the page alike", async () => {
    const w = await getWorld();
    const start = await now(w, w.b);
    const sent = await say(w, w.a, w.open.id, "طلب 123456", "MEMBER", { card: { type: "order", number: "123456" } });
    const m = (await since(w, w.b, start)).messages.find((x) => x.id === sent.id)!;
    expect(m).toMatchObject({ kind: "CARD", card: { type: "order", number: "123456" } });
    expect(Object.keys(m.card ?? {}).sort()).toEqual(["number", "type"]);
    expect(JSON.stringify(strip(m))).toBe(JSON.stringify(strip(await pageOf(w, w.b, w.open.id, sent.id))));
  });

  it("the ticket chip: number, state and holder for staff, nothing for a guest; `ticket.changed` sends the message again with the new state", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, "the printer is broken");
    const start = { b: await now(w, w.b), g: await now(w, w.t.guest, "GUEST") };
    const ticket = await db.ticket.create({ data: { orgId: w.t.org.id, number: 9001, title: "Printer", creatorId: w.a.id, assigneeId: w.c.id, sourceMessageId: sent.id } });
    await emitRealtime(db, w.t.org.id, "ticket.changed", { conversationId: w.open.id, messageId: sent.id, spaceId: w.space.id });
    const first = await since(w, w.b, start.b);
    const chip = first.messages.find((x) => x.id === sent.id)!.work;
    expect(chip).toEqual([{ kind: "ticket", id: ticket.id, number: 9001, status: "OPEN", assigneeName: "Cee" }]);
    expect((await since(w, w.t.guest, start.g, "GUEST")).messages.find((x) => x.id === sent.id)?.work).toBeUndefined();
    await db.ticket.update({ where: { id: ticket.id }, data: { status: "RESOLVED" } });
    await emitRealtime(db, w.t.org.id, "ticket.changed", { conversationId: w.open.id, messageId: sent.id, spaceId: w.space.id });
    const second = await since(w, w.b, first.cursor);
    expect(second.messages.find((x) => x.id === sent.id)?.work?.[0]).toMatchObject({ kind: "ticket", status: "RESOLVED" });
    expect(JSON.stringify(strip(second.messages[0]!))).toBe(JSON.stringify(strip(await pageOf(w, w.b, w.open.id, sent.id))));
  });

  it("«لازم ينقرأ»: the author and the moderator see how many read and who has not, each person sees their own state, a guest sees nothing; a ✅ moves the count", async () => {
    const w = await getWorld();
    await db.organization.update({ where: { id: w.t.org.id }, data: { settings: { features: { mustRead: true } } } });
    try {
      const start = { sa: await now(w, w.sa), b: await now(w, w.b), g: await now(w, w.t.guest, "GUEST") };
      const sent = await say(w, w.sa, w.open.id, "everybody read the new rule");
      await setMustRead(as(w, w.sa), sent.id, true);
      // the people it must reach: the space's ACTIVE staff but its author: Ay, Bee, Cee
      const forAuthor = (await since(w, w.sa, start.sa)).messages.find((m) => m.id === sent.id)!;
      expect(forAuthor.mustRead).toMatchObject({ mine: false, acked: false, total: 3, read: 0 });
      expect(forAuthor.mustRead?.missing?.map((p) => p.name).sort()).toEqual(["Bee", "Cee", "Member"]);
      const forB = (await since(w, w.b, start.b)).messages.find((m) => m.id === sent.id)!;
      expect(forB.mustRead).toEqual({ mine: true, acked: false });
      expect((await since(w, w.t.guest, start.g, "GUEST")).messages.find((m) => m.id === sent.id)?.mustRead).toBeUndefined();
      // Bee taps «قرأت ✓»: the ✅ is an event, the message comes again with the count moved
      const s2 = await now(w, w.sa);
      await setAck(as(w, w.b), sent.id, true);
      const after = (await since(w, w.sa, s2)).messages.find((m) => m.id === sent.id)!;
      expect(after.mustRead).toMatchObject({ total: 3, read: 1 });
      expect(after.mustRead?.missing?.map((p) => p.name).sort()).toEqual(["Cee", "Member"]);
      const bAfter = (await since(w, w.b, s2)).messages.find((m) => m.id === sent.id)!;
      expect(bAfter.mustRead).toEqual({ mine: true, acked: true });
      expect(JSON.stringify(strip(after))).toBe(JSON.stringify(strip(await pageOf(w, w.sa, w.open.id, sent.id))));
    } finally {
      await db.organization.update({ where: { id: w.t.org.id }, data: { settings: {} } });
    }
  });
});
