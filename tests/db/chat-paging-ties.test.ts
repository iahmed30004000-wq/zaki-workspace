/**
 * F0.8 — a page of messages never skips one. The cursor used to be the message's `createdAt` alone, so two messages written in the
 * same instant could fall in the gap between two pages. Now the order and the cursor are `(createdAt, id)`.
 */
import { describe, expect, it } from "vitest";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "Ties" } });
  await loginAs(team.member.id);
  return { team, topic };
}
const page = async (conversationId: string, query: string) => {
  const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}?${query}`, params: { id: conversationId } });
  expect(res.status).toBe(200);
  return (res.json?.["messages"] as { id: string }[]).map((m) => m.id);
};

describe("paging across messages that share an instant", () => {
  it("walking back page by page returns every message once, in order", async () => {
    const w = await world();
    const at = new Date("2026-11-17T10:00:00.000Z");
    const earlier = new Date("2026-11-17T09:00:00.000Z");
    // one older message, then SIX that share one instant: a page of 2 ends in the middle of the tie more than once
    const ids = ["z0", "z1", "z2", "z3", "z4", "z5", "z6"];
    await db.chatMessage.createMany({
      data: ids.map((id, i) => ({ id, orgId: w.team.org.id, conversationId: w.topic.id, authorId: w.team.member.id, body: `m ${id}`, createdAt: i === 0 ? earlier : at })),
    });
    const seen: string[] = [];
    let cursor = "";
    for (let guard = 0; guard < 10; guard++) {
      const got = await page(w.topic.id, `limit=2${cursor ? `&before=${cursor}` : ""}`);
      if (got.length === 0) break;
      seen.unshift(...got); // each page is oldest-first; older pages go in front
      cursor = got[0]!;
    }
    expect(seen).toEqual(ids);
  });

  it("«around» a message of a tie returns its neighbours on both sides without losing one", async () => {
    const w = await world();
    const at = new Date("2026-11-17T11:00:00.000Z");
    const ids = ["y1", "y2", "y3", "y4", "y5"];
    await db.chatMessage.createMany({ data: ids.map((id) => ({ id, orgId: w.team.org.id, conversationId: w.topic.id, authorId: w.team.member.id, body: id, createdAt: at })) });
    const got = await page(w.topic.id, "around=y3&limit=4");
    expect(got).toContain("y3");
    // the whole conversation is five messages: every neighbour within the half-pages is there exactly once
    expect(new Set(got).size).toBe(got.length);
    expect(got.slice().sort()).toEqual(["y1", "y2", "y3", "y4", "y5"].filter((id) => got.includes(id)));
    expect(got).toEqual(got.slice().sort());
    expect(got.length).toBeGreaterThanOrEqual(4);
  });
});

/**
 * C1.6 — the unread landing and the client's own cursors, over a conversation made of a few long ties. The client (`useChatMessages`,
 * `messagesQueryOptions`) pages with `getPreviousPageParam` / `getNextPageParam`; here those very functions walk the REAL windows.
 */
describe("the unread landing across long ties (C1.6)", () => {
  it("firstUnreadId is the first message of the tie after the read mark; `around` it and the client's cursors reach every message once, both ways", async () => {
    const { messagesQueryOptions } = await import("@/lib/chat/cache/queries");
    const messagesRoute = await import("@/app/api/chat/conversations/[id]/messages/route");
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "Ties and unread" } });
    const other = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Other" });
    // 150 messages by somebody else, in five instants of 30: a window of 50 always ends in the middle of a tie
    const at = (g: number) => new Date(Date.parse("2026-11-17T08:00:00.000Z") + g * 60_000);
    const all = Array.from({ length: 150 }, (_, i) => `t${String(i).padStart(3, "0")}`);
    await db.chatMessage.createMany({ data: all.map((id, i) => ({ id, orgId: team.org.id, conversationId: topic.id, authorId: other.id, body: id, createdAt: at(Math.floor(i / 30)) })) });
    // the person has read everything up to the end of the second instant: the first unread message is the first of the third group
    await db.conversationMember.create({ data: { conversationId: topic.id, userId: team.member.id, lastReadAt: at(1) } });
    await loginAs(team.member.id);
    const get = async (query: string) => {
      const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${topic.id}/messages?${query}`, params: { id: topic.id } });
      expect(res.status).toBe(200);
      return res.json as unknown as { messages: { id: string }[]; hasOlder: boolean; hasNewer: boolean; firstUnreadId: string | null };
    };
    const newest = await get("limit=50");
    expect(newest.firstUnreadId).toBe("t060"); // outside the newest window (t100..t149): the landing needs `around`
    expect(newest.messages.some((m) => m.id === "t060")).toBe(false);
    const around = await get(`limit=50&around=${newest.firstUnreadId}`);
    expect(around.messages.some((m) => m.id === "t060")).toBe(true);
    expect(around.firstUnreadId).toBe("t060");
    const options = messagesQueryOptions(topic.id);
    const page = (p: typeof around) => ({ messages: p.messages as never[], hasOlder: p.hasOlder, hasNewer: p.hasNewer, firstUnreadId: p.firstUnreadId, readers: [] });
    let windows = [around];
    const param = (kind: "before" | "after", id: string) => `${kind}=${id}&limit=50`;
    for (let guard = 0; guard < 10; guard++) {
      const p = options.getPreviousPageParam(page(windows[0]!));
      if (!p || p.kind === "latest") break;
      windows = [await get(param("before", p.id)), ...windows];
    }
    for (let guard = 0; guard < 10; guard++) {
      const p = options.getNextPageParam(page(windows.at(-1)!));
      if (!p || p.kind === "latest") break;
      windows = [...windows, await get(param("after", p.id))];
    }
    const seen = windows.flatMap((w) => w.messages.map((m) => m.id));
    expect(seen).toEqual(all);
    expect(windows[0]!.hasOlder).toBe(false);
    expect(windows.at(-1)!.hasNewer).toBe(false);
  });
});
