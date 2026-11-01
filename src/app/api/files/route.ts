import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertMemberCan } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
import { ingest, listFiles } from "@/server/services/files";
import { currentSpace } from "@/server/services/current-space";
import { storageTarget } from "@/server/files/storage-policy";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";
import { MAX_FILE_BYTES } from "@/server/files/sniff";

/**
 * The file library is closed to org GUESTs on every route (list, details, bytes, versions,
 * upload, delete): they get 403 `guest.no_access` before anything is read or stored.
 */

/**
 * POST multipart/form-data: file=<binary> — bytes are sniffed server-side;
 * the client's claimed type is ignored entirely (magic bytes only).
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    let received;
    try {
      ({ upload: received } = await parseMultipartUpload(req, { fieldName: "file", maxBytes: MAX_FILE_BYTES, tempDir: uploadTempDir }));
      // the library of the space the person is in
      const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
      const made = await ingest(ctx, { name: received.name, path: received.path, size: received.size, prefix: received.prefix }, undefined, "LIBRARY", undefined, { workspaceId: space?.id ?? null });
      return NextResponse.json(made, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) {
        return NextResponse.json({ error: "bad_request", message: err.message }, { status: 400 });
      }
      // a body over the ceiling is answered 413 before its bytes are buffered (security review D2)
      if (err instanceof UploadStreamError && err.kind === "too_large") return NextResponse.json({ error: "payload_too_large", message: "files.too_large" }, { status: 413 });
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}

/**
 * GET: the library of the space the person is in — heads only (latest version of every family). `storage` says where a new
 * file goes right now (Drive first; the server only when Drive is not connected or not answering) and `onDrive` is the same
 * in the old shape.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    // the library row of the person's grid («يشوف»); uploading is checked by `ingest` («يضيف ويعدّل»)
    await assertMemberCan(ctx, "files.view", "section.view_denied");
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const [files, storage] = await Promise.all([listFiles(ctx.orgId, { spaceId: space?.id ?? null, isHq: space?.kind === "HQ" }), storageTarget(ctx.orgId)]);
    return NextResponse.json({ files, onDrive: storage.target === "drive", storage, space: space ? { id: space.id, name: space.name } : null });
  });
}
