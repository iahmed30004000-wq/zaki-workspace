import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as assistantRoute from "@/app/api/chat/assistant/route";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as homeRoute from "@/app/api/chat/home/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { AiCompletion, AiRequest } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { settleChatAssistantForTests } from "@/server/services/chat-assistant";
import { saveKey } from "@/server/services/owner-assistant-settings";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «المساعد» كجهة اتصال — against a real PostgreSQL and a FAKE provider (the network is never touched).
 *
 * What this pins: the row is offered only where «@المساعد» is and its own switch is on; one tap makes (or finds) the person's own restricted
 * conversation; every message written THERE is answered without «@», in no other conversation; only its owner can wake it; the space's list
 * shows it to its person only; switching it off stops the answers without «@» and the row.
 */

const KEY = "sk-ant-api03-CONTACT-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore

let seen: AiRequest[] = [];
let script: () => Partial<AiCompletion> = () => ({ text: "جواب المساعد" });
beforeEach(() => {
  seen = [];
  script = () => ({ text: "جواب المساعد" });
  setProviderFactoryForTests(() => ({
    async complete(request) {
      seen.push(request);
      const out = script();
      return { text: out.text ?? "", toolCalls: [], usage: { inputTokens: 100, outputTokens: 40 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(opts: { chat?: boolean } = {}) {
  const t = await makeTeam();
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة الأحمد" });
  const omar = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "عمر حداد" });
  const ws = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: t.admin.id, role: "ADMIN" }], "المبيعات");
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "حكي المبيعات" } });
  if (opts.chat !== false) await setFeature(t.org.id, "chatAssistant", true);
  await setFeature(t.org.id, "ownerAssistant", true);
  await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  return { ...t, sara, omar, ws, topic };
}
type World = Awaited<ReturnType<typeof world>>;

const open = async (who: string) => {
  await loginAs(who);
  return call(assistantRoute.POST, { method: "POST" });
};
const say = async (who: string, conversationId: string, body: string) => {
  await loginAs(who);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body } });
  await settleChatAssistantForTests();
  return res;
};
const lines = (conversationId: string) => db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } } });
const topicsOf = async (who: string): Promise<{ id: string; title: string }[]> => {
  await loginAs(who);
  const res = await call(homeRoute.GET);
  const spaces = (res.json?.["spaces"] ?? []) as { topics: { id: string; title: string }[] }[];
  return spaces.flatMap((s) => s.topics);
};
const flag = async (who: string, scope = "") => {
  await loginAs(who);
  const res = await call(directoryRoute.GET, { url: `http://localhost/api/chat/directory${scope}` });
  return res.json?.["assistant"];
};

describe("the row «المساعد» is offered only where «@المساعد» is", () => {
  it("everything on: the directory says so (both lists); a guest is refused; each switch off hides it", async () => {
    const w = await world();
    expect(await flag(w.sara.id)).toBe(true);
    expect(await flag(w.sara.id, "?scope=company")).toBe(true);
    await loginAs(w.guest.id);
    expect((await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory" })).status).toBe(403);

    await setFeature(w.org.id, "assistantContact", false);
    expect(await flag(w.sara.id)).toBe(false);
    await setFeature(w.org.id, "assistantContact", true);
    await setFeature(w.org.id, "chatAssistant", false);
    expect(await flag(w.sara.id)).toBe(false);
  });

  it("with the switch off (or «@المساعد» off) the route answers «not found» and nothing is made", async () => {
    const w = await world();
    await setFeature(w.org.id, "assistantContact", false);
    expect((await open(w.sara.id)).status).toBe(404);
    await setFeature(w.org.id, "assistantContact", true);
    await setFeature(w.org.id, "chatAssistant", false);
    expect((await open(w.sara.id)).status).toBe(404);
    expect(await db.conversation.count({ where: { orgId: w.org.id, dmKey: { startsWith: "assistant|" } } })).toBe(0);
  });

  it("a guest cannot open one", async () => {
    const w = await world();
    expect((await open(w.guest.id)).status).toBe(403);
  });
});

describe("one tap makes, then finds, the person's own conversation", () => {
  it("a restricted topic of the space, titled «المساعد», with only that person in it; the second tap finds it", async () => {
    const w = await world();
    const first = await open(w.sara.id);
    expect(first.status, first.text).toBe(201);
    const id = first.json?.["id"] as string;
    const row = await db.conversation.findUniqueOrThrow({ where: { id }, include: { members: true } });
    expect(row).toMatchObject({ kind: "TOPIC", title: "المساعد", restricted: true });
    expect(row.dmKey).toMatch(new RegExp(`^assistant\\|${w.sara.id}@`));
    expect(row.members.map((m) => m.userId)).toEqual([w.sara.id]);
    const second = await open(w.sara.id);
    expect(second.status).toBe(200);
    expect(second.json?.["id"]).toBe(id);
    expect(await db.conversation.count({ where: { orgId: w.org.id, dmKey: { startsWith: "assistant|" } } })).toBe(1);
  });

  it("each person has their own, and the space's list draws it for its person only (the owner's list is not filled with them)", async () => {
    const w = await world();
    const saraChat = (await open(w.sara.id)).json?.["id"] as string;
    const omarChat = (await open(w.omar.id)).json?.["id"] as string;
    expect(saraChat).not.toBe(omarChat);
    expect((await topicsOf(w.sara.id)).map((t) => t.id)).toContain(saraChat);
    expect((await topicsOf(w.sara.id)).map((t) => t.id)).not.toContain(omarChat);
    expect((await topicsOf(w.owner.id)).map((t) => t.id)).not.toContain(saraChat);
    expect((await topicsOf(w.owner.id)).map((t) => t.id)).not.toContain(omarChat);
  });

  it("nobody else can write in it, and its words do not reach anybody else", async () => {
    const w = await world();
    const id = (await open(w.sara.id)).json?.["id"] as string;
    const res = await say(w.omar.id, id, "مرحبا يا مساعد");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(seen).toHaveLength(0);
  });
});

describe("every message written there is answered, with no «@»", () => {
  it("answers a plain message once, in that conversation, through the same path as a mention", async () => {
    const w = await world();
    const id = (await open(w.sara.id)).json?.["id"] as string;
    script = () => ({ text: "أهلا سارة" });
    expect((await say(w.sara.id, id, "شو الأولويات اليوم؟")).status).toBe(201);
    expect(seen).toHaveLength(1);
    const answered = await lines(id);
    expect(answered).toHaveLength(1);
    expect(JSON.parse(answered[0]!.body)).toMatchObject({ k: "assistant", p: { text: "أهلا سارة" } });
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "chat.assistant_asked" } })).toBe(1);
  });

  it("the same plain message in an ordinary topic, or in somebody else's assistant conversation, is NOT answered", async () => {
    const w = await world();
    await open(w.sara.id);
    await say(w.sara.id, w.topic.id, "شو الأولويات اليوم؟");
    expect(seen).toHaveLength(0);
    expect(await lines(w.topic.id)).toHaveLength(0);
    // a mention still works anywhere
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(1);
  });

  it("with the contact's switch off, a plain message there is only text", async () => {
    const w = await world();
    const id = (await open(w.sara.id)).json?.["id"] as string;
    await setFeature(w.org.id, "assistantContact", false);
    await say(w.sara.id, id, "شو الأولويات اليوم؟");
    expect(seen).toHaveLength(0);
    expect(await lines(id)).toHaveLength(0);
  });

  it("keeps every refusal of the mention path: a failing model is one Arabic line, not a crash", async () => {
    const w = await world();
    const id = (await open(w.sara.id)).json?.["id"] as string;
    setProviderFactoryForTests(() => ({
      async complete() {
        throw new Error("boom");
      },
    }));
    await say(w.sara.id, id, "مرحبا");
    const made = await lines(id);
    expect(made).toHaveLength(1);
    expect(JSON.stringify(made[0]!.body)).not.toContain("boom");
  });
});

describe("the helpers", () => {
  it("name and recognise the key", async () => {
    const { assistantChatKey, isAssistantChatKey, isAssistantChatOf } = await import("@/lib/chat/assistant-chat");
    const key = assistantChatKey("u1", "s1");
    expect(key).toBe("assistant|u1@s1");
    expect(isAssistantChatOf(key, "u1")).toBe(true);
    expect(isAssistantChatOf(key, "u2")).toBe(false);
    expect(isAssistantChatOf("u1|u2", "u1")).toBe(false);
    expect(isAssistantChatKey(key)).toBe(true);
    expect(isAssistantChatKey(null)).toBe(false);
  });
});

export type { World };

describe("«اتصل بالمساعد»: the call button of the owner's own conversation", () => {
  const detailOf = async (who: string, id: string) => {
    const detailRoute = await import("@/app/api/chat/conversations/[id]/route");
    await loginAs(who);
    const res = await call(detailRoute.GET, { params: { id } });
    return res.json?.["assistantCall"];
  };

  it("only the OWNER, in his own conversation with the assistant, while the guide is on, gets the flag", async () => {
    const w = await world();
    await setFeature(w.org.id, "siteGuide", true);
    const ownerChat = (await open(w.owner.id)).json?.["id"] as string;
    const saraChat = (await open(w.sara.id)).json?.["id"] as string;
    expect(await detailOf(w.owner.id, ownerChat)).toBe(true);
    // a member's own conversation, and an ordinary topic, never draw it
    expect(await detailOf(w.sara.id, saraChat)).toBeFalsy();
    expect(await detailOf(w.owner.id, w.topic.id)).toBeFalsy();
    // the guide off: the ordinary call button stays
    await setFeature(w.org.id, "siteGuide", false);
    expect(await detailOf(w.owner.id, ownerChat)).toBeFalsy();
  });
});
