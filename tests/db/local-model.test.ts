import "./scoping-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as settingsRoute from "@/app/api/owner-assistant/settings/route";
import * as keyRoute from "@/app/api/owner-assistant/key/route";
import * as gatewayKeyRoute from "@/app/api/owner-assistant/local/key/route";
import * as testRoute from "@/app/api/owner-assistant/local/test/route";
import * as chatRoute from "@/app/api/owner-assistant/chat/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { ASSISTANT_MENTION_ID } from "@/lib/chat/conversation/mentions";
import { decryptSecrets } from "@/server/crypto";
import { setProviderFactoryForTests, type ProviderConfig } from "@/server/ai/registry";
import { AiProviderError, type AiCompletion, type AiRequest } from "@/server/ai/provider";
import { setLocalTransportForTests, type LocalHttpRequest, type LocalTransport } from "@/server/ai/local-transport";
import { localQueue } from "@/server/ai/local-queue";
import { clearChatAssistantLimitsForTests, settleChatAssistantForTests } from "@/server/services/chat-assistant";
import { testLimiter } from "@/server/services/local-model";
import { saveKey, updateSettings } from "@/server/services/owner-assistant-settings";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «نموذج محلي» — both assistants on a LOCAL model, against a real PostgreSQL and a fake provider / fake transport (the network is never
 * touched).
 *
 * What this pins:
 *  - the settings are the OWNER's alone, the address is an INTERNAL host only (a public host, a metadata address and a hundred spellings
 *    are refused with a sentence), a provider cannot be chosen before its address and model are saved, a gateway's confirmation dies when
 *    its address changes, and the gateway's key is write-only, encrypted and found nowhere else;
 *  - the owner assistant and the chat assistant answer from a local model with NO Claude key, count their use against the same limits, and
 *    keep every refusal they had (a guest in the conversation, the daily limit);
 *  - privacy by provider: with Claude nothing changes whatever is switched on; with a local model the filter stays on until the owner
 *    turns the switch on; a gateway needs his confirmation too; secrets and tokens are masked in every case;
 *  - every failure of the local model is one short Arabic line, with no stack and none of the words in the log;
 *  - «اختبر الاتصال»: owner only, lists the models, pings, refuses a public address, is rate-limited.
 */

const CLAUDE_KEY = "sk-ant-api03-LOCALAI-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore
const GATEWAY_KEY = "gw-bearer-LOCALAI-never-appears-9876543210"; // scan-secrets:ignore
const PHONE = "0791234567";
const META_TOKEN = "EAAGm0PX4ZCpsBAKZCtestTOKENvalue1234567890"; // scan-secrets:ignore
const OLLAMA = "http://ollama:11434";
const HERMES = "http://hermes:8642";

interface Seen {
  config: ProviderConfig;
  request: AiRequest;
}
let seen: Seen[] = [];
let script: (request: AiRequest) => Partial<AiCompletion> | Promise<Partial<AiCompletion>> = () => ({ text: "جواب" });

beforeEach(() => {
  seen = [];
  script = () => ({ text: "جواب" });
  setProviderFactoryForTests((config) => ({
    async complete(request) {
      seen.push({ config, request });
      const out = await script(request);
      return { text: out.text ?? "", toolCalls: out.toolCalls ?? [], usage: out.usage ?? { inputTokens: 100, outputTokens: 40 } };
    },
  }));
});
afterEach(() => {
  setProviderFactoryForTests(null);
  setLocalTransportForTests(null);
  vi.restoreAllMocks();
});

const sentText = () => JSON.stringify(seen.map((s) => ({ system: s.request.system, messages: s.request.messages, tools: s.request.tools })));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

const responses: string[] = [];
async function api(handler: unknown, init: Parameters<typeof call>[1] = {}) {
  const res = await call(handler, init);
  responses.push(res.text);
  return res;
}
beforeEach(() => {
  responses.length = 0;
});
const patch = (body: unknown) => api(settingsRoute.PUT, { method: "PUT", body });
const ask = (message: string, extra: Record<string, unknown> = {}) => api(chatRoute.POST, { body: { message, ...extra } });

/** The owner's world, signed in, with the owner assistant on and NO Claude key (a local model needs none). */
async function world() {
  const t = await makeTeam();
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة الأحمد" });
  const omar = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "عمر حداد" });
  const ws = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: t.admin.id, role: "ADMIN" }], "المبيعات");
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "حكي المبيعات" } });
  await setFeature(t.org.id, "ownerAssistant", true);
  await setFeature(t.org.id, "chatAssistant", true);
  return { ...t, sara, omar, ws, topic };
}
type World = Awaited<ReturnType<typeof world>>;
const ctxOf = (w: World) => ({ orgId: w.org.id, userId: w.owner.id });

async function localReady(w: World, extra: Record<string, unknown> = {}) {
  await loginAs(w.owner.id);
  const res = await patch({ localBaseUrl: OLLAMA, localModel: "qwen2.5:3b-instruct", ownerProvider: "ollama", chatProvider: "ollama", ...extra });
  expect(res.status, res.text).toBe(200);
}

// ───────────────────────────────────────── the settings ─────────────────────────────────────────

describe("the settings of the local model", () => {
  it("are the owner's alone: an admin, a member, a guest and a signed-out visitor get 404 on every new route and nothing is written", async () => {
    const w = await world();
    for (const person of [w.admin, w.member, w.guest]) {
      await loginAs(person.id);
      expect((await patch({ localBaseUrl: OLLAMA })).status, person.name).toBe(404);
      expect((await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA } })).status, person.name).toBe(404);
      expect((await api(gatewayKeyRoute.PUT, { method: "PUT", body: { key: GATEWAY_KEY } })).status, person.name).toBe(404);
      expect((await api(gatewayKeyRoute.DELETE, { method: "DELETE" })).status, person.name).toBe(404);
    }
    expect(await db.aiSettings.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("with «مساعد المالك» off, even the owner gets 404", async () => {
    const w = await world();
    await setFeature(w.org.id, "ownerAssistant", false);
    await loginAs(w.owner.id);
    expect((await patch({ localBaseUrl: OLLAMA })).status).toBe(404);
    expect((await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA } })).status).toBe(404);
  });

  it("the defaults: Claude for both assistants, nothing local, the filter not relaxed, no confirmation", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const { settings } = (await api(settingsRoute.GET)).json as { settings: Record<string, unknown> };
    expect(settings).toMatchObject({ ownerProvider: "claude", chatProvider: "claude", localBaseUrl: null, localModel: null, gatewayBaseUrl: null, gatewayModel: null, hasGatewayKey: false, gatewayConfirmedLocal: false, localRelaxRedaction: false });
  });

  it("an internal address and a model name are saved, normalised, and audited by field name only", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await patch({ localBaseUrl: "  http://OLLAMA:11434/  ", localModel: " qwen2.5:3b-instruct " });
    expect(res.status).toBe(200);
    expect((res.json as { settings: Record<string, unknown> }).settings).toMatchObject({ localBaseUrl: "http://ollama:11434", localModel: "qwen2.5:3b-instruct" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { orgId: w.org.id, action: "ai.settings_changed" } });
    expect(audit.meta).toEqual({ fields: ["localBaseUrl", "localModel"] });
    expect(JSON.stringify(audit)).not.toContain("ollama");
  });

  it.each([
    ["https://api.openai.com", "assistant.local_url_public"],
    ["https://api.anthropic.com", "assistant.local_url_public"],
    ["http://8.8.8.8:11434", "assistant.local_url_public"],
    ["http://169.254.169.254", "assistant.local_url_public"],
    ["http://169.254.169.254:80", "assistant.local_url_public"],
    ["http://[fd00:ec2::254]", "assistant.local_url_public"],
    ["http://100.100.100.200", "assistant.local_url_public"],
    ["http://metadata.google.internal", "assistant.local_url_public"],
    ["http://0.0.0.0:11434", "assistant.local_url_public"],
    ["http://2852039166", "assistant.local_url_public"],
    ["http://example.com:11434", "assistant.local_url_public"],
    ["ftp://ollama", "assistant.local_url_invalid"],
    ["file:///etc/passwd", "assistant.local_url_invalid"],
    ["http://user:pw@ollama:11434", "assistant.local_url_invalid"],
    ["http://ollama:11434/api/chat", "assistant.local_url_invalid"],
    ["http://ollama:11434?x=1", "assistant.local_url_invalid"],
    ["not a url", "assistant.local_url_invalid"],
  ])("the address %s is refused with a sentence and nothing is stored", async (url, key) => {
    const w = await world();
    await loginAs(w.owner.id);
    for (const field of ["localBaseUrl", "gatewayBaseUrl"]) {
      const res = await patch({ [field]: url });
      expect(res.status, `${field} ${url}`).toBe(422);
      expect(JSON.stringify(res.json)).toContain(key);
      expect(AR[key]).toBeTruthy();
    }
    expect(await db.aiSettings.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("an address field set to an empty text clears it; a bad model name is refused", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await patch({ localBaseUrl: OLLAMA, localModel: "llama3.2:3b" });
    const cleared = await patch({ localBaseUrl: "" });
    expect((cleared.json as { settings: Record<string, unknown> }).settings).toMatchObject({ localBaseUrl: null, localModel: "llama3.2:3b" });
    for (const bad of ["../etc", "a b c", "https://x.io", "ab"]) {
      const res = await patch({ localModel: bad });
      expect(res.status, bad).toBe(422);
      expect(JSON.stringify(res.json)).toContain("assistant.local_model_invalid");
    }
    expect((await patch({ ownerProvider: "gpt" })).status).toBe(422);
  });

  it("a local provider cannot be chosen before its address and model are saved; with them, in the same request, it can", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    for (const body of [{ ownerProvider: "ollama" }, { chatProvider: "ollama" }, { ownerProvider: "openai" }, { chatProvider: "openai", gatewayBaseUrl: HERMES }, { ownerProvider: "ollama", localBaseUrl: OLLAMA }]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(JSON.stringify(res.json)).toContain("assistant.local_incomplete");
    }
    expect((await patch({ ownerProvider: "ollama", localBaseUrl: OLLAMA, localModel: "llama3.2:3b" })).status).toBe(200);
    expect((await patch({ chatProvider: "openai", gatewayBaseUrl: HERMES, gatewayModel: "hermes-3" })).status).toBe(200);
    // going back to Claude is always allowed
    expect((await patch({ ownerProvider: "claude" })).status).toBe(200);
  });

  it("the gateway's confirmation belongs to ONE address: a new address resets it unless it is confirmed in the same request", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await patch({ gatewayConfirmedLocal: true })).status).toBe(422); // nothing to confirm yet
    const first = await patch({ gatewayBaseUrl: HERMES, gatewayModel: "hermes-3", gatewayConfirmedLocal: true });
    expect((first.json as { settings: Record<string, unknown> }).settings).toMatchObject({ gatewayBaseUrl: HERMES, gatewayConfirmedLocal: true });
    // the same address again: still confirmed
    expect(((await patch({ gatewayBaseUrl: HERMES })).json as { settings: Record<string, unknown> }).settings).toMatchObject({ gatewayConfirmedLocal: true });
    // another address: the confirmation is gone
    const moved = await patch({ gatewayBaseUrl: "http://litellm:4000" });
    expect((moved.json as { settings: Record<string, unknown> }).settings).toMatchObject({ gatewayBaseUrl: "http://litellm:4000", gatewayConfirmedLocal: false });
    // clearing the address leaves nothing confirmed
    await patch({ gatewayConfirmedLocal: true });
    expect(((await patch({ gatewayBaseUrl: "" })).json as { settings: Record<string, unknown> }).settings).toMatchObject({ gatewayBaseUrl: null, gatewayConfirmedLocal: false });
  });

  it("the gateway's key is write-only: encrypted at rest, never in a response, a page, an audit row, or the settings", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const saved = await api(gatewayKeyRoute.PUT, { method: "PUT", body: { key: GATEWAY_KEY } });
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ hasGatewayKey: true, gatewayKeyLast4: GATEWAY_KEY.slice(-4) });
    const row = await db.aiSettings.findUniqueOrThrow({ where: { orgId: w.org.id } });
    expect(row.gatewayKeyCipher).toBeTruthy();
    expect(row.gatewayKeyCipher).not.toContain(GATEWAY_KEY);
    expect(decryptSecrets<{ apiKey: string }>(row.gatewayKeyCipher as string)?.apiKey).toBe(GATEWAY_KEY);
    expect(((await api(settingsRoute.GET)).json as { settings: Record<string, unknown> }).settings).toMatchObject({ hasGatewayKey: true, gatewayKeyLast4: GATEWAY_KEY.slice(-4) });
    for (const bad of ["short", "has space in it 123456", 5, null]) {
      expect((await api(gatewayKeyRoute.PUT, { method: "PUT", body: { key: bad } })).status, String(bad)).toBe(422);
    }
    const audits = JSON.stringify(await db.auditLog.findMany({ where: { orgId: w.org.id } }));
    expect(audits).not.toContain(GATEWAY_KEY);
    expect(responses.join("\n")).not.toContain(GATEWAY_KEY);
    const removed = await api(gatewayKeyRoute.DELETE, { method: "DELETE" });
    expect(removed.json).toEqual({ hasGatewayKey: false, gatewayKeyLast4: null });
    expect((await db.aiSettings.findUniqueOrThrow({ where: { orgId: w.org.id } })).gatewayKeyCipher).toBeNull();
  });
});

// ───────────────────────────────────────── the owner assistant on a local model ─────────────────────────────────────────

describe("«مساعد المالك» on a local model", () => {
  it("answers with NO Claude key, through the local provider at the saved address, with a smaller context and the 512-token cap", async () => {
    const w = await world();
    await localReady(w, { allowTitles: true });
    const p = await makeProject(w.ws.id, "مشروع");
    for (let i = 0; i < 40; i += 1) {
      await makeTask({ orgId: w.org.id, workspaceId: w.ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: w.owner.id, assigneeId: w.sara.id, title: `مهمة ${i}`, priority: "NORMAL", dueDate: new Date(Date.now() - i * 86_400_000) });
    }
    script = () => ({ text: "تحليل", usage: { inputTokens: 900, outputTokens: 120 } });
    const res = await ask("حلّل");
    expect(res.status, res.text).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.config).toMatchObject({ kind: "ollama", baseUrl: OLLAMA, model: "qwen2.5:3b-instruct", apiKey: "" });
    expect(seen[0]!.request.maxTokens).toBeLessThanOrEqual(512);
    const data = JSON.parse(/<data>\n([\s\S]*?)\n<\/data>/.exec(seen[0]!.request.messages.at(-1)!.content)![1]!) as { tasks: unknown[] };
    expect(data.tasks.length).toBeLessThanOrEqual(15);
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(4_000);
    const view = (res.json as { answer: { sent: string } }).answer.sent;
    expect(view).toContain("qwen2.5:3b-instruct");
    expect(JSON.parse(view).maxTokens).toBeLessThanOrEqual(512);
    expect(responses.join("\n")).not.toContain(CLAUDE_KEY);
  });

  it("counts against the same limits: usage is recorded, and the daily limit refuses BEFORE the local model is called", async () => {
    const w = await world();
    await localReady(w, { dailyLimit: 2 });
    script = () => ({ text: "ج", usage: { inputTokens: 700, outputTokens: 50 } });
    expect((await ask("واحد")).status).toBe(200);
    expect((await ask("اثنين")).status).toBe(200);
    const usage = await db.aiUsage.findFirstOrThrow({ where: { orgId: w.org.id, userId: w.owner.id } });
    expect(usage).toMatchObject({ requests: 2, inputTokens: 1400, outputTokens: 100 });
    const refused = await ask("ثلاثة");
    expect(refused.status).toBe(429);
    expect(JSON.stringify(refused.json)).toContain("assistant.daily_limit");
    expect(seen).toHaveLength(2);
  });

  it("the monthly token budget refuses a local call too", async () => {
    const w = await world();
    await localReady(w, { monthlyTokenBudget: 100 });
    script = () => ({ text: "ج", usage: { inputTokens: 90, outputTokens: 30 } });
    expect((await ask("واحد")).status).toBe(200);
    const refused = await ask("اثنين");
    expect(refused.status).toBe(429);
    expect(JSON.stringify(refused.json)).toContain("assistant.monthly_budget");
    expect(seen).toHaveLength(1);
  });

  it("a local provider whose settings were lost is «no local model» (409), not a crash, and nothing is sent", async () => {
    const w = await world();
    await localReady(w);
    await db.aiSettings.update({ where: { orgId: w.org.id }, data: { localModel: null } });
    const res = await ask("حلّل");
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.json)).toContain("assistant.no_local");
    expect(AR["assistant.no_local"]).toBeTruthy();
    expect(seen).toHaveLength(0);
    // a stored address that is no longer acceptable (edited in the database) is not used either
    await db.aiSettings.update({ where: { orgId: w.org.id }, data: { localModel: "llama3.2:3b", localBaseUrl: "https://api.openai.com" } });
    expect((await ask("حلّل")).status).toBe(409);
    expect(seen).toHaveLength(0);
  });

  it("Claude stays exactly as it was: its key, its model, its 1500-token cap, no local kind", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await api(keyRoute.PUT, { method: "PUT", body: { key: CLAUDE_KEY } })).status).toBe(200);
    expect((await ask("حلّل")).status).toBe(200);
    expect(seen[0]!.config).toEqual({ apiKey: CLAUDE_KEY, model: "claude-sonnet-5-5" });
    expect(seen[0]!.request.maxTokens).toBe(1500);
  });

  it("a local model that fails answers with its own key (502) and nothing is stored", async () => {
    const w = await world();
    await localReady(w);
    const before = await db.aiMessage.count();
    for (const key of ["assistant.err_local_busy", "assistant.err_local_down", "assistant.err_local_missing", "assistant.err_local_timeout", "assistant.err_local_host"] as const) {
      script = () => {
        throw new AiProviderError(key);
      };
      const res = await ask("حلّل");
      expect(res.status, key).toBe(502);
      expect(JSON.stringify(res.json)).toContain(key);
      expect(AR[key], key).toBeTruthy();
    }
    expect(await db.aiMessage.count()).toBe(before);
    expect(AR["assistant.err_local_busy"]).toContain("السيرفر مشغول");
  });
});

describe("privacy by provider: the owner's question", () => {
  const question = `اتصل بالزبون على ${PHONE} وتوكن الإعلانات ${META_TOKEN}`;

  it("a local model with the filter ON (the default): the phone and the token are masked", async () => {
    const w = await world();
    await localReady(w);
    expect((await ask(question)).status).toBe(200);
    expect(sentText()).not.toContain(PHONE);
    expect(sentText()).not.toContain(META_TOKEN);
  });

  it("a local model with the owner's switch ON: the phone passes, the ad token is STILL masked", async () => {
    const w = await world();
    await localReady(w, { localRelaxRedaction: true });
    expect((await ask(question)).status).toBe(200);
    expect(sentText()).toContain(PHONE);
    expect(sentText()).not.toContain(META_TOKEN);
  });

  it("Claude with the switch ON: nothing is relaxed (the switch is for a local model only)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await api(keyRoute.PUT, { method: "PUT", body: { key: CLAUDE_KEY } });
    expect((await patch({ localRelaxRedaction: true, gatewayConfirmedLocal: false })).status).toBe(200);
    expect((await ask(question)).status).toBe(200);
    expect(sentText()).not.toContain(PHONE);
    expect(sentText()).not.toContain(META_TOKEN);
  });

  it("a gateway: the filter stays on without the confirmation, even with the switch; with both it is relaxed; the token never passes", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await patch({ gatewayBaseUrl: HERMES, gatewayModel: "hermes-3", ownerProvider: "openai", localRelaxRedaction: true })).status).toBe(200);
    expect((await api(gatewayKeyRoute.PUT, { method: "PUT", body: { key: GATEWAY_KEY } })).status).toBe(200);
    expect((await ask(question)).status).toBe(200);
    expect(seen[0]!.config).toMatchObject({ kind: "openai", baseUrl: HERMES, model: "hermes-3", apiKey: GATEWAY_KEY });
    expect(sentText()).not.toContain(PHONE);
    seen = [];
    expect((await patch({ gatewayConfirmedLocal: true })).status).toBe(200);
    expect((await ask(question)).status).toBe(200);
    expect(sentText()).toContain(PHONE);
    expect(sentText()).not.toContain(META_TOKEN);
    // the gateway's key goes to the provider and nowhere else
    expect(sentText()).not.toContain(GATEWAY_KEY);
    expect(responses.join("\n")).not.toContain(GATEWAY_KEY);
  });

  it("changing the gateway's address withdraws the confirmation, so the filter is back on at once", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await patch({ gatewayBaseUrl: HERMES, gatewayModel: "hermes-3", ownerProvider: "openai", localRelaxRedaction: true, gatewayConfirmedLocal: true });
    await patch({ gatewayBaseUrl: "http://litellm:4000" });
    expect((await ask(question)).status).toBe(200);
    expect(sentText()).not.toContain(PHONE);
  });
});

// ───────────────────────────────────────── the chat assistant on a local model ─────────────────────────────────────────

async function say(who: string, conversationId: string, body: string) {
  await loginAs(who);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body } });
  await settleChatAssistantForTests();
  return res;
}
const lines = (conversationId: string) => db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } }, orderBy: { createdAt: "asc" } });
const pOf = (body: string) => (JSON.parse(body) as { p: { text: string; err?: string; first?: number; local?: number; relaxed?: number; read?: number } }).p;
const audits = (orgId: string) => db.auditLog.findMany({ where: { orgId, action: "chat.assistant_asked" } });
const mentionables = async (who: string, conversationId: string) => {
  await loginAs(who);
  const res = await call(conversationRoute.GET, { params: { id: conversationId } });
  return (res.json?.["mentionables"] ?? []) as { id: string }[];
};

describe("«@المساعد» on a local model", () => {
  it("is offered and answers with NO Claude key; the line says a local model read it; the audit row names the kind and no words", async () => {
    const w = await world();
    await localReady(w);
    expect(await db.aiSettings.findUniqueOrThrow({ where: { orgId: w.org.id } })).toMatchObject({ keyLast4: null });
    expect((await mentionables(w.sara.id, w.topic.id)).map((m) => m.id)).toContain(ASSISTANT_MENTION_ID);
    script = () => ({ text: "الخلاصة المحلية", usage: { inputTokens: 300, outputTokens: 60 } });
    await say(w.omar.id, w.topic.id, "الزبون طلب تأجيل");
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.config).toMatchObject({ kind: "ollama", baseUrl: OLLAMA, model: "qwen2.5:3b-instruct" });
    expect(seen[0]!.request.maxTokens).toBeLessThanOrEqual(512);
    expect(seen[0]!.request.tools).toBeUndefined();
    const rows = await lines(w.topic.id);
    expect(rows).toHaveLength(1);
    expect(pOf(rows[0]!.body)).toMatchObject({ text: "الخلاصة المحلية", local: 1, first: 1 });
    expect(pOf(rows[0]!.body).relaxed).toBeUndefined();
    const a = (await audits(w.org.id))[0]!;
    expect(a.meta).toMatchObject({ outcome: "answered", provider: "ollama", model: "qwen2.5:3b-instruct" });
    expect(JSON.stringify(a.meta)).not.toMatch(/لخّص|الخلاصة|تأجيل/);
    // the same limits as Claude: the use is counted
    expect(await db.aiUsage.findFirstOrThrow({ where: { orgId: w.org.id, userId: w.sara.id } })).toMatchObject({ requests: 1, inputTokens: 300, outputTokens: 60 });
  });

  it("a conversation with a guest among its people is refused AS BEFORE, even for a local model, and nothing is sent", async () => {
    const w = await world();
    await localReady(w);
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(0);
    expect(pOf((await lines(w.topic.id))[0]!.body)).toMatchObject({ err: "guest", text: AR["chatai.err.guest"] });
    // with the relaxed switch on too
    await patch({ localRelaxRedaction: true });
    clearChatAssistantLimitsForTests({ userId: w.sara.id, conversationId: w.topic.id });
    await say(w.sara.id, w.topic.id, "@المساعد مرة ثانية");
    expect(seen).toHaveLength(0);
  });

  it("the filter is ON by default for a local model: no phone, no name, and the window is the small one", async () => {
    const w = await world();
    await localReady(w);
    for (let i = 0; i < 25; i += 1) await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.omar.id, body: `قديم رقم-${i}-` } });
    await say(w.omar.id, w.topic.id, `الزبون سارة الأحمد على ${PHONE}`);
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    const sent = sentText();
    expect(sent).not.toContain(PHONE);
    expect(sent).not.toMatch(/سارة|الأحمد|عمر|حداد/);
    expect(pOf((await lines(w.topic.id))[0]!.body).read).toBeLessThanOrEqual(12);
  });

  it("with the owner's switch ON the phone and the names pass, secrets and tokens do not, and the line says the filter was loosened", async () => {
    const w = await world();
    await localReady(w, { localRelaxRedaction: true });
    await say(w.omar.id, w.topic.id, `الزبون على ${PHONE} والتوكن ${META_TOKEN} وكلمة سر: topsecretpass99`);
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    const sent = sentText();
    expect(sent).toContain(PHONE);
    expect(sent).toContain("عمر حداد");
    expect(sent).not.toContain(META_TOKEN);
    expect(sent).not.toContain("topsecretpass99");
    expect(pOf((await lines(w.topic.id))[0]!.body)).toMatchObject({ local: 1, relaxed: 1 });
    expect((await audits(w.org.id))[0]!.meta).toMatchObject({ relaxed: true, provider: "ollama" });
  });

  it("Claude with the switch ON: the filter is exactly what it was (nothing relaxed, no local flag)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await api(keyRoute.PUT, { method: "PUT", body: { key: CLAUDE_KEY } });
    await patch({ localRelaxRedaction: true });
    await say(w.omar.id, w.topic.id, `الزبون على ${PHONE}`);
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen[0]!.config).toEqual({ apiKey: CLAUDE_KEY, model: "claude-sonnet-5-5" });
    expect(sentText()).not.toContain(PHONE);
    expect(sentText()).not.toMatch(/عمر|حداد/);
    expect(pOf((await lines(w.topic.id))[0]!.body).local).toBeUndefined();
    expect(pOf((await lines(w.topic.id))[0]!.body).relaxed).toBeUndefined();
  });

  it("the daily limit refuses before the local model is called, with the same Arabic line as for Claude", async () => {
    const w = await world();
    await localReady(w, { dailyLimit: 1 });
    await say(w.sara.id, w.topic.id, "@المساعد واحد");
    clearChatAssistantLimitsForTests({ userId: w.sara.id, conversationId: w.topic.id });
    await say(w.sara.id, w.topic.id, "@المساعد اثنين");
    expect(seen).toHaveLength(1);
    expect(pOf((await lines(w.topic.id))[1]!.body)).toMatchObject({ err: "daily", text: AR["chatai.err.daily"] });
  });

  it("a local provider that is not set up is a short Arabic line in the conversation", async () => {
    const w = await world();
    await localReady(w);
    await db.aiSettings.update({ where: { orgId: w.org.id }, data: { localBaseUrl: null } });
    // not offered in the «@» list any more, but a typed mention still gets a plain answer
    expect((await mentionables(w.sara.id, w.topic.id)).map((m) => m.id)).not.toContain(ASSISTANT_MENTION_ID);
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(0);
    expect(pOf((await lines(w.topic.id))[0]!.body)).toMatchObject({ err: "no_local", text: AR["chatai.err.no_local"] });
  });

  it.each([
    ["assistant.err_local_busy", "local_busy", "السيرفر مشغول"],
    ["assistant.err_local_down", "local_down", "أوصل"],
    ["assistant.err_local_missing", "local_missing", "مش منزّل"],
    ["assistant.err_local_timeout", "local_timeout", "تأخّر"],
    ["assistant.err_local_host", "local_host", "مش مسموح"],
  ] as const)("when the local model fails with %s the conversation gets ONE short Arabic line: no stack, no words in the log", async (key, reason, phrase) => {
    const w = await world();
    await localReady(w);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    script = () => {
      throw new AiProviderError(key);
    };
    await say(w.omar.id, w.topic.id, "كلام-خاص-بالزبون-لا-يظهر-بالسجل");
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    const rows = await lines(w.topic.id);
    expect(rows).toHaveLength(1);
    const p = pOf(rows[0]!.body);
    expect(p.err).toBe(reason);
    expect(p.text).toBe(AR[`chatai.err.${reason}`]);
    expect(p.text).toContain(phrase);
    expect(p.text).not.toMatch(/\bat\s|Error|stack/);
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.join(" "))).join("\n");
    expect(logged).not.toContain("كلام-خاص-بالزبون");
    expect(logged).not.toContain("لخّص");
    expect(logged).not.toContain("ollama");
  });

  it("an unexpected crash of the local model is the generic line, and still nothing of the words is logged", async () => {
    const w = await world();
    await localReady(w);
    const spies = (["log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    script = () => {
      throw new Error("boom with كلام-خاص-بالزبون inside");
    };
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(pOf((await lines(w.topic.id))[0]!.body)).toMatchObject({ err: "failed", text: AR["chatai.err.failed"] });
    expect(spies.flatMap((s) => s.mock.calls.map((c) => c.join(" "))).join("\n")).not.toContain("كلام-خاص-بالزبون");
  });
});

// ───────────────────────────────────────── «اختبر الاتصال» ─────────────────────────────────────────

describe("«اختبر الاتصال»", () => {
  const reply = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) });
  const tags = { models: [{ name: "qwen2.5:3b-instruct" }, { name: "llama3.2:3b" }] };
  const answer = { message: { role: "assistant", content: "hi" }, prompt_eval_count: 3, eval_count: 5 };

  function fakeOllama(log: LocalHttpRequest[] = []): LocalTransport {
    return async (req) => {
      log.push(req);
      if (req.url.endsWith("/api/tags")) return reply(200, tags);
      if (req.url.endsWith("/api/chat")) return reply(200, answer);
      if (req.url.endsWith("/v1/models")) return reply(200, { data: [{ id: "hermes-3" }] });
      if (req.url.endsWith("/v1/chat/completions")) return reply(200, { choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } });
      return reply(404, {});
    };
  }

  it("lists the installed models, says the named one is installed, and pings it with 5 tokens (the form's values, saved or not)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const log: LocalHttpRequest[] = [];
    setLocalTransportForTests(fakeOllama(log));
    const res = await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA, model: "llama3.2:3b" } });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ provider: "ollama", reachable: true, models: ["qwen2.5:3b-instruct", "llama3.2:3b"], installed: true, ping: { ok: true } });
    expect((res.json as { listMs: number }).listMs).toBeGreaterThanOrEqual(0);
    expect(log.map((r) => `${r.method} ${r.url}`)).toEqual(["GET http://ollama:11434/api/tags", "POST http://ollama:11434/api/chat"]);
    // nothing was saved, and it is not a question of the owner's: the usage meter is untouched
    expect(await db.aiSettings.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.aiUsage.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("with nothing typed it tests the saved values; the gateway's saved key is sent as the Bearer header", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await patch({ gatewayBaseUrl: HERMES, gatewayModel: "hermes-3" });
    await api(gatewayKeyRoute.PUT, { method: "PUT", body: { key: GATEWAY_KEY } });
    const log: LocalHttpRequest[] = [];
    setLocalTransportForTests(fakeOllama(log));
    const res = await api(testRoute.POST, { body: { provider: "openai" } });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ provider: "openai", models: ["hermes-3"], installed: true, ping: { ok: true } });
    expect(log.every((r) => r.headers["authorization"] === `Bearer ${GATEWAY_KEY}`)).toBe(true);
    expect(responses.join("\n")).not.toContain(GATEWAY_KEY);
  });

  it("a model that is not installed is said so and is not pinged", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(fakeOllama());
    const res = await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA, model: "mistral:7b" } });
    expect(res.json).toMatchObject({ installed: false, ping: null });
  });

  it("a service that is down is 502 with a key; the answer holds no address and no body", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 172.18.0.5:11434"), { code: "ECONNREFUSED" });
    });
    const res = await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA } });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.json)).toContain("assistant.err_local_down");
    expect(res.text).not.toContain("172.18");
  });

  it("is NOT a way to call a public or metadata address, an arbitrary path or another scheme: 422, and the transport is never reached", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const transport = vi.fn(fakeOllama());
    setLocalTransportForTests(transport);
    for (const baseUrl of ["https://api.openai.com", "http://169.254.169.254", "http://example.com", "http://ollama:11434/api/pull", "file:///etc/passwd", "http://u:p@ollama"]) {
      const res = await api(testRoute.POST, { body: { provider: "ollama", baseUrl } });
      expect(res.status, baseUrl).toBe(422);
    }
    expect((await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA, model: "../x" } })).status).toBe(422);
    expect((await api(testRoute.POST, { body: { provider: "claude" } })).status).toBe(422);
    expect((await api(testRoute.POST, { body: { provider: "ollama" } })).status).toBe(422); // nothing typed, nothing saved
    expect(transport).not.toHaveBeenCalled();
  });

  it("is limited to ten tests a minute per company", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(fakeOllama());
    const key = `localtest.${w.org.id}`;
    testLimiter.reset(key);
    for (let i = 0; i < 10; i += 1) expect((await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA } })).status).toBe(200);
    const eleventh = await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA } });
    expect(eleventh.status).toBe(429);
    expect(JSON.stringify(eleventh.json)).toContain("assistant.local_test_rate");
    testLimiter.reset(key);
  });

  it("the ping goes through the one-at-a-time queue: while a question is being answered it waits, and a full line is «busy»", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect(localQueue.busy).toBe(false);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = localQueue.run(() => gate);
    // two more fill the line (two may wait), the third finds it full
    const waiting = [localQueue.run(async () => 1), localQueue.run(async () => 2)];
    setLocalTransportForTests(fakeOllama());
    const res = await api(testRoute.POST, { body: { provider: "ollama", baseUrl: OLLAMA, model: "llama3.2:3b" } });
    expect(res.status).toBe(200);
    expect((res.json as { ping: { ok: boolean; key?: string } }).ping).toEqual({ ok: false, key: "assistant.err_local_busy" });
    release();
    await Promise.all([slow, ...waiting]);
  });
});

