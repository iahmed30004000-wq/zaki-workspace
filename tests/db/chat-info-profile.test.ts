/**
 * S5.4 — the conversation profile's server side.
 *
 *  - «الروابط» lists EVERY web address found in the messages of the conversation (not only the first link of a message that got a preview card), newest first, one row
 *    per address (the same address twice in a page is one row), with its host; the card's title and picture only when the card is for THAT address and the preview
 *    switches are on. Never an address of a deleted message, a system line, another conversation, or a conversation the viewer cannot read.
 *  - the count of the tab is the number of those rows;
 *  - the people of a conversation (the members tab reads the existing detail door): a restricted topic shows names only to people who may read it, a topic of a
 *    section never hands the space's people over as its own.
 */
import { describe, expect, it } from "vitest";
import * as mediaRoute from "@/app/api/chat/conversations/[id]/media/route";
import * as detailRoute from "@/app/api/chat/conversations/[id]/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

const SECRET = "zzsecretzz";
let at = Date.parse("2026-11-18T10:00:00.000Z");
const nextAt = () => new Date((at += 60_000));

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const bee = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: bee.id }, { userId: t.guest.id }], "Alpha");
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const other = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Other" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: bee.id }, { userId: t.member.id }] } } });
  const section = await db.team.create({ data: { workspaceId: space.id, name: "Section", members: { create: [{ userId: bee.id }] } } });
  const teamTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "TeamOnly", teamId: section.id } });
  const say = (conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId, conversationId, authorId, body, createdAt: nextAt(), ...extra } });
  return { t, bee, outsider, space, topic, other, restricted, teamTopic, say, orgId };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

type Link = { id: string; messageId: string; url: string; host: string; title: string | null; siteName: string | null; image: string | null; authorName: string };
const get = async (userId: string, id: string, query: string) => {
  await loginAs(userId);
  const res = await call(mediaRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/media${query}`, params: { id } });
  return {
    status: res.status,
    links: (res.json?.["links"] ?? null) as Link[] | null,
    next: (res.json?.["next"] ?? null) as string | null,
    counts: (res.json?.["counts"] ?? null) as Record<string, number> | null,
    text: res.text,
  };
};
const featuresOn = async (orgId: string, keys: Record<string, boolean>) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
  await db.organization.update({ where: { id: orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), ...keys } } } });
};
const newConversation = async (w: World, title: string) => db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title } });

describe("«الروابط» lists every address found in the messages", () => {
  it("an address in a message that never got a preview card is listed, with its host; newest first", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "NoCards");
    const a = await w.say(conv.id, w.bee.id, "شوف هاد https://example.com/first لو سمحت");
    const b = await w.say(conv.id, w.t.member.id, "وكمان www.news.example.org/story?id=7 مهم");
    const r = await get(w.t.member.id, conv.id, "?kind=LINK");
    expect(r.status).toBe(200);
    expect(r.links!.map((l) => l.url)).toEqual(["https://www.news.example.org/story?id=7", "https://example.com/first"]);
    expect(r.links![0]).toMatchObject({ messageId: b.id, host: "news.example.org", title: null, image: null, authorName: "Member" });
    expect(r.links![1]).toMatchObject({ messageId: a.id, host: "example.com", authorName: "Bee" });
  });

  it("every address of ONE message is a row (not only the first), the address inside [text](address) is found, and a bad scheme never is", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "Many");
    const m = await w.say(conv.id, w.bee.id, "أول https://one.example/a وتاني [العنوان](https://two.example/b) وثالث mailto:me@example.com ورابع javascript:alert(1) وخامس ftp://files.example/x");
    const r = await get(w.t.member.id, conv.id, "?kind=LINK");
    expect(r.links!.map((l) => l.url).sort()).toEqual(["https://one.example/a", "https://two.example/b"]);
    expect(new Set(r.links!.map((l) => l.id)).size).toBe(2);
    expect(r.links!.every((l) => l.messageId === m.id)).toBe(true);
    expect(r.text).not.toContain("javascript:");
    expect(r.text).not.toContain("mailto:");
  });

  it("the same address twice is ONE row (the newest message wins)", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "Dupes");
    await w.say(conv.id, w.bee.id, "https://dup.example/page");
    const newest = await w.say(conv.id, w.t.member.id, "again https://dup.example/page/ and https://dup.example/page#top");
    const r = await get(w.t.member.id, conv.id, "?kind=LINK");
    expect(r.links!).toHaveLength(1);
    expect(r.links![0]!.messageId).toBe(newest.id);
    expect((await get(w.t.member.id, conv.id, "?counts=1")).counts?.["LINK"]).toBe(1);
  });

  it("NEVER the address of a deleted message (the owner too), a system line, another conversation's, or a message that only mentions http as a word", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "Hidden");
    await w.say(conv.id, w.bee.id, `https://kept.example/ok`);
    await w.say(conv.id, w.bee.id, `https://${SECRET}.example/deleted`, { deletedAt: new Date(), deletedById: w.bee.id });
    await w.say(conv.id, w.bee.id, `https://${SECRET}.example/system`, { kind: "SYSTEM" });
    await w.say(w.other.id, w.bee.id, `https://${SECRET}.example/elsewhere`);
    await w.say(conv.id, w.bee.id, "the http protocol is a word here, no address");
    for (const who of [w.t.member.id, w.t.owner.id, w.bee.id]) {
      const r = await get(who, conv.id, "?kind=LINK");
      expect(r.status).toBe(200);
      expect(r.links!.map((l) => l.url)).toEqual(["https://kept.example/ok"]);
      expect(r.text).not.toContain(SECRET);
      expect((await get(who, conv.id, "?counts=1")).counts?.["LINK"]).toBe(1);
    }
  });

  it("the card's title, site and picture come only from a preview that is OK, for THAT address, and while the preview switches are on", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "Cards");
    const card = (url: string, status: string, title: string) => db.linkPreview.create({ data: { orgId: w.orgId, urlHash: `h_${uid()}`, url, title, siteName: "الموقع", status } });
    const good = await card("https://card.example/a", "OK", "عنوان البطاقة");
    const failed = await card("https://failed.example/b", "FAILED", "لا يظهر");
    const m1 = await w.say(conv.id, w.bee.id, "https://card.example/a و https://second.example/x", { previewId: good.id });
    await w.say(conv.id, w.bee.id, "https://failed.example/b", { previewId: failed.id });
    // switches off: the addresses are still listed, never the card's words
    const off = await get(w.t.member.id, conv.id, "?kind=LINK");
    expect(off.links!.map((l) => l.url).sort()).toEqual(["https://card.example/a", "https://failed.example/b", "https://second.example/x"]);
    expect(off.links!.every((l) => l.title === null && l.image === null)).toBe(true);
    expect(off.text).not.toContain("عنوان البطاقة");
    await featuresOn(w.orgId, { chatLayoutV2: true, linkPreviews: true });
    try {
      const on = await get(w.t.member.id, conv.id, "?kind=LINK");
      const byUrl = new Map(on.links!.map((l) => [l.url, l]));
      expect(byUrl.get("https://card.example/a")).toMatchObject({ messageId: m1.id, title: "عنوان البطاقة", siteName: "الموقع" });
      // the second address of the same message has no card of its own
      expect(byUrl.get("https://second.example/x")).toMatchObject({ title: null, siteName: null, image: null });
      // a failed card gives nothing
      expect(byUrl.get("https://failed.example/b")).toMatchObject({ title: null });
      expect(on.text).not.toContain("لا يظهر");
    } finally {
      await featuresOn(w.orgId, { chatLayoutV2: false, linkPreviews: false });
    }
  });

  it("pages: newest first, `before` is the last message of the page before, nothing twice; a foreign cursor is «not found»", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "Pages");
    for (let i = 0; i < 5; i++) await w.say(conv.id, w.bee.id, `https://page${i}.example/p`);
    const all = (await get(w.t.member.id, conv.id, "?kind=LINK&limit=100")).links!.map((l) => l.url);
    expect(all).toEqual([4, 3, 2, 1, 0].map((i) => `https://page${i}.example/p`));
    const seen: string[] = [];
    let before = "";
    for (let guard = 0; guard < 10; guard++) {
      const r = await get(w.t.member.id, conv.id, `?kind=LINK&limit=2${before}`);
      expect(r.status).toBe(200);
      seen.push(...r.links!.map((l) => l.url));
      if (!r.next) break;
      before = `&before=${r.next}`;
    }
    expect(seen).toEqual(all);
    const foreign = await w.say(w.other.id, w.bee.id, "https://foreign.example/f");
    expect((await get(w.t.member.id, conv.id, `?kind=LINK&before=${foreign.id}`)).status).toBe(404);
  });

  it("a conversation one cannot read lists nothing: not found, and the silent eye leaves no trace", async () => {
    const w = await getWorld();
    await w.say(w.restricted.id, w.bee.id, `https://${SECRET}.example/private`);
    expect((await get(w.outsider.id, w.restricted.id, "?kind=LINK")).status).toBe(404);
    expect((await get(w.outsider.id, w.restricted.id, "?counts=1")).status).toBe(404);
    const before = await db.realtimeEvent.count({ where: { orgId: w.orgId } });
    const owner = await get(w.t.owner.id, w.restricted.id, "?kind=LINK");
    expect(owner.status).toBe(200);
    expect(owner.links!.map((l) => l.url)).toContain(`https://${SECRET}.example/private`);
    expect(await db.realtimeEvent.count({ where: { orgId: w.orgId } })).toBe(before);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: w.restricted.id, userId: w.t.owner.id } } })).toBeNull();
  });

  it("a guest reads the links of a topic of their space, as they read its messages", async () => {
    const w = await getWorld();
    const conv = await newConversation(w, "GuestLinks");
    await w.say(conv.id, w.bee.id, "https://guest.example/g");
    const r = await get(w.t.guest.id, conv.id, "?kind=LINK");
    expect(r.status).toBe(200);
    expect(r.links!.map((l) => l.url)).toEqual(["https://guest.example/g"]);
  });
});

describe("the people of a conversation (the members tab reads the existing detail door)", () => {
  type Detail = { status: number; names: string[]; text: string };
  const people = async (userId: string, id: string): Promise<Detail> => {
    await loginAs(userId);
    const res = await call(detailRoute.GET, { url: `http://localhost/api/chat/conversations/${id}?limit=1`, params: { id } });
    const members = (res.json?.["members"] ?? []) as { name: string }[];
    const mentionables = (res.json?.["mentionables"] ?? []) as { name: string }[];
    return { status: res.status, names: [...new Set([...members, ...mentionables].map((m) => m.name))].sort(), text: res.text };
  };

  it("a restricted topic gives its names to its people only; a person outside it is told «not found» and gets no name", async () => {
    const w = await getWorld();
    const inside = await people(w.bee.id, w.restricted.id);
    expect(inside.status).toBe(200);
    expect(inside.names).toEqual(expect.arrayContaining(["Bee", "Member"]));
    const outside = await people(w.outsider.id, w.restricted.id);
    expect(outside.status).toBe(404);
    expect(outside.text).not.toContain("Bee");
    expect(outside.text).not.toContain("Member");
    // a space member who is not in the restricted topic is outside it too
    const space = await people(w.t.guest.id, w.restricted.id);
    expect([403, 404]).toContain(space.status);
    expect(space.text).not.toContain("Bee");
  });

  it("an open topic offers its whole space (the members tab's list)", async () => {
    const w = await getWorld();
    const r = await people(w.t.member.id, w.topic.id);
    expect(r.status).toBe(200);
    expect(r.names).toEqual(expect.arrayContaining(["Bee", "Member"]));
  });

  it("a person outside the company's space does not read an open topic's people either", async () => {
    const w = await getWorld();
    const stranger = await makeTeam();
    await loginAs(stranger.owner.id);
    const res = await call(detailRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}?limit=1`, params: { id: w.topic.id } });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("Bee");
  });
});
