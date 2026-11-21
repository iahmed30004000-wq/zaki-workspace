/**
 * S5.2 — the Telegram-like forward sheet, on the server: the picker's door (`GET /api/chat/forward-targets`: every space the person is in, only places they may WRITE in, their
 * saved chat on its own), the forward doors (the ORIGINAL author is kept on a re-forward, an optional comment is written after the copies, the receiver is NOTIFIED through the
 * send's own path, an archived target is refused) and the tap on the «محوّلة من» header (`GET /api/chat/messages/[id]/forward`: only when both ends are readable, never for a guest).
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as targetsRoute from "@/app/api/chat/forward-targets/route";
import * as forwardManyRoute from "@/app/api/chat/messages/forward/route";
import * as forwardOneRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { openDm, openSavedMessages } from "@/server/chat/dm";
import { resetPresenceForTests } from "@/server/realtime/presence";
import type { ForwardTargetsDto } from "@/lib/chat/forward";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Result = { targetId: string; ok: boolean; ids?: string[]; commentId?: string; error?: string };

async function world() {
  resetPresenceForTests(); // nobody has a live stream: everybody counts as offline
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member; // the person who forwards
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const c = await makeUser({ orgId, role: "MEMBER", name: "Cee" });
  const gone = await makeUser({ orgId, role: "MEMBER", name: "Gone" });
  const stranger = await makeUser({ orgId, role: "MEMBER", name: "Stranger" });
  const one = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: c.id }, { userId: gone.id }, { userId: t.guest.id, role: "GUEST" }], "Space One");
  const two = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }], "Space Two");
  const alone = await makeWorkspace(orgId, [{ userId: stranger.id }], "Space Alone");
  const topic = (spaceId: string, title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId, title, ...extra } });
  const open1 = await topic(one.id, "One open");
  const open2 = await topic(two.id, "Two open", { lastMessageAt: new Date() });
  const admins = await topic(one.id, "One admins only", { postingPolicy: "ADMINS" });
  const closed = await topic(one.id, "One closed", { closedAt: new Date() });
  const archived = await topic(one.id, "One archived", { archivedAt: new Date() });
  const announce = await topic(one.id, "One announce", { topicType: "ANNOUNCEMENTS" });
  const restricted = await topic(one.id, "One restricted", { restricted: true, members: { create: [{ userId: b.id }, { userId: c.id }] } });
  const mine = await topic(one.id, "One restricted mine", { restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } });
  const foreign = await topic(alone.id, "Alone topic");
  // the person's own chat with the assistant: a restricted topic they are a member of, whose key says so
  const assistant = await topic(one.id, "Assistant", { restricted: true, dmKey: `assistant|${a.id}@${one.id}`, members: { create: [{ userId: a.id }] } });
  await loginAs(a.id);
  const ctx = { orgId, orgRole: "MEMBER" as const, userId: a.id };
  const dmB = (await openDm(ctx, b.id, one.id)).id;
  const dmGone = (await openDm(ctx, gone.id, one.id)).id;
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: gone.id } }, data: { status: "OFFBOARDED" } });
  // another company with a space of its own: never listed
  const otherOrg = await makeOrg();
  const outsider = await makeUser({ orgId: otherOrg.id, role: "MEMBER", name: "Outsider" });
  const otherSpace = await makeWorkspace(otherOrg.id, [{ userId: outsider.id }]);
  const otherTopic = await db.conversation.create({ data: { orgId: otherOrg.id, kind: "TOPIC", spaceId: otherSpace.id, title: "Other company" } });
  return { ...t, orgId, a, b, c, gone, stranger, one, two, alone, open1, open2, admins, closed, archived, announce, restricted, mine, foreign, dmB, dmGone, otherTopic, assistant };
}
type World = Awaited<ReturnType<typeof world>>;
let w: World;
beforeAll(async () => {
  w = await world();
});

const setSwitch = (on: boolean | null, key = "chatMultiSelect") => db.organization.update({ where: { id: w.orgId }, data: { settings: on === null ? {} : { features: { [key]: on } } } });
const targets = async (userId: string) => {
  await loginAs(userId);
  const res = await call(targetsRoute.GET, { url: "http://localhost/api/chat/forward-targets" });
  expect(res.status).toBe(200);
  return res.json as unknown as ForwardTargetsDto;
};
const ids = (dto: ForwardTargetsDto) => dto.targets.map((x) => x.id);
let tick = 0;
async function written(conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) {
  tick += 1;
  return db.chatMessage.create({ data: { orgId: w.orgId, conversationId, authorId, body, createdAt: new Date(Date.now() - 3_600_000 + tick * 1000), ...extra } });
}
const forwardMany = (body: unknown) => call(forwardManyRoute.POST, { url: "http://localhost/api/chat/messages/forward", body });
const results = (res: { json: Record<string, unknown> | null }) => res.json?.["results"] as Result[];
const bell = (userId: string) => db.notification.findMany({ where: { userId, type: "chat_message" }, select: { title: true, body: true, linkUrl: true } });

describe("GET /api/chat/forward-targets — the picker", () => {
  it("lists the places I may write in in EVERY space I am in (not only one), and my private chats; each says which space it is in", async () => {
    const dto = await targets(w.a.id);
    expect(ids(dto)).toEqual(expect.arrayContaining([w.open1.id, w.open2.id, w.mine.id, w.dmB]));
    const two = dto.targets.find((x) => x.id === w.open2.id)!;
    expect(two).toMatchObject({ kind: "TOPIC", title: "Two open", spaceId: w.two.id, spaceName: "Space Two" });
    expect(dto.targets.find((x) => x.id === w.dmB)).toMatchObject({ kind: "DM", title: "Bee" });
  });

  it("never lists a restricted topic I am not in, a closed one, an archived one, an admins-only one, another space's I am not in, or another company's", async () => {
    const dto = await targets(w.a.id);
    for (const hidden of [w.restricted.id, w.closed.id, w.archived.id, w.admins.id, w.foreign.id, w.otherTopic.id]) expect(ids(dto)).not.toContain(hidden);
  });

  it("the person's chat with the assistant is not a place to forward to", async () => {
    expect(ids(await targets(w.a.id))).not.toContain(w.assistant.id);
  });

  it("a private chat whose other person left is not a place to write in", async () => {
    expect(ids(await targets(w.a.id))).not.toContain(w.dmGone);
  });

  it("a person who is in no space of mine sees none of mine, and a restricted topic only for the people in it", async () => {
    const dto = await targets(w.stranger.id);
    expect(ids(dto)).toEqual(expect.arrayContaining([w.foreign.id]));
    for (const hidden of [w.open1.id, w.open2.id, w.mine.id, w.dmB]) expect(ids(dto)).not.toContain(hidden);
    expect(ids(await targets(w.c.id))).toContain(w.restricted.id);
  });

  it("a guest: only the topics of the space she is in that she may write in (no announcements), no private chats, no saved chat", async () => {
    const dto = await targets(w.guest.id);
    expect(ids(dto)).toContain(w.open1.id);
    for (const hidden of [w.announce.id, w.open2.id, w.restricted.id, w.dmB]) expect(ids(dto)).not.toContain(hidden);
    expect(dto.targets.some((x) => x.kind === "DM" || x.kind === "GROUP")).toBe(false);
    expect(dto.saved).toBeNull();
  });

  it("a space admin may write in an admins-only topic; a person muted in a space has none of its topics", async () => {
    expect(ids(await targets(w.admin.id))).not.toContain(w.admins.id); // an org admin who is not in the space sees nothing of it
    await db.workspaceMember.create({ data: { workspaceId: w.one.id, userId: w.admin.id, role: "ADMIN" } });
    expect(ids(await targets(w.admin.id))).toContain(w.admins.id);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.two.id, userId: w.b.id } }, data: { mutedUntil: new Date(Date.now() + 3_600_000) } });
    expect(ids(await targets(w.b.id))).not.toContain(w.open2.id);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.two.id, userId: w.b.id } }, data: { mutedUntil: null } });
  });

  it("the saved chat comes on its own (`saved`), with no id until it exists; never among the targets", async () => {
    const before = await targets(w.b.id);
    expect(before.saved).toEqual({ id: null });
    const made = await openSavedMessages({ orgId: w.orgId, orgRole: "MEMBER", userId: w.b.id });
    const after = await targets(w.b.id);
    expect(after.saved).toEqual({ id: made.id });
    expect(ids(after)).not.toContain(made.id);
    await setSwitch(false, "savedMessages");
    expect((await targets(w.b.id)).saved).toBeNull();
    await setSwitch(null);
  });

  it("the recents are the newest conversations that have a message, and every one of them is on the list", async () => {
    const dto = await targets(w.a.id);
    expect(dto.recents).toContain(w.open2.id);
    for (const id of dto.recents) expect(ids(dto)).toContain(id);
  });

  it("the company's switch is the door's: off = 404; nobody signed in = 401", async () => {
    await setSwitch(false);
    await loginAs(w.a.id);
    expect((await call(targetsRoute.GET)).status).toBe(404);
    await setSwitch(null);
    logout();
    expect((await call(targetsRoute.GET)).status).toBe(401);
  });
});

describe("the ORIGINAL author is kept on a re-forward", () => {
  it("a forward of a forward points at the first message, so the header names its author and not the person who passed it on", async () => {
    // Cee wrote it; Member (a) passes it to Space Two; Bee passes THAT copy back into Space One
    const original = await written(w.open1.id, w.c.id, "original words");
    await loginAs(w.a.id);
    const first = results(await forwardMany({ messageIds: [original.id], targetIds: [w.open2.id] }))[0]!;
    const copy1 = await db.chatMessage.findUniqueOrThrow({ where: { id: first.ids![0]! } });
    expect(copy1.forwardedFromId).toBe(original.id);
    await loginAs(w.b.id);
    const second = results(await forwardMany({ messageIds: [copy1.id], targetIds: [w.open1.id] }))[0]!;
    expect(second.ok).toBe(true);
    const copy2 = await db.chatMessage.findUniqueOrThrow({ where: { id: second.ids![0]! } });
    expect(copy2.authorId).toBe(w.b.id);
    expect(copy2.forwardedFromId).toBe(original.id);
    // what a reader is shown: Cee (the first author), not Member (the first forwarder) and not Bee (the last)
    await loginAs(w.a.id);
    const list = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.open1.id}/messages`, params: { id: w.open1.id } });
    const row = (list.json?.["messages"] as { id: string; forwardedFrom?: { name: string } }[]).find((m) => m.id === copy2.id);
    expect(row?.forwardedFrom?.name).toBe("Cee");
  });

  it("the single door keeps the original too", async () => {
    const original = await written(w.open1.id, w.b.id, "single door original");
    await loginAs(w.a.id);
    const r1 = await call(forwardOneRoute.POST, { url: "http://localhost/x", params: { id: original.id }, body: { conversationId: w.open2.id } });
    expect(r1.status).toBe(201);
    const copy = await db.chatMessage.findUniqueOrThrow({ where: { id: r1.json?.["id"] as string } });
    const r2 = await call(forwardOneRoute.POST, { url: "http://localhost/x", params: { id: copy.id }, body: { conversationId: w.open1.id } });
    expect(r2.status).toBe(201);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: r2.json?.["id"] as string } })).forwardedFromId).toBe(original.id);
  });

  it("«بدون اسم المرسل» on a re-forward leaves no link at all", async () => {
    const original = await written(w.open1.id, w.b.id, "hide me twice");
    await loginAs(w.a.id);
    const first = results(await forwardMany({ messageIds: [original.id], targetIds: [w.open2.id], withoutAuthor: true }))[0]!;
    const copy = await db.chatMessage.findUniqueOrThrow({ where: { id: first.ids![0]! } });
    expect(copy.forwardedFromId).toBeNull();
    const second = results(await forwardMany({ messageIds: [copy.id], targetIds: [w.open1.id], withoutAuthor: true }))[0]!;
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: second.ids![0]! } })).forwardedFromId).toBeNull();
  });
});

describe("the comment travels with the forward", () => {
  it("is its own message AFTER the copies, mine, in every target; the target's list time is the comment's", async () => {
    const m1 = await written(w.open1.id, w.b.id, "c one");
    const m2 = await written(w.open1.id, w.b.id, "c two");
    await loginAs(w.a.id);
    const out = results(await forwardMany({ messageIds: [m1.id, m2.id], targetIds: [w.open2.id, w.mine.id], comment: "  look at this  " }));
    expect(out.every((r) => r.ok && r.commentId)).toBe(true);
    for (const r of out) {
      const note = await db.chatMessage.findUniqueOrThrow({ where: { id: r.commentId! } });
      const copies = await db.chatMessage.findMany({ where: { id: { in: r.ids! } } });
      expect(note).toMatchObject({ body: "look at this", authorId: w.a.id, conversationId: r.targetId, kind: "TEXT", forwardedFromId: null });
      expect(copies).toHaveLength(2);
      for (const c of copies) expect(note.createdAt.getTime()).toBeGreaterThan(c.createdAt.getTime());
      expect((await db.conversation.findUniqueOrThrow({ where: { id: r.targetId } })).lastMessageAt?.getTime()).toBe(note.createdAt.getTime());
    }
  });

  it("a blank comment writes nothing; a comment over the cap is refused (422) and nothing is written", async () => {
    const m = await written(w.open1.id, w.b.id, "blank comment");
    await loginAs(w.a.id);
    const blank = results(await forwardMany({ messageIds: [m.id], targetIds: [w.open2.id], comment: "   " }))[0]!;
    expect(blank.ok).toBe(true);
    expect(blank.commentId).toBeUndefined();
    const before = await db.chatMessage.count({ where: { conversationId: w.open2.id } });
    const long = await forwardMany({ messageIds: [m.id], targetIds: [w.open2.id], comment: "x".repeat(1001) });
    expect(long.status).toBe(422);
    expect(await db.chatMessage.count({ where: { conversationId: w.open2.id } })).toBe(before);
  });

  it("a target that refuses gets neither the copies nor the comment; a message that cannot be forwarded refuses the whole request, comment included", async () => {
    const m = await written(w.open1.id, w.b.id, "refused target");
    await loginAs(w.a.id);
    const out = results(await forwardMany({ messageIds: [m.id], targetIds: [w.admins.id, w.open2.id], comment: "never lands in admins" }));
    expect(out.find((r) => r.targetId === w.admins.id)).toMatchObject({ ok: false, error: "chat.e.post_denied" });
    expect(await db.chatMessage.count({ where: { conversationId: w.admins.id, body: "never lands in admins" } })).toBe(0);
    const deleted = await written(w.open1.id, w.b.id, "gone", { deletedAt: new Date() });
    const res = await forwardMany({ messageIds: [m.id, deleted.id], targetIds: [w.open2.id], comment: "atomic comment" });
    expect(res.status).toBe(403);
    expect(await db.chatMessage.count({ where: { body: "atomic comment" } })).toBe(0);
  });
});

describe("the receiver is told, through the send's own path", () => {
  it("a forward into a private chat tells its other person once (not once per copy), with the comment as the words, linking the newest message", async () => {
    const m1 = await written(w.open1.id, w.c.id, "bell one");
    const m2 = await written(w.open1.id, w.c.id, "bell two");
    const m3 = await written(w.open1.id, w.c.id, "bell three");
    await loginAs(w.a.id);
    await db.notification.deleteMany({ where: { userId: w.b.id } });
    const out = results(await forwardMany({ messageIds: [m1.id, m2.id, m3.id], targetIds: [w.dmB], comment: "for you" }));
    expect(out[0]!.ok).toBe(true);
    const rows = await bell(w.b.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Member", body: "for you" });
    expect(rows[0]!.linkUrl).toContain(w.dmB);
    expect(rows[0]!.linkUrl).toContain(out[0]!.commentId!);
  });

  it("without a comment: the words of the one message, or how many were passed on", async () => {
    const m1 = await written(w.open1.id, w.c.id, "words of one");
    const m2 = await written(w.open1.id, w.c.id, "another");
    await loginAs(w.a.id);
    await db.notification.deleteMany({ where: { userId: w.b.id } });
    await forwardMany({ messageIds: [m1.id], targetIds: [w.dmB] });
    expect((await bell(w.b.id)).map((r) => r.body)).toEqual(["words of one"]);
    // the DM stacks no second unread notification: clear the first one so a new one may come
    await db.notification.deleteMany({ where: { userId: w.b.id } });
    await forwardMany({ messageIds: [m1.id, m2.id], targetIds: [w.dmB] });
    expect((await bell(w.b.id)).map((r) => r.body)).toEqual(["حوّل لك رسالتين"]);
  });

  it("the single door tells too", async () => {
    const m = await written(w.open1.id, w.c.id, "single bell");
    await loginAs(w.a.id);
    await db.notification.deleteMany({ where: { userId: w.b.id } });
    expect((await call(forwardOneRoute.POST, { url: "http://localhost/x", params: { id: m.id }, body: { conversationId: w.dmB } })).status).toBe(201);
    expect((await bell(w.b.id)).map((r) => r.body)).toEqual(["single bell"]);
  });

  it("a person who muted the chat is told of nothing; the forwarder is never told of their own forward; the saved chat tells nobody", async () => {
    const m = await written(w.open1.id, w.c.id, "muted bell");
    await db.notification.deleteMany({ where: { userId: { in: [w.a.id, w.b.id] } } });
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: w.dmB, userId: w.b.id } }, data: { mutedUntil: new Date(Date.now() + 3_600_000) } });
    await loginAs(w.a.id);
    const saved = await openSavedMessages({ orgId: w.orgId, orgRole: "MEMBER", userId: w.a.id });
    const out = results(await forwardMany({ messageIds: [m.id], targetIds: [w.dmB, saved.id] }));
    expect(out.every((r) => r.ok)).toBe(true);
    expect(await bell(w.b.id)).toHaveLength(0);
    expect(await bell(w.a.id)).toHaveLength(0);
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: w.dmB, userId: w.b.id } }, data: { mutedUntil: null } });
  });
});

describe("what a forward may be written into", () => {
  it("an archived topic and a closed one refuse, as a hand-made request would be refused: the same words as any target I may not write in", async () => {
    const m = await written(w.open1.id, w.b.id, "to archived");
    await loginAs(w.a.id);
    // the archived topic is one I could write in by the policy alone (open, in my space): the forward still refuses it
    const out = results(await forwardMany({ messageIds: [m.id], targetIds: [w.archived.id, w.closed.id] }));
    expect(out.map((r) => [r.ok, r.error])).toEqual([[false, "chat.e.post_denied"], [false, "chat.e.post_denied"]]);
    const single = await call(forwardOneRoute.POST, { url: "http://localhost/x", params: { id: m.id }, body: { conversationId: w.archived.id } });
    expect(single.status).toBe(403);
    expect(await db.chatMessage.count({ where: { conversationId: { in: [w.archived.id, w.closed.id] }, forwardedFromId: m.id } })).toBe(0);
  });

  it("a space I am not in, a restricted topic I am not in and another company's topic refuse; the answer does not say which exists", async () => {
    const m = await written(w.open1.id, w.b.id, "to nowhere");
    await loginAs(w.a.id);
    const out = results(await forwardMany({ messageIds: [m.id], targetIds: [w.foreign.id, w.restricted.id, w.otherTopic.id, "no-such-id"] }));
    expect(out.every((r) => !r.ok && r.error === "chat.e.post_denied")).toBe(true);
  });
});

describe("GET /api/chat/messages/[id]/forward — the header's tap", () => {
  const source = (userId: string, id: string) => {
    return loginAs(userId).then(() => call(forwardOneRoute.GET, { url: `http://localhost/api/chat/messages/${id}/forward`, params: { id } }));
  };

  it("names the original's conversation and message when I may read both", async () => {
    const original = await written(w.open1.id, w.b.id, "tap origin");
    await loginAs(w.a.id);
    const copy = results(await forwardMany({ messageIds: [original.id], targetIds: [w.open2.id] }))[0]!.ids![0]!;
    const res = await source(w.b.id, copy);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ conversationId: w.open1.id, messageId: original.id });
  });

  it("a person who may not read the original's conversation gets 404 (and nothing of it)", async () => {
    const original = await written(w.mine.id, w.a.id, "private origin words");
    await loginAs(w.a.id);
    const copy = results(await forwardMany({ messageIds: [original.id], targetIds: [w.open2.id] }))[0]!.ids![0]!;
    // b is in both spaces but `mine` is restricted to a and b: use c, who reads Space One's open topics only... c is not in Space Two
    await db.workspaceMember.create({ data: { workspaceId: w.two.id, userId: w.c.id } });
    const res = await source(w.c.id, copy);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("private origin words");
    expect(res.text).not.toContain(w.mine.id);
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.two.id, userId: w.c.id } } });
  });

  it("a guest never learns the source: 404, and the header is not in her messages either", async () => {
    const original = await written(w.open1.id, w.b.id, "guest origin");
    await loginAs(w.a.id);
    const copy = results(await forwardMany({ messageIds: [original.id], targetIds: [w.open1.id] }))[0]!.ids![0]!;
    expect((await source(w.guest.id, copy)).status).toBe(404);
    await loginAs(w.guest.id);
    const list = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.open1.id}/messages`, params: { id: w.open1.id } });
    const row = (list.json?.["messages"] as { id: string; forwardedFrom?: unknown }[]).find((m) => m.id === copy);
    expect(row).toBeDefined();
    expect(row?.forwardedFrom).toBeUndefined();
  });

  it("a deleted original, a message that is no forward and another company's message are 404", async () => {
    const original = await written(w.open1.id, w.b.id, "to be deleted");
    await loginAs(w.a.id);
    const copy = results(await forwardMany({ messageIds: [original.id], targetIds: [w.open2.id] }))[0]!.ids![0]!;
    await db.chatMessage.update({ where: { id: original.id }, data: { deletedAt: new Date() } });
    expect((await source(w.a.id, copy)).status).toBe(404);
    const plain = await written(w.open1.id, w.b.id, "plain");
    expect((await source(w.a.id, plain.id)).status).toBe(404);
    const theirs = await db.chatMessage.create({ data: { orgId: w.otherTopic.orgId, conversationId: w.otherTopic.id, authorId: (await db.user.findFirstOrThrow({ where: { name: "Outsider" } })).id, body: "other company" } });
    expect((await source(w.a.id, theirs.id)).status).toBe(404);
    logout();
    expect((await call(forwardOneRoute.GET, { url: "http://localhost/x", params: { id: copy } })).status).toBe(401);
  });
});
