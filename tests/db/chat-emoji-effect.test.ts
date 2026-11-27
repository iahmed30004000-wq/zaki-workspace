/**
 * «التأثير بيشوفه الطرفين»: who may tell the other person's screen to play an emoji, and who is told. Only the two people of a private chat, only for a living
 * message that is one emoji; the owner's silent oversight never signals anything (it would give him away); a topic signals nobody.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as route from "@/app/api/chat/messages/[id]/effect/route";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

afterEach(() => resetHubForTests());

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const bee = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: bee.id }], "Alpha");
  const dm = await db.conversation.create({ data: { orgId, kind: "DM", dmKey: [t.member.id, bee.id].sort().join("|"), members: { create: [{ userId: t.member.id }, { userId: bee.id }] } } });
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open", members: { create: [{ userId: t.member.id }] } } });
  const say = (conversationId: string, body: string, extra: Record<string, unknown> = {}) => db.chatMessage.create({ data: { orgId, conversationId, authorId: bee.id, body, ...extra } });
  return { t, bee, orgId, dm, topic, say };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const play = async (userId: string, messageId: string) => {
  await loginAs(userId);
  return (await call(route.POST, { method: "POST", params: { id: messageId } })).status;
};
const listen = (orgId: string, userId: string) => {
  const frames: string[] = [];
  addClient({ orgId, userId, send: (frame: string) => void frames.push(frame) } as never);
  return frames;
};

describe("playing an emoji for the other person", () => {
  it("one of the two plays it: only the other one's screen is told, and the frame names the message and nothing it says", async () => {
    const w = await getWorld();
    const m = await w.say(w.dm.id, "😂");
    const bee = listen(w.orgId, w.bee.id);
    const mine = listen(w.orgId, w.t.member.id);
    const owner = listen(w.orgId, w.t.owner.id);
    expect(await play(w.t.member.id, m.id)).toBe(204);
    expect(bee).toHaveLength(1);
    expect(bee[0]).toContain('"kind":"emoji.effect"');
    expect(bee[0]).toContain(m.id);
    expect(bee[0]).not.toContain("😂");
    expect(mine).toHaveLength(0);
    expect(owner).toHaveLength(0);
    // a second tap within two seconds is quiet
    expect(await play(w.t.member.id, m.id)).toBe(204);
    expect(bee).toHaveLength(1);
  });

  it("somebody who is not one of the two cannot, the owner's oversight included; nor for words, a deleted message or an unknown one", async () => {
    const w = await getWorld();
    const m = await w.say(w.dm.id, "🔥");
    const words = await w.say(w.dm.id, "مرحبا 🔥");
    const gone = await w.say(w.dm.id, "🎉", { deletedAt: new Date() });
    const bee = listen(w.orgId, w.bee.id);
    const member = listen(w.orgId, w.t.member.id);
    expect(await play(w.t.owner.id, m.id)).toBe(404);
    expect(await play(w.t.admin.id, m.id)).toBe(404);
    expect(await play(w.t.member.id, words.id)).toBe(404);
    expect(await play(w.t.member.id, gone.id)).toBe(404);
    expect(await play(w.t.member.id, "nothing-here")).toBe(404);
    expect(bee).toHaveLength(0);
    expect(member).toHaveLength(0);
  });

  it("in a topic it answers quietly and tells nobody", async () => {
    const w = await getWorld();
    const m = await w.say(w.topic.id, "👍");
    const bee = listen(w.orgId, w.bee.id);
    expect(await play(w.t.member.id, m.id)).toBe(204);
    expect(bee).toHaveLength(0);
  });
});
