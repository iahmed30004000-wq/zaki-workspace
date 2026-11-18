/**
 * C1.2 — `GET /api/chat/spaces/[spaceId]/topics`: the forum view of one space. The route file already had POST (used by the new-topic dialog):
 * it must keep creating topics. A space that is not the person's does not exist for them.
 */
import { describe, expect, it } from "vitest";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import type { SpaceTopicsDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const spaceAdmin = await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: spaceAdmin.id, role: "ADMIN" }, { userId: t.member.id }, { userId: b.id }, { userId: t.guest.id }], "Alpha");
  const team = await db.team.create({ data: { workspaceId: space.id, name: "Section", members: { create: [{ userId: b.id }] } } });
  const mk = (title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title, ...extra } });
  const quiet = await mk("Quiet", { position: 1 });
  const busy = await mk("Busy", { position: 2 });
  const pinned = await mk("Pinned", { position: 3, pinnedAt: new Date() });
  const restricted = await mk("Restricted", { restricted: true, members: { create: [{ userId: b.id }] } });
  const teamTopic = await mk("TeamOnly", { teamId: team.id });
  const archived = await mk("Old", { archivedAt: new Date(), closedAt: new Date() });
  await db.chatMessage.create({ data: { orgId, conversationId: quiet.id, authorId: b.id, body: "early", createdAt: new Date("2026-11-17T08:00:00.000Z") } });
  await db.chatMessage.create({ data: { orgId, conversationId: busy.id, authorId: b.id, body: "late", createdAt: new Date("2026-11-17T09:00:00.000Z") } });
  await db.chatMessage.create({ data: { orgId, conversationId: restricted.id, authorId: b.id, body: "secret words", createdAt: new Date("2026-11-17T10:00:00.000Z") } });
  return { t, b, spaceAdmin, outsider, space, quiet, busy, pinned, restricted, teamTopic, archived };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const get = async (userId: string, spaceId: string) => {
  await loginAs(userId);
  const res = await call(topicsRoute.GET, { url: `http://localhost/api/chat/spaces/${spaceId}/topics`, params: { spaceId } });
  return { status: res.status, dto: res.json as unknown as SpaceTopicsDto, json: res.json };
};
const titles = (r: { dto: SpaceTopicsDto }) => r.dto.rows.map((x) => x.title);

describe("GET: the forum view of a space", () => {
  it("topic rows only: pinned on top, then the newest activity; the restricted, the team's and the archived ones are not the member's", async () => {
    const w = await getWorld();
    const r = await get(w.t.member.id, w.space.id);
    expect(r.status).toBe(200);
    expect(r.dto.space).toMatchObject({ id: w.space.id, name: "Alpha", canModerate: false, canCreateTopic: false });
    expect(r.dto.rows.every((x) => x.kind === "TOPIC")).toBe(true);
    // Pinned first; then Busy (09:00) before Quiet (08:00) (a space that has topics gets no starter topic added)
    expect(titles(r)).toEqual(["Pinned", "Busy", "Quiet"]);
    for (const hidden of ["Restricted", "TeamOnly", "Old"]) expect(titles(r)).not.toContain(hidden);
    expect(JSON.stringify(r.json)).not.toContain("secret words");
    expect(r.dto.rows.find((x) => x.title === "Busy")).toMatchObject({ unread: 1, topicType: "DISCUSSION", pinned: false, restricted: false });
    expect(r.dto.rows.find((x) => x.title === "Busy")?.lastMessage).toMatchObject({ preview: "late", authorName: "Bee", mine: false, kind: "TEXT" });
    expect(r.dto.rows.find((x) => x.title === "Pinned")?.pinned).toBe(true);
  });

  it("the people each topic is for see it: Bee is in the restricted topic and in the team; the space's manager sees the team's and the archived", async () => {
    const w = await getWorld();
    const bee = titles(await get(w.b.id, w.space.id));
    expect(bee).toEqual(expect.arrayContaining(["Restricted", "TeamOnly"]));
    expect(bee).not.toContain("Old");
    const admin = await get(w.spaceAdmin.id, w.space.id);
    expect(admin.dto.space).toMatchObject({ canModerate: true, canCreateTopic: true });
    expect(titles(admin)).toEqual(expect.arrayContaining(["TeamOnly", "Old"]));
    // a manager still does not read a restricted topic of other people
    expect(titles(admin)).not.toContain("Restricted");
    // archived topics are last
    expect(titles(admin).at(-1)).toBe("Old");
  });

  it("the silent eye reads them all; a guest reads the open ones", async () => {
    const w = await getWorld();
    const owner = await get(w.t.owner.id, w.space.id);
    expect(titles(owner)).toEqual(expect.arrayContaining(["Restricted", "TeamOnly", "Old", "Busy"]));
    expect(owner.dto.space.canCreateTopic).toBe(true);
    const guest = await get(w.t.guest.id, w.space.id);
    expect(guest.status).toBe(200);
    expect(titles(guest)).toEqual(expect.arrayContaining(["Busy", "Quiet", "Pinned"]));
    expect(titles(guest)).not.toContain("Restricted");
    expect(guest.dto.space.canCreateTopic).toBe(false);
  });

  it("a space that is not the person's (never put in it, or another company's) does not exist for them", async () => {
    const w = await getWorld();
    expect((await get(w.outsider.id, w.space.id)).status).toBe(404);
    const other = await makeTeam();
    expect((await get(other.owner.id, w.space.id)).status).toBe(404);
    expect((await get(w.t.member.id, "no-such-space")).status).toBe(404);
  });

  it("a space with no topic gets its two starter topics the first time (as the old home did), and an outsider's refused read writes nothing", async () => {
    const w = await getWorld();
    const bare = await makeWorkspace(w.t.org.id, [{ userId: w.t.member.id }], "Bare");
    expect((await get(w.outsider.id, bare.id)).status).toBe(404);
    expect(await db.conversation.count({ where: { spaceId: bare.id } })).toBe(0);
    const r = await get(w.t.member.id, bare.id);
    expect(titles(r).sort()).toEqual(["التنبيهات", "عام"]);
  });
});

describe("POST on the same file still opens a topic", () => {
  it("a space admin creates one; a plain member is refused", async () => {
    const w = await getWorld();
    await loginAs(w.spaceAdmin.id);
    const ok = await call(topicsRoute.POST, { url: "http://localhost/api/x", params: { spaceId: w.space.id }, body: { title: "Fresh" } });
    expect(ok.status).toBe(201);
    expect(titles(await get(w.t.member.id, w.space.id))).toContain("Fresh");
    await loginAs(w.t.member.id);
    const no = await call(topicsRoute.POST, { url: "http://localhost/api/x", params: { spaceId: w.space.id }, body: { title: "Nope" } });
    expect(no.status).toBe(403);
  });
});
