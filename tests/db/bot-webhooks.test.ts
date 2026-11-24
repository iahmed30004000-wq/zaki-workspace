import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature } from "@/lib/features";
import { hmacHex } from "@/server/crypto";
import { setLocalTransportForTests, type LocalHttpRequest } from "@/server/ai/local-transport";
import { addressedTo, settleBotWebhooksForTests } from "@/server/services/bot-webhooks";
import { createBot, deleteBot, setBotWebhook } from "@/server/services/bots";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * The webhook of a bot: a message that addresses it (a mention, a slash command, a private chat with it) is sent, signed, to its address; nothing else is. Real PostgreSQL, a fake transport.
 */
let seen: LocalHttpRequest[] = [];
let answer: { status: number; text: string } | Error = { status: 200, text: "{}" };

beforeEach(() => {
  seen = [];
  answer = { status: 200, text: "{}" };
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  setLocalTransportForTests(async (request) => {
    seen.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  });
});

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

const handle = () => `b${uid().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}_bot`;

async function world() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.owner.id, role: "ADMIN" }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "Space A");
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "طلبات" } });
  await setFeatures(team.org.id, { apiDoor: true, doorMessages: true, botFather: true });
  const ctx = { orgId: team.org.id, userId: team.admin.id, orgRole: "ADMIN" as const };
  const username = handle();
  const made = await createBot(ctx, { name: "بوت الطلبات", username, workspaceId: space.id });
  const hook = await setBotWebhook(ctx, username, "https://hooks.example.com/zaki?k=1");
  const botUser = (await db.bot.findFirstOrThrow({ where: { id: made.bot.id } })).userId;
  return { ...team, space, topic, ctx, username, botUser, secret: hook.webhookSecret!, botId: made.bot.id };
}
type World = Awaited<ReturnType<typeof world>>;

const say = async (w: World, conversationId: string, text: string, as: { id: string } = w.member) => {
  await loginAs(as.id);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body: text } });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
  await settleBotWebhooksForTests();
};

describe("what addresses a bot", () => {
  it("a mention and a slash command do; «/cmd@other_bot» does not; a plain sentence does not", () => {
    expect(addressedTo("هلا @orders_bot شو الوضع", "orders_bot").mentioned).toBe(true);
    expect(addressedTo("هلا @Orders_Bot", "orders_bot").mentioned).toBe(true);
    expect(addressedTo("هلا @orders_bot2", "orders_bot").mentioned).toBe(false);
    expect(addressedTo("mail@orders_bot.com", "orders_bot").mentioned).toBe(false);
    expect(addressedTo("/start", "orders_bot").command).toEqual({ name: "start", args: "" });
    expect(addressedTo("/status 123 now", "orders_bot").command).toEqual({ name: "status", args: "123 now" });
    expect(addressedTo("/start@orders_bot x", "orders_bot").command).toEqual({ name: "start", args: "x" });
    expect(addressedTo("/start@other_bot", "orders_bot").command).toBeNull();
    expect(addressedTo("مرحبا بالجميع", "orders_bot")).toEqual({ mentioned: false, command: null });
  });
});

describe("the delivery", () => {
  it("a mention in a topic of the bot's space is POSTed to its address, signed with its secret (timestamp.body), with the text and the author and nothing more", async () => {
    const w = await world();
    await say(w, w.topic.id, `@${w.username} شو حالة الطلب؟`);
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.url).toBe("https://hooks.example.com/zaki?k=1");
    const raw = Buffer.from(req.rawBody as Uint8Array).toString("utf8");
    const ts = req.headers["x-zaki-timestamp"]!;
    expect(req.headers["x-zaki-signature"]).toBe(`sha256=${hmacHex(w.secret, `${ts}.${raw}`)}`);
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(30);
    expect(req.headers["x-zaki-event"]).toBe("message");
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body).toMatchObject({ event: "message", mentioned: true, bot: { username: w.username }, from: { name: "Member" }, message: { text: `@${w.username} شو حالة الطلب؟` }, conversation: { kind: "TOPIC", title: "طلبات" } });
    expect(Object.keys(body).sort()).toEqual(["bot", "conversation", "delivery", "event", "from", "mentioned", "message"]);
  });

  it("a slash command carries its name and arguments", async () => {
    const w = await world();
    await say(w, w.topic.id, "/status 123 now");
    expect(JSON.parse(Buffer.from(seen[0]!.rawBody as Uint8Array).toString("utf8"))).toMatchObject({ mentioned: false, command: { name: "status", args: "123 now" } });
  });

  it("a plain message, the bot's own message, another bot's command, and a topic of ANOTHER space send nothing", async () => {
    const w = await world();
    await say(w, w.topic.id, "كلام عادي بين الزملاء");
    await say(w, w.topic.id, `/start@someone_else_bot`);
    const elsewhere = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Space B");
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: elsewhere.id, title: "ثاني" } });
    await say(w, other.id, `@${w.username} هلا`);
    expect(seen).toHaveLength(0);
  });

  it("a restricted topic reaches the bot only when it was added to it", async () => {
    const w = await world();
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "سري", restricted: true, members: { create: [{ userId: w.member.id }] } } });
    await say(w, closed.id, `@${w.username} هلا`);
    expect(seen).toHaveLength(0);
    await db.conversationMember.create({ data: { conversationId: closed.id, userId: w.botUser } });
    await say(w, closed.id, `@${w.username} هلا`);
    expect(seen).toHaveLength(1);
  });

  it("with the switch off, or after the bot was deleted, or with no address, nothing is sent", async () => {
    const w = await world();
    await setFeatures(w.org.id, { botFather: false });
    await say(w, w.topic.id, `@${w.username} 1`);
    await setFeatures(w.org.id, { botFather: true });
    await setBotWebhook(w.ctx, w.username, "");
    await say(w, w.topic.id, `@${w.username} 2`);
    await setBotWebhook(w.ctx, w.username, "https://hooks.example.com/zaki");
    await deleteBot(w.ctx, w.username);
    await say(w, w.topic.id, `@${w.username} 3`);
    expect(seen).toHaveLength(0);
  });

  it("a failure is ONE row under «التكاملات» with a code only (never the address, the text or the answer), and the message is untouched", async () => {
    const w = await world();
    answer = { status: 500, text: "oops secret-answer" };
    await say(w, w.topic.id, `@${w.username} سر الزبون 0791234567`);
    answer = new Error("ECONNREFUSED");
    await say(w, w.topic.id, `@${w.username} ثاني`);
    const rows = await db.integrationEvent.findMany({ where: { orgId: w.org.id, type: "bot.webhook" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.direction, r.status, r.detail])).toEqual([["OUT", "FAILED", "bot.webhook.http_500"], ["OUT", "FAILED", "bot.webhook.unreachable"]]);
    expect(JSON.stringify(rows)).not.toMatch(/hooks\.example|secret-answer|0791234567|سر الزبون/);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "TEXT" } })).toBe(2);
  });
});
