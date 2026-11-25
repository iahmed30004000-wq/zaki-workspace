import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@prisma/client";
import * as openRoute from "@/app/api/chat/botfather/route";
import * as pressRoute from "@/app/api/chat/botfather/press/route";
import * as revealRoute from "@/app/api/chat/botfather/reveal/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature } from "@/lib/features";
import { decodeKeyboard } from "@/lib/chat/botfather";
import { settleBotFatherForTests } from "@/server/services/botfather";
import { addMember } from "@/server/chat/topics";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * «بوت فاذر» the way Telegram's talks: a command that lacks something ASKS for it and the next message answers («/cancel» stops); menus are buttons under the message,
 * a press of a menu button redraws that very message; only the person of the chat may press, and only a button the message really has.
 */
beforeEach(() => {
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

async function world() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.owner.id, role: "ADMIN" }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "Space A");
  const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const k of ["apiDoor", "doorMessages", "botFather"] as const) s = withFeature(s, k, true);
  await db.organization.update({ where: { id: team.org.id }, data: { settings: s as Prisma.InputJsonValue } });
  await loginAs(team.admin.id);
  const chat = (await call(openRoute.POST, { url: "http://localhost/api/chat/botfather", body: {} })).json?.["id"] as string;
  return { ...team, space, chat };
}
const handle = () => `b${uid().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}_bot`;

interface Line {
  id: string;
  text: string;
  reveal: boolean;
  buttons: { t: string; d: string }[];
}
const lines = async (conversationId: string): Promise<Line[]> =>
  (await db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }))
    .map((m) => ({ id: m.id, ...(JSON.parse(m.body) as { k: string; p: { text?: string; reveal?: number; kb?: string } }) }))
    .filter((l) => l.k === "botfather")
    .map((l) => ({ id: l.id, text: l.p.text ?? "", reveal: l.p.reveal === 1, buttons: decodeKeyboard(l.p.kb).flat() }));
const last = async (conversationId: string) => (await lines(conversationId)).at(-1)!;
const say = async (conversationId: string, text: string) => {
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body: text } });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
  await settleBotFatherForTests();
  return last(conversationId);
};
const press = (messageId: string, data: string) => call(pressRoute.POST, { url: "http://localhost/api/chat/botfather/press", body: { messageId, data } });
const button = (line: Line, data: string) => {
  expect(line.buttons.map((b) => b.d), line.text).toContain(data);
  return press(line.id, data);
};
const botNamed = (orgId: string, username: string) => db.bot.findFirstOrThrow({ where: { orgId, username, deletedAt: null } });

describe("a command that lacks something asks for it", () => {
  it("«/newbot» asks the name, then the handle, then makes the bot; a bad handle is asked again, not dropped", async () => {
    const w = await world();
    const h = handle();
    expect((await say(w.chat, "/newbot")).text).toContain("شو اسمه");
    expect((await say(w.chat, "بوت الطلبات")).text).toContain("اسم المستخدم");
    expect((await say(w.chat, "orders")).text).toContain("اسم المستخدم");
    expect(await db.bot.count({ where: { orgId: w.org.id } })).toBe(0);
    const done = await say(w.chat, `@${h}`);
    expect(done.reveal).toBe(true);
    expect(await botNamed(w.org.id, h)).toMatchObject({ name: "بوت الطلبات" });
    // nothing waits any more: ordinary words get the help
    expect((await say(w.chat, "شكرا")).text).toContain("/newbot");
  });

  it("«/cancel» stops what was asked, and says so when nothing was; another command also takes over", async () => {
    const w = await world();
    await say(w.chat, "/newbot");
    expect((await say(w.chat, "/cancel")).text).toContain("لغيت");
    expect((await say(w.chat, "بوت")).text).toContain("/newbot");
    expect((await say(w.chat, "/cancel")).text).toContain("ما في");
    await say(w.chat, "/newbot");
    expect((await say(w.chat, "/mybots")).text).toContain("ما عندك بوتات");
    expect(await db.bot.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a command with no bot offers my bots as buttons; the pick asks the value; «/setname» renames the bot and its account", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot قديم @${h}`);
    const pick = await say(w.chat, "/setname");
    expect((await button(pick, `pick:setname:${h}`)).status).toBe(200);
    expect((await last(w.chat)).text).toContain("الاسم الجديد");
    await say(w.chat, "اسم جديد");
    const bot = await botNamed(w.org.id, h);
    expect(bot.name).toBe("اسم جديد");
    expect((await db.user.findUniqueOrThrow({ where: { id: bot.userId }, select: { name: true } })).name).toBe("اسم جديد");
  });

  it("typing the handle answers the «which bot» question too", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    await say(w.chat, "/setdescription");
    await say(w.chat, `@${h}`);
    await say(w.chat, "وصف من خطوتين");
    expect((await botNamed(w.org.id, h)).description).toBe("وصف من خطوتين");
  });

  it("«/setabouttext» is the profile's line and stays when the description changes later; «/empty» clears", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    await say(w.chat, `/setdescription @${h} وصف أول`);
    const bot = await botNamed(w.org.id, h);
    const bio = async () => (await db.user.findUniqueOrThrow({ where: { id: bot.userId }, select: { bio: true } })).bio;
    // no about text of its own yet: the description shows on the profile, as before
    expect(await bio()).toBe("وصف أول");
    await say(w.chat, `/setabouttext @${h}`);
    await say(w.chat, "نبذة البوت");
    await say(w.chat, `/setdescription @${h} وصف ثاني`);
    expect(await bio()).toBe("نبذة البوت");
    expect((await botNamed(w.org.id, h)).description).toBe("وصف ثاني");
    await say(w.chat, `/setdescription @${h}`);
    await say(w.chat, "/empty");
    expect((await botNamed(w.org.id, h)).description).toBeNull();
  });

  it("«/setcommands» takes the whole list as its answer even though its lines start with a slash", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    await say(w.chat, `/setcommands @${h}`);
    await say(w.chat, "/start - ابدأ\n/help - مساعدة");
    expect((await botNamed(w.org.id, h)).commands).toEqual([{ command: "start", description: "ابدأ" }, { command: "help", description: "مساعدة" }]);
  });
});

describe("the buttons under the messages", () => {
  it("«/mybots» → a bot → its menu, each press redraws the SAME message, and «رجوع» goes back", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    const list = await say(w.chat, "/mybots");
    const count = (await lines(w.chat)).length;
    expect((await button(list, `bot:${h}`)).status).toBe(200);
    const menu = await last(w.chat);
    expect(menu.id).toBe(list.id);
    expect(menu.buttons.map((b) => b.d)).toEqual([`tk:${h}`, `edit:${h}`, `set:${h}`, `del:${h}`, "bots"]);
    await button(menu, `edit:${h}`);
    expect((await last(w.chat)).buttons.map((b) => b.d)).toContain(`ask:setname:${h}`);
    await button(await last(w.chat), `bot:${h}`);
    await button(await last(w.chat), "bots");
    expect((await last(w.chat)).buttons.map((b) => b.d)).toContain(`bot:${h}`);
    expect((await lines(w.chat)).length).toBe(count);
  });

  it("a new token from the menu is shown once through the reveal door, never written in the message", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    const list = await say(w.chat, "/mybots");
    await button(list, `bot:${h}`);
    await button(await last(w.chat), `tk:${h}`);
    await button(await last(w.chat), `tkn:${h}`);
    const shown = await last(w.chat);
    expect(shown.reveal).toBe(true);
    expect(JSON.stringify(await db.chatMessage.findMany({ where: { conversationId: w.chat } }))).not.toMatch(/zws_[0-9a-f]{12}\./);
    const got = await call(revealRoute.GET, { params: { id: shown.id } });
    expect(got.json).toMatchObject({ token: expect.stringMatching(/^zws_/) });
  });

  it("deleting asks first: «لا» keeps the bot, «نعم» deletes it", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    const confirm = await say(w.chat, `/deletebot @${h}`);
    await button(confirm, `bot:${h}`);
    expect(await db.bot.count({ where: { orgId: w.org.id, username: h, deletedAt: null } })).toBe(1);
    await button(await last(w.chat), `del:${h}`);
    await button(await last(w.chat), `delok:${h}`);
    expect(await db.bot.count({ where: { orgId: w.org.id, username: h, deletedAt: null } })).toBe(0);
  });

  it("only the person of the chat presses, only a button the message has, and not after the right is gone", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    const list = await say(w.chat, "/mybots");
    expect((await press(list.id, `delok:${h}`)).status).toBe(404);
    await loginAs(w.owner.id);
    expect((await press(list.id, `bot:${h}`)).status).toBe(404);
    await loginAs(w.admin.id);
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.admin.id }, data: { role: "MEMBER" } });
    expect((await press(list.id, `bot:${h}`)).status).toBe(403);
    expect(await db.bot.count({ where: { orgId: w.org.id, username: h, deletedAt: null } })).toBe(1);
  });
});

describe("«/setjoingroups» and «/setprivacy»", () => {
  it("a bot that may not join cannot be added to a topic of chosen people; allowing it again lets it in", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    const bot = await botNamed(w.org.id, h);
    expect(bot).toMatchObject({ joinGroups: true, privacyMode: true });
    const view = await say(w.chat, `/setjoingroups @${h}`);
    await button(view, `jgset:${h}:0`);
    expect((await botNamed(w.org.id, h)).joinGroups).toBe(false);
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "خاص", restricted: true, members: { create: [{ userId: w.owner.id }] } } });
    const ctx = { orgId: w.org.id, userId: w.owner.id, orgRole: "OWNER" as const };
    await expect(addMember(ctx, topic.id, bot.userId)).rejects.toThrow("bots.no_join");
    await say(w.chat, `/setjoingroups @${h} enable`);
    await addMember(ctx, topic.id, bot.userId);
    expect(await db.conversationMember.count({ where: { conversationId: topic.id, userId: bot.userId } })).toBe(1);
  });

  it("«/setprivacy» turns privacy off and on, from words or from its buttons", async () => {
    const w = await world();
    const h = handle();
    await say(w.chat, `/newbot بوت @${h}`);
    const view = await say(w.chat, `/setprivacy @${h}`);
    await button(view, `pmset:${h}:0`);
    expect((await botNamed(w.org.id, h)).privacyMode).toBe(false);
    await say(w.chat, `/setprivacy @${h} enable`);
    expect((await botNamed(w.org.id, h)).privacyMode).toBe(true);
  });
});
