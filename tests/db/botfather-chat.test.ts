import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// the pictures of this file live in a throw-away folder, never in the repository
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-botfather-${process.pid}`;
});

import type { Prisma } from "@prisma/client";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as openRoute from "@/app/api/chat/botfather/route";
import * as revealRoute from "@/app/api/chat/botfather/reveal/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as directoryRoute from "@/app/api/chat/directory/route";
import { withFeature } from "@/lib/features";
import { settleBotFatherForTests } from "@/server/services/botfather";
import { call, db, loginAs, makeTeam, makeWorkspace, makeUser, uid } from "./helpers";

/**
 * «بوت فاذر» — the system chat: who opens it, a message that is a command is answered by a line (never a secret in the line), the one-time reveal, and the lists that must not show
 * somebody else's chat. Through the real routes and a real PostgreSQL.
 */
beforeEach(() => {
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.owner.id, role: "ADMIN" }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "Space A");
  await db.workspace.update({ where: { id: space.id }, data: {} });
  await setFeatures(team.org.id, { apiDoor: true, doorMessages: true, botFather: opts.on !== false });
  return { ...team, space };
}
/** The company's current space is the first one the person is in: make that one. */
async function openAs(user: { id: string }) {
  await loginAs(user.id);
  return call(openRoute.POST, { url: "http://localhost/api/chat/botfather", body: {} });
}
const say = async (conversationId: string, text: string) => {
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body: text } });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
  await settleBotFatherForTests();
  return res;
};
const lines = async (conversationId: string) =>
  (await db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } })).map((m) => ({ id: m.id, ...(JSON.parse(m.body) as { k: string; p: { text?: string; reveal?: number } }) })).filter((l) => l.k === "botfather");
const handle = () => `b${uid().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}_bot`;

describe("opening the chat", () => {
  it("the owner and an admin open ONE restricted topic (201 then 200), a member is refused (403), a guest too, and with the switch off it is «not found»", async () => {
    const w = await world();
    const first = await openAs(w.admin);
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const again = await openAs(w.admin);
    expect(again.status).toBe(200);
    expect(again.json?.["id"]).toBe(first.json?.["id"]);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: first.json?.["id"] as string }, include: { members: true } });
    expect(conv).toMatchObject({ kind: "TOPIC", restricted: true, title: "بوت فاذر" });
    expect(conv.members.map((m) => m.userId)).toEqual([w.admin.id]);
    expect((await openAs(w.member)).status).toBe(403);
    expect((await openAs(w.guest)).status).toBe(403);
    await setFeatures(w.org.id, { botFather: false });
    expect((await openAs(w.admin)).status).toBe(404);
  });

  it("the new-message list offers the row only to the owner and the admins, only while the switch is on", async () => {
    const w = await world();
    const dir = async (user: { id: string }) => {
      await loginAs(user.id);
      return (await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory" })).json?.["botFather"];
    };
    expect(await dir(w.admin)).toBe(true);
    expect(await dir(w.owner)).toBe(true);
    expect(await dir(w.member)).toBe(false);
    await setFeatures(w.org.id, { botFather: false });
    expect(await dir(w.admin)).toBe(false);
  });
});

describe("a command is answered by a line, and a secret is never in the line", () => {
  it("«/newbot» makes the bot, the line says so and carries only the mark; the token and the webhook secret come ONCE through the reveal door, for that person alone", async () => {
    const w = await world();
    const h = handle();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    await say(chat, `/newbot بوت الطلبات @${h}`);
    const [line] = await lines(chat);
    expect(line?.p.text).toContain("بوت الطلبات");
    expect(line?.p.text).toContain(h);
    expect(line?.p.reveal).toBe(1);
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    expect(bot.ownerId).toBe(w.admin.id);
    // the line, the search and the history hold no secret
    const everything = JSON.stringify(await db.chatMessage.findMany({ where: { conversationId: chat } }));
    expect(everything).not.toMatch(/zws_[0-9a-f]{12}\./);

    // somebody else cannot take it; the person can, once
    await loginAs(w.owner.id);
    expect((await call(revealRoute.GET, { params: { id: line!.id } })).status).toBe(404);
    await loginAs(w.admin.id);
    const got = await call(revealRoute.GET, { params: { id: line!.id } });
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({ token: expect.stringMatching(/^zws_[0-9a-f]{12}\./), webhookSecret: expect.stringMatching(/^[0-9a-f]{64}$/), username: h });
    expect((await call(revealRoute.GET, { params: { id: line!.id } })).status).toBe(404);
  });

  it("«/mybots», «/token», «/setdescription», «/setcommands», «/setwebhook» and «/revoke» do what they say, each answered in words", async () => {
    const w = await world();
    const h = handle();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    await say(chat, `/newbot بوت @${h}`);
    await say(chat, "/mybots");
    await say(chat, `/token @${h}`);
    await say(chat, `/setdescription @${h} بيعمل كذا`);
    await say(chat, `/setcommands @${h}\n/start - ابدأ\n/help - مساعدة`);
    await say(chat, `/setwebhook @${h} https://hooks.example.com/zaki`);
    await say(chat, `/revoke @${h}`);
    const texts = (await lines(chat)).map((l) => l.p.text ?? "");
    expect(texts).toHaveLength(7);
    expect(texts[1]).toContain(h);
    expect(texts[2]).toContain("توكن جديد");
    expect(texts[3]).toContain("وصف");
    expect(texts[4]).toContain("2");
    expect(texts[5]).toContain("hooks.example.com");
    expect(texts[6]).toContain("ألغيت");
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    expect(bot).toMatchObject({ description: "بيعمل كذا", webhookUrl: "https://hooks.example.com/zaki" });
    expect(bot.commands).toEqual([{ command: "start", description: "ابدأ" }, { command: "help", description: "مساعدة" }]);
    expect(await db.apiToken.count({ where: { createdById: bot.userId, revokedAt: null } })).toBe(0);
  });

  it("a failure is a plain sentence: a bad handle, a taken one, a bad commands line, a public http address; «/deletebot» waits for «confirm»", async () => {
    const w = await world();
    const h = handle();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    await say(chat, "/newbot بوت @orders");
    await say(chat, `/newbot بوت @${h}`);
    await say(chat, `/newbot ثاني @${h}`);
    await say(chat, `/setcommands @${h}\nكلام بدون أمر`);
    await say(chat, `/setwebhook @${h} http://example.com/x`);
    await say(chat, `/deletebot @${h}`);
    await say(chat, "/token @nobody_bot");
    const texts = (await lines(chat)).map((l) => l.p.text ?? "");
    expect(texts[0]).toContain("اسم المستخدم");
    expect(texts[2]).toContain("مأخوذ");
    expect(texts[3]).toContain("السطر 1");
    expect(texts[4]).toContain("الرابط غير مقبول");
    expect(texts[5]).toContain("confirm");
    expect(texts[6]).toContain("ما لقيت بوت");
    expect(await db.bot.count({ where: { orgId: w.org.id, username: h, deletedAt: null } })).toBe(1);
    await say(chat, `/deletebot @${h} confirm`);
    expect(await db.bot.count({ where: { orgId: w.org.id, username: h, deletedAt: null } })).toBe(0);
    expect((await lines(chat)).at(-1)?.p.text).toContain("حذفت");
  });

  it("anything that is not a command is answered with the help; a person who lost the right gets the refusal, not a bot", async () => {
    const w = await world();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    await say(chat, "مرحبا");
    expect((await lines(chat))[0]?.p.text).toContain("/newbot");
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.admin.id }, data: { role: "MEMBER" } });
    await say(chat, `/newbot بوت @${handle()}`);
    expect((await lines(chat)).at(-1)?.p.text).toContain("للمالك والمشرفين");
    expect(await db.bot.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("only the person the chat belongs to wakes it: the owner reading it (oversight) and a message in any other topic do nothing", async () => {
    const w = await world();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "عادي" } });
    await loginAs(w.admin.id);
    await say(other.id, `/newbot بوت @${handle()}`);
    expect(await db.bot.count({ where: { orgId: w.org.id } })).toBe(0);
    expect((await lines(other.id)).length).toBe(0);
    expect((await lines(chat)).length).toBe(0);
  });
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
async function uploadPicture(): Promise<string> {
  const form = new FormData();
  form.append("file", new File([PNG as BlobPart], "bot.png", { type: "image/png" }));
  form.append("kind", "IMAGE");
  const res = await uploadsRoute.POST(new Request("http://localhost/api/chat/uploads", { method: "POST", body: form }));
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as { id: string }).id;
}
const sayPicture = async (conversationId: string) => {
  const attachmentId = await uploadPicture();
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { attachmentIds: [attachmentId] } });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
  await settleBotFatherForTests();
};

describe("«/setavatar»: the bot's picture", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("the next picture the person sends becomes the bot's face, and the answer says so; a picture while no command waits is only a picture", async () => {
    const w = await world();
    const h = handle();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    await say(chat, `/newbot بوت @${h}`);
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    // no command waiting: the picture is stored as a message and the bot is untouched, with no line from the bot maker
    await sayPicture(chat);
    expect((await db.user.findUniqueOrThrow({ where: { id: bot.userId }, select: { avatarUrl: true } })).avatarUrl).toBeNull();
    expect((await lines(chat)).length).toBe(1);

    await say(chat, `/setavatar @${h}`);
    await sayPicture(chat);
    const texts = (await lines(chat)).map((l) => l.p.text ?? "");
    expect(texts).toHaveLength(3);
    expect(texts[1]).toContain("ابعت");
    expect(texts[2]).toContain(h);
    const face = (await db.user.findUniqueOrThrow({ where: { id: bot.userId }, select: { avatarUrl: true } })).avatarUrl;
    expect(face).toMatch(/^\/api\/avatars\/[A-Za-z0-9_-]+$/);
    // the command waits for ONE picture: a second one changes nothing
    await sayPicture(chat);
    expect((await db.user.findUniqueOrThrow({ where: { id: bot.userId }, select: { avatarUrl: true } })).avatarUrl).toBe(face);
    expect((await lines(chat)).length).toBe(3);
  });

  it("a text message in between cancels the wait; an unknown bot is a plain sentence and waits for nothing", async () => {
    const w = await world();
    const h = handle();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    await say(chat, `/newbot بوت @${h}`);
    await say(chat, `/setavatar @${h}`);
    await say(chat, "/mybots");
    await sayPicture(chat);
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    expect((await db.user.findUniqueOrThrow({ where: { id: bot.userId }, select: { avatarUrl: true } })).avatarUrl).toBeNull();
    await say(chat, "/setavatar @nobody_bot");
    expect((await lines(chat)).at(-1)?.p.text).toContain("ما لقيت بوت");
    await sayPicture(chat);
    expect((await lines(chat)).length).toBe(4);
  });
});

describe("somebody else's chat with the bot maker is not on anybody's list", () => {
  it("the topic list of the space and the chat list hold it for its person only", async () => {
    const w = await world();
    const chat = (await openAs(w.admin)).json?.["id"] as string;
    const other = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Other Admin" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: other.id, role: "ADMIN" } });
    const { topicListed } = await import("@/server/chat/home");
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: chat }, include: { members: true } });
    const viewer = { oversight: false, spaceRole: "ADMIN" as const, teamIds: new Set<string>(), userId: other.id };
    expect(topicListed({ restricted: true, teamId: null, archivedAt: null, dmKey: conv.dmKey, memberCount: 0 }, viewer as never)).toBe(false);
    expect(topicListed({ restricted: true, teamId: null, archivedAt: null, dmKey: conv.dmKey, memberCount: 1 }, viewer as never)).toBe(true);
  });
});
