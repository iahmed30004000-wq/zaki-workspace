import { NextResponse } from "next/server";
import { z } from "zod";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";
import { withApi } from "@/server/api";
import { ForbiddenError, ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { createChatUpload } from "@/server/chat/attachments";
import { CHAT_LIMITS } from "@/server/files/sniff";

/**
 * POST /api/chat/uploads — a chat attachment BEFORE its message: the file binds to the
 * uploader only (the conversation is not known yet); the message claims it afterwards.
 * The bytes decide the kind; a declared kind that disagrees is refused. Guests may upload
 * (they post in the topics of their spaces).
 */
const formKind = z.enum(["IMAGE", "VIDEO", "AUDIO", "FILE", "VOICE", "VIDEO_NOTE"]);

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    let received;
    try {
      // Video is the only chat kind above the common 25 MB ceiling. The parser applies that
      // conservative ceiling first; createChatUpload applies the exact sniffed-kind ceiling.
      const parsedUpload = await parseMultipartUpload(req, { fieldName: "file", maxBytes: CHAT_LIMITS.VIDEO, tempDir: uploadTempDir });
      received = parsedUpload.upload;
      const rawKind = parsedUpload.fields.kind;
      const parsed = formKind.safeParse(rawKind);
      if (!parsed.success) throw new ValidationError([{ path: "kind", message: "chat.f.kind_required" }]);
      const durationRaw = parsedUpload.fields.durationMs;
      const peaksRaw = parsedUpload.fields.peaks;

      let peaks: unknown;
      if (typeof peaksRaw === "string" && peaksRaw.trim() !== "") {
        try {
          peaks = JSON.parse(peaksRaw);
        } catch {
          throw new ValidationError([{ path: "peaks", message: "chat.f.bad_peaks" }]);
        }
      }

      const made = await createChatUpload({
        actor,
        name: received.name,
        upload: received,
        declaredKind: parsed.data,
        durationMs: typeof durationRaw === "string" ? Number(durationRaw) : undefined,
        peaks,
      });
      return NextResponse.json(made, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) {
        throw new ValidationError([{ path: "file", message: err.kind === "empty" ? "chat.f.empty" : err.message }]);
      }
      if (err instanceof UploadStreamError && err.kind === "too_large") throw new ForbiddenError("chat.f.too_large");
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}
