import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { activeOrgCtx } from "@/server/services/integrations";
import { addMedia, listMedia, MEDIA_MAX_BYTES, type MediaRole } from "@/server/services/knowledge-media";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";

/**
 * Product photos and feedback pictures of one sheet (Q1.2). GET: what this person may see. POST multipart: `file` (a picture; the bytes are sniffed, the
 * client's type is ignored) and the fields `role` (GALLERY | FEEDBACK), `caption`, and for FEEDBACK `covered=1` (the browser painted its rectangles first) and
 * `consent=1`. The sheet's editors only.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await listMedia(await requireActor(), params.id), { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const ctx = await activeOrgCtx();
    let received;
    try {
      // the text fields travel BEFORE the file in the form (the parser reads them in order)
      const parsed = await parseMultipartUpload(req, { fieldName: "file", maxBytes: MEDIA_MAX_BYTES, tempDir: uploadTempDir });
      received = parsed.upload;
      const f = parsed.fields;
      const made = await addMedia(actor, ctx, params.id, {
        role: (f["role"] ?? "GALLERY") as MediaRole,
        file: { name: received.name, path: received.path, size: received.size, prefix: received.prefix },
        caption: f["caption"] ?? null,
        covered: f["covered"] === "1",
        consent: f["consent"] === "1",
      });
      return NextResponse.json({ item: made }, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) return NextResponse.json({ error: "bad_request", message: err.message }, { status: 400 });
      if (err instanceof UploadStreamError && err.kind === "too_large") return NextResponse.json({ error: "payload_too_large", message: "files.too_large" }, { status: 413 });
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}
