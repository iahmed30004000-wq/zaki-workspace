/**
 * C3b.5 — «حدّد»: forwarding many, deleting many and ONE task from a selection. The doors are `POST /api/chat/messages/forward`, `POST /api/chat/messages/delete`
 * and `POST /api/chat/messages/[id]/task` with `alsoMessageIds`; each reuses today's single rule per message (forwardMessage, deleteMessage, messageToTask) and adds
 * only the batch: the caps (100 messages, 10 targets), the company's switch `chatMultiSelect` (OFF = 404), one transaction per target, a report per target / per id,
 * and the P0.3 visibility decided by the policy over EVERY source (a private one makes the whole batch private; the confirmation is the server's).
 */
import { describe, expect, it } from "vitest";
import * as forwardManyRoute from "@/app/api/chat/messages/forward/route";
import * as deleteManyRoute from "@/app/api/chat/messages/delete/route";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { openDm } from "@/server/chat/dm";
import { call, db, loginAs, logout, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Result = { targetId: string; ok: boolean; ids?: string[]; error?: string };
type DeleteResult = { id: string; ok: boolean; error?: string };

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member; // the author of most messages
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const mod = await makeUser({ orgId, role: "MEMBER", name: "Moderator" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: mod.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }, { userId: outsider.id }]);
  const topic = (title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title, ...extra } });
  const open = await topic("Open");
  const restricted = await topic("Restricted", { restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } });
  const t1 = await topic("Target one");
  const t2 = await topic("Target two");
  const announce = await topic("Announce", { topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS" });
  await loginAs(a.id);
  const dm = (await openDm({ orgId, orgRole: "MEMBER", userId: a.id }, b.id)).id;
  const { project, board } = await makeProject(space.id);
  return { ...t, orgId, a, b, mod, outsider, space, open, restricted, t1, t2, announce, dm, project, board };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

let tick = 0;
/** n messages in a conversation, written at increasing seconds so their order is the order of `ids` */
async function messages(w: World, conversationId: string, authorId: string, bodies: string[], extra: Record<string, unknown> = {}) {
  const base = Date.now() - 3_600_000 + tick * 100_000;
  tick += 1;
  const ids: string[] = [];
  for (const [i, body] of bodies.entries()) {
    const m = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId, authorId, body, createdAt: new Date(base + i * 1000), ...extra } });
    ids.push(m.id);
  }
  return ids;
}
const setSwitch = (w: World, on: boolean | null) => db.organization.update({ where: { id: w.orgId }, data: { settings: on === null ? {} : { features: { chatMultiSelect: on } } } });
const forward = (body: unknown) => call(forwardManyRoute.POST, { url: "http://localhost/api/chat/messages/forward", body });
const removeMany = (body: unknown) => call(deleteManyRoute.POST, { url: "http://localhost/api/chat/messages/delete", body });
const results = (res: { json: Record<string, unknown> | null }) => res.json?.["results"] as Result[];
const copiesIn = (conversationId: string) => db.chatMessage.findMany({ where: { conversationId, forwardedFromId: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("POST /api/chat/messages/forward", () => {
  it("copies the selected messages, in their order, into every target: one report per target, each copy says where it came from and is mine", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["one", "two", "three"]);
    await loginAs(w.a.id);
    // the client may send them in any order: the copies keep the conversation's order
    const res = await forward({ messageIds: [ids[2], ids[0], ids[1]], targetIds: [w.t1.id, w.t2.id] });
    expect(res.status).toBe(200);
    const out = results(res);
    expect(out.map((r) => [r.targetId, r.ok]).sort()).toEqual([[w.t1.id, true], [w.t2.id, true]].sort());
    for (const target of [w.t1.id, w.t2.id]) {
      const copies = await copiesIn(target);
      expect(copies.map((c) => c.body)).toEqual(["one", "two", "three"]);
      expect(copies.map((c) => c.forwardedFromId)).toEqual(ids);
      expect(copies.every((c) => c.authorId === w.a.id && c.deletedAt === null)).toBe(true);
      expect(out.find((r) => r.targetId === target)?.ids).toEqual(copies.map((c) => c.id));
      // the target's list time moved with the last copy
      expect((await db.conversation.findUniqueOrThrow({ where: { id: target } })).lastMessageAt?.getTime()).toBe(copies[2]!.createdAt.getTime());
    }
  });

  it("«بدون اسم المرسل»: the copies are written with no link to the original", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.b.id, ["anonymous please"]);
    await loginAs(w.a.id);
    const res = await forward({ messageIds: [id], targetIds: [w.t1.id], withoutAuthor: true });
    expect(res.status).toBe(200);
    const copy = await db.chatMessage.findUniqueOrThrow({ where: { id: results(res)[0]!.ids![0]! } });
    expect(copy).toMatchObject({ body: "anonymous please", authorId: w.a.id, forwardedFromId: null, conversationId: w.t1.id });
  });

  it("a target I may not write in fails ALONE (reported per target, nothing written there); the other target still gets its copies", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["partial 1", "partial 2"]);
    await loginAs(w.a.id);
    const res = await forward({ messageIds: ids, targetIds: [w.announce.id, w.t2.id] });
    expect(res.status).toBe(200);
    const out = results(res);
    expect(out.find((r) => r.targetId === w.announce.id)).toMatchObject({ ok: false, error: "chat.e.post_denied" });
    expect(out.find((r) => r.targetId === w.t2.id)?.ok).toBe(true);
    expect(await db.chatMessage.count({ where: { conversationId: w.announce.id, body: { startsWith: "partial" } } })).toBe(0);
    expect(await db.chatMessage.count({ where: { conversationId: w.t2.id, body: { startsWith: "partial" } } })).toBe(2);
  });

  it("a target I may not even read is a failure of that target too, and the report does not say it exists (the same words as one I may not write in)", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.b.id, ["to a hidden place"]);
    await loginAs(w.outsider.id);
    const res = await forward({ messageIds: [id], targetIds: [w.restricted.id] });
    expect(res.status).toBe(200);
    expect(results(res)[0]).toMatchObject({ targetId: w.restricted.id, ok: false });
    expect(await db.chatMessage.count({ where: { conversationId: w.restricted.id, body: "to a hidden place" } })).toBe(0);
  });

  it("a message I may not read refuses the WHOLE request (404) and writes nothing anywhere", async () => {
    const w = await getWorld();
    const [hidden] = await messages(w, w.restricted.id, w.a.id, ["secret of the restricted topic"]);
    const [fine] = await messages(w, w.open.id, w.b.id, ["fine one"]);
    await loginAs(w.outsider.id);
    const res = await forward({ messageIds: [fine, hidden], targetIds: [w.t1.id] });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("secret of the restricted topic");
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id, forwardedFromId: { in: [fine!, hidden!] } } })).toBe(0);
  });

  it("a poll, a deleted message and a system line in the selection refuse the whole request, as forwarding one does", async () => {
    const w = await getWorld();
    const [fine] = await messages(w, w.open.id, w.b.id, ["good one"]);
    const [poll] = await messages(w, w.open.id, w.b.id, ["question?"], { kind: "POLL" });
    const [gone] = await messages(w, w.open.id, w.b.id, ["gone"], { deletedAt: new Date() });
    const [system] = await messages(w, w.open.id, w.b.id, ["joined"], { kind: "SYSTEM" });
    await loginAs(w.a.id);
    const before = await db.chatMessage.count({ where: { conversationId: w.t1.id } });
    const wrong: string[] = [];
    for (const [name, bad, error] of [["poll", poll, "chat.e.poll_immutable"], ["deleted", gone, "chat.e.deleted"], ["system", system, "chat.e.system_immutable"]] as const) {
      const res = await forward({ messageIds: [fine, bad], targetIds: [w.t1.id] });
      if (res.status !== 403 || res.json?.["message"] !== error) wrong.push(`${name}: ${res.status} ${String(res.json?.["message"])}`);
    }
    expect(wrong).toEqual([]);
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id } })).toBe(before);
  });

  it("the caps are the server's: more than 100 messages, more than 10 targets, none of either, a repeated id counted once", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.b.id, ["cap"]);
    await loginAs(w.a.id);
    const before = await db.chatMessage.count({ where: { conversationId: w.t1.id } });
    const many = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);
    expect((await forward({ messageIds: many(101), targetIds: [w.t1.id] })).status).toBe(422);
    expect((await forward({ messageIds: [id], targetIds: many(11) })).status).toBe(422);
    expect((await forward({ messageIds: [], targetIds: [w.t1.id] })).status).toBe(422);
    expect((await forward({ messageIds: [id], targetIds: [] })).status).toBe(422);
    expect((await forward({ messageIds: [id], targetIds: [w.t1.id], withoutAuthor: "yes" })).status).toBe(422);
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id } })).toBe(before);
    const twice = await forward({ messageIds: [id, id], targetIds: [w.t1.id, w.t1.id] });
    expect(twice.status).toBe(200);
    expect(results(twice)).toHaveLength(1);
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id } })).toBe(before + 1);
  });

  it("exactly 100 messages into 10 targets goes through (the cap is a limit, not a wall)", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, Array.from({ length: 100 }, (_, i) => `bulk ${i}`));
    const targets = await Promise.all(Array.from({ length: 10 }, (_, i) => db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: `Bulk ${i}` } })));
    await loginAs(w.a.id);
    const res = await forward({ messageIds: ids, targetIds: targets.map((x) => x.id) });
    expect(res.status).toBe(200);
    expect(results(res).every((r) => r.ok)).toBe(true);
    expect(await db.chatMessage.count({ where: { conversationId: { in: targets.map((x) => x.id) } } })).toBe(1000);
  });

  it("is a 401 for nobody and a 404 for a message of another company", async () => {
    const w = await getWorld();
    const other = await makeTeam();
    const foreign = await db.conversation.create({ data: { orgId: other.org.id, kind: "TOPIC", title: "Foreign" } });
    const [theirs] = await messages({ ...w, orgId: other.org.id } as World, foreign.id, other.member.id, ["not yours"]);
    await loginAs(w.a.id);
    expect((await forward({ messageIds: [theirs], targetIds: [w.t1.id] })).status).toBe(404);
    logout();
    expect((await forward({ messageIds: [theirs], targetIds: [w.t1.id] })).status).toBe(401);
  });

  it("the company's switch: OFF answers 404 and writes nothing; back ON it works again", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.b.id, ["switch"]);
    await loginAs(w.a.id);
    await setSwitch(w, false);
    const off = await forward({ messageIds: [id], targetIds: [w.t1.id] });
    expect(off.status).toBe(404);
    expect(off.json?.["message"]).toBe("features.off");
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id, body: "switch" } })).toBe(0);
    await setSwitch(w, null);
    expect((await forward({ messageIds: [id], targetIds: [w.t1.id] })).status).toBe(200);
  });
});

describe("POST /api/chat/messages/delete", () => {
  it("deletes my own messages one by one (the single rule): tombstones for everybody, the text kept for the archive, the list time falls back", async () => {
    const w = await getWorld();
    const topic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Delete mine" } });
    const keep = (await messages(w, topic.id, w.b.id, ["kept"]))[0]!;
    const ids = await messages(w, topic.id, w.a.id, ["mine 1", "mine 2", "mine 3"]);
    await loginAs(w.a.id);
    const res = await removeMany({ ids });
    expect(res.status).toBe(200);
    expect((res.json?.["results"] as DeleteResult[]).every((r) => r.ok)).toBe(true);
    const rows = await db.chatMessage.findMany({ where: { id: { in: ids } } });
    expect(rows.every((r) => r.deletedAt !== null && r.deletedById === w.a.id && r.body.startsWith("mine"))).toBe(true);
    // a deleted message comes back as a tombstone only: the other person's screen has no words of it
    await loginAs(w.b.id);
    const seen = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${topic.id}/messages`, params: { id: topic.id } });
    expect(seen.status).toBe(200);
    expect(seen.text).not.toContain("mine 1");
    expect(seen.text).not.toContain("mine 3");
    expect(seen.text).toContain("kept");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: topic.id } })).lastMessageAt?.getTime()).toBe((await db.chatMessage.findUniqueOrThrow({ where: { id: keep } })).createdAt.getTime());
  });

  it("a message of a conversation I cannot read says the very same thing as an id that does not exist (not_found): the report is no oracle, and the message is untouched", async () => {
    const w = await getWorld();
    const [hidden] = await messages(w, w.restricted.id, w.a.id, ["hidden from the outsider"]);
    await loginAs(w.outsider.id);
    const res = await removeMany({ ids: [hidden, "no-such-message"] });
    expect(res.status).toBe(200);
    const out = res.json?.["results"] as DeleteResult[];
    expect(out.map((r) => [r.ok, r.error])).toEqual([[false, "chat.e.not_found"], [false, "chat.e.not_found"]]);
    expect(res.text).not.toContain("hidden from the outsider");
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: hidden } })).deletedAt).toBeNull();
  });

  it("somebody else's message is refused PER ID (delete_denied, untouched) while my own in the same request goes; nothing is audited for the refused one", async () => {
    const w = await getWorld();
    const [mine] = await messages(w, w.open.id, w.a.id, ["my own"]);
    const [theirs] = await messages(w, w.open.id, w.b.id, ["not mine to delete"]);
    await loginAs(w.a.id);
    const res = await removeMany({ ids: [mine, theirs] });
    expect(res.status).toBe(200);
    const out = res.json?.["results"] as DeleteResult[];
    expect(out.find((r) => r.id === mine)?.ok).toBe(true);
    expect(out.find((r) => r.id === theirs)).toMatchObject({ ok: false, error: "chat.e.delete_denied" });
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: theirs } })).deletedAt).toBeNull();
    expect(await db.auditLog.count({ where: { action: "chat.delete_by_admin", meta: { path: ["messageId"], equals: theirs } } })).toBe(0);
  });

  it("a moderator (the space's ADMIN) deletes other people's messages, each one audited", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["mod 1", "mod 2"]);
    await loginAs(w.mod.id);
    const res = await removeMany({ ids });
    expect((res.json?.["results"] as DeleteResult[]).every((r) => r.ok)).toBe(true);
    expect(await db.chatMessage.count({ where: { id: { in: ids }, deletedAt: { not: null } } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "chat.delete_by_admin", actorId: w.mod.id, conversationId: w.open.id } })).toBeGreaterThanOrEqual(2);
  });

  it("an owner who only READS (silent oversight) cannot select-delete anything: every id refused, nothing deleted, nothing audited (no trace)", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["owner reads 1", "owner reads 2"]);
    const dmMessage = (await messages(w, w.dm, w.a.id, ["a private one"]))[0]!;
    const audits = await db.auditLog.count({ where: { actorId: w.owner.id } });
    await loginAs(w.owner.id);
    const res = await removeMany({ ids: [...ids, dmMessage] });
    expect(res.status).toBe(200);
    expect((res.json?.["results"] as DeleteResult[]).map((r) => [r.ok, r.error])).toEqual([[false, "chat.e.delete_denied"], [false, "chat.e.delete_denied"], [false, "chat.e.delete_denied"]]);
    expect(await db.chatMessage.count({ where: { id: { in: [...ids, dmMessage] }, deletedAt: { not: null } } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorId: w.owner.id } })).toBe(audits);
  });

  it("the same owner who JOINED the conversation is a moderator there like any other and may delete", async () => {
    const w = await getWorld();
    const topic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Owner joined", members: { create: [{ userId: w.owner.id }] } } });
    const ids = await messages(w, topic.id, w.b.id, ["joined 1"]);
    await loginAs(w.owner.id);
    const res = await removeMany({ ids });
    expect((res.json?.["results"] as DeleteResult[])[0]?.ok).toBe(true);
  });

  it("an id that is already deleted, unknown or of another company is reported (deleted / not_found) and the rest still goes", async () => {
    const w = await getWorld();
    const other = await makeTeam();
    const foreign = await db.conversation.create({ data: { orgId: other.org.id, kind: "TOPIC", title: "Foreign 2" } });
    const [theirs] = await messages({ ...w, orgId: other.org.id } as World, foreign.id, other.member.id, ["not yours either"]);
    const [done] = await messages(w, w.open.id, w.a.id, ["already gone"], { deletedAt: new Date() });
    const [live] = await messages(w, w.open.id, w.a.id, ["still here"]);
    await loginAs(w.a.id);
    const res = await removeMany({ ids: [done, "no-such-id", theirs, live] });
    expect(res.status).toBe(200);
    const out = res.json?.["results"] as DeleteResult[];
    expect(out.find((r) => r.id === done)).toMatchObject({ ok: false, error: "chat.e.deleted" });
    expect(out.find((r) => r.id === "no-such-id")).toMatchObject({ ok: false, error: "chat.e.not_found" });
    expect(out.find((r) => r.id === theirs)).toMatchObject({ ok: false, error: "chat.e.not_found" });
    expect(out.find((r) => r.id === live)?.ok).toBe(true);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: theirs } })).deletedAt).toBeNull();
  });

  it("the cap is the server's: 101 ids, none, a non-text id are all 422 and nothing is deleted; a repeated id counts once", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.a.id, ["cap delete"]);
    await loginAs(w.a.id);
    expect((await removeMany({ ids: Array.from({ length: 101 }, (_, i) => `id${i}`) })).status).toBe(422);
    expect((await removeMany({ ids: [] })).status).toBe(422);
    expect((await removeMany({ ids: [5] })).status).toBe(422);
    expect((await removeMany({})).status).toBe(422);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    const twice = await removeMany({ ids: [id, id] });
    expect(twice.status).toBe(200);
    expect(twice.json?.["results"]).toHaveLength(1);
  });

  it("is a 401 for nobody; the company's switch OFF answers 404 and deletes nothing", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.a.id, ["switch delete"]);
    logout();
    expect((await removeMany({ ids: [id] })).status).toBe(401);
    await loginAs(w.a.id);
    await setSwitch(w, false);
    const off = await removeMany({ ids: [id] });
    expect(off.status).toBe(404);
    expect(off.json?.["message"]).toBe("features.off");
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    await setSwitch(w, null);
  });

  it("the quota is per kind of batch, says the real wait, and a request refused before it writes costs nothing", async () => {
    const w = await getWorld();
    const person = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Quota" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: person.id, role: "MEMBER" } });
    await loginAs(person.id);
    // 30 requests that are refused (an id that does not exist) cost nothing…
    for (let i = 0; i < 30; i++) expect((await forward({ messageIds: [`none-${i}`], targetIds: [w.t1.id] })).status).toBe(404);
    // …20 that go through (an empty report still counts) use the delete bucket up, and only that one
    for (let i = 0; i < 20; i++) expect((await removeMany({ ids: [`none-${i}`] })).status).toBe(200);
    const blocked = await removeMany({ ids: ["none-x"] });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    // forwarding has its own bucket: still open
    const [id] = await messages(w, w.open.id, w.b.id, ["quota forward"]);
    expect((await forward({ messageIds: [id], targetIds: [w.t1.id] })).status).toBe(200);
  });
});

describe("GET /api/chat/messages/delete: the screen's question «is the switch on?»", () => {
  it("answers 200 while the company's switch is on, 404 `features.off` while it is off, and 401 to nobody", async () => {
    const w = await getWorld();
    const probe = () => call(deleteManyRoute.GET, { url: "http://localhost/api/chat/messages/delete" });
    logout();
    expect((await probe()).status).toBe(401);
    await loginAs(w.a.id);
    expect(await probe()).toMatchObject({ status: 200, json: { on: true } });
    await setSwitch(w, false);
    const off = await probe();
    expect(off.status).toBe(404);
    expect(off.json?.["message"]).toBe("features.off");
    await setSwitch(w, null);
  });
});

describe("«اعمل مهمة» from a selection: POST /api/chat/messages/[id]/task with alsoMessageIds", () => {
  const taskBody = (w: World, extra: Record<string, unknown> = {}) => ({ workspaceId: w.space.id, projectId: w.project.id, boardId: w.board.id, ...extra });
  const make = (id: string, body: unknown) => call(taskRoute.POST, { params: { id }, body });

  it("makes ONE task: the title from the first message, the description quotes the selected messages with author and time, the source is the first", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["first line of the first\nsecond line", "the middle one", "the last one"]);
    await loginAs(w.a.id);
    const before = await db.task.count({ where: { orgId: w.orgId } });
    // the screen sends them in the order they were selected: the server finds the first by time
    const res = await make(ids[1]!, taskBody(w, { alsoMessageIds: [ids[2], ids[0]] }));
    expect(res.status).toBe(201);
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before + 1);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } });
    expect(task.title).toBe("first line of the first");
    expect(task.sourceMessageId).toBe(ids[0]);
    const text = task.description ?? "";
    expect(text.indexOf("first line of the first")).toBeLessThan(text.indexOf("the middle one"));
    expect(text.indexOf("the middle one")).toBeLessThan(text.indexOf("the last one"));
    expect(text.split("Bee").length - 1).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).toContain(`/chat/${w.open.id}?m=${ids[0]}`);
    expect(text.length).toBeLessThanOrEqual(4000);
    // an open topic: nothing private about it
    expect(task.visibility).toBe("SPACE");
  });

  it("with no extra ids the single door is exactly what it was", async () => {
    const w = await getWorld();
    const [id] = await messages(w, w.open.id, w.b.id, ["just one"]);
    await loginAs(w.a.id);
    const res = await make(id!, taskBody(w));
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } });
    expect(task).toMatchObject({ title: "just one", sourceMessageId: id });
  });

  it("the first message with no words (a voice note) is still the source; the title comes from the first one with words", async () => {
    const w = await getWorld();
    const [voice] = await messages(w, w.open.id, w.b.id, [""], { kind: "VOICE" });
    const [words] = await messages(w, w.open.id, w.b.id, ["after the voice"]);
    await loginAs(w.a.id);
    const res = await make(words!, taskBody(w, { alsoMessageIds: [voice] }));
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } });
    expect(task.sourceMessageId).toBe(voice);
    expect(task.title).toBe("after the voice");
  });

  it("from a private conversation the whole task is «المعنيين بس» by default; for the whole space it needs the explicit choice AND confirmPublic, and the refusal writes nothing", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.restricted.id, w.b.id, ["private 1", "private 2"]);
    await loginAs(w.a.id);
    const before = await db.task.count({ where: { orgId: w.orgId } });
    const dflt = await make(ids[0]!, taskBody(w, { alsoMessageIds: [ids[1]] }));
    expect(dflt.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: dflt.json?.["taskId"] as string } })).visibility).toBe("PARTICIPANTS");
    const unconfirmed = await make(ids[0]!, taskBody(w, { alsoMessageIds: [ids[1]], visibility: "SPACE" }));
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.json?.["details"]).toBeTruthy();
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before + 1);
    const confirmed = await make(ids[0]!, taskBody(w, { alsoMessageIds: [ids[1]], visibility: "SPACE", confirmPublic: true }));
    expect(confirmed.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: confirmed.json?.["taskId"] as string } })).visibility).toBe("SPACE");
  });

  it("ONE private source makes the whole batch private: an open message plus a DM message is decided by the DM, never by the first row", async () => {
    const w = await getWorld();
    const [open] = await messages(w, w.open.id, w.b.id, ["open one"]);
    const [dmMsg] = await messages(w, w.dm, w.b.id, ["dm one"]);
    await loginAs(w.a.id);
    const before = await db.task.count({ where: { orgId: w.orgId } });
    // the open message is the earliest and leads the batch; the DM message is still decided
    const refused = await make(open!, taskBody(w, { alsoMessageIds: [dmMsg], visibility: "SPACE" }));
    expect(refused.status).toBe(422);
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before);
    const dflt = await make(open!, taskBody(w, { alsoMessageIds: [dmMsg] }));
    expect(dflt.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: dflt.json?.["taskId"] as string } })).visibility).toBe("PARTICIPANTS");
  });

  it("a message I may not read, a deleted one or a system line among the ids refuses the whole request and makes no task", async () => {
    const w = await getWorld();
    const [fine] = await messages(w, w.open.id, w.b.id, ["fine"]);
    const [hidden] = await messages(w, w.restricted.id, w.b.id, ["hidden from the outsider"]);
    const [gone] = await messages(w, w.open.id, w.b.id, ["gone"], { deletedAt: new Date() });
    const [system] = await messages(w, w.open.id, w.b.id, ["joined"], { kind: "SYSTEM" });
    const before = await db.task.count({ where: { orgId: w.orgId } });
    await loginAs(w.outsider.id);
    const unreadable = await make(fine!, taskBody(w, { alsoMessageIds: [hidden] }));
    expect(unreadable.status).toBe(404);
    expect(unreadable.text).not.toContain("hidden from the outsider");
    await loginAs(w.a.id);
    expect((await make(fine!, taskBody(w, { alsoMessageIds: [gone] }))).status).toBe(403);
    expect((await make(fine!, taskBody(w, { alsoMessageIds: [system] }))).status).toBe(403);
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before);
  });

  it("a guest makes no task from a selection either (403)", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["guest 1", "guest 2"]);
    await loginAs(w.guest.id);
    const res = await make(ids[0]!, taskBody(w, { alsoMessageIds: [ids[1]] }));
    expect([403, 404]).toContain(res.status);
  });

  it("the cap is the server's: 100 messages in all is fine, 101 is a 422 and makes nothing; a repeat of the path's own id counts once", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, Array.from({ length: 101 }, (_, i) => `many ${i}`));
    await loginAs(w.a.id);
    const before = await db.task.count({ where: { orgId: w.orgId } });
    const tooMany = await make(ids[0]!, taskBody(w, { alsoMessageIds: ids.slice(1) }));
    expect(tooMany.status).toBe(422);
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before);
    const ok = await make(ids[0]!, taskBody(w, { alsoMessageIds: [...ids.slice(1, 100), ids[0]] }));
    expect(ok.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: ok.json?.["taskId"] as string } });
    expect((task.description ?? "").length).toBeLessThanOrEqual(4000);
    expect(task.description).toContain(`?m=${ids[0]}`);
  });

  it("huge messages are cut to fit the description's room and the link back to the first one is never the part that is cut", async () => {
    const w = await getWorld();
    const big = "ك".repeat(3900);
    const ids = await messages(w, w.open.id, w.b.id, [big, big, big]);
    await loginAs(w.a.id);
    const res = await make(ids[0]!, taskBody(w, { alsoMessageIds: [ids[1], ids[2]] }));
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } });
    expect((task.description ?? "").length).toBeLessThanOrEqual(4000);
    expect(task.description).toContain(`/chat/${w.open.id}?m=${ids[0]}`);
    expect(task.title.length).toBeLessThanOrEqual(280);
  });

  it("the company's switch is for the selection only: OFF answers 404 when extra ids come, and the single door still works", async () => {
    const w = await getWorld();
    const ids = await messages(w, w.open.id, w.b.id, ["off 1", "off 2"]);
    await loginAs(w.a.id);
    await setSwitch(w, false);
    const before = await db.task.count({ where: { orgId: w.orgId } });
    const batch = await make(ids[0]!, taskBody(w, { alsoMessageIds: [ids[1]] }));
    expect(batch.status).toBe(404);
    expect(batch.json?.["message"]).toBe("features.off");
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before);
    expect((await make(ids[0]!, taskBody(w))).status).toBe(201);
    await setSwitch(w, null);
  });
});
