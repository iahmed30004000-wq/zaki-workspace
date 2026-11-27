/**
 * The extra poll options and «المقالات» against a real database: what is secret in a poll is not in the payload at all (the page and the sync feed), the vote and the
 * added option obey who may vote and who may post, and an article is a message with its own limits and its own switch.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendLimiter } from "@/server/chat/messages";
import { voteLimiter } from "@/server/chat/polls";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as voteRoute from "@/app/api/chat/messages/[id]/poll/vote/route";
import * as closeRoute from "@/app/api/chat/messages/[id]/poll/close/route";
import * as optionsRoute from "@/app/api/chat/messages/[id]/poll/options/route";
import * as syncRoute from "@/app/api/chat/sync/route";
import type { MessageDto, MessagesPageDto, PollDto, SyncDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

async function world() {
  const t = await makeTeam();
  const second = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Second" });
  const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: second.id }, { userId: t.admin.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, title: "General" } });
  return { ...t, second, space, topic };
}
let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});
beforeEach(() => {
  sendLimiter.reset(`chat.send.${w.member.id}`);
  for (const person of [w.member, w.second, w.owner, w.guest]) voteLimiter.reset(`chat.vote.${person.id}`);
});

const send = (body: Record<string, unknown>, conversationId = w.topic.id) => call(messagesRoute.POST, { params: { id: conversationId }, body });
const vote = (id: string, optionIds: string[]) => call(voteRoute.PUT, { method: "PUT", params: { id }, body: { optionIds } });
const add = (id: string, text: string) => call(optionsRoute.POST, { params: { id }, body: { text } });
const seen = async (userId: string, id: string): Promise<{ dto: MessageDto; json: string }> => {
  await loginAs(userId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages`, params: { id: w.topic.id } });
  const dto = (res.json as unknown as MessagesPageDto).messages.find((m) => m.id === id)!;
  return { dto, json: JSON.stringify(dto) };
};
const setSwitch = (key: "chatPollExtras" | "chatArticles", on: boolean | null) => db.organization.update({ where: { id: w.org.id }, data: { settings: on === null ? {} : { features: { [key]: on } } } });
async function ask(poll: Record<string, unknown>) {
  await loginAs(w.member.id);
  const res = await send({ body: "سؤال؟", poll: { options: ["أ", "ب", "ج"], ...poll } });
  expect(res.status, res.text).toBe(201);
  const dto = res.json as unknown as MessageDto;
  const rows = await db.pollOption.findMany({ where: { poll: { messageId: dto.id } }, orderBy: { position: "asc" } });
  return { id: dto.id, dto, options: rows.map((o) => o.id) };
}

describe("a quiz", () => {
  it("the right answer and its line are in nobody's payload before they answered; one vote, never changed", async () => {
    const q = await ask({ quiz: true, correctOption: 1, explanation: "لأنه الباء" });
    expect(q.dto.poll).toMatchObject({ quiz: true, noRevote: true });
    expect(q.dto.poll!.options.map((o) => o.correct)).toEqual([false, true, false]); // the asker knows it

    await loginAs(w.second.id);
    const cursor = ((await call(syncRoute.GET, { url: "http://localhost/api/chat/sync" })).json as unknown as SyncDto).cursor;
    const before = await seen(w.second.id, q.id);
    expect(before.dto.poll!.resultsHidden).toBe(true);
    expect(before.json).not.toContain("correct");
    expect(before.json).not.toContain("لأنه الباء");
    await loginAs(w.member.id);
    expect((await vote(q.id, [q.options[1]!])).status).toBe(200);
    await loginAs(w.second.id);
    const feed = await call(syncRoute.GET, { url: `http://localhost/api/chat/sync?after=${cursor}` });
    const told = JSON.stringify((feed.json as unknown as SyncDto).messages.find((m) => m.id === q.id));
    expect(told).not.toContain("correct");
    expect(told).not.toContain("لأنه الباء");

    const answered = await vote(q.id, [q.options[0]!]);
    expect(answered.status).toBe(200);
    const poll = (answered.json as unknown as MessageDto).poll as PollDto;
    expect(poll.explanation).toBe("لأنه الباء");
    expect(poll.options.find((o) => o.id === q.options[1])!.correct).toBe(true);
    expect(poll.canVote).toBe(false);
    expect((await vote(q.id, [q.options[0]!])).status).toBe(200); // the same vote again
    expect((await vote(q.id, [q.options[1]!])).status).toBe(403);
    expect((await vote(q.id, [])).status).toBe(403);
    const guest = await seen(w.guest.id, q.id);
    expect(guest.json).not.toContain("correct");
    expect(guest.json).not.toContain("لأنه الباء");
  });

  it("a shape that makes no sense is refused and nothing is written", async () => {
    await loginAs(w.member.id);
    const count = await db.poll.count();
    for (const poll of [{ quiz: true }, { quiz: true, correctOption: 5 }, { quiz: true, correctOption: 0, multiple: true }, { quiz: true, correctOption: 0, openOptions: true }, { correctOption: 0 }, { explanation: "x" }, { quiz: true, correctOption: 0, explanation: "ا".repeat(201) }]) {
      expect((await send({ body: "؟", poll: { options: ["أ", "ب"], ...poll } })).status, JSON.stringify(poll)).toBe(422);
    }
    expect(await db.poll.count()).toBe(count);
  });
});

describe("hidden results", () => {
  it("no count, percent or name leaves the server until the poll closes", async () => {
    const q = await ask({ hideResults: true });
    await loginAs(w.second.id);
    await vote(q.id, [q.options[2]!]);
    for (const person of [w.member.id, w.second.id, w.admin.id, w.owner.id]) {
      const view = (await seen(person, q.id)).dto.poll!;
      expect(view.resultsHidden).toBe(true);
      expect(view.options.map((o) => [o.count, o.percent])).toEqual([[0, 0], [0, 0], [0, 0]]);
      expect(view.options.some((o) => o.voters)).toBe(false);
    }
    await loginAs(w.member.id);
    expect((await call(closeRoute.POST, { params: { id: q.id } })).status).toBe(200);
    const after = (await seen(w.second.id, q.id)).dto.poll!;
    expect(after.resultsHidden).toBeUndefined();
    expect(after.options[2]).toMatchObject({ count: 1, percent: 100 });
  });
});

describe("adding an option", () => {
  it("only on a poll sent open, by somebody who may vote and post, distinct and at most ten; votes already cast stay", async () => {
    const q = await ask({ openOptions: true });
    await loginAs(w.second.id);
    await vote(q.id, [q.options[0]!]);
    const made = await add(q.id, "  د   جديد ");
    expect(made.status, made.text).toBe(200);
    expect((made.json as unknown as MessageDto).poll!.options.map((o) => o.text)).toEqual(["أ", "ب", "ج", "د جديد"]);
    expect((made.json as unknown as MessageDto).poll!.options[0]!.count).toBe(1);
    expect((await add(q.id, "د جديد")).status).toBe(422);
    expect((await add(q.id, "​")).status).toBe(422);
    expect((await add(q.id, "ا".repeat(101))).status).toBe(422);
    await loginAs(w.guest.id);
    expect((await add(q.id, "من الشريك")).status).toBe(403);
    await loginAs(w.owner.id); // the silent eye
    expect((await add(q.id, "من الرقيب")).status).toBe(403);
    // somebody who may read but not post
    await db.conversation.update({ where: { id: w.topic.id }, data: { postingPolicy: "ADMINS" } });
    await loginAs(w.second.id);
    expect((await add(q.id, "ممنوع")).status).toBe(403);
    await db.conversation.update({ where: { id: w.topic.id }, data: { postingPolicy: "ALL" } });
    for (let i = 5; i <= 10; i += 1) expect((await add(q.id, `خيار ${i}`)).status).toBe(200);
    expect((await add(q.id, "الحادي عشر")).status).toBe(422);
    const fixed = await ask({});
    await loginAs(w.second.id);
    expect((await add(fixed.id, "لا")).status).toBe(403);
  });

  it("the switch off: a poll with an extra is refused, nobody adds; a plain poll is as before, and a quiz already sent still hides its answer", async () => {
    const quiz = await ask({ quiz: true, correctOption: 0 });
    const open = await ask({ openOptions: true });
    await setSwitch("chatPollExtras", false);
    await loginAs(w.member.id);
    for (const poll of [{ quiz: true, correctOption: 0 }, { openOptions: true }, { hideResults: true }, { noRevote: true }, { shuffle: true }]) {
      expect((await send({ body: "؟", poll: { options: ["أ", "ب"], ...poll } })).status, JSON.stringify(poll)).toBe(403);
    }
    expect((await send({ body: "؟", poll: { options: ["أ", "ب"] } })).status).toBe(201);
    expect((await add(open.id, "د")).status).toBe(404);
    expect((await seen(w.second.id, quiz.id)).json).not.toContain("correct");
    await setSwitch("chatPollExtras", null);
  });
});

describe("«المقالات»", () => {
  const body = `عنوان المقال\n## قسم\n- بند\n> اقتباس\n${"نص طويل ".repeat(900)}`;

  it("a long post goes as an ARTICLE; without the flag the ordinary limit holds; the bell says the title only", async () => {
    await loginAs(w.member.id);
    expect(body.length).toBeGreaterThan(4000);
    expect((await send({ body })).status).toBe(422);
    const res = await send({ body, article: true, mentions: [w.second.id] });
    expect(res.status, res.text).toBe(201);
    const dto = res.json as unknown as MessageDto;
    expect(dto.kind).toBe("ARTICLE");
    expect(dto.body).toBe(body.trim());
    const bell = await db.notification.findFirstOrThrow({ where: { userId: w.second.id, linkUrl: { contains: dto.id } } });
    expect(bell.body).toBe("📄 عنوان المقال");
  });

  it("a title and some words are needed, only pictures go with it, never a guest, never with a poll or a voice note", async () => {
    await loginAs(w.member.id);
    expect((await send({ body: "عنوان بس", article: true })).status).toBe(422);
    expect((await send({ body: `${"ا".repeat(121)}\nنص`, article: true })).status).toBe(422);
    expect((await send({ body: `ع\n${"ا".repeat(20_001)}`, article: true })).status).toBe(422);
    const id = uid();
    await db.storedFile.create({ data: { id, orgId: w.org.id, uploaderId: w.member.id, familyId: id, name: "a.pdf", mimeType: "application/pdf", size: 4, path: id, purpose: "CHAT" } });
    expect((await send({ body: "ع\nنص", article: true, attachmentIds: [id] })).status).toBe(422);
    expect((await send({ body: "ع\nنص", article: true, poll: { options: ["أ", "ب"] } })).status).toBe(422);
    await loginAs(w.guest.id);
    expect((await send({ body: "ع\nنص", article: true })).status).toBe(403);
  });

  it("the author edits it as an article (history kept); its files are never swapped; the switch off: no new one and no edit", async () => {
    await loginAs(w.member.id);
    const made = (await send({ body: "ع\nالنص الأول", article: true })).json as unknown as MessageDto;
    const patch = (b: Record<string, unknown>) => call(messageRoute.PATCH, { method: "PATCH", params: { id: made.id }, body: b });
    expect((await patch({ body })).status).toBe(200);
    expect((await patch({ body: "عنوان بلا نص" })).status).toBe(422);
    expect((await patch({ body: "" })).status).toBe(422);
    expect((await patch({ body, replace: { attachmentId: "x", uploadId: "y" } })).status).toBe(403);
    expect((await db.messageRevision.findFirstOrThrow({ where: { messageId: made.id } })).body).toBe("ع\nالنص الأول");
    await loginAs(w.second.id);
    expect((await patch({ body: "ع\nمن غيري" })).status).toBe(403);
    await setSwitch("chatArticles", false);
    await loginAs(w.member.id);
    expect((await send({ body: "ع\nنص", article: true })).status).toBe(404);
    expect((await patch({ body: "ع\nنص" })).status).toBe(404);
    await setSwitch("chatArticles", null);
  });
});
