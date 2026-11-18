import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/** Q1.7: the hint line is a switch of the company, for staff only; the server only says whether it is on (the text is read by the screen). */
async function world(on: boolean) {
  const w = await makeTeamsWorld();
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "orderTemplateHint", on) as Prisma.InputJsonValue } });
  const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Orders ${uid()}` } });
  const me = async () => ((await call(conversationRoute.GET, { params: { id: topic.id } })).json!["me"] as { orderHints?: boolean });
  return { ...w, topic, me };
}

describe("me.orderHints", () => {
  it("is on for staff while the switch is on, and off when it is off", async () => {
    const on = await world(true);
    await loginAs(on.carol.id);
    expect((await on.me()).orderHints).toBe(true);
    const off = await world(false);
    await loginAs(off.carol.id);
    expect((await off.me()).orderHints).toBeFalsy();
  });
  it("is never on for a guest", async () => {
    const w = await world(true);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(guest.id);
    expect((await w.me()).orderHints).toBeFalsy();
  });
  it("a message is never changed or hidden by it: the text a reader gets is the text that was written", async () => {
    const w = await world(true);
    const text = "الاسم: سلمى\nرقم الهاتف: 0791234567\nالمحافظة: عمان\nالعنوان: شارع الجامعة";
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.bob.id, body: text } });
    await loginAs(w.carol.id);
    const r = await call(conversationRoute.GET, { params: { id: w.topic.id } });
    const found = (r.json!["messages"] as Array<{ body: string }>).find((m) => m.body === text);
    expect(found).toBeTruthy();
  });
});
