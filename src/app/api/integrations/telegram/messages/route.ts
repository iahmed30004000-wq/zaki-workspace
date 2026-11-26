import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatMessages } from "@/server/services/telegram";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertNotSpaceOnly } from "@/server/policy/space-only";

const querySchema = z.object({
  chatId: z.string().min(1).max(64),
});

/** GET ?chatId=… : message thread of one chat (org members read it; never guests: it holds customer phone numbers). */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertNotSpaceOnly(ctx.userId, ctx.orgId); // the customers' conversations are the company's
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const messages = await chatMessages(ctx.orgId, q.chatId);
    return NextResponse.json({ messages: messages.reverse() }); // oldest first for the thread view
  });
}
