import { NextResponse } from "next/server";
import { apiError } from "@/server/api";
import { withAssistantApi } from "@/server/ai/api";
import { agentSettings, assistantTurn, verifySignature } from "@/server/calls/assistant-agent";

export const dynamic = "force-dynamic";

/**
 * POST: the voice agent (the owner's own program) asks what the assistant says in a call. No session: the request is signed with the shared secret
 * (x-agent-timestamp + x-agent-signature over `<time>.<body>`). Without the secret on the server, or with a wrong signature, it is a plain «not found».
 */
export async function POST(req: Request) {
  return withAssistantApi(async () => {
    const agent = agentSettings();
    const raw = await req.text();
    if (!agent || raw.length > 20_000 || !verifySignature(agent.secret, req.headers.get("x-agent-timestamp"), req.headers.get("x-agent-signature"), raw)) {
      return apiError("not_found", "features.off");
    }
    return NextResponse.json(await assistantTurn(raw), { headers: { "cache-control": "no-store" } });
  });
}
