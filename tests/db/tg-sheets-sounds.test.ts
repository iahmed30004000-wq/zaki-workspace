import { afterAll, describe, expect, it, vi } from "vitest";

// Keep this file's server-side uploads out of the repo (read once, when files.ts loads).
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-sounds-${process.pid}`;
});

import * as listRoute from "@/app/api/me/sounds/route";
import * as oneRoute from "@/app/api/me/sounds/[id]/route";
import * as rawRoute from "@/app/api/files/[id]/raw/route";
import { SOUND_MAX_BYTES, SOUND_MAX_COUNT } from "@/lib/sound-library/choice";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «إضافة صوت» (the sounds library). The rules these pin: the switch (the new chat screen AND `tgPhone`) holds every door; the bytes decide that a file is
 * sound; a sound is read, listed and deleted by its UPLOADER ONLY, whatever anybody's rank; the size and the number kept are capped; no migration (the
 * row is a `StoredFile` with purpose SOUND) and the file stays on the server's disk.
 */
const WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 36, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

async function upload(bytes: Uint8Array, name = "رنتي.wav") {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type: "audio/wav" }));
  const res = await (listRoute.POST as unknown as Handler)(new Request("http://localhost/api/me/sounds", { method: "POST", body: form }), { params: {} });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

const switchOn = (orgId: string) => db.organization.update({ where: { id: orgId }, data: { settings: { features: { chatLayoutV2: true, tgPhone: true } } } });
const listOf = (res: { json: Record<string, unknown> | null }) => (res.json?.["sounds"] ?? []) as { id: string; name: string }[];

describe("my own sounds", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("with the new chat screen off, every door is «not found»", async () => {
    const team = await makeTeam();
    await loginAs(team.member.id);
    expect((await call(listRoute.GET)).status).toBe(404);
    expect((await upload(WAV)).status).toBe(404);
  });

  it("an upload is audio by its bytes; it is listed, read (with ranges) and deleted by its uploader only", async () => {
    const team = await makeTeam();
    await switchOn(team.org.id);
    await loginAs(team.member.id);
    const made = await upload(WAV);
    expect(made.status).toBe(201);
    const id = made.json?.["id"] as string;
    expect(made.json?.["name"]).toBe("رنتي");
    const row = await db.storedFile.findUniqueOrThrow({ where: { id } });
    expect(row.purpose).toBe("SOUND");
    expect(row.mimeType).toBe("audio/wav");
    expect(row.path.startsWith("gdrive:")).toBe(false);

    expect((await upload(PNG, "picture.mp3")).status).toBe(403);
    expect((await upload(new TextEncoder().encode("<html><body>hi</body></html>"), "x.mp3")).status).toBe(403);

    expect(listOf(await call(listRoute.GET)).map((s) => s.id)).toEqual([id]);
    const read = await call(oneRoute.GET, { params: { id }, headers: { range: "bytes=0-3" } });
    expect(read.status).toBe(206);
    expect(read.headers.get("content-range")).toBe(`bytes 0-3/${WAV.length}`);
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");

    // nobody else, whatever their rank: not through the sounds door and not through the library's
    for (const other of [team.owner, team.admin]) {
      await loginAs(other.id);
      expect((await call(oneRoute.GET, { params: { id } })).status).toBe(404);
      expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(404);
      expect(listOf(await call(listRoute.GET))).toEqual([]);
      expect((await call(rawRoute.GET, { params: { id } })).status).toBe(404);
    }

    await loginAs(team.member.id);
    expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect((await call(oneRoute.GET, { params: { id } })).status).toBe(404);
    expect(listOf(await call(listRoute.GET))).toEqual([]);
  });

  it("a guest uploads nothing; too big and too many are refused", async () => {
    const team = await makeTeam();
    await switchOn(team.org.id);
    await loginAs(team.guest.id);
    expect((await upload(WAV)).status).toBe(403);

    await loginAs(team.member.id);
    const big = new Uint8Array(SOUND_MAX_BYTES + 1);
    big.set(WAV);
    const refused = await upload(big);
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("sound.too_large");

    await db.storedFile.createMany({
      data: Array.from({ length: SOUND_MAX_COUNT }, (_, i) => ({ orgId: team.org.id, uploaderId: team.member.id, familyId: `snd-${team.member.id}-${i}`, name: `s${i}.wav`, path: `${team.org.id}/s${i}`, mimeType: "audio/wav", size: 10, version: 1, purpose: "SOUND" })),
    });
    const full = await upload(WAV);
    expect(full.status).toBe(403);
    expect(full.json?.["message"]).toBe("sound.too_many");
  });
});
