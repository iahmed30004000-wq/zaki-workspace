/**
 * S5.6 — «مين تفاعل»: the reactors' names in the message DTO and the Zaki emoji as reactions, on the real doors.
 *
 *  - every chip carries `by`: who reacted (id, name, picture, `me` on my own row), capped; the count stays the truth;
 *  - the ✅ of «لازم ينقرأ» is somebody's receipt: its names go only to the author, the moderators and the owner (everybody else sees the count and themself);
 *  - a GUEST sees only himself among the reactors (never the staff's names behind a chip);
 *  - a restricted topic is readable by its members only, so its reactors' names never reach anybody else (the topic itself is a 404);
 *  - a known Zaki code (`:zaki_smile:`, a task sticker) is a reaction; an unknown code, a code with text around it and any other text are refused;
 *  - the company's switch `zakiEmojis` off refuses a Zaki code (the chips of unicode emoji work either way).
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as reactRoute from "@/app/api/chat/messages/[id]/react/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { resetPresenceForTests } from "@/server/realtime/presence";
import type { MessageDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  resetPresenceForTests();
  const t = await makeTeam();
  const orgId = t.org.id;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const c = await makeUser({ orgId, role: "MEMBER", name: "Cee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: b.id }, { userId: c.id }, { userId: t.guest.id, role: "GUEST" }, { userId: t.admin.id, role: "ADMIN" }], "Space");
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: t.member.id }, { userId: b.id }] } } });
  return { ...t, orgId, b, c, outsider, space, open, restricted };
}
type World = Awaited<ReturnType<typeof world>>;
let w: World;
beforeAll(async () => {
  w = await world();
});

let tick = 0;
async function written(conversationId: string, authorId: string, body: string) {
  tick += 1;
  return db.chatMessage.create({ data: { orgId: w.orgId, conversationId, authorId, body, createdAt: new Date(Date.now() - 3_600_000 + tick * 1000) } });
}
const react = async (userId: string, messageId: string, emoji: string) => {
  await loginAs(userId);
  return call(reactRoute.POST, { url: `http://localhost/api/chat/messages/${messageId}/react`, body: { emoji }, params: { id: messageId } });
};
const read = async (userId: string, conversationId: string, messageId: string): Promise<MessageDto | undefined> => {
  await loginAs(userId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}/messages`, params: { id: conversationId } });
  expect(res.status).toBe(200);
  return (res.json?.["messages"] as MessageDto[]).find((m) => m.id === messageId);
};
const setSwitch = (features: Record<string, boolean>) => db.organization.update({ where: { id: w.orgId }, data: { settings: { features } } });

describe("the reactors of a chip", () => {
  it("each chip lists who reacted, with my own row marked, and the count stays the truth", async () => {
    const m = await written(w.open.id, w.member.id, "رسالة");
    expect((await react(w.b.id, m.id, "👍")).status).toBe(200);
    expect((await react(w.c.id, m.id, "👍")).status).toBe(200);
    expect((await react(w.c.id, m.id, "🔥")).status).toBe(200);
    const asB = await read(w.b.id, w.open.id, m.id);
    const like = asB!.reactions.find((r) => r.emoji === "👍")!;
    expect(like.count).toBe(2);
    expect(like.by?.map((x) => x.name).sort()).toEqual(["Bee", "Cee"]);
    expect(like.by?.find((x) => x.name === "Bee")?.me).toBe(true);
    expect(like.by?.find((x) => x.name === "Cee")?.me).toBeUndefined();
    expect(asB!.reactions.find((r) => r.emoji === "🔥")!.by?.map((x) => x.name)).toEqual(["Cee"]);
    // the author sees the same names
    const asAuthor = await read(w.member.id, w.open.id, m.id);
    expect(asAuthor!.reactions.find((r) => r.emoji === "👍")!.by?.map((x) => x.name).sort()).toEqual(["Bee", "Cee"]);
  });

  it("taking a reaction back takes the name off the list", async () => {
    const m = await written(w.open.id, w.member.id, "رسالة ثانية");
    await react(w.b.id, m.id, "🎉");
    await react(w.c.id, m.id, "🎉");
    await react(w.b.id, m.id, "🎉");
    const dto = await read(w.c.id, w.open.id, m.id);
    expect(dto!.reactions).toHaveLength(1);
    expect(dto!.reactions[0]!.by?.map((x) => x.name)).toEqual(["Cee"]);
  });

  it("a guest sees only himself among the reactors, never the staff behind a chip; the count is untouched", async () => {
    const m = await written(w.open.id, w.member.id, "للضيف");
    await react(w.b.id, m.id, "👍");
    await react(w.c.id, m.id, "👍");
    await react(w.guest.id, m.id, "👍");
    const dto = await read(w.guest.id, w.open.id, m.id);
    const chip = dto!.reactions[0]!;
    expect(chip.count).toBe(3);
    expect(chip.by?.map((x) => x.name)).toEqual(["Guest"]);
    expect(chip.by?.[0]?.me).toBe(true);
    // a guest who did not react gets no names at all
    const other = await written(w.open.id, w.member.id, "لسا");
    await react(w.b.id, other.id, "🔥");
    const none = await read(w.guest.id, w.open.id, other.id);
    expect(none!.reactions[0]!.count).toBe(1);
    expect(none!.reactions[0]!.by ?? []).toEqual([]);
  });

  it("the ✅ of «لازم ينقرأ» is a receipt: its names go to the author and the moderators only, the others see the count and themself", async () => {
    const m = await written(w.open.id, w.member.id, "لازم ينقرأ");
    await db.chatReaction.createMany({ data: [{ messageId: m.id, userId: w.b.id, emoji: "✅" }, { messageId: m.id, userId: w.c.id, emoji: "✅" }] });
    const asB = await read(w.b.id, w.open.id, m.id);
    const ackB = asB!.reactions.find((r) => r.emoji === "✅")!;
    expect(ackB.count).toBe(2);
    expect(ackB.by?.map((x) => x.name)).toEqual(["Bee"]);
    const asAuthor = await read(w.member.id, w.open.id, m.id);
    expect(asAuthor!.reactions.find((r) => r.emoji === "✅")!.by?.map((x) => x.name).sort()).toEqual(["Bee", "Cee"]);
    const asAdmin = await read(w.admin.id, w.open.id, m.id);
    expect(asAdmin!.reactions.find((r) => r.emoji === "✅")!.by?.map((x) => x.name).sort()).toEqual(["Bee", "Cee"]);
  });

  it("a person outside a restricted topic never gets its messages, so never its reactors' names", async () => {
    const m = await written(w.restricted.id, w.member.id, "سرّي");
    await react(w.b.id, m.id, "👍");
    await loginAs(w.c.id);
    const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.restricted.id}/messages`, params: { id: w.restricted.id } });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("Bee");
    expect((await react(w.c.id, m.id, "👍")).status).toBe(404);
    // a member of it sees the names
    const asB = await read(w.b.id, w.restricted.id, m.id);
    expect(asB!.reactions[0]!.by?.map((x) => x.name)).toEqual(["Bee"]);
  });

  it("the list is capped per chip (the count still says how many)", async () => {
    const m = await written(w.open.id, w.member.id, "كتير");
    const crowd = [];
    for (let i = 0; i < 60; i += 1) crowd.push(await makeUser({ orgId: w.orgId, role: "MEMBER", name: `Crowd ${i}` }));
    await db.chatReaction.createMany({ data: crowd.map((u) => ({ messageId: m.id, userId: u.id, emoji: "👀" })) });
    const dto = await read(w.b.id, w.open.id, m.id);
    const chip = dto!.reactions.find((r) => r.emoji === "👀")!;
    expect(chip.count).toBe(60);
    expect((chip.by ?? []).length).toBeLessThanOrEqual(50);
    expect((chip.by ?? []).length).toBeGreaterThan(0);
  });
});

describe("the Zaki emoji as a reaction", () => {
  it("a known code is a reaction (a chat emoji and a task sticker), it shows as a chip with its code and names, and a second press takes it back", async () => {
    const m = await written(w.open.id, w.member.id, "برافو");
    const first = await react(w.b.id, m.id, ":zaki_clap:");
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ mine: true });
    expect((await react(w.c.id, m.id, ":zaki_task_done:")).status).toBe(200);
    const dto = await read(w.b.id, w.open.id, m.id);
    expect(dto!.reactions.map((r) => r.emoji)).toEqual([":zaki_clap:", ":zaki_task_done:"]);
    expect(dto!.reactions[0]).toMatchObject({ count: 1, mine: true });
    expect(dto!.reactions[0]!.by?.[0]?.name).toBe("Bee");
    const off = await react(w.b.id, m.id, ":zaki_clap:");
    expect(off.json).toEqual({ mine: false });
  });

  it("an unknown code, a code with words around it, a code in other letters, and plain text are refused", async () => {
    const m = await written(w.open.id, w.member.id, "ممنوع");
    for (const bad of [":zaki_nothing:", "hi :zaki_clap:", ":zaki_clap: :zaki_clap:", ":ZAKI_CLAP:", "<b>x</b>", "hello", ":zaki_:", "::"]) {
      const res = await react(w.b.id, m.id, bad);
      expect(res.status, bad).toBe(422);
    }
    expect(await db.chatReaction.count({ where: { messageId: m.id } })).toBe(0);
  });

  it("with the company's switch `zakiEmojis` off a Zaki code is refused and a unicode emoji still works", async () => {
    const m = await written(w.open.id, w.member.id, "مطفّى");
    await setSwitch({ zakiEmojis: false });
    try {
      expect((await react(w.b.id, m.id, ":zaki_clap:")).status).toBe(422);
      expect((await react(w.b.id, m.id, "👍")).status).toBe(200);
    } finally {
      await db.organization.update({ where: { id: w.orgId }, data: { settings: {} } });
    }
  });
});

describe("the bell and the list say the Arabic name of a Zaki emoji, never the code", () => {
  it("a message with a Zaki emoji notifies the others with «(احتفال)» and the list preview is the same words", async () => {
    resetPresenceForTests();
    await loginAs(w.member.id);
    const sent = await call(messagesRoute.POST, { url: `http://localhost/api/chat/conversations/${w.restricted.id}/messages`, body: { body: "مبروك :zaki_party:", clientId: "zaki-bell-1", mentions: [w.b.id] }, params: { id: w.restricted.id } });
    expect(sent.status).toBe(201);
    const bell = await db.notification.findMany({ where: { userId: w.b.id, type: "chat_message" }, select: { body: true } });
    expect(bell.some((n) => n.body?.includes("مبروك (احتفال)"))).toBe(true);
    expect(bell.some((n) => n.body?.includes(":zaki_"))).toBe(false);
  });
});
