/**
 * C1.2 — `GET /api/chat/conversations/[id]/messages`: one window of a conversation, cursor `(createdAt, id)` (F0.8), in every direction:
 * the newest, `before`, `after`, `around`. Every message leaves through the presenter, so a deleted message, a note and the owner's fields stay
 * exactly as private as on the old screen. The new file is where `POST` (C1.8) also lives: it must still send.
 */
import { describe, expect, it } from "vitest";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as detailRoute from "@/app/api/chat/conversations/[id]/route";
import { conversationDetailUrl, conversationMessagesUrl, conversationHeaderUrl, chatListUrl, chatSyncUrl, spaceTopicsUrl } from "@/lib/chat/conversation/client";
import type { MessageDto, MessagesPageDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: b.id }, { userId: t.guest.id }]);
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Long" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Hidden", restricted: true, members: { create: [{ userId: b.id }] } } });
  return { t, b, outsider, space, topic, restricted };
}
type World = Awaited<ReturnType<typeof world>>;

const page = async (userId: string, id: string, query = "") => {
  await loginAs(userId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/messages${query ? `?${query}` : ""}`, params: { id } });
  return { status: res.status, dto: res.json as unknown as MessagesPageDto, json: res.json };
};
const ids = (p: { dto: MessagesPageDto }) => p.dto.messages.map((m) => m.id);

/** 120 messages, one per second, ids m000..m119 in the order they were written. */
async function longTopic(w: World, conversationId: string, n = 120) {
  const start = Date.parse("2026-11-17T08:00:00.000Z");
  await db.chatMessage.createMany({
    data: Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(3, "0")}-${conversationId.slice(-6)}`, orgId: w.t.org.id, conversationId, authorId: i % 2 ? w.b.id : w.t.member.id, body: `line ${i}`, createdAt: new Date(start + i * 1000) })),
  });
  return Array.from({ length: n }, (_, i) => `m${String(i).padStart(3, "0")}-${conversationId.slice(-6)}`);
}

describe("windows of a long conversation", () => {
  it("the newest window first, then back through `before` to the very first message: every message once, in order, no jump", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id);
    const first = await page(w.t.member.id, w.topic.id, "limit=50");
    expect(first.status).toBe(200);
    expect(ids(first)).toEqual(all.slice(70));
    expect(first.dto).toMatchObject({ hasOlder: true, hasNewer: false });
    const seen: string[] = [...ids(first)];
    let cursor = seen[0]!;
    for (let guard = 0; guard < 10; guard++) {
      const older = await page(w.t.member.id, w.topic.id, `before=${cursor}&limit=50`);
      expect(older.dto.hasNewer).toBe(true);
      seen.unshift(...ids(older));
      if (!older.dto.hasOlder) break;
      cursor = ids(older)[0]!;
    }
    expect(seen).toEqual(all);
  });

  it("`after` walks forward the same way and says when it reaches the newest", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id);
    const seen: string[] = [];
    let cursor = all[19]!;
    let last = { hasNewer: true, hasOlder: false };
    for (let guard = 0; guard < 10 && last.hasNewer; guard++) {
      const newer = await page(w.t.member.id, w.topic.id, `after=${cursor}&limit=40`);
      expect(newer.dto.hasOlder).toBe(true);
      seen.push(...ids(newer));
      last = newer.dto;
      cursor = ids(newer).at(-1)!;
    }
    expect(seen).toEqual(all.slice(20));
    expect(last.hasNewer).toBe(false);
  });

  it("`around` a message: it, older ones and newer ones, with the right flags at both ends", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id);
    const mid = await page(w.t.member.id, w.topic.id, `around=${all[60]}&limit=20`);
    expect(ids(mid)).toEqual(all.slice(51, 71)); // 10 older + itself, 10 newer
    expect(ids(mid)).toContain(all[60]);
    expect(mid.dto).toMatchObject({ hasOlder: true, hasNewer: true });
    const top = await page(w.t.member.id, w.topic.id, `around=${all[2]}&limit=20`);
    expect(ids(top)[0]).toBe(all[0]);
    expect(top.dto.hasOlder).toBe(false);
    expect(top.dto.hasNewer).toBe(true);
    const bottom = await page(w.t.member.id, w.topic.id, `around=${all[118]}&limit=20`);
    expect(ids(bottom).at(-1)).toBe(all[119]);
    expect(bottom.dto.hasNewer).toBe(false);
  });

  it("messages written in the same instant are neither skipped nor shown twice at a window boundary, in either direction (F0.8)", async () => {
    const w = await world();
    const at = new Date("2026-11-17T11:00:00.000Z");
    const tie = ["t0", "t1", "t2", "t3", "t4", "t5", "t6"].map((x) => `${x}-${w.topic.id.slice(-6)}`);
    await db.chatMessage.createMany({ data: tie.map((id) => ({ id, orgId: w.t.org.id, conversationId: w.topic.id, authorId: w.b.id, body: id, createdAt: at })) });
    const back: string[] = [];
    let cursor = "";
    for (let guard = 0; guard < 10; guard++) {
      const got = await page(w.t.member.id, w.topic.id, `limit=2${cursor ? `&before=${cursor}` : ""}`);
      if (!got.dto.messages.length) break;
      // stop where this topic's earlier fixtures begin
      const inTie = ids(got).filter((i) => tie.includes(i));
      back.unshift(...inTie);
      if (inTie.length < ids(got).length) break;
      cursor = ids(got)[0]!;
    }
    expect(back).toEqual(tie);
    const fwd: string[] = [];
    let after = tie[0]!;
    fwd.push(after);
    for (let guard = 0; guard < 10; guard++) {
      const got = await page(w.t.member.id, w.topic.id, `after=${after}&limit=2`);
      fwd.push(...ids(got));
      if (!got.dto.hasNewer) break;
      after = ids(got).at(-1)!;
    }
    expect(fwd).toEqual(tie);
  });

  it("a window is at most 50 (more is refused, as on the old route); a cursor that is not in this conversation is «not found»; two cursors at once is refused", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id, 60);
    expect((await page(w.t.member.id, w.topic.id, "limit=50")).dto.messages).toHaveLength(50);
    expect((await page(w.t.member.id, w.topic.id, "limit=51")).status).toBe(422);
    expect((await page(w.t.member.id, w.topic.id, "limit=0")).status).toBe(422);
    expect((await page(w.t.member.id, w.topic.id, "before=nope")).status).toBe(404);
    // an anchor from ANOTHER conversation is not an anchor here (nobody learns a message of a conversation they cannot read by asking around it)
    const stray = await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: w.restricted.id, authorId: w.b.id, body: "elsewhere" } });
    expect((await page(w.t.member.id, w.topic.id, `around=${stray.id}`)).status).toBe(404);
    const two = await page(w.t.member.id, w.topic.id, `before=${all[10]}&after=${all[5]}`);
    expect(two.status).toBe(422);
    expect(JSON.stringify(two.json)).toContain("chat.e.page_one_cursor");
  });
});

describe("what a window tells about reading", () => {
  it("firstUnreadId is the oldest message after my read mark that is not mine, not deleted and not a system line; null with no mark", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id, 10);
    await db.chatMessage.update({ where: { id: all[5] }, data: { deletedAt: new Date() } }); // deleted: skipped
    await db.chatMessage.update({ where: { id: all[4] }, data: { kind: "SYSTEM", body: JSON.stringify({ k: "join" }) } }); // a system line: skipped
    // authors alternate (even: member, odd: Bee): after message 3 the next not-mine non-deleted non-system one is 7 (6 is mine, 4 is a system line, 5 is deleted)
    await db.conversationMember.create({ data: { conversationId: w.topic.id, userId: w.t.member.id, lastReadAt: new Date(Date.parse("2026-11-17T08:00:00.000Z") + 3500) } });
    expect((await page(w.t.member.id, w.topic.id)).dto.firstUnreadId).toBe(all[7]);
    // Bee has no read mark here: nothing to land on
    expect((await page(w.b.id, w.topic.id)).dto.firstUnreadId).toBeNull();
    // read everything: null
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.t.member.id } }, data: { lastReadAt: new Date() } });
    expect((await page(w.t.member.id, w.topic.id)).dto.firstUnreadId).toBeNull();
  });

  it("each person's avatar sits under the last message of the window they read (the owner's silent reading never shows)", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id, 10);
    await db.conversationMember.createMany({
      data: [
        { conversationId: w.topic.id, userId: w.b.id, lastReadAt: new Date(Date.parse("2026-11-17T08:00:00.000Z") + 6500) },
        { conversationId: w.topic.id, userId: w.t.owner.id, lastReadAt: new Date() },
      ],
    });
    const got = await page(w.t.member.id, w.topic.id);
    expect(got.dto.readers).toEqual([expect.objectContaining({ userId: w.b.id, messageId: all[6], name: "Bee" })]);
  });
});

describe("it is the presenter's answer, so the privacy of the old screen holds", () => {
  it("a deleted message is a tombstone: no text for anybody here, its original only for the silent eye", async () => {
    const w = await world();
    const all = await longTopic(w, w.topic.id, 5);
    await db.chatMessage.update({ where: { id: all[3] }, data: { deletedAt: new Date(), deletedById: w.b.id, body: "السرّ القديم" } });
    const asMember = await page(w.t.member.id, w.topic.id);
    const gone = asMember.dto.messages.find((m: MessageDto) => m.id === all[3])!;
    expect(gone).toMatchObject({ deleted: true, body: null });
    expect(gone.original).toBeUndefined();
    expect(JSON.stringify(asMember.json)).not.toContain("السرّ القديم");
    const asGuest = await page(w.t.guest.id, w.topic.id);
    expect(JSON.stringify(asGuest.json)).not.toContain("السرّ القديم");
    const asOwner = await page(w.t.owner.id, w.topic.id);
    expect(asOwner.dto.messages.find((m) => m.id === all[3])?.original?.body).toBe("السرّ القديم");
  });

  it("the same messages as the old detail, byte for byte (the split changed nothing the screen shows)", async () => {
    const w = await world();
    await longTopic(w, w.topic.id, 30);
    for (const who of [w.t.member, w.t.guest, w.t.owner]) {
      await loginAs(who.id);
      const old = await call(detailRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}?limit=20`, params: { id: w.topic.id } });
      const fresh = await page(who.id, w.topic.id, "limit=20");
      expect(JSON.stringify(fresh.dto.messages)).toBe(JSON.stringify((old.json as { messages: unknown[] }).messages));
    }
  });

  it("not readable → 404 (a restricted topic I am not in, a conversation of another company); a guest has topics only", async () => {
    const w = await world();
    expect((await page(w.t.member.id, w.restricted.id)).status).toBe(404);
    expect((await page(w.outsider.id, w.restricted.id)).status).toBe(404);
    const other = await makeTeam();
    expect((await page(other.owner.id, w.topic.id)).status).toBe(404);
    const dm = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "DM", spaceId: w.space.id, members: { create: [{ userId: w.t.member.id }, { userId: w.b.id }] }, dmKey: `${[w.t.member.id, w.b.id].sort().join("|")}@${w.space.id}` } });
    expect((await page(w.t.guest.id, dm.id)).status).toBe(404);
    // the silent eye reads a restricted topic's window
    expect((await page(w.t.owner.id, w.restricted.id)).status).toBe(200);
  });

  it("POST on the same file still sends a message (C1.8 edits it later)", async () => {
    const w = await world();
    await loginAs(w.t.member.id);
    const sent = await call(messagesRoute.POST, { url: "http://localhost/api/x", params: { id: w.topic.id }, body: { body: "hello from the same file" } });
    expect(sent.status).toBe(201);
    expect((await page(w.b.id, w.topic.id, "limit=1")).dto.messages[0]?.body).toBe("hello from the same file");
  });
});

describe("the client's URL builders", () => {
  it("one place builds every URL of the new endpoints; the old detail URL is untouched", () => {
    expect(conversationDetailUrl("a b", "m1")).toBe("/api/chat/conversations/a%20b?limit=40&before=m1");
    expect(conversationMessagesUrl("c1")).toBe("/api/chat/conversations/c1/messages?limit=50");
    expect(conversationMessagesUrl("c1", { before: "m9", limit: 20 })).toBe("/api/chat/conversations/c1/messages?limit=20&before=m9");
    expect(conversationMessagesUrl("c1", { around: "m9" })).toBe("/api/chat/conversations/c1/messages?limit=50&around=m9");
    expect(conversationMessagesUrl("c1", { after: "m9" })).toBe("/api/chat/conversations/c1/messages?limit=50&after=m9");
    expect(conversationHeaderUrl("c1")).toBe("/api/chat/conversations/c1/header");
    expect(chatListUrl()).toBe("/api/chat/list");
    expect(chatListUrl("s1")).toBe("/api/chat/list?spaceId=s1");
    expect(spaceTopicsUrl("s 1")).toBe("/api/chat/spaces/s%201/topics");
    expect(chatSyncUrl()).toBe("/api/chat/sync");
    expect(chatSyncUrl("123")).toBe("/api/chat/sync?after=123");
    expect(chatSyncUrl("123", 100)).toBe("/api/chat/sync?after=123&limit=100");
  });
});
