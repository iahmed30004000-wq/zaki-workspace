/**
 * «القصص» on the server (`stories`, src/server/services/stories.ts). The heart of it is WHO MAY SEE A STORY AND ITS FILE, asked of every
 * door: only ACTIVE non-guest people of the same company; an account limited to its spaces sees, and is seen by, only those it may meet;
 * an external partner never; nobody but the author after 24 hours; nobody at all after «حذف». Then the limits, the views and the switch.
 */
import { describe, expect, it } from "vitest";
import * as storiesRoute from "@/app/api/stories/route";
import * as storyRoute from "@/app/api/stories/[id]/route";
import * as viewRoute from "@/app/api/stories/[id]/view/route";
import * as viewersRoute from "@/app/api/stories/[id]/viewers/route";
import * as mediaRoute from "@/app/api/stories/[id]/media/route";
import * as fileRoute from "@/app/api/files/[id]/route";
import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as attachmentRoute from "@/app/api/chat/attachments/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import { STORY_CAPTION_MAX, STORY_MAX_PER_DAY, STORY_TTL_MS, STORY_VIDEO_MAX_MS, type StoriesFeedDto, type StoryViewerDto } from "@/lib/chat/v2/stories/types";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0, 1, 2, 3, 4]);

async function post(bytes: Uint8Array = PNG, fields: Record<string, string> = {}, name = "story.png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await storiesRoute.POST(new Request("http://localhost/api/stories", { method: "POST", body: form }));
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, text };
}

const feed = async () => {
  const res = await call(storiesRoute.GET);
  return { status: res.status, body: res.json as unknown as StoriesFeedDto };
};
const authorsSeen = async () => ((await feed()).body.people ?? []).map((p) => p.userId).sort();

/** The file's one door, read as bytes (the shared `call` would decode them as text; only the status and the headers matter here). */
async function media(id: string, headers: Record<string, string> = {}) {
  const res = await mediaRoute.GET(new Request(`http://localhost/api/stories/${id}/media`, { headers }), { params: { id } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, bytes, headers: res.headers };
}

/** Every door of one story, as the signed-in person meets it. */
async function doors(id: string) {
  return {
    media: (await media(id)).status,
    view: (await call(viewRoute.POST, { method: "POST", params: { id } })).status,
    viewers: (await call(viewersRoute.GET, { params: { id } })).status,
    remove: (await call(storyRoute.DELETE, { method: "DELETE", params: { id } })).status,
  };
}
const ALL_HIDDEN = { media: 404, view: 404, viewers: 404, remove: 404 };

async function postAs(userId: string, bytes: Uint8Array = PNG, fields: Record<string, string> = {}, name?: string) {
  await loginAs(userId);
  const made = await post(bytes, fields, name);
  expect(made.status, made.text).toBe(201);
  return made.json?.["id"] as string;
}

const fileIdOf = async (storyId: string) => (await db.story.findUniqueOrThrow({ where: { id: storyId }, select: { fileId: true } })).fileId;
const expire = (id: string) => db.story.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - STORY_TTL_MS - 1000) } });
const limit = (orgId: string, userId: string) => db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { spaceOnly: true } });

describe("posting and watching", () => {
  it("a colleague sees it in the feed with its caption, opens its file with ranges, and it lasts 24 hours", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id, PNG, { caption: "  صباح الخير  " });
    const row = await db.story.findUniqueOrThrow({ where: { id }, include: { file: true } });
    expect(row.file.purpose).toBe("STORY");
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(STORY_TTL_MS);

    await loginAs(t.admin.id);
    const got = await feed();
    expect(got.status).toBe(200);
    expect(got.body.people).toHaveLength(1);
    expect(got.body.people[0]).toMatchObject({ userId: t.member.id, mine: false, stories: [{ id, kind: "IMAGE", caption: "صباح الخير", seen: false, url: `/api/stories/${id}/media` }] });
    // somebody else's story says nothing about who saw it
    expect(got.body.people[0]?.stories[0]?.views).toBeUndefined();

    const whole = await media(id);
    expect(whole.status).toBe(200);
    expect([...whole.bytes]).toEqual([...PNG]);
    expect(whole.headers.get("cache-control")).toBe("private, no-store");
    expect(whole.headers.get("content-type")).toBe("image/png");
    const part = await media(id, { range: "bytes=1-3" });
    expect(part.status).toBe(206);
    expect([...part.bytes]).toEqual([...PNG.slice(1, 4)]);
  });

  it("a short video keeps its length; a longer one, a sound, a document and a caption too long are refused and write no story", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id, MP4, { durationMs: "12000" }, "v.mp4");
    expect((await db.story.findUniqueOrThrow({ where: { id } })).durationMs).toBe(12000);
    const before = await db.storedFile.count({ where: { orgId: t.org.id } });
    expect((await post(MP4, { durationMs: String(STORY_VIDEO_MAX_MS + 5000) }, "v.mp4")).text).toContain("stories.video_long");
    expect((await post(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 9, 9]), {}, "s.mp3")).text).toContain("stories.unsupported");
    expect((await post(new Uint8Array([...Buffer.from("%PDF-1.4 hello")]), {}, "d.pdf")).text).toContain("stories.unsupported");
    expect((await post(PNG, { caption: "ا".repeat(STORY_CAPTION_MAX + 1) })).status).toBe(422);
    expect(await db.story.count({ where: { orgId: t.org.id } })).toBe(1);
    expect(await db.storedFile.count({ where: { orgId: t.org.id } })).toBe(before);
  });

  it(`holds one person to ${STORY_MAX_PER_DAY} stories in 24 hours, a deleted one included`, async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    const first = await db.story.findUniqueOrThrow({ where: { id } });
    for (let i = 1; i < STORY_MAX_PER_DAY; i++) {
      const file = await db.storedFile.create({ data: { orgId: t.org.id, uploaderId: t.member.id, familyId: `f${i}${id}`, name: "s.png", path: "x", mimeType: "image/png", size: 1, purpose: "STORY" } });
      await db.story.create({ data: { orgId: t.org.id, authorId: t.member.id, fileId: file.id, kind: "IMAGE", expiresAt: first.expiresAt, deletedAt: i === 1 ? new Date() : null } });
    }
    const over = await post();
    expect(over.status).toBe(403);
    expect(over.text).toContain("stories.too_many");
    // another person is not held by it
    await loginAs(t.admin.id);
    expect((await post()).status).toBe(201);
  });
});

describe("who may see a story and its file", () => {
  it("nobody signed out, nobody of another company, and never an external partner (who posts nothing either)", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);

    logout();
    expect((await media(id)).status).toBe(401);
    expect((await feed()).status).toBe(401);

    const elsewhere = await makeOrg();
    const stranger = await makeUser({ orgId: elsewhere.id, role: "OWNER" });
    await loginAs(stranger.id);
    expect(await authorsSeen()).toEqual([]);
    expect(await doors(id)).toEqual(ALL_HIDDEN);

    // the guest shares a space with the author, and it changes nothing
    await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.guest.id, role: "GUEST" }]);
    await loginAs(t.guest.id);
    expect((await feed()).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(await doors(id)).toEqual(ALL_HIDDEN);
  });

  it("an author who became a partner or is no longer active is not seen any more", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    const set = (data: { role?: "MEMBER" | "GUEST"; status?: "ACTIVE" | "SUSPENDED" | "OFFBOARDED" }) => db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } }, data });
    await loginAs(t.admin.id);
    for (const change of [{ role: "GUEST" as const }, { role: "MEMBER" as const, status: "SUSPENDED" as const }, { status: "OFFBOARDED" as const }]) {
      await set(change);
      expect(await authorsSeen(), JSON.stringify(change)).toEqual([]);
      expect((await media(id)).status, JSON.stringify(change)).toBe(404);
    }
    await set({ status: "ACTIVE" });
    expect(await authorsSeen()).toEqual([t.member.id]);
  });

  it("an account limited to a space sees and is seen only by the people of its spaces and the owner", async () => {
    const t = await makeTeam();
    const girl = await makeUser({ orgId: t.org.id, name: "محصورة" });
    const colleague = await makeUser({ orgId: t.org.id, name: "زميلة" });
    await makeWorkspace(t.org.id, [{ userId: girl.id }, { userId: colleague.id }], "العمل");
    await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }], "التصنيع");
    await limit(t.org.id, girl.id);

    const hers = await postAs(girl.id);
    const colleagues = await postAs(colleague.id);
    const owners = await postAs(t.owner.id);
    const outsiders = await postAs(t.member.id);

    // what SHE sees: her space's people and the owner
    await loginAs(girl.id);
    expect(await authorsSeen()).toEqual([colleague.id, girl.id, t.owner.id].sort());
    expect(await doors(outsiders)).toEqual(ALL_HIDDEN);
    expect((await media(colleagues)).status).toBe(200);
    expect((await media(owners)).status).toBe(200);

    // who sees HER: the same people, and nobody from outside (an admin included)
    for (const [who, may] of [[colleague.id, true], [t.owner.id, true], [t.member.id, false], [t.admin.id, false]] as const) {
      await loginAs(who);
      expect((await authorsSeen()).includes(girl.id), who).toBe(may);
      expect((await media(hers)).status, who).toBe(may ? 200 : 404);
    }
    await loginAs(t.member.id);
    expect(await doors(hers)).toEqual(ALL_HIDDEN);

    // put out of the shared space, the colleague loses it at once
    await db.workspaceMember.deleteMany({ where: { userId: colleague.id } });
    await loginAs(colleague.id);
    expect((await media(hers)).status).toBe(404);
  });

  it("with no space a limited account sees only its own and the owner's side stays closed to everybody else", async () => {
    const t = await makeTeam();
    const alone = await makeUser({ orgId: t.org.id, name: "لحالها" });
    await limit(t.org.id, alone.id);
    const theirs = await postAs(t.member.id);
    const mine = await postAs(alone.id);
    expect(await authorsSeen()).toEqual([alone.id]);
    expect((await media(theirs)).status).toBe(404);
    await loginAs(t.member.id);
    expect((await media(mine)).status).toBe(404);
  });

  it("after its 24 hours it leaves every feed; only the author still opens the file, and nobody records a view", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    await expire(id);
    expect(await authorsSeen()).toEqual([]);
    expect((await media(id)).status).toBe(200);
    for (const who of [t.admin.id, t.owner.id]) {
      await loginAs(who);
      expect(await authorsSeen()).toEqual([]);
      expect(await doors(id)).toEqual(ALL_HIDDEN);
    }
    // nothing was hard-deleted
    expect(await db.story.count({ where: { id } })).toBe(1);
    expect(await db.storedFile.count({ where: { id: await fileIdOf(id) } })).toBe(1);
  });

  it("the story's file has no other door: not the library's file routes (not even for its author), not the chat's, and no message may claim it", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    const fileId = await fileIdOf(id);
    for (const who of [t.member.id, t.admin.id, t.owner.id]) {
      await loginAs(who);
      expect((await call(fileRoute.GET, { params: { id: fileId } })).status, who).toBe(404);
      expect((await call(rawRoute.GET, { params: { id: fileId } })).status, who).toBe(404);
      expect((await call(attachmentRoute.GET, { url: `http://localhost/api/chat/attachments/${fileId}`, params: { id: fileId } })).status, who).toBe(404);
    }
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    expect((await call(messagesRoute.POST, { params: { id: dm }, body: { attachmentIds: [fileId] } })).status).toBe(404);
  });
});

describe("views and deleting", () => {
  it("records one view per person, never the author's; the author alone sees who, and the count agrees with the list", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    expect((await call(viewRoute.POST, { method: "POST", params: { id } })).status).toBe(200);
    await loginAs(t.admin.id);
    await call(viewRoute.POST, { method: "POST", params: { id } });
    await call(viewRoute.POST, { method: "POST", params: { id } });
    expect((await feed()).body.people[0]?.stories[0]?.seen).toBe(true);
    expect((await call(viewersRoute.GET, { params: { id } })).status).toBe(403);
    await loginAs(t.owner.id);
    expect((await call(viewersRoute.GET, { params: { id } })).status).toBe(403);
    await call(viewRoute.POST, { method: "POST", params: { id } });

    await loginAs(t.member.id);
    const list = (await call(viewersRoute.GET, { params: { id } })).json?.["viewers"] as StoryViewerDto[];
    expect(list.map((v) => v.userId).sort()).toEqual([t.admin.id, t.owner.id].sort());
    expect((await feed()).body.people.find((p) => p.mine)?.stories[0]).toMatchObject({ views: 2, seen: true });
    expect(await db.storyView.count({ where: { storyId: id } })).toBe(2);
  });

  it("only the author deletes; afterwards nobody opens it, the author included, and nothing is hard-deleted", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    for (const who of [t.admin.id, t.owner.id]) {
      await loginAs(who);
      expect((await call(storyRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(403);
    }
    await loginAs(t.member.id);
    expect((await call(storyRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect(await authorsSeen()).toEqual([]);
    for (const who of [t.member.id, t.admin.id]) {
      await loginAs(who);
      expect(await doors(id)).toEqual(ALL_HIDDEN);
    }
    const row = await db.story.findUniqueOrThrow({ where: { id }, include: { file: true } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.file.deletedAt).toBeNull();
  });
});

describe("the company's switch", () => {
  it("off: every door answers «not found» and nothing is lost; on again: it is all back", async () => {
    const t = await makeTeam();
    const id = await postAs(t.member.id);
    const set = (stories: boolean) => db.organization.update({ where: { id: t.org.id }, data: { settings: { features: { stories } } } });
    await set(false);
    expect((await feed()).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(await doors(id)).toEqual(ALL_HIDDEN);
    await set(true);
    expect(await authorsSeen()).toEqual([t.member.id]);
    expect((await media(id)).status).toBe(200);
  });
});
