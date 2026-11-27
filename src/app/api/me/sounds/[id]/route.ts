import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { assertSoundLibraryOn, deleteMySound, openMySound } from "@/server/services/sounds";
import { parseByteRange } from "@/server/files/range";

/**
 * ONE of my sounds. GET streams it (with ranges: an iPhone asks for them), DELETE takes it away. OWNER ONLY: the file is found by its id AND its uploader,
 * so nobody else — whatever their rank — can read or delete it; a miss is 404, never a hint.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertSoundLibraryOn(actor);
    const file = await openMySound(actor.userId, params.id);
    const base: Record<string, string> = {
      "content-type": file.mimeType,
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      // the id changes with every upload, so the phone may keep the bytes (privately: they are one person's)
      "cache-control": "private, max-age=86400",
      "accept-ranges": "bytes",
    };
    const range = parseByteRange(req.headers.get("range"), file.size);
    if (range.kind === "unsatisfiable") return new NextResponse(null, { status: 416, headers: { ...base, "content-range": `bytes */${file.size}` } });
    if (range.kind === "partial") {
      return new NextResponse(await file.stream(range), { status: 206, headers: { ...base, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${file.size}` } });
    }
    return new NextResponse(await file.stream(null), { status: 200, headers: { ...base, "content-length": String(file.size) } });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertSoundLibraryOn(actor);
    await deleteMySound(actor.userId, params.id);
    return NextResponse.json({ ok: true });
  });
}

export const dynamic = "force-dynamic";
