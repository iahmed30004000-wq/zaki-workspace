import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { clearGroupPicture, setGroupPicture } from "@/server/chat/group-picture";
import { structureRoute } from "@/server/door/structure-auth";
import { AVATAR_MAX_BYTES } from "@/server/services/avatars";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";

/**
 * The picture of a group of topics.
 *
 *  POST   multipart `file` — PNG, JPEG or WebP, at most 2 MB (the bytes decide); the answer is `{ imageUrl }`, and the previous picture is soft-deleted.
 *  DELETE — back to the emoji.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return structureRoute(req, () =>
    withApi(async () => {
      const ctx = await activeOrgCtx();
      let received: Awaited<ReturnType<typeof parseMultipartUpload>>["upload"] | undefined;
      try {
        ({ upload: received } = await parseMultipartUpload(req, { fieldName: "file", maxBytes: AVATAR_MAX_BYTES, tempDir: uploadTempDir }));
        const { readFile } = await import("node:fs/promises");
        const bytes = await readFile(received.path);
        const made = await setGroupPicture(ctx, params.id, { name: received.name, bytes: new Uint8Array(bytes) });
        return NextResponse.json(made, { status: 201 });
      } catch (err) {
        if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) return NextResponse.json({ error: "bad_request", message: "avatar.empty" }, { status: 400 });
        if (err instanceof UploadStreamError && err.kind === "too_large") throw new ForbiddenError("avatar.too_large");
        throw err;
      } finally {
        await received?.cleanup();
      }
    }),
  );
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return structureRoute(req, () =>
    withApi(async () => {
      const ctx = await activeOrgCtx();
      await clearGroupPicture(ctx, params.id);
      return NextResponse.json({ ok: true });
    }),
  );
}
