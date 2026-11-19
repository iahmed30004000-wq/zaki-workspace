/**
 * C3a.1 — a person's OWN pin, archive, «علّم كغير مقروء» and mute of a conversation (`PUT /api/chat/conversations/[id]/me`, `setMyChatState`).
 * «لإلي بس»: nobody else ever sees it, the moderator's pin and archive (for everybody) are untouched, and the privacy of a reader in silent oversight
 * is the first rule — no row, no event, no trace. The numbers come from the ONE list query; the change reaches the person's other tabs through the sync
 * feed with ids only.
 */
import { describe, expect, it } from "vitest";
import * as meRoute from "@/app/api/chat/conversations/[id]/me/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as orderRoute from "@/app/api/chat/order/route";
import { chatList } from "@/server/chat/list";
import { openDm } from "@/server/chat/dm";
import type { ChatRowDto } from "@/server/chat/dto";
import { PINS_MAX, setMyChatState } from "@/server/chat/read-state";
import { syncFeed } from "@/server/chat/sync";
import { spaceTopics } from "@/server/chat/space-topics";
import { unreadTotal } from "@/server/chat/unread";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
type Person = { id: string };

// every database call is counted, so "one query, no loop" is a number
const seen: string[] = [];
let counting = false;
(db as unknown as { $use: (fn: (p: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(async (params, next) => {
  if (counting) seen.push(`${params.model ?? "raw"}.${params.action}`);
  return next(params);
});
const counted = async <T>(fn: () => Promise<T>): Promise<string[]> => {
  seen.length = 0;
  counting = true;
  try {
    await fn();
    return [...seen];
  } finally {
    counting = false;
  }
};

// times are relative to the real clock: the archive is stamped with "now", so a message is before it or after it by construction
let seq = 0;
const past = () => new Date(Date.now() - 3_600_000 + ++seq * 1000);

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const c = await makeUser({ orgId, role: "MEMBER", name: "Cee" });
  const sa = await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: sa.id, role: "ADMIN" }, { userId: a.id }, { userId: b.id }, { userId: c.id }, { userId: t.guest.id }], "Alpha");
  const topic = (title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title, ...extra } });
  const open = await topic("Open");
  const open2 = await topic("OpenTwo");
  const restricted = await topic("Restricted", { restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } });
  const dm = (await openDm(ctxOf(orgId, a, "MEMBER"), b.id, space.id)).id;
  const dmOthers = (await openDm(ctxOf(orgId, b, "MEMBER"), c.id, space.id)).id;
  return { t, a, b, c, sa, outsider, space, open, open2, restricted, dm, dmOthers };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

/** A NEW ctx object every time: the request scope lives on it (see `chatScope`). */
function ctxOf(orgId: string, who: Person, orgRole: Role) {
  return { orgId, userId: who.id, orgRole };
}
const as = (w: World, who: Person, role: Role = "MEMBER") => ctxOf(w.t.org.id, who, role);
const member = (conversationId: string, userId: string) => db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
const say = (w: World, conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) =>
  db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId, authorId, body, createdAt: past(), ...extra } });
/** A message one millisecond after this person's archive of the conversation. */
const sayAfterArchive = async (w: World, conversationId: string, userId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) => {
  const mark = await member(conversationId, userId);
  return db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId, authorId, body, createdAt: new Date(mark!.archivedAt!.getTime() + 1), ...extra } });
};
const put = (w: World, who: Person, id: string, body: Record<string, unknown>) => loginAs(who.id).then(() => call(meRoute.PUT, { method: "PUT", params: { id }, body }));
const listOf = async (w: World, who: Person, role: Role = "MEMBER") => (await chatList(as(w, who, role), { spaceId: w.space.id })).rows;
const rowOf = (rows: ChatRowDto[], id: string) => rows.find((r) => r.id === id);
const setFeature = async (w: World, on: boolean | null) => {
  await db.organization.update({ where: { id: w.t.org.id }, data: { settings: on === null ? {} : { features: { chatPersonalState: on } } } });
};

describe("the three columns and who sees them", () => {
  it("my pin is MY pin: a row for me, nothing for anybody else, and the moderator's pin of the topic untouched", async () => {
    const w = await getWorld();
    const res = await put(w, w.a, w.open.id, { pinned: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ pinned: true, archived: false, markedUnread: false });
    const mine = rowOf(await listOf(w, w.a), w.open.id)!;
    expect(mine.pinnedByMe).toBe(true);
    expect(mine.pinned).toBe(false); // the managers' pin: for everybody, not set
    expect(rowOf(await listOf(w, w.b), w.open.id)!.pinnedByMe).toBe(false);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.open.id } })).pinnedAt).toBeNull();
    // un-pin
    expect((await put(w, w.a, w.open.id, { pinned: false })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.open.id)!.pinnedByMe).toBe(false);
  });

  it("an open topic the person reads gets a row, like markRead; a conversation of two other people does not exist for them", async () => {
    const w = await getWorld();
    expect(await member(w.open2.id, w.a.id)).toBeNull();
    expect((await put(w, w.a, w.open2.id, { markedUnread: true })).status).toBe(200);
    expect((await member(w.open2.id, w.a.id))?.markedUnread).toBe(true);
    // somebody else's private chat: 404, and no row was made
    const res = await put(w, w.a, w.dmOthers, { pinned: true });
    expect(res.status).toBe(404);
    expect(await member(w.dmOthers, w.a.id)).toBeNull();
    // a conversation that does not exist is the same answer
    expect((await put(w, w.a, "nope", { pinned: true })).status).toBe(404);
  });

  it("a restricted topic or a private chat needs an EXISTING row: no row is no audience (404, nothing written)", async () => {
    const w = await getWorld();
    // the space's other member is in neither: 404 and no row
    const before = await db.conversationMember.count({ where: { conversationId: w.restricted.id } });
    expect((await put(w, w.c, w.restricted.id, { archived: true })).status).toBe(404);
    expect((await put(w, w.outsider, w.dm, { archived: true })).status).toBe(404);
    expect(await db.conversationMember.count({ where: { conversationId: w.restricted.id } })).toBe(before);
    // a person with the row may
    expect((await put(w, w.b, w.restricted.id, { pinned: true })).status).toBe(200);
    expect((await put(w, w.b, w.dm, { pinned: true })).status).toBe(200);
    // a row made for a restricted topic by this path would be a way in: it must not exist for the person without one
    expect(await member(w.restricted.id, w.c.id)).toBeNull();
  });

  it("while the reader is in silent oversight: 404, no row, no event, no trace (the owner's rule)", async () => {
    const w = await getWorld();
    const eventsBefore = await db.realtimeEvent.count();
    const rowsBefore = await db.conversationMember.count();
    for (const id of [w.open.id, w.restricted.id, w.dm, w.dmOthers]) {
      for (const body of [{ pinned: true }, { archived: true }, { markedUnread: true }, { mutedUntil: new Date(Date.now() + 3_600_000).toISOString() }]) {
        const res = await put(w, w.t.owner, id, body);
        expect(res.status, JSON.stringify(body)).toBe(404);
      }
    }
    expect(await db.realtimeEvent.count()).toBe(eventsBefore);
    expect(await db.conversationMember.count()).toBe(rowsBefore);
    expect(await db.userChatOrder.count({ where: { userId: w.t.owner.id } })).toBe(0);
  });

  it("an owner who JOINED a topic has a row of his own and uses it like anybody", async () => {
    const w = await getWorld();
    await db.conversationMember.create({ data: { conversationId: w.open2.id, userId: w.t.owner.id } });
    expect((await put(w, w.t.owner, w.open2.id, { pinned: true })).status).toBe(200);
    expect((await member(w.open2.id, w.t.owner.id))?.pinnedAt).not.toBeNull();
  });

  it("a body that says nothing, or something wrong, is refused", async () => {
    const w = await getWorld();
    expect((await put(w, w.a, w.open.id, {})).status).toBe(422);
    expect((await put(w, w.a, w.open.id, { pinned: "yes" })).status).toBe(422);
    expect((await put(w, w.a, w.open.id, { mutedUntil: "tomorrow" })).status).toBe(422);
  });
});

describe("pins: at most ten, in a person's own order", () => {
  it("the 11th is refused (422, `chatps.pins_full`), a pin already there is not counted twice, and the order keeps the newest on top", async () => {
    const w = await getWorld();
    const me = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Pinner" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: me.id, role: "MEMBER" } });
    const topics: string[] = [];
    for (let i = 0; i < PINS_MAX + 1; i++) topics.push((await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: `Pin${i}` } })).id);
    for (const id of topics.slice(0, PINS_MAX)) expect((await put(w, me, id, { pinned: true })).status).toBe(200);
    const full = await put(w, me, topics[PINS_MAX]!, { pinned: true });
    expect(full.status).toBe(422);
    expect(JSON.stringify(full.json)).toContain("chatps.pins_full");
    expect((await member(topics[PINS_MAX]!, me.id))?.pinnedAt ?? null).toBeNull();
    // pinning one that is already pinned is fine at the limit, and changes nothing
    expect((await put(w, me, topics[0]!, { pinned: true })).status).toBe(200);
    const order = await db.userChatOrder.findUniqueOrThrow({ where: { userId_orgId_scope: { userId: me.id, orgId: w.t.org.id, scope: "pins" } } });
    expect(order.order).toEqual([...topics.slice(0, PINS_MAX)].reverse());
    // an un-pin frees a place and leaves the order
    expect((await put(w, me, topics[3]!, { pinned: false })).status).toBe(200);
    expect((await put(w, me, topics[PINS_MAX]!, { pinned: true })).status).toBe(200);
    const after = await db.userChatOrder.findUniqueOrThrow({ where: { userId_orgId_scope: { userId: me.id, orgId: w.t.org.id, scope: "pins" } } });
    expect(after.order).toEqual([topics[PINS_MAX], ...[...topics.slice(0, PINS_MAX)].reverse().filter((id) => id !== topics[3])]);
    // the person's saved orders (what the screen asks for) carry it, and nobody else's do
    await loginAs(me.id);
    expect(((await call(orderRoute.GET)).json?.["orders"] as Record<string, string[]>)["pins"]).toEqual(after.order);
    await loginAs(w.b.id);
    const theirs = ((await call(orderRoute.GET)).json?.["orders"] as Record<string, string[]> | undefined)?.["pins"] ?? [];
    expect(theirs.filter((id) => topics.includes(id))).toEqual([]);
  });

  it("two pins at once never make eleven", async () => {
    const w = await getWorld();
    const me = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Racer" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: me.id, role: "MEMBER" } });
    const topics: string[] = [];
    for (let i = 0; i < PINS_MAX - 1 + 3; i++) topics.push((await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: `Race${i}` } })).id);
    // nine are pinned; three more are pinned at the same moment: one fits
    for (const id of topics.slice(0, PINS_MAX - 1)) expect((await put(w, me, id, { pinned: true })).status).toBe(200);
    const results = await Promise.allSettled(topics.slice(PINS_MAX - 1).map((id) => setMyChatState(as(w, me), id, { pinned: true })));
    const reasons = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? (r as PromiseRejectedResult).reason));
    expect(reasons).toEqual(["validation.failed", "validation.failed"]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.conversationMember.count({ where: { userId: me.id, pinnedAt: { not: null } } })).toBe(PINS_MAX);
  });
});

describe("archive: it comes back to the main list when something arrives, unless the chat is muted", () => {
  it("an archived chat that is not muted is back after a message newer than the archive; a system line does not bring it back", async () => {
    const w = await getWorld();
    await say(w, w.dm, w.b.id, "before");
    expect((await put(w, w.a, w.dm, { archived: true })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.dm)!.archivedByMe).toBe(true);
    expect(rowOf(await listOf(w, w.b), w.dm)!.archivedByMe).toBe(false);
    await sayAfterArchive(w, w.dm, w.a.id, w.b.id, "joined", { kind: "SYSTEM" });
    expect(rowOf(await listOf(w, w.a), w.dm)!.archivedByMe).toBe(true);
    await sayAfterArchive(w, w.dm, w.a.id, w.b.id, "after");
    expect(rowOf(await listOf(w, w.a), w.dm)!.archivedByMe).toBe(false);
    // archived again: gone until the next one
    expect((await put(w, w.a, w.dm, { archived: true })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.dm)!.archivedByMe).toBe(true);
  });

  it("a muted one stays archived, however many arrive; lifting the mute brings it back at the next one", async () => {
    const w = await getWorld();
    await say(w, w.open2.id, w.b.id, "x");
    expect((await put(w, w.a, w.open2.id, { archived: true, mutedUntil: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200);
    await sayAfterArchive(w, w.open2.id, w.a.id, w.b.id, "y");
    const row = rowOf(await listOf(w, w.a), w.open2.id)!;
    expect(row.archivedByMe).toBe(true);
    expect(row.muted).toBe(true);
    expect((await put(w, w.a, w.open2.id, { mutedUntil: null })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.open2.id)!.archivedByMe).toBe(false); // «y» is newer than the archive
  });

  it("an archive that a message already ended stays ended when the chat is muted LATER (muting does not archive it again)", async () => {
    const w = await getWorld();
    const t = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Ended" } });
    await say(w, t.id, w.b.id, "old");
    expect((await put(w, w.a, t.id, { archived: true })).status).toBe(200);
    await sayAfterArchive(w, t.id, w.a.id, w.b.id, "back again");
    expect(rowOf(await listOf(w, w.a), t.id)!.archivedByMe).toBe(false);
    expect((await put(w, w.a, t.id, { mutedUntil: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200);
    const row = rowOf(await listOf(w, w.a), t.id)!;
    expect(row.muted).toBe(true);
    expect(row.archivedByMe).toBe(false);
    // while archived AND muted from the start, the archive stands (the other test); archiving and muting in one call is that case too
    expect((await put(w, w.a, t.id, { archived: true, mutedUntil: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), t.id)!.archivedByMe).toBe(true);
  });

  it("un-archiving is explicit too, and an archive of a topic takes it out of its space's row (its numbers and chips)", async () => {
    const w = await getWorld();
    const t = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Fold" } });
    await say(w, t.id, w.b.id, "fold one");
    await db.conversationMember.create({ data: { conversationId: t.id, userId: w.a.id, lastReadAt: new Date(Date.now() - 86_400_000) } });
    const spaceRow = async () => (await chatList(as(w, w.a))).rows.find((r) => r.kind === "SPACE" && r.id === w.space.id)!;
    const before = await spaceRow();
    expect(before.topicChips?.some((c) => c.id === t.id)).toBe(true);
    expect((await put(w, w.a, t.id, { archived: true })).status).toBe(200);
    const after = await spaceRow();
    expect(after.topicChips?.some((c) => c.id === t.id)).toBe(false);
    expect(after.unread).toBeLessThan(before.unread);
    // the forum view still has it, marked archived, so the person can find it again
    const forum = (await spaceTopics(as(w, w.a), w.space.id)).rows.find((r) => r.id === t.id)!;
    expect(forum.archivedByMe).toBe(true);
    expect((await put(w, w.a, t.id, { archived: false })).status).toBe(200);
    expect((await spaceTopics(as(w, w.a), w.space.id)).rows.find((r) => r.id === t.id)!.archivedByMe).toBe(false);
  });

  it("the sidebar number leaves out an archived chat (the same rule the list's folders use)", async () => {
    const w = await getWorld();
    const me = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Counter" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: me.id, role: "MEMBER" } });
    const t = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Badge" } });
    await db.conversationMember.create({ data: { conversationId: t.id, userId: me.id, lastReadAt: new Date(Date.now() - 86_400_000) } });
    await say(w, t.id, w.b.id, "one");
    expect(await unreadTotal(as(w, me))).toBe(1);
    expect((await put(w, me, t.id, { archived: true, mutedUntil: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200);
    expect(await unreadTotal(as(w, me))).toBe(0);
    await sayAfterArchive(w, t.id, me.id, w.b.id, "two");
    expect(await unreadTotal(as(w, me))).toBe(0); // muted: stays archived, counts nothing
    expect((await put(w, me, t.id, { mutedUntil: null })).status).toBe(200);
    expect(await unreadTotal(as(w, me))).toBe(2); // a message after the archive: back
  });
});

describe("mark unread, and mute presets", () => {
  it("«علّم كغير مقروء» shows on my row only, and opening the conversation clears it (and tells my other screens)", async () => {
    const w = await getWorld();
    await db.conversationMember.upsert({ where: { conversationId_userId: { conversationId: w.dm, userId: w.a.id } }, create: { conversationId: w.dm, userId: w.a.id }, update: {} });
    expect((await put(w, w.a, w.dm, { markedUnread: true })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.dm)!.markedUnread).toBe(true);
    expect(rowOf(await listOf(w, w.b), w.dm)!.markedUnread).toBe(false);
    const cursor = (await syncFeed(as(w, w.a))).cursor;
    await loginAs(w.a.id);
    const read = () => call(readRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${w.dm}/read`, params: { id: w.dm } });
    expect((await read()).status).toBe(200);
    expect((await member(w.dm, w.a.id))?.markedUnread).toBe(false);
    expect(rowOf(await listOf(w, w.a), w.dm)!.markedUnread).toBe(false);
    const feed = await syncFeed(as(w, w.a), { after: BigInt(cursor) });
    expect(feed.rows.find((r) => r.id === w.dm)?.markedUnread).toBe(false);
    // when the read mark does not move at all (it is already ahead), opening still clears the flag
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: w.dm, userId: w.a.id } }, data: { lastReadAt: new Date(Date.now() + 3_600_000) } });
    expect((await put(w, w.a, w.dm, { markedUnread: true })).status).toBe(200);
    await loginAs(w.a.id);
    expect((await read()).status).toBe(200);
    expect((await member(w.dm, w.a.id))?.markedUnread).toBe(false);
    // nothing to clear: nothing said
    const events = await db.realtimeEvent.count({ where: { kind: "conversation.changed" } });
    expect((await read()).status).toBe(200);
    expect(await db.realtimeEvent.count({ where: { kind: "conversation.changed" } })).toBe(events);
    // a person in silent oversight opening a conversation clears nothing and leaves nothing
    await loginAs(w.t.owner.id);
    expect((await read()).status).toBe(200);
    expect(await db.realtimeEvent.count({ where: { kind: "conversation.changed" } })).toBe(events);
  });

  it("the mute is a date: an hour, a day, a week, for good, or null to lift it; a date in the past is a lifted mute", async () => {
    const w = await getWorld();
    const hour = new Date(Date.now() + 3_600_000);
    const res = await put(w, w.a, w.open.id, { mutedUntil: hour.toISOString() });
    expect(res.status).toBe(200);
    expect(res.json?.["mutedUntil"]).toBe(hour.toISOString());
    expect(rowOf(await listOf(w, w.a), w.open.id)!.muted).toBe(true);
    expect(rowOf(await listOf(w, w.b), w.open.id)!.muted).toBe(false);
    const forever = new Date(Date.now() + 100 * 365 * 86_400_000);
    expect((await put(w, w.a, w.open.id, { mutedUntil: forever.toISOString() })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.open.id)!.muted).toBe(true);
    // further than a hundred years is cut at the hundred, never refused
    const far = await put(w, w.a, w.open.id, { mutedUntil: new Date(Date.now() + 500 * 365 * 86_400_000).toISOString() });
    expect(far.status).toBe(200);
    expect(Date.parse(far.json?.["mutedUntil"] as string)).toBeLessThanOrEqual(Date.now() + 101 * 365 * 86_400_000);
    const past = await put(w, w.a, w.open.id, { mutedUntil: new Date(Date.now() - 1000).toISOString() });
    expect(past.json?.["mutedUntil"]).toBeNull();
    expect(rowOf(await listOf(w, w.a), w.open.id)!.muted).toBe(false);
    expect((await put(w, w.a, w.open.id, { mutedUntil: null })).json?.["mutedUntil"]).toBeNull();
  });
});

describe("the other tabs and devices: through the sync feed, ids only", () => {
  it("my change is an event for ME alone (it names the conversation and me, nothing else); my row arrives with it; nobody else's feed carries it", async () => {
    const w = await getWorld();
    const cursorA = (await syncFeed(as(w, w.a))).cursor;
    const cursorB = (await syncFeed(as(w, w.b))).cursor;
    const eventsBefore = await db.realtimeEvent.count();
    expect((await put(w, w.a, w.open.id, { pinned: true })).status).toBe(200);
    const created = await db.realtimeEvent.findMany({ where: { orgId: w.t.org.id }, orderBy: { id: "desc" }, take: await db.realtimeEvent.count() - eventsBefore });
    expect(created).toHaveLength(1);
    expect(created[0]!.kind).toBe("conversation.changed");
    expect(created[0]!.ids).toEqual({ conversationId: w.open.id, targetUserId: w.a.id, spaceId: w.space.id });
    const mine = await syncFeed(as(w, w.a), { after: BigInt(cursorA) });
    expect(mine.rows.find((r) => r.id === w.open.id)?.pinnedByMe).toBe(true);
    const theirs = await syncFeed(as(w, w.b), { after: BigInt(cursorB) });
    expect(JSON.stringify(theirs)).not.toContain(w.open.id);
  });

  it("a mark that changed nothing says nothing", async () => {
    const w = await getWorld();
    await put(w, w.a, w.open.id, { pinned: true });
    const events = await db.realtimeEvent.count();
    expect((await put(w, w.a, w.open.id, { pinned: true })).status).toBe(200);
    expect(await db.realtimeEvent.count()).toBe(events);
  });

  it("a message arriving brings an archived chat back in the same feed (the row is recomputed in the one query)", async () => {
    const w = await getWorld();
    const t = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Back" } });
    await put(w, w.a, t.id, { archived: true });
    const cursor = (await syncFeed(as(w, w.a))).cursor;
    const m = await sayAfterArchive(w, t.id, w.a.id, w.b.id, "ping");
    await db.realtimeEvent.create({ data: { orgId: w.t.org.id, kind: "message.created", ids: { conversationId: t.id, messageId: m.id, spaceId: w.space.id } } });
    const feed = await syncFeed(as(w, w.a), { after: BigInt(cursor) });
    expect(feed.rows.find((r) => r.id === t.id)?.archivedByMe).toBe(false);
  });
});

describe("the switch `chatPersonalState`", () => {
  it("on by default; off: the door answers 404, the list shows none of it (an archived chat is back), the data stays and comes back with the switch", async () => {
    const w = await getWorld();
    await setFeature(w, null);
    expect((await chatList(as(w, w.a))).personal).toBe(true);
    expect((await put(w, w.a, w.open.id, { pinned: true })).status).toBe(200);
    expect((await put(w, w.a, w.dm, { archived: true, markedUnread: true })).status).toBe(200);
    expect(rowOf(await listOf(w, w.a), w.dm)).toMatchObject({ archivedByMe: true, markedUnread: true });

    await setFeature(w, false);
    const off = await put(w, w.a, w.open.id, { pinned: false });
    expect(off.status).toBe(404);
    expect((await chatList(as(w, w.a))).personal).toBe(false);
    const rows = await listOf(w, w.a);
    expect(rowOf(rows, w.open.id)).toMatchObject({ pinnedByMe: false });
    expect(rowOf(rows, w.dm)).toMatchObject({ archivedByMe: false, markedUnread: false });
    // nothing was lost
    expect((await member(w.open.id, w.a.id))?.pinnedAt).not.toBeNull();
    expect((await member(w.dm, w.a.id))?.archivedAt).not.toBeNull();
    // the sync feed leaves it out too
    const cursor = (await syncFeed(as(w, w.a))).cursor;
    await db.realtimeEvent.create({ data: { orgId: w.t.org.id, kind: "conversation.changed", ids: { conversationId: w.dm, targetUserId: w.a.id } } });
    expect((await syncFeed(as(w, w.a), { after: BigInt(cursor) })).rows.find((r) => r.id === w.dm)).toMatchObject({ archivedByMe: false, markedUnread: false });

    await setFeature(w, null);
    expect(rowOf(await listOf(w, w.a), w.open.id)!.pinnedByMe).toBe(true);
    expect(rowOf(await listOf(w, w.a), w.dm)).toMatchObject({ archivedByMe: true, markedUnread: true });
  });
});

describe("one query for the list, however many conversations carry a personal state", () => {
  it("the number of database calls does not grow with the marks (no canRead per row, no loop)", async () => {
    const w = await getWorld();
    await setFeature(w, null);
    const me = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Many" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: me.id, role: "MEMBER" } });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.space.id, title: `Many${i}` } })).id);
    const plain = await counted(() => chatList(as(w, me), { spaceId: w.space.id }));
    for (const [i, id] of ids.entries()) await setMyChatState(as(w, me), id, i % 2 ? { pinned: true } : { archived: true, markedUnread: true });
    const marked = await counted(() => chatList(as(w, me), { spaceId: w.space.id }));
    expect(marked).toEqual(plain);
    const rows = await listOf(w, me);
    expect(rows.filter((r) => r.pinnedByMe)).toHaveLength(3);
    expect(rows.filter((r) => r.archivedByMe)).toHaveLength(3);
    // pinned first (the newest pin on top), archived last
    const mine = rows.filter((r) => ids.includes(r.id));
    expect(mine.slice(0, 3).every((r) => r.pinnedByMe)).toBe(true);
    expect(mine.slice(0, 3).map((r) => r.id)).toEqual([ids[5], ids[3], ids[1]]);
    expect(mine.slice(-3).every((r) => r.archivedByMe)).toBe(true);
  });
});
