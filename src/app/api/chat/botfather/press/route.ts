import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { parseJson } from "@/server/validation";
import { pressBotButton } from "@/server/services/botfather";

const bodySchema = z.object({ messageId: z.string().min(1).max(64), data: z.string().min(1).max(80) }).strict();

/**
 * POST: a press of a button under a line of MY chat with «بوت فاذر». Only a button that line really has is taken (404 for anything else, and for somebody else's chat);
 * a menu button redraws the line, a button that asks something adds a new line (src/server/services/botfather.ts).
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const { messageId, data } = await parseJson(bodySchema, req);
    await pressBotButton(ctx, messageId, data);
    return NextResponse.json({ ok: true });
  });
}
