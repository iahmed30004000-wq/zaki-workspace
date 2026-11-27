import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError, ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";
import { assertStoriesDoor, createStory, storiesFeed } from "@/server/services/stories";
import { STORY_VIDEO_MAX_BYTES } from "@/lib/chat/v2/stories/types";

/**
 * «القصص».
 *
 *  GET   the stories this person may watch now, grouped by who posted them (`StoriesFeedDto`).
 *  POST  multipart `file` (a picture or a short video), `caption`, `durationMs`: one new story for 24 hours.
 *
 * An external partner, and everybody while the company's switch `stories` is off, gets 404.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await storiesFeed(actor), { headers: { "cache-control": "private, no-store" } });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    // before a byte is read: a refused person writes nothing to the disk
    await assertStoriesDoor(actor);
    let received: Awaited<ReturnType<typeof parseMultipartUpload>> | undefined;
    try {
      received = await parseMultipartUpload(req, { fieldName: "file", maxBytes: STORY_VIDEO_MAX_BYTES, tempDir: uploadTempDir });
      const duration = received.fields["durationMs"];
      const made = await createStory(actor, { upload: received.upload, caption: received.fields["caption"] ?? "", ...(duration ? { durationMs: Number(duration) } : {}) });
      return NextResponse.json(made, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) throw new ValidationError([{ path: "file", message: "chat.f.empty" }]);
      if (err instanceof UploadStreamError && err.kind === "too_large") throw new ForbiddenError("stories.too_large");
      throw err;
    } finally {
      await received?.upload.cleanup();
    }
  });
}

export const dynamic = "force-dynamic";
