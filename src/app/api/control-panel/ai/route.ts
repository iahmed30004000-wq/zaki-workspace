import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { controlPanelAccess } from "@/server/services/control-panel";
import { connectZakiAi, zakiAiStatus } from "@/server/services/zaki-ai";

const noStore = { headers: { "cache-control": "no-store" } } as const;

/**
 * «زاكي أي أي»: is it connected? OWNER ONLY (404 for everybody else and while «لوحة التحكم» is off).
 * `?fresh=1` asks the service again instead of answering from the 30-second memory. The answer holds the address and the model name that were
 * saved, whether a key is saved and its last four characters, and a dictionary key for the reason: never the key.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const access = await controlPanelAccess(await requireActor());
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    return NextResponse.json(await zakiAiStatus(access.orgId, { fresh }), noStore);
  });
}

/** «اربط واختبر»: `{ baseUrl, model, key?, confirmLocal? }`. Saves, tests, and only when the test passed makes the owner's assistant use it. */
export async function POST(req: Request) {
  return withApi(async () => {
    const access = await controlPanelAccess(await requireActor());
    const body: unknown = await req.json().catch(() => null);
    return NextResponse.json(await connectZakiAi({ orgId: access.orgId, userId: access.viewerId }, body), noStore);
  });
}
