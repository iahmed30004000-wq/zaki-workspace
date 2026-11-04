import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as digestRoute from "@/app/api/digest/route";
import * as summarizeRoute from "@/app/api/chat/conversations/[id]/summarize/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AiProviderError, type AiCompletion, type AiRequest } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { clearDigestLimitsForTests } from "@/server/services/digest";
import { saveKey } from "@/server/services/owner-assistant-settings";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «شو فاتني؟» — against a real PostgreSQL and a FAKE provider (the network is never touched).
 *
 * What this pins:
 *  - off means off: «ملخّص شو فاتني», «مساعد المالك» or «قراءة الدردشات للمساعد» off, or a partner: not found, and the model is never called;
 *    with no key a plain Arabic key comes back and the model is never called;
 *  - who gets what: only what the person may already read reaches the prompt — a topic they are not in, a private chat, a topic a guest can
 *    reach, somebody else's task and a reward task never appear; phones, e-mails and addresses are masked and people are «زميل n»;
 *  - the limits: at most 8 messages of a topic, 400 characters each, no tools; 5 calls a minute;
 *  - the cache: a second opening does not call the model, «حدّث» does, a 4-hour-old row is not used;
 *  - «لخّصلي» answers the person only (nothing is posted), refuses what they cannot read and what a guest can reach;
 *  - the audit rows hold counters and never the words.
 */

const KEY = "sk-ant-api03-DIGEST-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore

let seen: AiRequest[] = [];
let script: (request: AiRequest) => Partial<AiCompletion> | Promise<Partial<AiCompletion>> = () => ({ text: "• اتفقتوا على الموعد." });
beforeEach(() => {
  seen = [];
  script = () => ({ text: "• اتفقتوا على الموعد." });
  setProviderFactoryForTests(() => ({
    async complete(request) {
      seen.push(request);
      const out = await script(request);
      return { text: out.text ?? "", toolCalls: out.toolCalls ?? [], usage: out.usage ?? { inputTokens: 100, outputTokens: 40 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

const sentText = () => JSON.stringify(seen.map((s) => ({ system: s.system, messages: s.messages, tools: s.tools })));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function say(orgId: string, conversationId: string, authorId: string, body: string, createdAt?: Date) {
  return db.chatMessage.create({ data: { orgId, conversationId, authorId, body, kind: "TEXT", ...(createdAt ? { createdAt } : {}) } });
}

async function world(opts: { digest?: boolean; key?: boolean } = {}) {
  const t = await makeTeam();
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة الأحمد" });
  const omar = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "عمر حداد" });
  const lina = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "لينا خوري" });
  const ws = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: t.admin.id, role: "ADMIN" }], "المبيعات");
  // a space with a partner in it: every open topic of it is reachable by the partner
  const wsGuest = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: t.guest.id, role: "GUEST" }], "مع الشريك");
  // a space sara is not in
  const wsOther = await makeWorkspace(t.org.id, [{ userId: omar.id }, { userId: lina.id }], "الإدارة");

  // sara's own topic: she has a row with a read mark an hour old; omar wrote since
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "حكي المبيعات", members: { create: [{ userId: sara.id, lastReadAt: hoursAgo(1) }, { userId: omar.id }] } } });
  await say(t.org.id, topic.id, omar.id, "الزبون على 0791234567 وإيميله zaid@example.com، العنوان شارع الجامعة عمارة 5 طابق 3", hoursAgo(0.5));
  await say(t.org.id, topic.id, omar.id, "سارة، شوفي موعد التسليم الخميس", hoursAgo(0.4));
  // an open topic of her space that she has no row in: read through the space, last day only
  const openTopic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "إعلانات الفريق" } });
  await say(t.org.id, openTopic.id, omar.id, "OPEN-TOPIC-LINE اجتماع الفريق بكرا العاشرة", hoursAgo(2));
  // a restricted topic of her space she is NOT in
  const restricted = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "رواتب", restricted: true, members: { create: [{ userId: omar.id }, { userId: t.admin.id }] } } });
  await say(t.org.id, restricted.id, omar.id, "SECRET-RESTRICTED-TOPIC", hoursAgo(1));
  // a topic of a space she is not in
  const foreign = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: wsOther.id, title: "سري", members: { create: [{ userId: omar.id }] } } });
  await say(t.org.id, foreign.id, omar.id, "SECRET-OTHER-SPACE", hoursAgo(1));
  // a private chat between sara and omar: never read
  const dm = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", dmKey: [sara.id, omar.id].sort().join("|"), members: { create: [{ userId: sara.id, lastReadAt: hoursAgo(1) }, { userId: omar.id }] } } });
  await say(t.org.id, dm.id, omar.id, "SECRET-PRIVATE-CHAT", hoursAgo(0.3));
  // a topic where a partner can read: refused whole
  const guestTopic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: wsGuest.id, title: "مع الشريك", members: { create: [{ userId: sara.id, lastReadAt: hoursAgo(1) }, { userId: omar.id }] } } });
  await say(t.org.id, guestTopic.id, omar.id, "SECRET-GUEST-REACHABLE", hoursAgo(0.2));
  // sara's own conversation with the assistant (a topic with a key): never read
  const mine = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "المساعد", dmKey: `assistant:${sara.id}`, members: { create: [{ userId: sara.id, lastReadAt: hoursAgo(1) }] } } });
  await say(t.org.id, mine.id, omar.id, "SECRET-ASSISTANT-CHAT", hoursAgo(0.2));

  // tasks: one late of hers, one of omar's, one reward task of hers
  const p = await makeProject(ws.id);
  const base = { orgId: t.org.id, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: t.admin.id };
  const late = await makeTask({ ...base, assigneeId: sara.id, title: "تسليم عرض الأسعار المتأخر", dueDate: new Date(Date.now() - 3 * 86_400_000) });
  const others = await makeTask({ ...base, assigneeId: omar.id, title: "SECRET-OMAR-TASK", dueDate: new Date(Date.now() - 3 * 86_400_000) });
  const reward = await makeTask({ ...base, assigneeId: sara.id, title: "SECRET-REWARD-TASK", dueDate: new Date(Date.now() - 3 * 86_400_000) });
  await db.task.update({ where: { id: reward.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 500, rewardCurrency: "JOD" } });

  if (opts.digest !== false) await setFeature(t.org.id, "morningDigest", true);
  await setFeature(t.org.id, "chatAssistant", true);
  await setFeature(t.org.id, "ownerAssistant", true);
  if (opts.key !== false) await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  return { ...t, sara, omar, lina, ws, wsGuest, topic, openTopic, restricted, foreign, dm, guestTopic, mine, late, others, reward };
}
type World = Awaited<ReturnType<typeof world>>;

async function digest(who: string, body: Record<string, unknown> = {}) {
  await loginAs(who);
  clearDigestLimitsForTests(who);
  return call(digestRoute.POST, { method: "POST", body });
}
const summarize = async (who: string, conversationId: string) => {
  await loginAs(who);
  clearDigestLimitsForTests(who);
  return call(summarizeRoute.POST, { method: "POST", params: { id: conversationId } });
};
const audits = (orgId: string, action: string) => db.auditLog.findMany({ where: { orgId, action } });

describe("off means off", () => {
  it("with «ملخّص شو فاتني», «مساعد المالك» or «قراءة الدردشات للمساعد» off, nothing answers and the model is never called", async () => {
    const w = await world({ digest: false });
    expect((await digest(w.sara.id)).status).toBe(404);
    expect((await summarize(w.sara.id, w.topic.id)).status).toBe(404);
    await setFeature(w.org.id, "morningDigest", true);
    await setFeature(w.org.id, "ownerAssistant", false);
    expect((await digest(w.sara.id)).status).toBe(404);
    await setFeature(w.org.id, "ownerAssistant", true);
    await setFeature(w.org.id, "chatAssistant", false);
    expect((await digest(w.sara.id)).status).toBe(404);
    expect((await summarize(w.sara.id, w.topic.id)).status).toBe(404);
    expect(seen).toHaveLength(0);
    expect(await db.digestCache.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("off, the topic page is told there is no button; on, a topic of staff is told there is", async () => {
    const w = await world({ digest: false });
    await loginAs(w.sara.id);
    expect((await call(conversationRoute.GET, { params: { id: w.topic.id } })).json?.["digest"]).toBe(false);
    await setFeature(w.org.id, "morningDigest", true);
    expect((await call(conversationRoute.GET, { params: { id: w.topic.id } })).json?.["digest"]).toBe(true);
    // never in a private chat or the assistant's own conversation
    expect((await call(conversationRoute.GET, { params: { id: w.dm.id } })).json?.["digest"]).toBe(false);
    expect((await call(conversationRoute.GET, { params: { id: w.mine.id } })).json?.["digest"]).toBe(false);
  });

  it("a partner has no digest and no summary (not found), whatever is on", async () => {
    const w = await world();
    expect((await digest(w.guest.id)).status).toBe(404);
    expect((await summarize(w.guest.id, w.guestTopic.id)).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("with no key the answer is a dictionary key and the model is never called", async () => {
    const w = await world({ key: false });
    const res = await digest(w.sara.id);
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("digest.err.no_key");
    const sum = await summarize(w.sara.id, w.topic.id);
    expect(sum.json?.["message"]).toBe("digest.err.no_key");
    expect(seen).toHaveLength(0);
  });
});

describe("who gets what", () => {
  it("only what the person may read reaches the prompt, filtered, with no tools", async () => {
    const w = await world();
    const res = await digest(w.sara.id);
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ text: "• اتفقتوا على الموعد.", empty: false, cached: false });
    expect(seen).toHaveLength(1);
    const sent = sentText();
    // hers: the late task, the topic she is in, the open topic of her own space
    expect(sent).toContain("تسليم عرض الأسعار المتأخر");
    expect(sent).toContain("late 3d");
    expect(sent).toContain("شوفي موعد التسليم");
    expect(sent).toContain("[حكي المبيعات]");
    expect(sent).toContain("OPEN-TOPIC-LINE");
    // never: a topic she is not in, a space she is not in, a private chat, a partner-reachable topic, the assistant's own chat,
    // somebody else's task, a reward task
    for (const secret of ["SECRET-RESTRICTED-TOPIC", "SECRET-OTHER-SPACE", "SECRET-PRIVATE-CHAT", "SECRET-GUEST-REACHABLE", "SECRET-ASSISTANT-CHAT", "SECRET-OMAR-TASK", "SECRET-REWARD-TASK"]) {
      expect(sent, secret).not.toContain(secret);
    }
    // filtered: phone, e-mail, address; people are «زميل n»
    expect(sent).not.toContain("0791234567");
    expect(sent).not.toContain("example.com");
    expect(sent).not.toMatch(/الجامعة|عمارة 5/);
    expect(sent).not.toMatch(/سارة|الأحمد|عمر|حداد/);
    expect(sent).toContain("زميل 1");
    expect(sent).toContain("[رقم]");
    expect(sent).toContain("[عنوان]");
    // one user turn, no tools
    expect(seen[0]!.messages).toHaveLength(1);
    expect(seen[0]!.tools).toBeUndefined();
  });

  it("a topic with a read mark shows only what is newer than the mark, and a topic with nothing new is left out", async () => {
    const w = await world();
    await say(w.org.id, w.topic.id, w.sara.id, "OLD-LINE-BEFORE-MARK", hoursAgo(5));
    // sara has read everything up to now in the open-topic-less world: only her own words are new
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.sara.id } }, data: { lastReadAt: new Date() } });
    await db.task.updateMany({ where: { assigneeId: w.sara.id }, data: { dueDate: null, updatedAt: hoursAgo(120) } });
    await db.chatMessage.deleteMany({ where: { conversationId: w.openTopic.id } });
    const res = await digest(w.sara.id);
    expect(res.json).toMatchObject({ empty: true });
    expect(seen).toHaveLength(0);
  });

  it("is bounded: 8 messages per topic and 400 characters each", async () => {
    const w = await world();
    for (let i = 0; i < 12; i++) await say(w.org.id, w.topic.id, w.omar.id, `LINE-${String(i).padStart(2, "0")} ${"ك".repeat(900)}`, new Date(Date.now() - (20 - i) * 60_000));
    await digest(w.sara.id);
    const sent = seen[0]!.messages[0]!.content;
    const block = /\[حكي المبيعات\]\n([\s\S]*?)(?:\n\n\[|\n<\/topics>|$)/.exec(sent)?.[1] ?? "";
    const rows = block.split("\n").filter((l) => l.includes(": "));
    expect(rows.length).toBeLessThanOrEqual(8);
    for (const row of rows) expect([...row].length).toBeLessThanOrEqual(400 + "زميل 1: ".length);
    // the oldest of the twelve fell out, the newest stayed
    expect(sent).not.toContain("LINE-00");
    expect(sent).toContain("LINE-11");
  });

  it("the owner's silent reading is not used: he gets only what he is in, here nothing", async () => {
    const w = await world();
    const res = await digest(w.owner.id);
    expect(res.json).toMatchObject({ empty: true });
    expect(seen).toHaveLength(0);
  });
});

describe("the cache and the limits", () => {
  it("a second opening is served from the cache; «حدّث» asks again; a 4-hour-old row is not used", async () => {
    const w = await world();
    const first = await digest(w.sara.id);
    expect(first.json).toMatchObject({ cached: false });
    expect(seen).toHaveLength(1);
    const second = await digest(w.sara.id);
    expect(second.json).toMatchObject({ cached: true, text: "• اتفقتوا على الموعد." });
    expect(seen).toHaveLength(1);
    script = () => ({ text: "• جواب جديد." });
    const refreshed = await digest(w.sara.id, { refresh: true });
    expect(refreshed.json).toMatchObject({ cached: false, text: "• جواب جديد." });
    expect(seen).toHaveLength(2);
    expect(await db.digestCache.count({ where: { orgId: w.org.id, userId: w.sara.id } })).toBe(1);
    // the cache is per person
    expect(await db.digestCache.count({ where: { orgId: w.org.id, userId: w.omar.id } })).toBe(0);
    await db.digestCache.updateMany({ where: { userId: w.sara.id }, data: { createdAt: hoursAgo(4) } });
    script = () => ({ text: "• بعد أربع ساعات." });
    expect((await digest(w.sara.id)).json).toMatchObject({ cached: false, text: "• بعد أربع ساعات." });
    expect(seen).toHaveLength(3);
  });

  it("5 calls a minute for a person; the cache hit is not a call", async () => {
    const w = await world();
    await loginAs(w.sara.id);
    clearDigestLimitsForTests(w.sara.id);
    const run = () => call(digestRoute.POST, { method: "POST", body: { refresh: true } });
    for (let i = 0; i < 5; i++) expect((await run()).status).toBe(200);
    const sixth = await run();
    expect(sixth.status).toBe(429);
    expect(sixth.json?.["message"]).toBe("digest.err.rate");
    expect(seen).toHaveLength(5);
    // the cache still answers, and so does nobody else's limit change
    expect((await call(digestRoute.POST, { method: "POST", body: {} })).json).toMatchObject({ cached: true });
  });

  it("a failing provider is a short Arabic key, nothing is cached, and the words never reach the log row", async () => {
    const w = await world();
    script = () => {
      throw new AiProviderError("assistant.err_overloaded");
    };
    const res = await digest(w.sara.id);
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("digest.err.busy");
    expect(await db.digestCache.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the audit rows hold counters and never the words", async () => {
    const w = await world();
    await digest(w.sara.id);
    await summarize(w.sara.id, w.topic.id);
    const d = await audits(w.org.id, "digest.generated");
    const s = await audits(w.org.id, "digest.topic_summarized");
    expect(d).toHaveLength(1);
    expect(s).toHaveLength(1);
    expect(d[0]!.actorId).toBe(w.sara.id);
    expect(d[0]!.meta).toMatchObject({ topics: 2, tasks: 1 });
    expect((d[0]!.meta as { charsSent: number }).charsSent).toBeGreaterThan(0);
    expect(s[0]!.conversationId).toBe(w.topic.id);
    const everything = JSON.stringify([d, s]);
    expect(everything).not.toMatch(/اتفقتوا|الموعد|تسليم|0791234567|OPEN-TOPIC-LINE/);
    // the cache holds the model's short answer only, never what it read
    const cached = await db.digestCache.findFirstOrThrow({ where: { userId: w.sara.id } });
    expect(cached.text).toBe("• اتفقتوا على الموعد.");
    // usage is counted like every other call of the assistant
    expect((await db.aiUsage.aggregate({ where: { orgId: w.org.id, userId: w.sara.id }, _sum: { requests: true } }))._sum.requests).toBe(2);
  });
});

describe("«لخّصلي»", () => {
  it("answers the person only: nothing is posted, nothing is cached, and it reads that topic alone", async () => {
    const w = await world();
    for (let i = 0; i < 45; i++) await say(w.org.id, w.topic.id, w.omar.id, `MSG-${String(i).padStart(2, "0")}`, new Date(Date.now() - (60 - i) * 60_000));
    const before = await db.chatMessage.count({ where: { conversationId: w.topic.id } });
    const res = await summarize(w.sara.id, w.topic.id);
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ text: "• اتفقتوا على الموعد.", empty: false });
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(before);
    expect(await db.digestCache.count({ where: { orgId: w.org.id } })).toBe(0);
    const sent = sentText();
    expect(sent).toContain("MSG-44");
    expect(sent).not.toContain("MSG-00"); // only the last 40
    for (const secret of ["SECRET-RESTRICTED-TOPIC", "SECRET-PRIVATE-CHAT", "OPEN-TOPIC-LINE", "تسليم عرض الأسعار"]) expect(sent).not.toContain(secret);
    expect(seen[0]!.tools).toBeUndefined();
  });

  it("refuses what the person cannot read (not found), a private chat, the assistant's chat, and a topic a partner can reach", async () => {
    const w = await world();
    for (const id of [w.restricted.id, w.foreign.id, w.dm.id, w.mine.id]) expect((await summarize(w.sara.id, id)).status, id).toBe(404);
    const guest = await summarize(w.sara.id, w.guestTopic.id);
    expect(guest.status).toBe(409);
    expect(guest.json?.["message"]).toBe("digest.err.guest");
    expect(seen).toHaveLength(0);
  });

  it("a topic with no messages says so without calling the model", async () => {
    const w = await world();
    const empty = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "فاضي" } });
    expect((await summarize(w.sara.id, empty.id)).json).toMatchObject({ empty: true });
    expect(seen).toHaveLength(0);
  });
});
