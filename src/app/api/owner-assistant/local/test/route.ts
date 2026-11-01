import { NextResponse } from "next/server";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { testLocalConnection } from "@/server/services/local-model";

/**
 * «اختبر الاتصال» for the local model. OWNER ONLY (404 for anybody else and while the feature is off).
 *
 *   POST { provider: "ollama" | "openai", baseUrl?, model? }   (empty: the saved ones)
 *
 * Answers `{ provider, reachable, models, installed, listMs, ping }`: the installed models, whether the named one is among them and the
 * time of a 5-token ping. A service that cannot be reached is 502 `upstream` with a dictionary key; an address that is not internal is 422.
 */
export async function POST(req: Request) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json(await testLocalConnection(access, await readJson(req)), noStore);
  });
}
