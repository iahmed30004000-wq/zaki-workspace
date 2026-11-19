/**
 * C3c.3 — «جدول الإرسال» (scheduled messages), against a real database.
 *
 *  - a message scheduled for later is NOT a message until its time: no ChatMessage row exists, no reader (the window, the list, the search, the sync feed) shows it
 *  - the job sends it at its time, as its author, through the normal send (the words, the mentions, the silent flag, the files arrive)
 *  - the permission is checked AGAIN at send time: a person who lost access (left the space, the topic was closed, the other person of the DM went) sends nothing:
 *    the row is FAILED, no message exists, and the author gets a bell note that carries no word of the message
 *  - «احذف» cancels (its words are blanked), «عدّل» changes the words and the time, «ابعت هلّق» sends now; none of them works on a row that is no longer waiting
 *  - nobody but the author reads, edits, cancels or sends a row; the silent eye cannot schedule; a guest follows the posting rules
 *  - the window: at least a minute, at most 365 days; a file's own 24 hours
 *  - the switch `chatScheduled`: off, the routes answer 404 and the job leaves the rows alone; on again, they go out
 *  - the job is idempotent: two runs at once, a run after a crash between the send and the mark, a retried request: ONE message
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import * as scheduleRoute from "@/app/api/chat/conversations/[id]/scheduled/route";
import * as oneRoute from "@/app/api/chat/scheduled/[id]/route";
import * as sendNowRoute from "@/app/api/chat/scheduled/[id]/send/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { chatList } from "@/server/chat/list";
import { searchChat } from "@/server/chat/search";
import { syncFeed } from "@/server/chat/sync";
import { createScheduled, MAX_LATE_MS, messageClientIdOf, SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MS } from "@/server/chat/scheduled";
import { runChatScheduled } from "@/server/jobs/chat-scheduled";
import { withFeature } from "@/lib/features";
import { setLinkPreviewDepsForTests } from "@/server/chat/link-preview";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";

// the job reads every company's rows (it is not a request): each test starts with the table empty, so a row left by another test is never «due» in this one
beforeEach(async () => {
  await db.scheduledChatMessage.deleteMany({});
});

const WORD = "نصمجدولسري";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function world() {
  resetPresenceForTests();
  const t = await makeTeam();
  const author = t.member;
  const peer = t.admin;
  const ws = await makeWorkspace(t.org.id, [{ userId: author.id }, { userId: peer.id, role: "ADMIN" }, { userId: t.guest.id }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  const dm = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", members: { create: [{ userId: author.id }, { userId: peer.id }] } } });
  return { t, author, peer, ws, topic: topic.id, dm: dm.id, orgId: t.org.id };
}
type World = Awaited<ReturnType<typeof world>>;

const at = (offsetMs: number, base = Date.now()) => new Date(base + offsetMs).toISOString();

async function schedule(w: World, who: { id: string }, conversationId: string, body: Record<string, unknown>) {
  await loginAs(who.id);
  return call(scheduleRoute.POST, { method: "POST", params: { id: conversationId }, body });
}
async function list(w: World, who: { id: string }, conversationId: string) {
  await loginAs(who.id);
  return call(scheduleRoute.GET, { method: "GET", params: { id: conversationId } });
}
async function one(who: { id: string }, method: "PATCH" | "DELETE", id: string, body?: Record<string, unknown>) {
  await loginAs(who.id);
  return call(method === "PATCH" ? oneRoute.PATCH : oneRoute.DELETE, { method, params: { id }, ...(body ? { body } : {}) });
}
async function now(who: { id: string }, id: string) {
  await loginAs(who.id);
  return call(sendNowRoute.POST, { method: "POST", params: { id } });
}
const rowOf = (id: string) => db.scheduledChatMessage.findUniqueOrThrow({ where: { id } });
const messagesBy = (authorId: string, conversationId: string) => db.chatMessage.findMany({ where: { authorId, conversationId, kind: "TEXT" }, orderBy: { createdAt: "asc" } });
const notes = (userId: string) => db.notification.findMany({ where: { userId, type: "chat_scheduled_failed" } });
const ctxOf = (w: World, userId: string, orgRole: "MEMBER" | "ADMIN" | "OWNER" | "GUEST" = "MEMBER") => ({ orgId: w.orgId, orgRole, userId });

async function setSwitch(orgId: string, on: boolean, key: "chatScheduled" | "chatLayoutV2" = "chatScheduled") {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

/** A chat upload row the way `createChatUpload` leaves it. */
async function makeUpload(orgId: string, uploaderId: string, createdAt?: Date) {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...randomBytes(4)]);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), bytes);
  return db.storedFile.create({
    data: { id, orgId, uploaderId, familyId: id, name: "photo.png", mimeType: "image/png", size: bytes.length, path: id, purpose: "CHAT", ...(createdAt ? { createdAt } : {}) },
  });
}

describe("a scheduled message is not a message until its time", () => {
  it("scheduling makes a row of its own, and no message: the window, the list, the search and the sync feed never show it", async () => {
    const w = await world();
    const before = (await syncFeed(ctxOf(w, w.peer.id, "ADMIN"))).cursor;
    const res = await schedule(w, w.author, w.topic, { body: `${WORD} 1`, sendAt: at(10 * MIN), clientId: "c-1" });
    expect(res.status).toBe(201);
    expect(res.json?.["status"]).toBe("PENDING");
    expect(await db.chatMessage.count({ where: { body: { contains: WORD } } })).toBe(0);
    // every reader, as the peer (who may read the topic) and as the author
    for (const who of [w.peer, w.author]) {
      await loginAs(who.id);
      const window = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic}/messages`, params: { id: w.topic } });
      expect(window.status).toBe(200);
      expect(window.text).not.toContain(WORD);
      const c = ctxOf(w, who.id, who.id === w.peer.id ? "ADMIN" : "MEMBER");
      expect(JSON.stringify(await chatList(c))).not.toContain(WORD);
      expect(JSON.stringify(await searchChat(c, { id: w.ws.id, isHq: false }, WORD))).not.toContain(WORD);
      expect(JSON.stringify(await syncFeed(c, { after: BigInt(before) }))).not.toContain(WORD);
    }
  });

  it("the job sends it at its time, as its author, and not a minute before", async () => {
    const w = await world();
    const base = Date.now();
    const res = await schedule(w, w.author, w.topic, { body: ` ${WORD} 2 `, sendAt: at(10 * MIN, base), mentions: [w.peer.id], silent: true });
    const id = res.json?.["id"] as string;
    expect((await runChatScheduled(new Date(base + 9 * MIN))).sent).toBe(0);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
    expect((await rowOf(id)).status).toBe("PENDING");

    const run = await runChatScheduled(new Date(base + 10 * MIN + 1000));
    expect(run.sent).toBe(1);
    const sent = await messagesBy(w.author.id, w.topic);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe(`${WORD} 2`);
    expect(sent[0]!.mentions).toEqual([w.peer.id]);
    expect(sent[0]!.silent).toBe(true);
    expect(sent[0]!.clientId).toBe(messageClientIdOf(id));
    const row = await rowOf(id);
    expect(row.status).toBe("SENT");
    expect(row.messageId).toBe(sent[0]!.id);
    // the words of a finished row are not kept twice
    expect(row.body).toBe("");
    // and from then on it is an ordinary message that the readers show
    await loginAs(w.peer.id);
    expect((await call(messagesRoute.GET, { url: "http://localhost/x", params: { id: w.topic } })).text).toContain(WORD);
  });

  it("a DM works the same way, and «@الكل» travels with the row", async () => {
    const w = await world();
    const base = Date.now();
    const dm = await schedule(w, w.author, w.dm, { body: `${WORD} dm`, sendAt: at(2 * MIN, base) });
    expect(dm.status).toBe(201);
    const all = await schedule(w, w.author, w.topic, { body: `@الكل ${WORD}`, mentionAll: true, sendAt: at(2 * MIN, base) });
    expect(all.status).toBe(201);
    expect(all.json?.["mentionAll"]).toBe(true);
    expect((await runChatScheduled(new Date(base + 3 * MIN))).sent).toBe(2);
    expect(await messagesBy(w.author.id, w.dm)).toHaveLength(1);
    expect((await messagesBy(w.author.id, w.topic))[0]!.mentions).toContain("*");
  });
});

describe("the permission is checked again when the time comes", () => {
  it("a person who left the space sends nothing: FAILED, no message, and a note to themselves with no word of the message", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 3`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.author.id } });
    const run = await runChatScheduled(new Date(base + 6 * MIN));
    expect(run.failed).toBe(1);
    expect(run.sent).toBe(0);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic, authorId: w.author.id } })).toBe(0);
    const row = await rowOf(id);
    expect(row.status).toBe("FAILED");
    expect(row.failReason).toBeTruthy();
    const told = await notes(w.author.id);
    expect(told).toHaveLength(1);
    expect(JSON.stringify(told)).not.toContain(WORD);
    expect(told[0]!.linkUrl).toBeNull();
    // another run does not try again, and does not tell twice
    expect((await runChatScheduled(new Date(base + 7 * MIN))).failed).toBe(0);
    expect(await notes(w.author.id)).toHaveLength(1);
  });

  it("a topic that was closed meanwhile takes nothing", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 4`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await db.conversation.update({ where: { id: w.topic }, data: { closedAt: new Date() } });
    expect((await runChatScheduled(new Date(base + 6 * MIN))).failed).toBe(1);
    expect((await rowOf(id)).status).toBe("FAILED");
    expect(await db.chatMessage.count({ where: { conversationId: w.topic, authorId: w.author.id } })).toBe(0);
  });

  it("a DM whose other person is gone takes nothing", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.dm, { body: `${WORD} 5`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.peer.id }, data: { status: "SUSPENDED" } });
    expect((await runChatScheduled(new Date(base + 6 * MIN))).failed).toBe(1);
    expect((await rowOf(id)).status).toBe("FAILED");
    expect(await messagesBy(w.author.id, w.dm)).toHaveLength(0);
  });

  it("a person who was suspended from the company sends nothing (and is not messaged: a suspended person gets no notification)", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 6`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.author.id }, data: { status: "SUSPENDED" } });
    expect((await runChatScheduled(new Date(base + 6 * MIN))).failed).toBe(1);
    expect((await rowOf(id)).status).toBe("FAILED");
    expect(await db.chatMessage.count({ where: { conversationId: w.topic, authorId: w.author.id } })).toBe(0);
  });

  it("a row that is more than a day late when the job reaches it is not sent (the app was down)", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 7`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    const run = await runChatScheduled(new Date(base + 5 * MIN + MAX_LATE_MS + MIN));
    expect(run.failed).toBe(1);
    expect((await rowOf(id)).failReason).toBe("chat.sched.e.too_late");
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
    expect(await notes(w.author.id)).toHaveLength(1);
  });

  it("a person who may still write but whose files are gone is told, and nothing is half-sent", async () => {
    const w = await world();
    const base = Date.now();
    const file = await makeUpload(w.orgId, w.author.id);
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 8`, attachmentIds: [file.id], sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await db.storedFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    expect((await runChatScheduled(new Date(base + 6 * MIN))).failed).toBe(1);
    expect((await rowOf(id)).status).toBe("FAILED");
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
  });
});

describe("cancel, edit and send now", () => {
  it("«احذف» cancels the row and blanks its words; the job sends nothing; cancelling again is fine", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 9`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    expect((await one(w.author, "DELETE", id)).status).toBe(200);
    const row = await rowOf(id);
    expect(row.status).toBe("CANCELLED");
    expect(row.body).toBe("");
    expect((await runChatScheduled(new Date(base + 6 * MIN))).sent).toBe(0);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
    expect((await one(w.author, "DELETE", id)).status).toBe(200);
    // a cancelled row is no longer listed
    expect((await list(w, w.author, w.topic)).json?.["items"]).toEqual([]);
  });

  it("a row that was already sent cannot be cancelled, edited or sent again", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 10`, sendAt: at(2 * MIN, base) })).json?.["id"] as string;
    await runChatScheduled(new Date(base + 3 * MIN));
    expect((await one(w.author, "DELETE", id)).status).toBe(422);
    expect((await one(w.author, "PATCH", id, { body: "x" })).status).toBe(422);
    expect((await now(w.author, id)).status).toBe(422);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
  });

  it("«عدّل» changes the words, the moment and the mentions; the job sends the edited message at the new time", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} old`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    const edited = await one(w.author, "PATCH", id, { body: `${WORD} new`, sendAt: at(20 * MIN, base), mentions: [w.peer.id] });
    expect(edited.status).toBe(200);
    expect(edited.json?.["body"]).toBe(`${WORD} new`);
    expect((await runChatScheduled(new Date(base + 6 * MIN))).sent).toBe(0);
    expect((await runChatScheduled(new Date(base + 21 * MIN))).sent).toBe(1);
    const sent = await messagesBy(w.author.id, w.topic);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe(`${WORD} new`);
    expect(sent[0]!.mentions).toEqual([w.peer.id]);
  });

  it("an edit holds the same window and cannot empty the message", async () => {
    const w = await world();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 11`, sendAt: at(5 * MIN) })).json?.["id"] as string;
    expect((await one(w.author, "PATCH", id, { sendAt: at(20_000) })).status).toBe(422);
    expect((await one(w.author, "PATCH", id, { sendAt: at(400 * DAY) })).status).toBe(422);
    expect((await one(w.author, "PATCH", id, { body: "   " })).status).toBe(422);
    expect((await one(w.author, "PATCH", id, {})).status).toBe(422);
    expect((await rowOf(id)).body).toBe(`${WORD} 11`);
  });

  it("«ابعت هلّق» sends the row now, once; the job later finds nothing to do", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 12`, sendAt: at(30 * MIN, base) })).json?.["id"] as string;
    const res = await now(w.author, id);
    expect(res.status).toBe(200);
    expect((res.json?.["message"] as { body?: string } | null)?.body).toBe(`${WORD} 12`);
    expect((await rowOf(id)).status).toBe("SENT");
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
    expect((await now(w.author, id)).status).toBe(422);
    expect((await runChatScheduled(new Date(base + 40 * MIN))).sent).toBe(0);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
  });

  it("«ابعت هلّق» by a person who may no longer write is refused and leaves the row as it was", async () => {
    const w = await world();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 13`, sendAt: at(30 * MIN) })).json?.["id"] as string;
    await db.conversation.update({ where: { id: w.topic }, data: { closedAt: new Date() } });
    expect((await now(w.author, id)).status).toBe(403);
    expect((await rowOf(id)).status).toBe("PENDING");
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
  });
});

describe("only the author", () => {
  it("another person cannot read, edit, cancel or send the row (404), and the owner's eyes do not see it either", async () => {
    const w = await world();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 14`, sendAt: at(30 * MIN) })).json?.["id"] as string;
    for (const who of [w.peer, w.t.owner, w.t.guest]) {
      const listed = await list(w, who, w.topic);
      expect(listed.text).not.toContain(WORD);
      expect(listed.status === 200 ? listed.json?.["items"] : []).toEqual([]);
      for (const res of [await one(who, "PATCH", id, { body: "hijack" }), await one(who, "DELETE", id), await now(who, id)]) {
        expect(res.status).toBe(404);
        expect(res.text).not.toContain(WORD);
      }
    }
    const row = await rowOf(id);
    expect(row.status).toBe("PENDING");
    expect(row.body).toBe(`${WORD} 14`);
    expect((await list(w, w.author, w.topic)).json?.["items"]).toHaveLength(1);
  });

  it("the silent eye (the owner, who has not joined) cannot schedule; a row is not made", async () => {
    const w = await world();
    const res = await schedule(w, w.t.owner, w.topic, { body: `${WORD} 15`, sendAt: at(30 * MIN) });
    expect(res.status).toBe(403);
    expect(await db.scheduledChatMessage.count({ where: { authorId: w.t.owner.id } })).toBe(0);
  });

  it("a person who may not read the conversation gets «not found» and no row is made", async () => {
    const w = await world();
    const other = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", members: { create: [{ userId: w.peer.id }, { userId: w.t.owner.id }] } } });
    const res = await schedule(w, w.author, other.id, { body: `${WORD} 16`, sendAt: at(30 * MIN) });
    expect(res.status).toBe(404);
    expect(await db.scheduledChatMessage.count({ where: { authorId: w.author.id } })).toBe(0);
    expect((await list(w, w.author, other.id)).status).toBe(404);
  });

  it("a guest schedules where a guest may post (a topic) and not where a guest may not (a DM)", async () => {
    const w = await world();
    expect((await schedule(w, w.t.guest, w.topic, { body: `${WORD} g`, sendAt: at(30 * MIN) })).status).toBe(201);
    const dm = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", members: { create: [{ userId: w.t.guest.id }, { userId: w.peer.id }] } } });
    expect([403, 404]).toContain((await schedule(w, w.t.guest, dm.id, { body: `${WORD} g2`, sendAt: at(30 * MIN) })).status);
  });
});

describe("the ✕ on a link's card", () => {
  it("noPreview is kept on the row and honoured when it is sent: the server never visits the link; without it the link IS visited", async () => {
    const w = await world();
    await setSwitch(w.orgId, true, "chatLayoutV2");
    const visits: string[] = [];
    setLinkPreviewDepsForTests({
      timeoutMs: 3_000,
      resolve: async () => ["93.184.216.34"],
      fetch: (async (input: RequestInfo | URL) => {
        visits.push(String(input));
        return new Response("<html><head><meta property=\"og:title\" content=\"t\"></head></html>", { status: 200, headers: { "content-type": "text/html" } });
      }) as typeof fetch,
    });
    try {
      const base = Date.now();
      const off = await schedule(w, w.author, w.topic, { body: "https://news.example.com/off", noPreview: true, sendAt: at(5 * MIN, base) });
      expect(off.json?.["noPreview"]).toBe(true);
      expect((await runChatScheduled(new Date(base + 6 * MIN))).sent).toBe(1);
      expect(visits).toEqual([]);
      const on = await schedule(w, w.author, w.topic, { body: "https://news.example.com/on", sendAt: at(5 * MIN, base) });
      expect(on.json?.["noPreview"]).toBe(false);
      expect((await runChatScheduled(new Date(base + 6 * MIN))).sent).toBe(1);
      expect(visits.length).toBeGreaterThan(0);
    } finally {
      setLinkPreviewDepsForTests(undefined);
    }
  });
});

describe("the window and the files", () => {
  it("at least a minute ahead, at most 365 days: both edges are in, one millisecond beyond is out", async () => {
    const w = await world();
    const base = Date.now();
    const ctx = ctxOf(w, w.author.id);
    const make = (offset: number, key: string) => createScheduled(ctx, w.topic, { body: `${WORD} ${key}`, sendAt: new Date(base + offset).toISOString() }, new Date(base));
    await expect(make(SCHEDULE_MIN_LEAD_MS, "a")).resolves.toMatchObject({ status: "PENDING" });
    await expect(make(SCHEDULE_MIN_LEAD_MS - 1, "b")).rejects.toThrow();
    await expect(make(SCHEDULE_MAX_DAYS * DAY, "c")).resolves.toMatchObject({ status: "PENDING" });
    await expect(make(SCHEDULE_MAX_DAYS * DAY + 1, "d")).rejects.toThrow();
    await expect(make(-MIN, "e")).rejects.toThrow();
    // through the route
    expect((await schedule(w, w.author, w.topic, { body: "x", sendAt: at(10_000) })).status).toBe(422);
    expect((await schedule(w, w.author, w.topic, { body: "x", sendAt: "not a time" })).status).toBe(422);
    expect((await schedule(w, w.author, w.topic, { body: "   ", sendAt: at(10 * MIN) })).status).toBe(422);
  });

  it("a file is the author's, unattached, held by one row at a time, and the row must go out inside the file's 24 hours", async () => {
    const w = await world();
    const base = Date.now();
    const mine = await makeUpload(w.orgId, w.author.id);
    const theirs = await makeUpload(w.orgId, w.peer.id);
    expect((await schedule(w, w.author, w.topic, { body: "x", attachmentIds: [theirs.id], sendAt: at(5 * MIN, base) })).status).toBe(404);
    // too far for a file that lives a day
    const far = await schedule(w, w.author, w.topic, { body: "x", attachmentIds: [mine.id], sendAt: at(2 * DAY, base) });
    expect(far.status).toBe(422);
    expect(far.text).toContain("chat.sched.e.files_window");
    const first = await schedule(w, w.author, w.topic, { attachmentIds: [mine.id], sendAt: at(5 * MIN, base) });
    expect(first.status).toBe(201);
    // the same file in a second row is refused
    expect((await schedule(w, w.author, w.topic, { body: "y", attachmentIds: [mine.id], sendAt: at(6 * MIN, base) })).status).toBe(403);
    // at its time the file goes with the message
    expect((await runChatScheduled(new Date(base + 6 * MIN))).sent).toBe(1);
    const sent = await db.chatMessage.findFirstOrThrow({ where: { authorId: w.author.id, conversationId: w.topic }, include: { attachments: true } });
    expect(sent.attachments.map((a) => a.fileId)).toEqual([mine.id]);
    // an attached file cannot be scheduled again
    expect((await schedule(w, w.author, w.topic, { body: "z", attachmentIds: [mine.id], sendAt: at(5 * MIN, base) })).status).toBe(403);
  });
});

describe("the creation quota counts rows that were really made", () => {
  it("a person who keeps getting a refusal (a time too soon) is not locked out: the valid request after thirty-five refusals still works", async () => {
    const w = await world();
    for (let i = 0; i < 35; i++) expect((await schedule(w, w.author, w.topic, { body: "x", sendAt: at(10_000) })).status).toBe(422);
    expect((await schedule(w, w.author, w.topic, { body: "x", sendAt: at(10 * MIN) })).status).toBe(201);
  });
});

describe("the switch chatScheduled", () => {
  it("off: every route answers 404 and the job leaves the rows alone (they stay in the data); on again: they go out", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 17`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await setSwitch(w.orgId, false);
    expect((await schedule(w, w.author, w.topic, { body: "x", sendAt: at(30 * MIN) })).status).toBe(404);
    expect((await list(w, w.author, w.topic)).status).toBe(404);
    expect((await one(w.author, "PATCH", id, { body: "x" })).status).toBe(404);
    expect((await one(w.author, "DELETE", id)).status).toBe(404);
    expect((await now(w.author, id)).status).toBe(404);
    expect(await runChatScheduled(new Date(base + 10 * MIN))).toMatchObject({ sent: 0, failed: 0 });
    expect((await rowOf(id)).status).toBe("PENDING");
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
    await setSwitch(w.orgId, true);
    expect((await runChatScheduled(new Date(base + 10 * MIN))).sent).toBe(1);
  });

  it("another company's switch does not hold this company's rows", async () => {
    const w = await world();
    const w2 = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 18`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await setSwitch(w2.orgId, false);
    expect((await runChatScheduled(new Date(base + 10 * MIN))).sent).toBe(1);
    expect((await rowOf(id)).status).toBe("SENT");
  });
});

describe("the job never sends twice", () => {
  it("two runs at the same moment: one message", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 19`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    const later = new Date(base + 6 * MIN);
    const [a, b] = await Promise.all([runChatScheduled(later), runChatScheduled(later)]);
    expect(a.sent + b.sent).toBe(1);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
    expect((await rowOf(id)).status).toBe("SENT");
    // and a third, later run has nothing
    expect((await runChatScheduled(new Date(base + 7 * MIN))).sent).toBe(0);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
  });

  it("a run, and «ابعت هلّق» at the same moment: one message", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 20`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await Promise.all([runChatScheduled(new Date(base + 6 * MIN)), now(w.author, id)]);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
    expect((await rowOf(id)).status).toBe("SENT");
  });

  it("a crash between the send and the mark: the message exists, the row is still PENDING; the next run only marks it (no second message, and not FAILED even if the person lost access meanwhile)", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 21`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    const made = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.author.id, body: `${WORD} 21`, clientId: messageClientIdOf(id) } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.author.id } });
    const run = await runChatScheduled(new Date(base + 6 * MIN));
    expect(run.sent).toBe(1);
    expect(run.failed).toBe(0);
    const row = await rowOf(id);
    expect(row.status).toBe("SENT");
    expect(row.messageId).toBe(made.id);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(1);
  });

  it("the same request twice (a lost answer) is one row; the same id used for another conversation is refused", async () => {
    const w = await world();
    const a = await schedule(w, w.author, w.topic, { body: `${WORD} 22`, sendAt: at(5 * MIN), clientId: "same-1" });
    const b = await schedule(w, w.author, w.topic, { body: `${WORD} 22`, sendAt: at(5 * MIN), clientId: "same-1" });
    expect(a.status).toBe(201);
    expect(b.json?.["id"]).toBe(a.json?.["id"]);
    expect(await db.scheduledChatMessage.count({ where: { authorId: w.author.id } })).toBe(1);
    expect((await schedule(w, w.author, w.dm, { body: "x", sendAt: at(5 * MIN), clientId: "same-1" })).status).toBe(422);
  });

  it("a message with this row's clientId in ANOTHER conversation is not this row's message: the row FAILS (not marked sent), keeps its words, and nothing is sent here", async () => {
    const w = await world();
    const base = Date.now();
    const id = (await schedule(w, w.author, w.topic, { body: `${WORD} 23`, sendAt: at(5 * MIN, base) })).json?.["id"] as string;
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.dm, authorId: w.author.id, body: "elsewhere", clientId: messageClientIdOf(id) } });
    await runChatScheduled(new Date(base + 6 * MIN));
    const row = await rowOf(id);
    expect(row.status).toBe("FAILED");
    expect(row.messageId).toBeNull();
    expect(row.body).toBe(`${WORD} 23`);
    expect(await messagesBy(w.author.id, w.topic)).toHaveLength(0);
  });

  it("finished rows older than a month are removed; a waiting row is never touched", async () => {
    const w = await world();
    const old = new Date(Date.now() - 40 * DAY);
    const done = await db.scheduledChatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.author.id, body: "", sendAt: old, status: "SENT", clientId: "old-1" } });
    const waiting = await db.scheduledChatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.author.id, body: "w", sendAt: new Date(Date.now() + DAY), clientId: "old-2" } });
    const run = await runChatScheduled(new Date());
    expect(run.purged).toBeGreaterThanOrEqual(1);
    expect(await db.scheduledChatMessage.findUnique({ where: { id: done.id } })).toBeNull();
    expect(await db.scheduledChatMessage.findUnique({ where: { id: waiting.id } })).not.toBeNull();
  });
});
