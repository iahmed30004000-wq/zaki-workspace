import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { checkSavedKey } from "@/server/services/owner-assistant-key-check";

/**
 * «افحص المفتاح» — OWNER ONLY (404 for anybody else and while the feature is off).
 *
 *   POST   → { ok: true } | { ok: false, reason }   `reason` is a dictionary key (`assistant.no_key`, `assistant.err_key_rejected`, `assistant.err_overloaded`…)
 *
 * One request of a few tokens with the SAVED key. The key is never in the answer.
 */
export async function POST() {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json(await checkSavedKey(access), noStore);
  });
}
