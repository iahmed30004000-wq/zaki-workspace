/**
 * F0.8 — a page of messages never skips one. The cursor used to be the message's `createdAt` alone, so two messages written in the
 * same instant could fall in the gap between two pages. Now the order and the cursor are `(createdAt, id)`.
 */
import { describe, expect, it } from "vitest";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

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
