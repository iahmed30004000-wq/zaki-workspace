import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Keep this file's server-side uploads out of the repo (read once, when files.ts loads).
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-libstorage-${process.pid}`;
});

import * as attachmentRoute from "@/app/api/chat/attachments/[id]/route";
import * as filesRoute from "@/app/api/files/route";
import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as meterRoute from "@/app/api/storage/route";
import * as moveRoute from "@/app/api/storage/move/route";
import { purgeOrphanUploads } from "@/server/chat/attachments";
import { forgetDriveFolders } from "@/server/files/drive-store";
import { resumeDrive } from "@/server/files/storage-policy";
import { fileLibrary, ingest } from "@/server/services/files";
import { DRIVE_FILE_SCOPE } from "@/server/services/google";
import { upsertIntegration } from "@/server/services/integrations";
import { deleteServerCopies, moveToDrive, storageMeter } from "@/server/services/storage";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { ForbiddenError, ValidationError } from "@/server/auth";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";
import { fakeDrive } from "./fake-drive";

/**
 * «مكتبة مساحة العمل» and its STORAGE POLICY (the owner's ask, 2026-11-01: «التخزين أولويته على جوجل درايف، بدناش المساحة
 * تمتلي تبع السيرفر»). Against a fake Drive (no network):
 *  - every new upload (library, chat attachment, voice note) goes to Drive FIRST when Drive is connected and healthy, and to
 *    the server only as the fallback, never both; a profile picture stays on the server;
 *  - Drive down: the server, and the next minute's uploads skip Drive; not connected: the server, and the library says why;
 *  - the owner's meter, and his two separate steps: move (copies and verifies, deletes nothing) and delete the verified copies;
 *  - a Drive file is proxied through the app with the same permission check, only the asked range fetched.
 */

const png = (...tail: number[]) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...tail]);
const PNG = png(1, 2, 3, 4);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6]);

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

async function connectDrive(orgId: string, userId: string) {
  await upsertIntegration(orgId, "GOOGLE_DRIVE", {
    connected: true,
    secrets: { refreshToken: "refresh-token", accessToken: "access-token" },
    config: { connectedBy: userId, scope: `${DRIVE_FILE_SCOPE} openid` },
  });
}

async function world(opts: { connected?: boolean } = { connected: true }) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `التسويق ${uid()}`);
  if (opts.connected) await connectDrive(team.org.id, team.owner.id);
  const member = { orgId: team.org.id, orgRole: "MEMBER" as const, userId: team.member.id };
  const owner = { orgId: team.org.id, orgRole: "OWNER" as const, userId: team.owner.id };
  return { ...team, space, member, owner };
}
type World = Awaited<ReturnType<typeof world>>;

const pathOf = async (id: string) => (await db.storedFile.findUniqueOrThrow({ where: { id }, select: { path: true } })).path;
const driveFileOf = async (id: string) => drive.files.get((await pathOf(id)).slice("gdrive:".length))!;
const serverFile = (stored: string) => join(fileLibrary, stored);
const mediaCalls = () => drive.calls.filter((c) => c.url.includes("alt=media"));
const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

async function raw(id: string) {
  const res = await rawRoute.GET(new Request(`http://localhost/api/files/${id}/raw`), { params: { id } });
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}

const chatPhoto = (w: World, name = "photo.png", bytes: Uint8Array = PNG) =>
  ingest(w.member, { name, bytes }, undefined, "CHAT", { kind: "IMAGE" }, { sniffedMime: "image/png" });

describe("a new file goes to Drive first (never both)", () => {
  it("a chat attachment and a voice note go to «مرفقات الدردشة» in Drive, and nothing is written to the server", async () => {
    const w = await world();
    const photo = await chatPhoto(w);
    const voice = await ingest(w.member, { name: "voice.webm", bytes: WEBM }, undefined, "VOICE", { kind: "AUDIO" }, { sniffedMime: "audio/webm" });
    for (const id of [photo.id, voice.id]) expect(await pathOf(id)).toMatch(/^gdrive:/);

    const root = drive.byName("Zaki Workspace")!;
    const chat = drive.byName("مرفقات الدردشة")!;
    expect(chat.parents).toEqual([root.id]);
    expect((await driveFileOf(photo.id)).parents).toEqual([chat.id]);
    expect((await driveFileOf(voice.id)).parents).toEqual([chat.id]);
    expect(Buffer.from((await driveFileOf(photo.id)).bytes!)).toEqual(Buffer.from(PNG));
    expect(existsSync(join(fileLibrary, w.org.id))).toBe(false);
  });

  it("the uploader opens his own unclaimed chat file through the app, streamed: only the asked range comes from Drive", async () => {
    const w = await world();
    const photo = await chatPhoto(w);
    await loginAs(w.member.userId);
    const open = (headers: Record<string, string> = {}) =>
      attachmentRoute.GET(new Request(`http://localhost/api/chat/attachments/${photo.id}`, { headers }), { params: { id: photo.id } });

    const whole = await open();
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(Buffer.from(PNG));
    const part = await open({ range: "bytes=2-5" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 2-5/${PNG.length}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(Buffer.from(PNG.subarray(2, 6)));
    expect(mediaCalls().map((c) => c.range)).toEqual([null, "bytes=2-5"]);
    // nothing a browser could follow to Drive: no Drive address or token in what the app answered
    for (const res of [whole, part]) {
      expect([...res.headers.values()].join(" ")).not.toMatch(/googleapis|drive\.google|access-token|location/i);
    }
  });

  it("someone who may not read the chat file gets «not found» and Drive is never asked", async () => {
    const w = await world();
    const photo = await chatPhoto(w);
    await loginAs(w.admin.id);
    const res = await attachmentRoute.GET(new Request(`http://localhost/api/chat/attachments/${photo.id}`), { params: { id: photo.id } });
    expect(res.status).toBe(404);
    expect(mediaCalls()).toEqual([]);
  });

  it("an orphan chat upload that nobody claimed is removed for good: the row, and its Drive file goes to Drive's bin", async () => {
    const w = await world();
    const photo = await chatPhoto(w);
    const file = await driveFileOf(photo.id);
    await db.storedFile.update({ where: { id: photo.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
    expect(await purgeOrphanUploads(w.org.id)).toBe(1);
    expect(await db.storedFile.findUnique({ where: { id: photo.id } })).toBeNull();
    expect(file.trashed).toBe(true);
  });
});

describe("Drive is only first while it is connected and healthy", () => {
  it("Drive failing (503): the file is kept on the server and the next uploads skip Drive for a minute, until it is back", async () => {
    const w = await world();
    drive.state.failUploads = true;
    const first = await ingest(w.member, { name: "a.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(first.id)).not.toMatch(/^gdrive:/);
    drive.state.failUploads = false;
    const callsBefore = drive.calls.length;
    const second = await chatPhoto(w, "b.png");
    expect(await pathOf(second.id)).not.toMatch(/^gdrive:/);
    expect(drive.calls.length).toBe(callsBefore); // Drive was not even asked
    resumeDrive(w.org.id);
    const third = await ingest(w.member, { name: "c.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(third.id)).toMatch(/^gdrive:/);
  });

  it("one file Drive refused (a mismatch) does not pause Drive for the others", async () => {
    const w = await world();
    const real = drive.handle;
    let spoil = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const res = await real(input, init);
        if (spoil && new URL(String(input)).host === "upload.fake") {
          spoil = false;
          const made = (await res.json()) as { id: string; size: string };
          return new Response(JSON.stringify({ ...made, md5Checksum: "0".repeat(32) }), { status: 200 });
        }
        return res;
      }),
    );
    const a = await ingest(w.member, { name: "a.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    const b = await ingest(w.member, { name: "b.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(a.id)).not.toMatch(/^gdrive:/);
    expect(await pathOf(b.id)).toMatch(/^gdrive:/);
  });

  it("Drive not connected: the server, Drive is never called, and the library says so", async () => {
    const w = await world({ connected: false });
    const made = await ingest(w.member, { name: "a.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    expect(await pathOf(made.id)).not.toMatch(/^gdrive:/);
    expect(drive.calls).toEqual([]);

    await loginAs(w.member.userId);
    enter(w.space.id);
    const list = await call(filesRoute.GET);
    expect(list.json?.["storage"]).toEqual({ target: "server", reason: "not_connected" });
    expect(list.json?.["onDrive"]).toBe(false);
  });

  it("Drive connected: the library says new files go to Drive, and names the space whose files it lists", async () => {
    const w = await world();
    await loginAs(w.member.userId);
    enter(w.space.id);
    const list = await call(filesRoute.GET);
    expect(list.json?.["storage"]).toEqual({ target: "drive", reason: null });
    expect(list.json?.["space"]).toEqual({ id: w.space.id, name: w.space.name });
  });

  it("the library lists the files of the current space only, and a member of another space never opens the others", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [{ userId: w.admin.id }], `المبيعات ${uid()}`);
    const mine = await ingest(w.member, { name: "mine.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    const theirs = await ingest({ ...w.member, userId: w.admin.id, orgRole: "ADMIN" }, { name: "theirs.png", bytes: png(9) }, undefined, "LIBRARY", undefined, { workspaceId: other.id });
    await loginAs(w.member.userId);
    enter(w.space.id);
    const list = await call(filesRoute.GET);
    expect((list.json?.["files"] as Array<{ id: string }>).map((f) => f.id)).toEqual([mine.id]);
    expect((await raw(theirs.id)).status).toBe(404);
    expect(mediaCalls()).toEqual([]);
  });
});

describe("the owner's storage meter", () => {
  it("counts the server, Drive, whether Drive is connected, and is the owner's alone (route included)", async () => {
    const w = await world({ connected: false });
    await ingest(w.member, { name: "a.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    await ingest(w.member, { name: "face.png", bytes: png(7, 7) }, undefined, "AVATAR");

    const off = await storageMeter(w.owner);
    expect(off).toMatchObject({ target: "server", reason: "not_connected", drive: { files: 0, bytes: 0 }, copies: { files: 0, bytes: 0 } });
    expect(off.server.files).toBe(2);
    expect(off.server.bytes).toBe(PNG.length + png(7, 7).length);
    expect(off.movable).toEqual({ files: 1, bytes: PNG.length }); // a profile picture is not moved

    await connectDrive(w.org.id, w.owner.userId);
    await ingest(w.member, { name: "b.png", bytes: png(5, 5, 5) }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    const on = await storageMeter(w.owner);
    expect(on).toMatchObject({ target: "drive", reason: null, drive: { files: 1, bytes: png(5, 5, 5).length } });

    for (const [who, status] of [[w.member.userId, 403], [w.admin.id, 403], [w.guest.id, 403], [w.owner.userId, 200]] as const) {
      await loginAs(who);
      expect((await call(meterRoute.GET)).status, who).toBe(status);
    }
  });
});

/** Files that were written to the server before Drive was connected; then Drive is connected. */
async function oldFiles(w: World) {
  const a = await ingest(w.member, { name: "plan.png", bytes: png(1, 1) }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
  const b = await ingest(w.member, { name: "price.png", bytes: png(2, 2, 2) }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
  const c = await chatPhoto(w, "chat.png", png(3));
  const face = await ingest(w.member, { name: "face.png", bytes: png(4, 4) }, undefined, "AVATAR");
  const files = [a, b, c];
  const paths = new Map<string, string>();
  for (const f of [...files, face]) paths.set(f.id, await pathOf(f.id));
  for (const p of paths.values()) expect(existsSync(serverFile(p))).toBe(true);
  await connectDrive(w.org.id, w.owner.userId);
  return { files, face, paths };
}

describe("«انقل الملفات القديمة للدرايف»", () => {
  it("a dry run only counts, and changes nothing", async () => {
    const w = await world({ connected: false });
    const { files } = await oldFiles(w);
    const r = await moveToDrive(w.owner, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, done: 0, plan: { files: files.length } });
    expect(drive.calls.some((c) => c.method === "POST")).toBe(false);
    for (const f of files) expect(await pathOf(f.id)).not.toMatch(/^gdrive:/);
  });

  it("the owner's alone: a member, an admin and a guest are refused before anything is read", async () => {
    const w = await world({ connected: false });
    await oldFiles(w);
    for (const role of ["ADMIN", "MEMBER", "GUEST"] as const) {
      await expect(moveToDrive({ ...w.owner, orgRole: role, userId: w.admin.id })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteServerCopies({ ...w.owner, orgRole: role, userId: w.admin.id })).rejects.toBeInstanceOf(ForbiddenError);
    }
    await loginAs(w.member.userId);
    expect((await call(moveRoute.POST, { body: { step: "copy", dryRun: true } })).status).toBe(403);
    await loginAs(w.owner.userId);
    expect((await call(moveRoute.POST, { body: { step: "copy", dryRun: true } })).status).toBe(200);
    expect((await call(moveRoute.POST, { body: { step: "nonsense" } })).status).toBe(422);
  });

  it("is refused while Drive is not connected (nothing is read or written)", async () => {
    const w = await world({ connected: false });
    await ingest(w.member, { name: "a.png", bytes: PNG }, undefined, "LIBRARY", undefined, { workspaceId: w.space.id });
    await expect(moveToDrive(w.owner)).rejects.toThrow("storage.drive_not_ready");
    expect(drive.calls).toEqual([]);
  });

  it("moves in small batches, resumes where it stopped, leaves every server copy in place and records its size and hash", async () => {
    const w = await world({ connected: false });
    const { files, face, paths } = await oldFiles(w);

    const first = await moveToDrive(w.owner, { limit: 2 });
    expect(first).toMatchObject({ done: 2, failed: 0, missing: 0, stopped: null });
    expect(first.next).not.toBeNull();
    const second = await moveToDrive(w.owner, { limit: 2, after: first.next });
    expect(second).toMatchObject({ done: 1, failed: 0, next: null });

    for (const f of files) {
      expect(await pathOf(f.id)).toMatch(/^gdrive:/);
      expect(existsSync(serverFile(paths.get(f.id)!))).toBe(true); // nothing deleted
      const row = await db.storedFile.findUniqueOrThrow({ where: { id: f.id }, select: { meta: true, size: true } });
      const note = (row.meta as { serverCopy: { path: string; sha256: string; size: number } }).serverCopy;
      expect(note).toMatchObject({ path: paths.get(f.id), size: row.size });
      expect(note.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // a profile picture stays on the server
    expect(await pathOf(face.id)).toBe(paths.get(face.id));

    // the moved files go to their space's folder; the chat file to «مرفقات الدردشة»
    expect((await driveFileOf(files[0]!.id)).parents).toEqual([drive.byName(w.space.name)!.id]);
    expect((await driveFileOf(files[2]!.id)).parents).toEqual([drive.byName("مرفقات الدردشة")!.id]);

    // a second run finds nothing to do (idempotent), the meter counts the copies waiting
    expect(await moveToDrive(w.owner)).toMatchObject({ done: 0, next: null });
    const meter = await storageMeter(w.owner);
    expect(meter.copies.files).toBe(3);
    expect(meter.drive.files).toBe(3);
    expect(meter.movable.files).toBe(0);
  });

  it("a moved file opens from Drive through the app with the same permission check", async () => {
    const w = await world({ connected: false });
    const { files } = await oldFiles(w);
    await moveToDrive(w.owner);
    await loginAs(w.member.userId);
    enter(w.space.id);
    const res = await raw(files[0]!.id);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.bytes)).toEqual(Buffer.from(png(1, 1)));
    await loginAs(w.admin.id); // an org admin who is not in the space
    expect((await raw(files[0]!.id)).status).toBe(404);
  });

  it("a file whose bytes are not on the server is counted as missing, not invented", async () => {
    const w = await world({ connected: false });
    const { files, paths } = await oldFiles(w);
    await rm(serverFile(paths.get(files[0]!.id)!));
    const gone = await moveToDrive(w.owner);
    expect(gone).toMatchObject({ done: 2, missing: 1 });
    expect(await pathOf(files[0]!.id)).toBe(paths.get(files[0]!.id));
  });

  it("Drive failing stops the run and changes nothing", async () => {
    const w = await world({ connected: false });
    const { files, paths } = await oldFiles(w);
    drive.state.failUploads = true;
    const down = await moveToDrive(w.owner);
    expect(down).toMatchObject({ done: 0, failed: 1, stopped: "drive_unavailable" });
    for (const f of files) expect(await pathOf(f.id)).toBe(paths.get(f.id));
  });

  it("one run at a time", async () => {
    const w = await world({ connected: false });
    await oldFiles(w);
    const results = await Promise.allSettled([moveToDrive(w.owner), moveToDrive(w.owner)]);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason)).toEqual([expect.any(ValidationError)]);
  });
});

describe("«احذف نسخ السيرفر المتحقَّق منها» (a separate, explicit step)", () => {
  it("never happens by itself: moving leaves every server copy, and the delete step has a dry-run count", async () => {
    const w = await world({ connected: false });
    const { paths } = await oldFiles(w);
    await moveToDrive(w.owner);
    for (const p of paths.values()) expect(existsSync(serverFile(p))).toBe(true);
    expect(await deleteServerCopies(w.owner, { dryRun: true })).toMatchObject({ dryRun: true, plan: { files: 3 } });
    for (const p of paths.values()) expect(existsSync(serverFile(p))).toBe(true);
  });

  it("removes a server copy only when Drive reads back the exact size and hash; a changed Drive file keeps its server copy", async () => {
    const w = await world({ connected: false });
    const { files, face, paths } = await oldFiles(w);
    await moveToDrive(w.owner);
    // the Drive twin of one file is not what was moved (a corrupt or replaced file)
    (await driveFileOf(files[1]!.id)).bytes = png(2, 2, 9);

    const r = await deleteServerCopies(w.owner);
    expect(r).toMatchObject({ done: 2, failed: 1, next: null });
    expect(existsSync(serverFile(paths.get(files[0]!.id)!))).toBe(false);
    expect(existsSync(serverFile(paths.get(files[2]!.id)!))).toBe(false);
    expect(existsSync(serverFile(paths.get(files[1]!.id)!))).toBe(true); // kept: it is the only good copy
    expect(existsSync(serverFile(paths.get(face.id)!))).toBe(true); // a profile picture was never moved

    const cleared = await db.storedFile.findUniqueOrThrow({ where: { id: files[0]!.id }, select: { meta: true } });
    expect(cleared.meta).toBeNull();
    const kept = await db.storedFile.findUniqueOrThrow({ where: { id: files[1]!.id }, select: { meta: true } });
    expect(JSON.stringify(kept.meta)).toContain("serverCopy");
    expect((await storageMeter(w.owner)).copies.files).toBe(1);
  });

  it("works in batches, and the files stay readable from Drive after their server copy is gone", async () => {
    const w = await world({ connected: false });
    const { files } = await oldFiles(w);
    await moveToDrive(w.owner);
    const one = await deleteServerCopies(w.owner, { limit: 2 });
    expect(one).toMatchObject({ done: 2, next: expect.any(String) });
    const two = await deleteServerCopies(w.owner, { limit: 2, after: one.next });
    expect(two).toMatchObject({ done: 1, next: null });
    expect((await storageMeter(w.owner)).copies).toEqual({ files: 0, bytes: 0 });
    await loginAs(w.member.userId);
    enter(w.space.id);
    expect(Buffer.from((await raw(files[1]!.id)).bytes)).toEqual(Buffer.from(png(2, 2, 2)));
  });

  it("an orphan upload that was moved loses its leftover server copy too", async () => {
    const w = await world({ connected: false });
    const { files, paths } = await oldFiles(w);
    await moveToDrive(w.owner);
    await db.storedFile.update({ where: { id: files[2]!.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
    expect(await purgeOrphanUploads(w.org.id)).toBe(1);
    expect(existsSync(serverFile(paths.get(files[2]!.id)!))).toBe(false);
  });
});

describe("secrets and logs", () => {
  it("the move and the delete log counts only: no token, no file name", async () => {
    const w = await world({ connected: false });
    await oldFiles(w);
    await moveToDrive(w.owner);
    await deleteServerCopies(w.owner);
    const events = await db.integrationEvent.findMany({ where: { orgId: w.org.id, type: { startsWith: "storage." } } });
    expect(events.map((e) => e.type).sort()).toEqual(["storage.copies_deleted", "storage.moved"]);
    const text = JSON.stringify(events);
    for (const secret of ["access-token", "refresh-token", "plan.png", "price.png", "test-client-secret"]) expect(text).not.toContain(secret);
    const stored = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "GOOGLE_DRIVE" } } });
    expect(stored.secretEnc).not.toContain("refresh-token");
  });
});
