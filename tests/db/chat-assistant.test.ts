import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { ASSISTANT_MENTION_ID } from "@/lib/chat/conversation/mentions";
import { AiProviderError, type AiCompletion, type AiRequest } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import { answerMention, clearChatAssistantLimitsForTests, settleChatAssistantForTests } from "@/server/services/chat-assistant";
import { saveKey, updateSettings } from "@/server/services/owner-assistant-settings";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «@المساعد» في الدردشة والتوبكس — against a real PostgreSQL and a FAKE provider (the network is never touched).
 *
 * What this pins:
 *  - off means off: with «قراءة الدردشات للمساعد» (or «مساعد المالك», or the key) missing, the assistant is not in the «@» list and a typed
 *    mention is plain text: no model call, no line, no audit row;
 *  - it answers only a mention, only for ACTIVE staff who read the conversation, once, in the SAME conversation, and a guest never wakes it;
 *  - a conversation with a guest among its people is refused in Arabic and nothing is sent to the model;
 *  - what the model is given: the last messages of THAT conversation only, filtered (no phone, e-mail, link, address, staff name), no
 *    tools, so nothing can be executed; another conversation's words never appear;
 *  - limits, failures and double delivery: a clear Arabic line, no stack, no words in the log, exactly one answer;
 *  - the audit row holds counters and never the words.
 */

const KEY = "sk-ant-api03-CHATAI-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore

interface Seen {
  apiKey: string;
  request: AiRequest;
}
let seen: Seen[] = [];
let script: (request: AiRequest) => Partial<AiCompletion> | Promise<Partial<AiCompletion>> = () => ({ text: "جواب المساعد" });

beforeEach(() => {
  seen = [];
  script = () => ({ text: "جواب المساعد" });
  setProviderFactoryForTests((cfg) => ({
    async complete(request) {
      seen.push({ apiKey: cfg.apiKey, request });
      const out = await script(request);
      return { text: out.text ?? "", toolCalls: out.toolCalls ?? [], usage: out.usage ?? { inputTokens: 100, outputTokens: 40 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

/** Everything the provider was ever given, as one string. */
const sentText = () => JSON.stringify(seen.map((s) => ({ system: s.request.system, messages: s.request.messages, tools: s.request.tools })));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(opts: { chat?: boolean; owner?: boolean; key?: boolean } = {}) {
  const t = await makeTeam();
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة الأحمد" });
  const omar = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "عمر حداد" });
  const ws = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: t.admin.id, role: "ADMIN" }], "المبيعات");
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "حكي المبيعات" } });
  const other = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "حكي ثاني", restricted: true, members: { create: [{ userId: sara.id }] } } });
  if (opts.chat !== false) await setFeature(t.org.id, "chatAssistant", true);
  if (opts.owner !== false) await setFeature(t.org.id, "ownerAssistant", true);
  if (opts.key !== false) await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  return { ...t, sara, omar, ws, topic, other };
}
type World = Awaited<ReturnType<typeof world>>;

/** Posts a message as somebody through the real route (so the real send path, with its hook, runs), then waits for the assistant. */
async function say(who: string, conversationId: string, body: string, extra: Record<string, unknown> = {}) {
  await loginAs(who);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body, ...extra } });
  await settleChatAssistantForTests();
  return res;
}

const lines = (conversationId: string) =>
  db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } }, orderBy: { createdAt: "asc" } });
const pOf = (body: string) => (JSON.parse(body) as { p: { text: string; err?: string; first?: number; read?: number } }).p;
const audits = (orgId: string) => db.auditLog.findMany({ where: { orgId, action: "chat.assistant_asked" } });
const mentionables = async (who: string, conversationId: string) => {
  await loginAs(who);
  const res = await call(conversationRoute.GET, { params: { id: conversationId } });
  return (res.json?.["mentionables"] ?? []) as { id: string; name: string }[];
};

describe("off means off", () => {
  it("with «قراءة الدردشات للمساعد» off the assistant is not offered and a typed mention does nothing", async () => {
    const w = await world({ chat: false });
    expect((await mentionables(w.sara.id, w.topic.id)).map((m) => m.id)).not.toContain(ASSISTANT_MENTION_ID);
    const before = await db.chatMessage.count({ where: { conversationId: w.topic.id } });
    expect((await say(w.sara.id, w.topic.id, "@المساعد لخّص")).status).toBe(201);
    expect(seen).toHaveLength(0);
    expect(await lines(w.topic.id)).toHaveLength(0);
    expect(await audits(w.org.id)).toHaveLength(0);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(before + 1); // only her own message
  });

  it("without «مساعد المالك» or without the owner's key it is not offered either", async () => {
    const noOwner = await world({ owner: false });
    expect((await mentionables(noOwner.sara.id, noOwner.topic.id)).map((m) => m.id)).not.toContain(ASSISTANT_MENTION_ID);
    await say(noOwner.sara.id, noOwner.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(0);
    expect(await lines(noOwner.topic.id)).toHaveLength(0);

    const noKey = await world({ key: false });
    expect((await mentionables(noKey.sara.id, noKey.topic.id)).map((m) => m.id)).not.toContain(ASSISTANT_MENTION_ID);
  });

  it("when everything is on it is offered to staff, in a topic and in a private chat, and never to a guest", async () => {
    const w = await world();
    const offered = await mentionables(w.sara.id, w.topic.id);
    expect(offered.find((m) => m.id === ASSISTANT_MENTION_ID)?.name).toBe("المساعد");
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: `${w.sara.id}|${w.omar.id}`, members: { create: [{ userId: w.sara.id }, { userId: w.omar.id }] } } });
    expect((await mentionables(w.sara.id, dm.id)).map((m) => m.id)).toContain(ASSISTANT_MENTION_ID);
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    expect((await mentionables(w.guest.id, w.topic.id)).map((m) => m.id)).not.toContain(ASSISTANT_MENTION_ID);
  });
});

describe("it answers a mention, once, in the same conversation", () => {
  it("a plain message, a reply to the assistant without the word, and an EDIT that adds the word never wake it", async () => {
    const w = await world();
    await say(w.sara.id, w.topic.id, "رسالة عادية بدون منشن");
    await say(w.sara.id, w.topic.id, "المساعد بدون علامة");
    const m = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic.id, body: "رسالة عادية بدون منشن" } });
    await loginAs(w.sara.id);
    expect((await call(messageRoute.PATCH, { method: "PATCH", params: { id: m.id }, body: { body: "@المساعد صارت منشن بعد التعديل" } })).status).toBe(200);
    await settleChatAssistantForTests();
    expect(seen).toHaveLength(0);
    expect(await lines(w.topic.id)).toHaveLength(0);
  });

  it("answers with one line in that conversation, labelled and with the first-use warning, and writes one audit row without any words", async () => {
    const w = await world();
    script = () => ({ text: "الخلاصة: اتفقتوا على الموعد." });
    await say(w.omar.id, w.topic.id, "الزبون طلب تأجيل");
    expect((await say(w.sara.id, w.topic.id, "@المساعد لخّص الحكي لو سمحت")).status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.apiKey).toBe(KEY);
    const rows = await lines(w.topic.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.conversationId).toBe(w.topic.id);
    expect(rows[0]!.kind).toBe("SYSTEM");
    const p = pOf(rows[0]!.body);
    expect(p.text).toBe("الخلاصة: اتفقتوا على الموعد.");
    expect(p.first).toBe(1);
    expect(p.read).toBe(2);
    // a second answer in the same conversation no longer carries the full first-use note
    clearChatAssistantLimitsForTests({ userId: w.sara.id, conversationId: w.topic.id });
    await say(w.sara.id, w.topic.id, "@المساعد وبعدين؟");
    expect(pOf((await lines(w.topic.id))[1]!.body).first).toBeUndefined();

    const rowsAudit = await audits(w.org.id);
    expect(rowsAudit).toHaveLength(2);
    const a = rowsAudit[0]!;
    expect(a.actorId).toBe(w.sara.id);
    expect(a.conversationId).toBe(w.topic.id);
    expect(a.meta).toMatchObject({ outcome: "answered", readMessages: 2 });
    const meta = a.meta as { charsSent: number; charsReply: number };
    expect(meta.charsSent).toBeGreaterThan(0);
    expect(meta.charsReply).toBe("الخلاصة: اتفقتوا على الموعد.".length);
    // never the words: not the question, not the answer, not what the others said
    const everything = JSON.stringify(rowsAudit);
    expect(everything).not.toMatch(/لخّص|الخلاصة|الزبون طلب|تأجيل/);
  });

  it("sends only THIS conversation, text only, filtered, with no tools and no staff names", async () => {
    const w = await world();
    await say(w.sara.id, w.other.id, "سر المحادثة الثانية SECRET-OTHER-CONVERSATION");
    await say(w.omar.id, w.topic.id, "الزبون على 0791234567 وإيميله zaid@example.com، العنوان شارع الجامعة عمارة 5 طابق 3");
    await say(w.omar.id, w.topic.id, "سارة، شوفي موعد التسليم");
    await say(w.sara.id, w.topic.id, "@المساعد شو الوضع؟");
    expect(seen).toHaveLength(1);
    const sent = sentText();
    expect(sent).not.toContain("SECRET-OTHER-CONVERSATION");
    expect(sent).not.toContain("0791234567");
    expect(sent).not.toContain("example.com");
    expect(sent).not.toMatch(/الجامعة|عمارة 5/);
    expect(sent).not.toMatch(/سارة|الأحمد|عمر|حداد/);
    expect(sent).toContain("زميل 1");
    expect(sent).toContain("[رقم]");
    expect(sent).toContain("[عنوان]");
    // the mention is a plain word, the request is a single user turn inside <chat>, and nothing can be called
    expect(JSON.stringify(seen[0]!.request.messages)).not.toContain("@المساعد");
    expect(seen[0]!.request.messages).toHaveLength(1);
    expect(seen[0]!.request.messages[0]!.content.startsWith("<chat>")).toBe(true);
    expect(seen[0]!.request.tools).toBeUndefined();
    // nothing of the owner board or the company is in it
    expect(sent).not.toMatch(/المبيعات|حكي ثاني/);
  });

  it("with names allowed (the owner's setting) the real names go and the numbers are still masked", async () => {
    const w = await world();
    await updateSettings({ orgId: w.org.id, userId: w.owner.id }, { allowNames: true });
    await say(w.omar.id, w.topic.id, "كلّموه على 0791234567");
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    const sent = sentText();
    expect(sent).toContain("عمر حداد");
    expect(sent).not.toContain("0791234567");
  });

  it("reads at most the last 30 messages", async () => {
    const w = await world();
    for (let i = 0; i < 40; i += 1) await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.omar.id, body: `قديم رقم-${i}-` } });
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(pOf((await lines(w.topic.id))[0]!.body).read).toBe(30);
    expect(sentText()).not.toContain("رقم-0-");
    expect(sentText()).toContain("رقم-39-");
  });

  it("works in a private chat between two staff, and only they read the answer", async () => {
    const w = await world();
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: `${w.sara.id}|${w.omar.id}`, members: { create: [{ userId: w.sara.id }, { userId: w.omar.id }] } } });
    await say(w.omar.id, dm.id, "خاص: كلمة سرية DM-ONLY");
    await say(w.sara.id, dm.id, "@المساعد لخّص");
    expect(await lines(dm.id)).toHaveLength(1);
    expect(await lines(w.topic.id)).toHaveLength(0);
    // a third person (the admin) cannot read that DM or its answer
    await loginAs(w.admin.id);
    expect((await call(conversationRoute.GET, { params: { id: dm.id } })).status).toBe(404);
    // and the topic's answer never carries the DM
    await say(w.omar.id, w.topic.id, "@المساعد لخّص");
    expect(JSON.stringify(seen[1]!.request.messages)).not.toContain("DM-ONLY");
  });

  it("an answer follows the conversation's own visibility: a restricted topic's answer is not in another conversation", async () => {
    const w = await world();
    await say(w.sara.id, w.other.id, "@المساعد لخّص");
    expect(await lines(w.other.id)).toHaveLength(1);
    expect(await lines(w.topic.id)).toHaveLength(0);
    // Omar is in the space but not in the restricted topic: he cannot open it
    await loginAs(w.omar.id);
    expect((await call(conversationRoute.GET, { params: { id: w.other.id } })).status).toBe(404);
  });
});

describe("who may ask", () => {
  it("a guest typing the mention in a topic changes nothing: no call, no line, no refusal", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    expect((await say(w.guest.id, w.topic.id, "@المساعد جاوبني")).status).toBe(201);
    expect(seen).toHaveLength(0);
    expect(await lines(w.topic.id)).toHaveLength(0);
    expect(await audits(w.org.id)).toHaveLength(0);
  });

  it("a conversation with a guest among its people is refused in Arabic and nothing is sent", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(0);
    const rows = await lines(w.topic.id);
    expect(rows).toHaveLength(1);
    expect(pOf(rows[0]!.body)).toMatchObject({ err: "guest", text: AR["chatai.err.guest"] });
    expect((await audits(w.org.id))[0]!.meta).toMatchObject({ outcome: "refused", reason: "guest" });
  });

  it("a restricted topic without the guest in its rows is fine, and one with the guest's row is refused", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "MEMBER" } });
    await say(w.sara.id, w.other.id, "@المساعد لخّص");
    expect(seen).toHaveLength(1);
    await db.conversationMember.create({ data: { conversationId: w.other.id, userId: w.guest.id } });
    clearChatAssistantLimitsForTests({ userId: w.sara.id, conversationId: w.other.id });
    await say(w.sara.id, w.other.id, "@المساعد مرة ثانية");
    expect(seen).toHaveLength(1);
    expect(pOf((await lines(w.other.id))[1]!.body).err).toBe("guest");
  });

  it("a suspended person, and a person who lost access to the conversation, get nothing", async () => {
    const w = await world();
    const msg = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.other.id, authorId: w.omar.id, body: "@المساعد لخّص" } });
    // Omar is not in the restricted topic: even a stored message of his wakes nothing
    expect(await answerMention({ orgId: w.org.id, conversationId: w.other.id, messageId: msg.id })).toEqual({ outcome: "ignored" });
    const mine = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.sara.id, body: "@المساعد لخّص" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.sara.id } }, data: { status: "SUSPENDED" } });
    expect(await answerMention({ orgId: w.org.id, conversationId: w.topic.id, messageId: mine.id })).toEqual({ outcome: "ignored" });
    expect(seen).toHaveLength(0);
    expect(await lines(w.topic.id)).toHaveLength(0);
  });

  it("a message of another company, or a message that does not carry the word, wakes nothing", async () => {
    const w = await world();
    const plain = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.sara.id, body: "بدون منشن" } });
    expect(await answerMention({ orgId: w.org.id, conversationId: w.topic.id, messageId: plain.id })).toEqual({ outcome: "ignored" });
    const mention = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.sara.id, body: "@المساعد لخّص" } });
    const stranger = await makeTeam();
    expect(await answerMention({ orgId: stranger.org.id, conversationId: w.topic.id, messageId: mention.id })).toEqual({ outcome: "ignored" });
    expect(seen).toHaveLength(0);
  });
});

describe("it never executes anything", () => {
  it("a tool call or a task the model asks for creates nothing, and the line is only words", async () => {
    const w = await world();
    script = () => ({ text: "اقتراح: اعملوا مهمة «تأكيد الموعد» وذكّروا الزبون.", toolCalls: [{ name: "propose_action", input: { type: "create_task", params: { title: "x" }, reason: "y" } }] });
    const tasks = await db.task.count();
    await say(w.sara.id, w.topic.id, "@المساعد شو نعمل؟");
    expect(await db.task.count()).toBe(tasks);
    expect(await db.reminder.count()).toBe(0);
    expect(await db.aiProposal.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(pOf((await lines(w.topic.id))[0]!.body).text).toContain("اقتراح");
    // the only new rows of the conversation are the person's message and the line
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(2);
  });
});

describe("limits, failures, double delivery", () => {
  it("the sixth mention in a minute is not sent to the model, and the conversation is told once", async () => {
    const w = await world();
    for (let i = 0; i < 7; i += 1) await say(w.sara.id, w.topic.id, `@المساعد سؤال ${i}`);
    expect(seen).toHaveLength(5);
    const rows = await lines(w.topic.id);
    expect(rows).toHaveLength(6); // five answers and ONE notice
    const notice = rows.filter((r) => pOf(r.body).err === "limited");
    expect(notice).toHaveLength(1);
    expect(pOf(notice[0]!.body).text).toBe(AR["chatai.err.rate_user"]);
  });

  it("five a minute per conversation too, across different people", async () => {
    const w = await world();
    const people = [w.sara.id, w.omar.id, w.admin.id];
    for (let i = 0; i < 7; i += 1) await say(people[i % 3]!, w.topic.id, `@المساعد سؤال ${i}`);
    expect(seen).toHaveLength(5);
    expect(pOf((await lines(w.topic.id)).find((r) => pOf(r.body).err === "limited")!.body).text).toBe(AR["chatai.err.rate_conversation"]);
  });

  it("a missing key says so in Arabic in the conversation (the key can be removed after the list was drawn)", async () => {
    const w = await world();
    await db.aiSettings.update({ where: { orgId: w.org.id }, data: { keyCipher: null, keyLast4: null } });
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(0);
    expect(pOf((await lines(w.topic.id))[0]!.body)).toMatchObject({ err: "no_key", text: AR["chatai.err.no_key"] });
  });

  it("a provider failure is a short Arabic sentence: no stack, no key, no words in the line or in the log", async () => {
    const w = await world();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    script = () => {
      throw new AiProviderError("assistant.err_key_rejected");
    };
    await say(w.omar.id, w.topic.id, "كلمة خاصة SECRET-WORDS-IN-CHAT");
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    const rows = await lines(w.topic.id);
    expect(pOf(rows[0]!.body)).toMatchObject({ err: "key_rejected", text: AR["chatai.err.key_rejected"] });
    const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])).join("\n");
    expect(logged).toContain("chat_assistant.failed");
    expect(logged).not.toMatch(/SECRET-WORDS-IN-CHAT|لخّص|ABCD|sk-ant/);
    expect(rows[0]!.body).not.toMatch(/ABCD|sk-ant|at .*\.ts/);
    warn.mockRestore();
    error.mockRestore();

    // an unexpected crash of the provider is also only a sentence
    script = () => {
      throw new Error("boom with SECRET-WORDS-IN-CHAT inside");
    };
    clearChatAssistantLimitsForTests({ userId: w.sara.id, conversationId: w.topic.id });
    await say(w.sara.id, w.topic.id, "@المساعد كمان مرة");
    const last = pOf((await lines(w.topic.id))[1]!.body);
    expect(last.err).toBe("failed");
    expect(last.text).not.toContain("boom");
  });

  it("the company's daily limit of «مساعد المالك» refuses before the model is called", async () => {
    const w = await world();
    await updateSettings({ orgId: w.org.id, userId: w.owner.id }, { dailyLimit: 1 });
    await say(w.sara.id, w.topic.id, "@المساعد الأول");
    expect(seen).toHaveLength(1);
    await say(w.sara.id, w.topic.id, "@المساعد الثاني");
    expect(seen).toHaveLength(1);
    expect(pOf((await lines(w.topic.id))[1]!.body)).toMatchObject({ err: "daily", text: AR["chatai.err.daily"] });
    // the counters moved, and hold no content
    expect(await db.aiUsage.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("the same mention delivered twice (a retry, a race) gets exactly one answer and one model call", async () => {
    const w = await world();
    const msg = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.sara.id, body: "@المساعد لخّص" } });
    const input = { orgId: w.org.id, conversationId: w.topic.id, messageId: msg.id };
    script = async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { text: "مرة وحدة" };
    };
    const [a, b] = await Promise.all([answerMention(input), answerMention(input)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["answered", "duplicate"]);
    expect(await answerMention(input)).toEqual({ outcome: "duplicate" });
    expect(seen).toHaveLength(1);
    expect(await lines(w.topic.id)).toHaveLength(1);
    expect(await audits(w.org.id)).toHaveLength(1);
  });

  it("a client retry of the same send (same clientId) does not ask the model again", async () => {
    const w = await world();
    const clientId = `c-${uid()}`;
    await say(w.sara.id, w.topic.id, "@المساعد لخّص", { clientId });
    await say(w.sara.id, w.topic.id, "@المساعد لخّص", { clientId });
    expect(seen).toHaveLength(1);
    expect(await lines(w.topic.id)).toHaveLength(1);
  });
});
