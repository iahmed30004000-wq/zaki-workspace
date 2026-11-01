import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the server-side copies of this file's uploads out of the repo (read once, when files.ts loads).
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-drive-${process.pid}`;
});

import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as filesRoute from "@/app/api/files/route";
import { decryptSecrets } from "@/server/crypto";
import { forgetDriveFolders } from "@/server/files/drive-store";
import { fileLibrary, ingest } from "@/server/services/files";
import { connectGoogle, DRIVE_FILE_SCOPE, getGoogleStatus, type GoogleSecrets } from "@/server/services/google";
import { setFeature } from "@/server/services/features";
import { upsertIntegration } from "@/server/services/integrations";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { fakeDrive } from "./fake-drive";

/**
 * THE LIBRARY ON THE OWNER'S GOOGLE DRIVE (the owner's decision, 2026-10-26). Against a fake Drive (no
 * network): a library file goes to «Zaki Workspace» / <space> in his Drive and not to the server's disk;
 * it is read back through the app's own permission check, the asked range only; Drive failing, or a
 * connection with the old read-only grant, keeps the file on the server as before; a profile picture stays on
 * the server; a version that steps down moves to «نسخ قديمة». (Chat files: tests/db/space-library.test.ts.)
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const PNG_V2 = Uint8Array.from([...PNG, 9, 9, 9]);
const READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

const saved = { id: process.env["GOOGLE_CLIENT_ID"], secret: process.env["GOOGLE_CLIENT_SECRET"] };
let drive: ReturnType<typeof fakeDrive>;

beforeAll(() => {
  process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
});
afterAll(() => {
  for (const [key, value] of [["GOOGLE_CLIENT_ID", saved.id], ["GOOGLE_CLIENT_SECRET", saved.secret]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
beforeEach(() => {
  drive = fakeDrive();
  forgetDriveFolders();
  vi.stubGlobal("fetch", vi.fn(drive.handle));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function world(opts: { scope?: string; accessToken?: string } = {}) {
  const { org } = await makeTeam();
  const alice = await makeUser({ orgId: org.id, role: "MEMBER", name: `Alice ${uid()}` });
  const bob = await makeUser({ orgId: org.id, role: "MEMBER", name: `Bob ${uid()}` });
  const space = await makeWorkspace(org.id, [{ userId: alice.id }], `التسويق ${uid()}`);
  await upsertIntegration(org.id, "GOOGLE_DRIVE", {
    connected: true,
    secrets: { refreshToken: "refresh-token", accessToken: opts.accessToken ?? "access-token" },
    config: { connectedBy: alice.id, scope: opts.scope ?? `${DRIVE_FILE_SCOPE} openid` },
  });
  const ctx = { orgId: org.id, orgRole: "MEMBER" as const, userId: alice.id };
  return { org, alice, bob, space, ctx };
}

async function raw(id: string, headers: Record<string, string> = {}) {
  const res = await rawRoute.GET(new Request(`http://localhost/api/files/${id}/raw`, { headers }), { params: { id } });
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

const pathOf = async (id: string) => (await db.storedFile.findUniqueOrThrow({ where: { id }, select: { path: true } })).path;
const onServer = (orgId: string) => existsSync(join(fileLibrary, orgId));

describe("a library file is stored on the owner's Drive", () => {
  it("goes to «Zaki Workspace» / <its space>, and nothing is written to the server", async () => {
    const w = await world();
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });

    const path = await pathOf(made.id);
    expect(path).toMatch(/^gdrive:/);
    const file = drive.files.get(path.slice("gdrive:".length))!;
    expect(file.name).toBe("plan.png");
    expect(file.appProperties).toEqual({ zakiFile: made.id });
    expect(Buffer.from(file.bytes!)).toEqual(Buffer.from(PNG));

    const root = drive.byName("Zaki Workspace")!;
    expect(root.parents).toEqual([]);
    const folder = drive.byName(w.space.name)!;
    expect(folder.parents).toEqual([root.id]);
    expect(file.parents).toEqual([folder.id]);
    expect(onServer(w.org.id)).toBe(false);
  });

  it("the folders are made once, then found again (also after a restart forgot them)", async () => {
    const w = await world();
    const up = (name: string) => ingest(w.ctx, { name, bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    await up("a.png");
    await up("b.png");
    forgetDriveFolders();
    await up("c.png");
    const created = drive.calls.filter((c) => c.method === "POST" && new URL(c.url).pathname === "/drive/v3/files");
    expect(created).toHaveLength(2); // the root and the space
  });

  it("opens through the app: the whole file, or only the asked range fetched from Drive", async () => {
    const w = await world();
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    await loginAs(w.alice.id);

    const whole = await raw(made.id);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("image/png");
    expect(whole.headers.get("content-length")).toBe(String(PNG.length));
    expect(Buffer.from(whole.bytes)).toEqual(Buffer.from(PNG));

    const part = await raw(made.id, { range: "bytes=2-5" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 2-5/${PNG.length}`);
    expect(Buffer.from(part.bytes)).toEqual(Buffer.from(PNG.subarray(2, 6)));
    expect(drive.calls.filter((c) => c.url.includes("alt=media")).map((c) => c.range)).toEqual([null, "bytes=2-5"]);
  });

  it("someone outside the space gets «not found», and Drive is never asked", async () => {
    const w = await world();
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    await loginAs(w.bob.id);
    expect((await raw(made.id)).status).toBe(404);
    expect(drive.calls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });

  it("a file Drive no longer has answers «missing», not a broken stream", async () => {
    const w = await world();
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    drive.files.delete((await pathOf(made.id)).slice("gdrive:".length));
    await loginAs(w.alice.id);
    const res = await call(rawRoute.GET, { params: { id: made.id } });
    expect(res.status).toBe(404);
    expect(res.json?.["message"]).toBe("files.missing_storage");
  });

  it("an expired access token is refreshed once, and the fresh one is kept", async () => {
    const w = await world({ accessToken: "stale-token" });
    drive.state.staleToken = "stale-token";
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(made.id)).toMatch(/^gdrive:/);
    const row = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "GOOGLE_DRIVE" } } });
    expect(decryptSecrets<GoogleSecrets>(row.secretEnc)?.accessToken).toBe("fresh-token");
  });

  it("a new version is named «(نسخة 2)», and the old one moves to «نسخ قديمة» in the space folder", async () => {
    const w = await world();
    const v1 = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    const v2 = await ingest(w.ctx, { name: "plan.png", bytes: PNG_V2 }, { familyId: v1.id, latestVersion: 1 });
    const folder = drive.byName(w.space.name)!;
    const old = drive.byName("نسخ قديمة")!;
    expect(old.parents).toEqual([folder.id]);
    expect(drive.files.get((await pathOf(v1.id)).slice("gdrive:".length))!.parents).toEqual([old.id]);
    const head = drive.files.get((await pathOf(v2.id)).slice("gdrive:".length))!;
    expect(head.name).toBe("plan (نسخة 2).png");
    expect(head.parents).toEqual([folder.id]);
  });

  it("connecting with the drive.file grant turns the library on; the old read-only grant does not", async () => {
    const w = await world({ scope: READONLY_SCOPE });
    expect((await getGoogleStatus(w.org.id)).library).toBe(false);
    await connectGoogle(w.org.id, w.alice.id, { access: "a2", refresh: "r2", scope: DRIVE_FILE_SCOPE });
    expect((await getGoogleStatus(w.org.id)).library).toBe(true);
  });

  it("the library and the connection say the files go to Drive", async () => {
    const w = await world();
    expect(await getGoogleStatus(w.org.id)).toMatchObject({ connected: true, configured: true, library: true, libraryOff: false, appSource: "env" });
    await loginAs(w.alice.id);
    (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, w.space.id);
    expect((await call(filesRoute.GET)).json?.["onDrive"]).toBe(true);
  });
});

describe("nothing breaks because of Drive: the file stays on the server", () => {
  it("Drive refusing the upload keeps the file on the server, it opens, and the failure is logged", async () => {
    const w = await world();
    drive.state.failUploads = true;
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(made.id)).not.toMatch(/^gdrive:/);
    expect(onServer(w.org.id)).toBe(true);
    await loginAs(w.alice.id);
    expect(Buffer.from((await raw(made.id)).bytes)).toEqual(Buffer.from(PNG));
    const failed = await db.integrationEvent.findFirst({ where: { orgId: w.org.id, type: "file.drive_failed" } });
    expect(failed?.status).toBe("FAILED");
  });

  it("a connection with the old read-only grant: the server, and Drive is never called", async () => {
    const w = await world({ scope: READONLY_SCOPE });
    const made = await ingest(w.ctx, { name: "plan.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(made.id)).not.toMatch(/^gdrive:/);
    expect(drive.calls).toEqual([]);
    expect((await getGoogleStatus(w.org.id)).library).toBe(false);
  });

  it("«الميزات» → «المكتبة على Google Drive» off: new files on the server, Drive never asked, Drive files still open", async () => {
    const w = await world();
    const before = await ingest(w.ctx, { name: "old.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(before.id)).toMatch(/^gdrive:/);
    await setFeature({ orgId: w.org.id, orgRole: "OWNER", userId: w.alice.id }, "libraryDrive", false);
    const callsBefore = drive.calls.length;

    const after = await ingest(w.ctx, { name: "new.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(after.id)).not.toMatch(/^gdrive:/);
    expect(drive.calls.length).toBe(callsBefore);
    expect((await getGoogleStatus(w.org.id)).libraryOff).toBe(true);

    await loginAs(w.alice.id);
    expect(Buffer.from((await raw(before.id)).bytes)).toEqual(Buffer.from(PNG));
    expect(Buffer.from((await raw(after.id)).bytes)).toEqual(Buffer.from(PNG));
  });

  it("a profile picture stays on the server by design (tiny, and served on every screen)", async () => {
    const w = await world();
    const made = await ingest(w.ctx, { name: "face.png", bytes: PNG }, undefined, "AVATAR");
    expect(await pathOf(made.id)).not.toMatch(/^gdrive:/);
    expect(drive.calls).toEqual([]);
  });
});
