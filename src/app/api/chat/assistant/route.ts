import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { openAssistantChat } from "@/server/services/assistant-chat";

/**
 * POST: open (or find) MY conversation with the assistant, in the space I am in («المساعد» in the people lists). 201 when it was made, 200
 * when it was found. A guest is refused (`chat.guest_forbidden`); with the switch `assistantContact` off, or while «@المساعد» is not offered,
 * the answer is «not found». Every message written there is answered without «@» (src/server/services/chat-assistant.ts).
 */
export async function POST() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const result = await openAssistantChat(ctx, space?.id ?? null);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
}
