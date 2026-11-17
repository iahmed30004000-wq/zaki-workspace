/**
 * F0.7 — a retry of a message already sent (the same `clientId` of the same author) is answered with that message and does NOT use
 * the 30-a-minute quota: the phone's outbox re-sends until it hears back, and each retry used to count against the person.
 */
import { describe, expect, it } from "vitest";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

async function world() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  await loginAs(team.member.id);
  return { team, topic };
}
const send = (conversationId: string, clientId: string) =>
  call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body: { body: `رسالة ${clientId}`, clientId } });

describe("the send limit and retries", () => {
  it("re-sending a message that already went does not use the quota, and returns the same message", async () => {
    const w = await world();
    const first = await send(w.topic.id, "c-0");
    expect(first.status).toBe(201);
    const id = first.json?.["id"];
    // 40 retries of the same message: none is refused, none counts
    for (let i = 0; i < 40; i++) {
      const again = await send(w.topic.id, "c-0");
      expect(again.status, `retry ${i}`).toBeLessThan(300);
      expect(again.json?.["id"]).toBe(id);
    }
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, authorId: w.team.member.id } })).toBe(1);
    // the quota is still whole: 29 more NEW messages fit (30 per minute including the first), the next one is refused
    for (let i = 1; i < 30; i++) expect((await send(w.topic.id, `c-${i}`)).status, `new ${i}`).toBe(201);
    expect((await send(w.topic.id, "c-over")).status).toBe(429);
  });
});
