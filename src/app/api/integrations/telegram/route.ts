import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { connectBot, disconnect, listChats } from "@/server/services/telegram";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertNotSpaceOnly } from "@/server/policy/space-only";

const connectSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "telegram.token_shape"),
});

/**
 * Telegram carries customer conversations (names, phone numbers), so it is closed to org
 * GUESTs: every handler below answers them 403 `guest.no_access` before doing anything.
 */

/** GET: bot identity + chat list (org members; never guests). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertNotSpaceOnly(ctx.userId, ctx.orgId); // the customers' conversations are the company's
    const chats = await listChats(ctx.orgId);
    const botUsername = (chats?.config as { botUsername?: string })?.botUsername ?? null;
    return NextResponse.json({ chats, botUsername });
  });
}

/** POST: connect a bot by token — verified against Telegram before storage. */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertNotSpaceOnly(ctx.userId, ctx.orgId); // the customers' conversations are the company's
    const input = await parseJson(connectSchema, req);
    await assertOrgManager(ctx.orgId);
    const result = await connectBot(ctx.orgId, input.token);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, botUsername: result.username });
  });
}

/** DELETE: disconnect and drop the encrypted token. */
export async function DELETE() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertNotSpaceOnly(ctx.userId, ctx.orgId); // the customers' conversations are the company's
    await assertOrgManager(ctx.orgId);
    await disconnect(ctx.orgId);
    return NextResponse.json({ ok: true });
  });
}
