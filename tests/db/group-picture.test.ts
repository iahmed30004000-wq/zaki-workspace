import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// the uploads of this file live in a throw-away folder, never in the repository
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-group-pictures-${process.pid}`;
});

import * as groupsRoute from "@/app/api/groups/route";
import * as pictureRoute from "@/app/api/groups/[id]/picture/route";
import * as avatarBytesRoute from "@/app/api/avatars/[id]/route";
import { withFeature } from "@/lib/features";
import { avatarFileIdOf } from "@/server/services/avatars";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «صورة المجموعة»: a group of topics gets a picture instead of the fixed folder emoji. Whoever may arrange the space (its admin, the owner) uploads or removes it; the bytes
 * decide the type; a replaced picture leaves nothing live behind; a colleague reads it through the same door as a face; with the switch off nothing can be set.
 */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const TEXT = new TextEncoder().encode("not a picture at all, whatever the file is called");

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

async function upload(groupId: string, bytes: Uint8Array, name = "g.png", type = "image/png") {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
  const res = await (pictureRoute.POST as unknown as Handler)(new Request(`http://localhost/api/groups/${groupId}/picture`, { method: "POST", body: form }), { params: { id: groupId } });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

async function world() {
  const team = await makeTeam();
  const alice = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Alice" });
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: alice.id }], "الشغل");
  await loginAs(team.admin.id);
  const made = await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: space.id, name: "الإدارة", emoji: "🧭" } });
  expect(made.status, made.text).toBe(201);
  const groupId = (made.json as { group: { id: string } }).group.id;
  return { ...team, alice, space, groupId };
}
const listed = async (spaceId: string) => ((await call(groupsRoute.GET, { url: `http://localhost/api/groups?spaceId=${spaceId}`, method: "GET" })).json as { groups: Array<{ id: string; imageUrl: string | null; emoji: string | null }> }).groups;

beforeEach(() => {
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("a group's picture", () => {
  it("a space admin uploads a PNG: the group carries `imageUrl`, the emoji is untouched, and a colleague of the space reads the bytes", async () => {
    const w = await world();
    const res = await upload(w.groupId, PNG);
    expect(res.status, res.text).toBe(201);
    const url = res.json?.["imageUrl"] as string;
    expect(url).toMatch(/^\/api\/avatars\/[A-Za-z0-9_-]+$/);
    const [group] = await listed(w.space.id);
    expect(group).toMatchObject({ id: w.groupId, imageUrl: url, emoji: "🧭" });
    await loginAs(w.alice.id);
    const bytes = await call(avatarBytesRoute.GET, { params: { id: avatarFileIdOf(url)! } });
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("image/png");
  });

  it("a plain member cannot set it (403), and bytes that are not a picture are refused whatever the name says", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    expect((await upload(w.groupId, PNG)).status).toBe(403);
    await loginAs(w.admin.id);
    expect((await upload(w.groupId, TEXT, "g.png", "image/png")).status).toBe(403);
    expect((await listed(w.space.id))[0]?.imageUrl).toBeNull();
  });

  it("replacing soft-deletes the old file; removing takes the picture away and soft-deletes the last one", async () => {
    const w = await world();
    const first = (await upload(w.groupId, PNG)).json?.["imageUrl"] as string;
    const second = (await upload(w.groupId, PNG)).json?.["imageUrl"] as string;
    expect(second).not.toBe(first);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: avatarFileIdOf(first)! } })).deletedAt).not.toBeNull();
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: avatarFileIdOf(second)! } })).deletedAt).toBeNull();
    const gone = await call(pictureRoute.DELETE, { method: "DELETE", params: { id: w.groupId } });
    expect(gone.status).toBe(200);
    expect((await listed(w.space.id))[0]?.imageUrl).toBeNull();
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: avatarFileIdOf(second)! } })).deletedAt).not.toBeNull();
  });

  it("a group of another company is a 404, and with the switch off nothing is set", async () => {
    const w = await world();
    const stranger = await makeTeam();
    await loginAs(stranger.owner.id);
    expect((await upload(w.groupId, PNG)).status).toBe(404);
    await loginAs(w.admin.id);
    await setFeatures(w.org.id, { groupPictures: false });
    expect((await upload(w.groupId, PNG)).status).toBe(404);
  });
});
