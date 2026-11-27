import { NextResponse } from "next/server";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";
import { withApi } from "@/server/api";
import { ForbiddenError, ValidationError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertGifsOn, uploadMyGif } from "@/server/chat/gifs";
import { GIF_MAX_BYTES } from "@/lib/chat/gifs";

/** POST (multipart, field `file`): a new GIF straight into MY library. The bytes decide that it is a GIF. */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    // before a byte is kept
    await assertGifsOn(ctx.orgId);
    let received;
    try {
      received = (await parseMultipartUpload(req, { fieldName: "file", maxBytes: GIF_MAX_BYTES, tempDir: uploadTempDir })).upload;
      return NextResponse.json(await uploadMyGif(ctx, { name: received.name, upload: received }), { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) {
        throw new ValidationError([{ path: "file", message: err.kind === "empty" ? "chat.f.empty" : err.message }]);
      }
      if (err instanceof UploadStreamError && err.kind === "too_large") throw new ForbiddenError("gifs.e.too_large");
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}
