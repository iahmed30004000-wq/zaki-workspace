import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { parseMultipartUpload } from "@/server/files/multipart";
import { sniffChatMedia } from "@/server/files/sniff";
import { uploadTempDir, UploadStreamError, type ReceivedUpload } from "@/server/files/upload-stream";
import { requireActor } from "@/server/policy/actor";
import { authorizeTakeTranscript, MAX_TAKE_BYTES, takeGuard, transcribeTake, VoiceTranscriptError } from "@/server/services/voice-transcript";

/**
 * POST /api/chat/conversations/[id]/transcribe — the words of a recording that was NOT sent yet (the phone's preview, `tgPhone`): multipart, `file` (the
 * take) and `language` (a short code, or «auto»). The same switch, service and filter as «اكتب النص», and nothing is kept: neither the audio (the temporary
 * file goes before the answer) nor the words. Who may ask is decided BEFORE the body is read. A failure is a dictionary key in `message` (502 for the
 * service, 409 for «not set up» / «too big» / «silent», 429 for too many).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    let received: ReceivedUpload | undefined;
    let leave: (() => void) | undefined;
    try {
      await authorizeTakeTranscript(actor, params.id);
      leave = takeGuard.enter(actor.userId);
      const parsed = await parseMultipartUpload(req, { fieldName: "file", maxBytes: MAX_TAKE_BYTES, tempDir: uploadTempDir });
      received = parsed.upload;
      // the bytes say what it is: a recording, whatever it is called or declared
      const sniffed = sniffChatMedia(received.prefix, "VOICE", received.name);
      if (!sniffed.ok) throw new ValidationError([{ path: "file", message: sniffed.key }]);
      const result = await transcribeTake(actor, { bytes: await readFile(received.path), mime: sniffed.mime }, parsed.fields["language"]);
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof UploadStreamError) {
        if (err.kind === "too_large") return apiError("conflict", "voiceTranscript.err_big");
        throw new ValidationError([{ path: "file", message: err.kind === "empty" ? "chat.f.empty" : err.message }]);
      }
      if (err instanceof VoiceTranscriptError) {
        const upstream = err.key === "voiceTranscript.err_down" || err.key === "voiceTranscript.err_timeout" || err.key === "voiceTranscript.err_failed" || err.key === "voiceTranscript.err_busy";
        return upstream ? NextResponse.json({ error: "upstream", message: err.key }, { status: 502 }) : apiError(err.code, err.key);
      }
      throw err;
    } finally {
      leave?.();
      await received?.cleanup();
    }
  });
}
