import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { openBotFatherChat } from "@/server/services/botfather";

/**
 * POST: open (or find) MY chat with «بوت فاذر» in the space I am in (the row «بوت فاذر» of the new-message list). 201 when it was made, 200 when it was found. Only the owner and the
 * admins (403 `bots.not_allowed` for anybody else); with the switch `botFather` off the answer is «not found». Every message written there that starts with a command is answered
 * by a line of the chat (src/server/services/botfather.ts).
 */
export async function POST() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const result = await openBotFatherChat(ctx, space?.id ?? null);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
}
