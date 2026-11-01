import { NextResponse } from "next/server";
import { ValidationError } from "@/server/auth";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { removeGatewayKey, saveGatewayKey } from "@/server/services/owner-assistant-settings";

/**
 * The OpenAI-compatible gateway's optional Bearer key, WRITE-ONLY, like the Anthropic key (/api/owner-assistant/key): encrypted at rest,
 * never returned; the answer is `{ hasGatewayKey, gatewayKeyLast4 }` and nothing more. OWNER ONLY.
 *
 *   PUT     { key }   save or replace
 *   DELETE            remove
 */
export async function PUT(req: Request) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    const body = await readJson(req);
    const key = body && typeof body === "object" ? (body as { key?: unknown }).key : undefined;
    if (typeof key !== "string") throw new ValidationError([{ path: "key", message: "assistant.key_invalid" }]);
    const settings = await saveGatewayKey(access, key);
    return NextResponse.json({ hasGatewayKey: settings.hasGatewayKey, gatewayKeyLast4: settings.gatewayKeyLast4 }, noStore);
  });
}

export async function DELETE() {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    const settings = await removeGatewayKey(access);
    return NextResponse.json({ hasGatewayKey: settings.hasGatewayKey, gatewayKeyLast4: settings.gatewayKeyLast4 }, noStore);
  });
}
