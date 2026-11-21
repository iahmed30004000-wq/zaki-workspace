import { NextResponse } from "next/server";
import { apiError } from "@/server/api";
import { withAssistantApi } from "@/server/ai/api";
import { agentSettings, verifySignature } from "@/server/calls/assistant-agent";
import { claimSignature, storeTranscriptLine } from "@/server/calls/transcripts";

export const dynamic = "force-dynamic";

/**
 * POST: the voice agent (the owner's own program) hands over ONE finished sentence of a call, as TEXT with who said it (`{ callId, personId, text }`). Nothing else
 * is accepted: there is no audio and no place for any. Signed exactly like /api/voice-agent/turn (x-agent-timestamp + x-agent-signature over `<time>.<body>`); a
 * signature is good once, so a replay is refused too. Without the secret on the server, with a wrong, old or reused signature, it is a plain «not found».
 * The answer is `{ stored }`: false (not an error) when the record is not on for that call, so the agent can stop sending for a while.
 */
export async function POST(req: Request) {
  return withAssistantApi(async () => {
    const agent = agentSettings();
    const raw = await req.text();
    const signature = req.headers.get("x-agent-signature");
    if (!agent || raw.length > 6_000 || !verifySignature(agent.secret, req.headers.get("x-agent-timestamp"), signature, raw) || !signature || !claimSignature(signature)) {
      return apiError("not_found", "features.off");
    }
    return NextResponse.json(await storeTranscriptLine(raw), { headers: { "cache-control": "no-store" } });
  });
}
