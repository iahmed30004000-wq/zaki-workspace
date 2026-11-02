import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { transcribeAttachment, VoiceTranscriptError } from "@/server/services/voice-transcript";

/**
 * POST /api/chat/attachments/[id]/transcript — «اكتب النص»: the text of a voice note, written by the speech-to-text service on the
 * company's own machine and kept with the recording. Whoever may read the conversation may ask; the switch `voiceTranscript` off, or a note
 * the person cannot read, is 404. A failure is a dictionary key in `message` (502 for the service, 409 for «not set up» / «too big» / «silent»).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    try {
      const result = await transcribeAttachment(actor, params.id);
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof VoiceTranscriptError) {
        const upstream = err.key === "voiceTranscript.err_down" || err.key === "voiceTranscript.err_timeout" || err.key === "voiceTranscript.err_failed" || err.key === "voiceTranscript.err_busy";
        return upstream ? NextResponse.json({ error: "upstream", message: err.key }, { status: 502 }) : apiError(err.code, err.key);
      }
      throw err;
    }
  });
}
