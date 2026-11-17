import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { getOmsStatus, removeOmsConfig, saveOmsConfig } from "@/server/services/oms-link";
import { omsInputSchema } from "./schema";

/**
 * «ربط نظام الطلبات»: the OWNER's card (src/components/oms-link-card.tsx).
 * GET: the state and the settings (the token is never in it, only «محفوظ»). PUT: save (404 while the switch is off; refused without
 * ENCRYPTION_KEY or for an address that is not a public https one). DELETE: take the link out, the token with it (allowed while the
 * switch is off). Anybody who is not the OWNER gets 403 `oms.owner_only`.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "cache-control": "no-store" } };

export async function GET() {
  return withApi(async () => NextResponse.json(await getOmsStatus(await requireActor()), NO_STORE));
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(omsInputSchema, req);
    await saveOmsConfig(actor, input);
    return NextResponse.json(await getOmsStatus(actor), NO_STORE);
  });
}

export async function DELETE() {
  return withApi(async () => {
    const actor = await requireActor();
    await removeOmsConfig(actor);
    return NextResponse.json(await getOmsStatus(actor), NO_STORE);
  });
}
