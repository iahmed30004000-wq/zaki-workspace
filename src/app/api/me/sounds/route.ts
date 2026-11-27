import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { addMySound, assertSoundLibraryOn, listMySounds } from "@/server/services/sounds";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";
import { SOUND_MAX_BYTES } from "@/lib/sound-library/choice";

/**
 * My own sounds (the sounds library's «إضافة صوت»).
 *
 *  GET   `{ sounds }`: mine only.
 *  POST  multipart `file`: the bytes are sniffed (audio only, at most 1 MB, at most 20 kept); answers the new row.
 *
 * A GUEST uploads nothing (`guest.no_access`). With the switch off the address answers 404 `features.off`.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    await assertSoundLibraryOn(actor);
    return NextResponse.json({ sounds: await listMySounds(actor.userId) });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertSoundLibraryOn(actor);
    if (actor.role === "GUEST") throw new ForbiddenError("guest.no_access");
    let received: Awaited<ReturnType<typeof parseMultipartUpload>>["upload"] | undefined;
    try {
      ({ upload: received } = await parseMultipartUpload(req, { fieldName: "file", maxBytes: SOUND_MAX_BYTES, tempDir: uploadTempDir }));
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(received.path);
      const made = await addMySound({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, { name: received.name, bytes: new Uint8Array(bytes) });
      return NextResponse.json(made, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) return NextResponse.json({ error: "bad_request", message: "sound.empty" }, { status: 400 });
      if (err instanceof UploadStreamError && err.kind === "too_large") throw new ForbiddenError("sound.too_large");
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}

export const dynamic = "force-dynamic";
