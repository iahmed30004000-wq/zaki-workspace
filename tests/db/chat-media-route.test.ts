/**
 * C3d — `GET /api/chat/conversations/[id]/media?kind=IMAGE|VIDEO|FILE|AUDIO|LINK|MEDIA&before=&limit=` and `?counts=1`, and the work tab's
 * `GET /api/chat/conversations/[id]/media/work`. The rules they must keep:
 *  - the same reading rule as opening the conversation (404 for what is not mine; a guest has topics only);
 *  - the attachments of NON-deleted messages only — NEVER the file of a deleted message, not even for the owner, never a system line, never an upload no
 *    message claimed, never another conversation's;
 *  - LINK = the messages with a link card (`previewId`, status OK), and only while the link-preview switches are on;
 *  - pages: newest first, `before` is the last id of the page before, a foreign id is «not found»;
 *  - the silent eye (oversight) lists without a trace: no read row, no event;
 *  - «الشغل»: the tasks and tickets made from a message of THIS conversation, a hidden task is not even counted (P0.2), a ticket only for the people who may read it,
 *    a guest learns of none.
 */
import { describe, expect, it } from "vitest";
import * as mediaRoute from "@/app/api/chat/conversations/[id]/media/route";
import * as workRoute from "@/app/api/chat/conversations/[id]/media/work/route";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

const SECRET = "ملفسريجدا";
let at = Date.parse("2026-11-18T10:00:00.000Z");
const nextAt = () => new Date((at += 60_000));

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const bee = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: bee.id }, { userId: t.guest.id }], "Alpha");
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const other = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Other" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: bee.id }] } } });
  const say = (conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId, conversationId, authorId, body, createdAt: nextAt(), ...extra } });
  /** a message with one stored file linked to it */
  const withFile = async (
    conversationId: string,
    authorId: string,
    kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    name: string,
    extra: { messageExtra?: Record<string, unknown>; claimed?: boolean } = {},
  ) => {
    const file = await db.storedFile.create({
      data: {
        orgId,
        uploaderId: authorId,
        familyId: `f_${uid()}`,
        name,
        mimeType: kind === "IMAGE" ? "image/png" : kind === "VIDEO" ? "video/mp4" : kind === "AUDIO" ? "audio/ogg" : "application/pdf",
        size: 1234,
        path: `p_${uid()}`,
        purpose: kind === "AUDIO" ? "VOICE" : "CHAT",
      },
    });
    const message = extra.claimed === false ? null : await say(conversationId, authorId, `caption ${name}`, { kind: kind === "AUDIO" ? "VOICE" : "TEXT", ...(extra.messageExtra ?? {}) });
    const attachment = await db.messageAttachment.create({ data: { messageId: message?.id ?? null, fileId: file.id, kind, name, width: kind === "IMAGE" ? 40 : null, height: kind === "IMAGE" ? 30 : null } });
    return { message, attachment, file };
  };
  return { t, bee, outsider, space, topic, other, restricted, say, withFile, orgId };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

type Item = { id: string; messageId: string; at: string; position: number; authorName: string; caption: string | null; attachment: { id: string; kind: string; name: string; mime: string; url: string } };
type Link = { id: string; messageId: string; url: string; title: string | null; siteName: string | null };

const get = async (userId: string, id: string, query: string) => {
  await loginAs(userId);
  const res = await call(mediaRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/media${query}`, params: { id } });
  return {
    status: res.status,
    items: (res.json?.["items"] ?? null) as Item[] | null,
    links: (res.json?.["links"] ?? null) as Link[] | null,
    next: (res.json?.["next"] ?? null) as string | null,
    counts: (res.json?.["counts"] ?? null) as Record<string, number> | null,
    text: res.text,
  };
};
const work = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(workRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/media/work`, params: { id } });
  return { status: res.status, tasks: (res.json?.["tasks"] ?? null) as { id: string; title: string; key: string }[] | null, tickets: (res.json?.["tickets"] ?? null) as { id: string; title: string; key: string }[] | null, text: res.text };
};
const featuresOn = async (orgId: string, keys: Record<string, boolean>) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
  await db.organization.update({ where: { id: orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), ...keys } } } });
};

describe("the media of a conversation", () => {
  it("lists the pictures newest first, with the message, the author and the caption — and nothing of another kind", async () => {
    const w = await getWorld();
    const first = await w.withFile(w.topic.id, w.bee.id, "IMAGE", "first.png");
    await w.withFile(w.topic.id, w.bee.id, "VIDEO", "clip.mp4");
    await w.withFile(w.topic.id, w.bee.id, "FILE", "report.pdf");
    const last = await w.withFile(w.topic.id, w.t.member.id, "IMAGE", "last.png");
    const r = await get(w.t.member.id, w.topic.id, "?kind=IMAGE");
    expect(r.status).toBe(200);
    expect(r.items!.map((i) => i.attachment.id)).toEqual([last.attachment.id, first.attachment.id]);
    const top = r.items![0]!;
    expect(top.messageId).toBe(last.message!.id);
    expect(top.authorName).toBe("Member");
    expect(top.caption).toBe("caption last.png");
    expect(top.attachment).toMatchObject({ kind: "IMAGE", name: "last.png", mime: "image/png", url: `/api/chat/attachments/${last.attachment.id}` });
    expect(r.links).toEqual([]);
    expect(r.next).toBeNull();
  });

  it("MEDIA is the pictures and the videos together (what the viewer steps through); FILE and AUDIO are their own lists", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Kinds" } });
    const img = await w.withFile(conv.id, w.bee.id, "IMAGE", "a.png");
    const vid = await w.withFile(conv.id, w.bee.id, "VIDEO", "b.mp4");
    const doc = await w.withFile(conv.id, w.bee.id, "FILE", "c.pdf");
    const voice = await w.withFile(conv.id, w.bee.id, "AUDIO", "d.ogg");
    const ids = async (kind: string) => (await get(w.t.member.id, conv.id, `?kind=${kind}`)).items!.map((i) => i.attachment.id);
    expect(await ids("MEDIA")).toEqual([vid.attachment.id, img.attachment.id]);
    expect(await ids("VIDEO")).toEqual([vid.attachment.id]);
    expect(await ids("FILE")).toEqual([doc.attachment.id]);
    expect(await ids("AUDIO")).toEqual([voice.attachment.id]);
  });

  it("NEVER the file of a deleted message (the owner too), a system line, an upload no message claimed, or another conversation's", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Deleted" } });
    const kept = await w.withFile(conv.id, w.bee.id, "IMAGE", "kept.png");
    await w.withFile(conv.id, w.bee.id, "IMAGE", `${SECRET}-gone.png`, { messageExtra: { deletedAt: new Date(), deletedById: w.bee.id } });
    await w.withFile(conv.id, w.bee.id, "IMAGE", `${SECRET}-sys.png`, { messageExtra: { kind: "SYSTEM" } });
    await w.withFile(conv.id, w.bee.id, "IMAGE", `${SECRET}-unclaimed.png`, { claimed: false });
    await w.withFile(w.other.id, w.bee.id, "IMAGE", `${SECRET}-elsewhere.png`);
    for (const who of [w.t.member.id, w.t.owner.id, w.bee.id]) {
      const r = await get(who, conv.id, "?kind=IMAGE");
      expect(r.status).toBe(200);
      expect(r.items!.map((i) => i.attachment.id)).toEqual([kept.attachment.id]);
      expect(r.text).not.toContain(SECRET);
    }
    const counts = await get(w.t.owner.id, conv.id, "?counts=1");
    expect(counts.counts).toMatchObject({ IMAGE: 1, VIDEO: 0, FILE: 0, AUDIO: 0 });
  });

  it("pages: newest first, `before` is the last id of the page before, nothing twice, the end has no cursor", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Pages" } });
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await w.withFile(conv.id, w.bee.id, "IMAGE", `p${i}.png`));
    const wanted = made.map((m) => m.attachment.id).reverse();
    const one = await get(w.t.member.id, conv.id, "?kind=IMAGE&limit=2");
    expect(one.items!.map((i) => i.attachment.id)).toEqual(wanted.slice(0, 2));
    expect(one.next).toBe(wanted[1]);
    const two = await get(w.t.member.id, conv.id, `?kind=IMAGE&limit=2&before=${one.next}`);
    expect(two.items!.map((i) => i.attachment.id)).toEqual(wanted.slice(2, 4));
    const three = await get(w.t.member.id, conv.id, `?kind=IMAGE&limit=2&before=${two.next}`);
    expect(three.items!.map((i) => i.attachment.id)).toEqual(wanted.slice(4));
    expect(three.next).toBeNull();
    // the picture of ANOTHER conversation is no cursor here, and a cursor that does not exist is not one either
    const foreign = await w.withFile(w.other.id, w.bee.id, "IMAGE", "foreign.png");
    expect((await get(w.t.member.id, conv.id, `?kind=IMAGE&before=${foreign.attachment.id}`)).status).toBe(404);
    expect((await get(w.t.member.id, conv.id, "?kind=IMAGE&before=nothing")).status).toBe(404);
  });

  it("an album (several pictures of ONE message) keeps every picture across a page boundary", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Album" } });
    const message = await w.say(conv.id, w.bee.id, "three pictures");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const file = await db.storedFile.create({ data: { orgId: w.orgId, uploaderId: w.bee.id, familyId: `f_${uid()}`, name: `al${i}.png`, mimeType: "image/png", size: 5, path: `p_${uid()}`, purpose: "CHAT" } });
      ids.push((await db.messageAttachment.create({ data: { messageId: message.id, fileId: file.id, kind: "IMAGE", name: `al${i}.png`, position: i } })).id);
    }
    const seen: string[] = [];
    let before = "";
    for (let page = 0; page < 5; page++) {
      const r = await get(w.t.member.id, conv.id, `?kind=IMAGE&limit=2${before}`);
      seen.push(...r.items!.map((i) => i.attachment.id));
      if (!r.next) break;
      before = `&before=${r.next}`;
    }
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(3);
  });

  it("LINK: the messages with a link card (status OK) — not a failed one, a deleted one, and not while the switches are off", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Links" } });
    const card = (url: string, status: string, title: string) => db.linkPreview.create({ data: { orgId: w.orgId, urlHash: `h_${uid()}`, url, title, siteName: "example.com", status } });
    const good = await card("https://example.com/a", "OK", "العنوان");
    const failed = await card("https://example.com/b", "FAILED", "x");
    const gone = await card("https://example.com/c", "OK", "y");
    const m1 = await w.say(conv.id, w.bee.id, "see https://example.com/a", { previewId: good.id });
    await w.say(conv.id, w.bee.id, "see https://example.com/b", { previewId: failed.id });
    await w.say(conv.id, w.bee.id, "see https://example.com/c", { previewId: gone.id, deletedAt: new Date() });
    // off (the default: the new chat screen's switch is off): no list, no count
    expect((await get(w.t.member.id, conv.id, "?kind=LINK")).links).toEqual([]);
    expect((await get(w.t.member.id, conv.id, "?counts=1")).counts?.["LINK"]).toBe(0);
    await featuresOn(w.orgId, { chatLayoutV2: true, linkPreviews: true });
    const r = await get(w.t.member.id, conv.id, "?kind=LINK");
    expect(r.items).toEqual([]);
    expect(r.links).toHaveLength(1);
    expect(r.links![0]).toMatchObject({ id: m1.id, messageId: m1.id, url: "https://example.com/a", title: "العنوان", siteName: "example.com" });
    expect((await get(w.t.member.id, conv.id, "?counts=1")).counts?.["LINK"]).toBe(1);
    await featuresOn(w.orgId, { chatLayoutV2: false });
  });

  it("counts: one number per kind, the same rule as the lists", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Counts" } });
    await w.withFile(conv.id, w.bee.id, "IMAGE", "i1.png");
    await w.withFile(conv.id, w.bee.id, "IMAGE", "i2.png");
    await w.withFile(conv.id, w.bee.id, "FILE", "f1.pdf");
    const r = await get(w.t.member.id, conv.id, "?counts=1");
    expect(r.status).toBe(200);
    expect(r.counts).toEqual({ IMAGE: 2, VIDEO: 0, FILE: 1, AUDIO: 0, LINK: 0 });
  });

  it("refusals: not mine is 404 (a restricted topic, somebody else's chat, nothing); a guest has topics only; a bad question is 422", async () => {
    const w = await getWorld();
    await w.withFile(w.restricted.id, w.bee.id, "IMAGE", `${SECRET}-r.png`);
    expect((await get(w.t.member.id, w.restricted.id, "?kind=IMAGE")).status).toBe(404);
    expect((await get(w.t.member.id, w.restricted.id, "?counts=1")).status).toBe(404);
    expect((await get(w.t.member.id, "nothing", "?kind=IMAGE")).status).toBe(404);
    // another company
    const stranger = await makeTeam();
    expect((await get(stranger.owner.id, w.topic.id, "?kind=IMAGE")).status).toBe(404);
    // a guest reads the topics of the space they are in …
    expect((await get(w.t.guest.id, w.topic.id, "?kind=IMAGE")).status).toBe(200);
    // … and nothing private
    const dm = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", spaceId: w.space.id, members: { create: [{ userId: w.t.member.id }, { userId: w.bee.id }] } } });
    expect([403, 404]).toContain((await get(w.t.guest.id, dm.id, "?kind=IMAGE")).status);
    // the question itself
    expect((await get(w.t.member.id, w.topic.id, "?kind=SOUND")).status).toBe(422);
    expect((await get(w.t.member.id, w.topic.id, "")).status).toBe(422);
    expect((await get(w.t.member.id, w.topic.id, "?kind=IMAGE&limit=0")).status).toBe(422);
    expect((await get(w.t.member.id, w.topic.id, "?kind=IMAGE&limit=101")).status).toBe(422);
  });

  it("the silent eye lists a restricted topic and leaves NO trace: no read row, no event", async () => {
    const w = await getWorld();
    const ev = async () => db.realtimeEvent.count({ where: { orgId: w.orgId } });
    const made = await w.withFile(w.restricted.id, w.bee.id, "IMAGE", "inside.png");
    const rowsBefore = await db.conversationMember.count({ where: { conversationId: w.restricted.id } });
    const before = await ev();
    const r = await get(w.t.owner.id, w.restricted.id, "?kind=IMAGE");
    expect(r.status).toBe(200);
    expect(r.items!.map((i) => i.attachment.id)).toContain(made.attachment.id);
    expect((await get(w.t.owner.id, w.restricted.id, "?counts=1")).status).toBe(200);
    expect(await db.conversationMember.count({ where: { conversationId: w.restricted.id } })).toBe(rowsBefore);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: w.restricted.id, userId: w.t.owner.id } } })).toBeNull();
    expect(await ev()).toBe(before);
  });
});

describe("the work tab «الشغل»", () => {
  async function workWorld() {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: `Work ${uid()}` } });
    const { project, board, todo } = await makeProject(w.space.id);
    const base = { orgId: w.orgId, workspaceId: w.space.id, projectId: project.id, boardId: board.id, columnId: todo.id };
    const msg = await w.say(conv.id, w.bee.id, "make it a task");
    const elsewhere = await w.say(w.other.id, w.bee.id, "another conversation");
    const open = await makeTask({ ...base, creatorId: w.bee.id, assigneeId: w.bee.id, title: "open task" });
    const hidden = await makeTask({ ...base, creatorId: w.bee.id, assigneeId: w.bee.id, title: `${SECRET} hidden task` });
    const foreign = await makeTask({ ...base, creatorId: w.bee.id, title: `${SECRET} foreign task` });
    await db.task.update({ where: { id: open.id }, data: { sourceMessageId: msg.id } });
    await db.task.update({ where: { id: hidden.id }, data: { sourceMessageId: msg.id, visibility: "PARTICIPANTS" } });
    await db.task.update({ where: { id: foreign.id }, data: { sourceMessageId: elsewhere.id } });
    const number = ((await db.ticket.aggregate({ where: { orgId: w.orgId }, _max: { number: true } }))._max.number ?? 0) + 1;
    const mine = await db.ticket.create({ data: { orgId: w.orgId, number, title: "my ticket", creatorId: w.t.member.id, assigneeId: w.bee.id, sourceMessageId: msg.id } });
    const theirs = await db.ticket.create({ data: { orgId: w.orgId, number: number + 1, title: `${SECRET} not mine`, creatorId: w.bee.id, assigneeId: w.bee.id, sourceMessageId: msg.id } });
    return { w, conv, msg, open, hidden, foreign, mine, theirs };
  }

  it("the tasks and tickets made from a message of THIS conversation — a hidden task is not even counted, a ticket nobody opens for me is not named", async () => {
    const { w, conv, open, hidden, foreign, mine, theirs } = await workWorld();
    // a member who is neither of the hidden task's people: the open task and the ticket they raised, nothing else
    const r = await work(w.t.member.id, conv.id);
    expect(r.status).toBe(200);
    expect(r.tasks!.map((t) => t.id)).toEqual([open.id]);
    expect(r.tickets!.map((t) => t.id)).toEqual([mine.id]);
    expect(r.tasks![0]!.key).toMatch(/-\d+$/);
    expect(r.tickets![0]!.key).toMatch(/-T\d+$/);
    for (const hiddenThing of [hidden.id, foreign.id, theirs.id, SECRET]) expect(r.text).not.toContain(hiddenThing);
    // the hidden task's own people see it; the owner (silent eye) sees all three that were made here
    expect((await work(w.bee.id, conv.id)).tasks!.map((t) => t.id).sort()).toEqual([open.id, hidden.id].sort());
    const owner = await work(w.t.owner.id, conv.id);
    expect(owner.tasks!.map((t) => t.id).sort()).toEqual([open.id, hidden.id].sort());
    expect(owner.tickets!.map((t) => t.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it("a conversation one cannot open is «not found»; a guest learns of no task and no ticket", async () => {
    const { w, conv } = await workWorld();
    expect((await work(w.outsider.id, w.restricted.id)).status).toBe(404);
    expect((await work(w.t.member.id, "nothing")).status).toBe(404);
    const guest = await work(w.t.guest.id, conv.id);
    expect(guest.status).toBe(200);
    expect(guest.tasks).toEqual([]);
    expect(guest.tickets).toEqual([]);
  });

  it("writes nothing for the silent eye", async () => {
    const { w, conv } = await workWorld();
    const before = await db.realtimeEvent.count({ where: { orgId: w.orgId } });
    expect((await work(w.t.owner.id, conv.id)).status).toBe(200);
    expect(await db.realtimeEvent.count({ where: { orgId: w.orgId } })).toBe(before);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: w.t.owner.id } } })).toBeNull();
  });
});
