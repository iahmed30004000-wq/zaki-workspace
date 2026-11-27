import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { voiceServerStatus } from "@/server/services/voice-transcript";

/**
 * GET /api/owner-assistant/voice-server — the card «تحويل الصوت لنص على السيرفر»: what the voice program on the owner's server says right now (its
 * /health, read on demand), the chosen transcription source and whether the chat draws «اكتب النص». OWNER ONLY (404 for anybody else, and for
 * everybody while the assistant is off). No address, no secret and no raw answer of the program is in it. Choosing it is the settings' own PUT
 * (`transcribeSource: "agent"`): one writer of those settings.
 */
export async function GET() {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json(await voiceServerStatus(access.orgId), noStore);
  });
}
