import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as automationRoute from "@/app/api/me/automation/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature } from "@/lib/features";
import { setAwayClockForTests, settleAwayForTests } from "@/server/chat/away";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * «أتمتة المحادثة»: a person who writes to somebody in a private chat OUTSIDE that somebody's work hours sees one labelled away line with the somebody's own text — at most one per
 * twelve hours, only in a private chat, only with the switch on, never as a message in the somebody's name. Real PostgreSQL, a fake clock.
 */
const AMMAN = { days: [0, 1, 2, 3, 4], from: "09:00", to: "17:00", tz: "Asia/Amman" };
const OUTSIDE = new Date("2026-11-24T05:00:00Z"); // Tuesday 08:00 in Amman
const INSIDE = new Date("2026-11-24T09:00:00Z"); // Tuesday 12:00 in Amman
const TEXT = "أنا خارج الدوام، برد عليك أول ما أبدأ";

let now = OUTSIDE;
beforeEach(() => {
  now = OUTSIDE;
  setAwayClockForTests(() => now);
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
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "الشغل");
  await setFeatures(team.org.id, { chatAutomation: opts.on !== false });
  return { ...team, space };
}
type World = Awaited<ReturnType<typeof world>>;

const save = (body: Record<string, unknown>) => call(automationRoute.PATCH, { method: "PATCH", body });
async function away(w: World, body: Record<string, unknown> = { workHours: AMMAN, chatAutomation: { on: true, text: TEXT } }) {
  await loginAs(w.member.id);
  const res = await save(body);
  expect(res.status, res.text).toBe(200);
}
async function dm(w: World, from: { id: string }, to: { id: string }): Promise<string> {
  await loginAs(from.id);
  return (await call(dmRoute.POST, { body: { userId: to.id } })).json?.["id"] as string;
}
async function say(conversationId: string, text: string, from: { id: string }) {
  await loginAs(from.id);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body: text } });
  expect(res.status, res.text).toBeLessThan(300);
  await settleAwayForTests();
}
const lines = async (conversationId: string) =>
  (await db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } }))
    .map((m) => ({ authorId: m.authorId, ...(JSON.parse(m.body) as { k: string; p: { text?: string } }) }))
    .filter((l) => l.k === "away");

describe("saving the hours and the line", () => {
  it("is mine alone: PATCH stores both, GET returns them, `null` clears the hours", async () => {
    const w = await world();
    await away(w);
    const got = await call(automationRoute.GET);
    expect(got.json).toMatchObject({ workHours: AMMAN, chatAutomation: { on: true, text: TEXT } });
    expect((await save({ workHours: null })).status).toBe(200);
    expect((await call(automationRoute.GET)).json).toMatchObject({ workHours: null, chatAutomation: { on: true, text: TEXT } });
  });

  it("refuses a backwards range, an empty line that is on, and a made-up zone (422); with the switch off nothing can be saved (404)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await save({ workHours: { ...AMMAN, from: "18:00", to: "09:00" } })).status).toBe(422);
    expect((await save({ chatAutomation: { on: true, text: "  " } })).status).toBe(422);
    expect((await save({ workHours: { ...AMMAN, tz: "Mars/Olympus" } })).status).toBe(422);
    await setFeatures(w.org.id, { chatAutomation: false });
    expect((await save({ chatAutomation: { on: false, text: "" } })).status).toBe(404);
  });
});

describe("the away line", () => {
  it("outside the hours the person who writes sees ONE line with the text, authored by the one who is away; a second message within twelve hours adds none, a later one does", async () => {
    const w = await world();
    await away(w);
    const conv = await dm(w, w.admin, w.member);
    await say(conv, "وينك؟", w.admin);
    expect(await lines(conv)).toEqual([{ authorId: w.member.id, k: "away", p: { text: TEXT, at: OUTSIDE.getTime() } }]);
    now = new Date(OUTSIDE.getTime() + 60_000);
    await say(conv, "ردّ", w.admin);
    expect(await lines(conv)).toHaveLength(1);
    now = new Date(OUTSIDE.getTime() + 13 * 3_600_000);
    await say(conv, "لسا هون", w.admin);
    expect(await lines(conv)).toHaveLength(2);
    // the real messages are untouched, and none of them is in the away person's name
    expect(await db.chatMessage.count({ where: { conversationId: conv, kind: "TEXT", authorId: w.member.id } })).toBe(0);
  });

  it("nothing inside the hours, with no hours, with the line off, with the switch off, in a topic, or when the one who is away is the one writing", async () => {
    const w = await world();
    await away(w);
    const conv = await dm(w, w.admin, w.member);
    now = INSIDE;
    await say(conv, "داخل الدوام", w.admin);
    now = OUTSIDE;
    // the away person writes: the other person has set nothing
    await say(conv, "أنا كتبت", w.member);
    // a topic is not a private chat
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "عام" } });
    await say(topic.id, "في موضوع", w.admin);
    expect(await lines(conv)).toHaveLength(0);
    expect(await lines(topic.id)).toHaveLength(0);

    await away(w, { workHours: null });
    await say(conv, "بدون ساعات", w.admin);
    expect(await lines(conv)).toHaveLength(0);
    await away(w, { workHours: AMMAN, chatAutomation: { on: false, text: TEXT } });
    await say(conv, "السطر مطفي", w.admin);
    expect(await lines(conv)).toHaveLength(0);
    await away(w);
    await setFeatures(w.org.id, { chatAutomation: false });
    await say(conv, "المفتاح مطفي", w.admin);
    expect(await lines(conv)).toHaveLength(0);
  });
});
