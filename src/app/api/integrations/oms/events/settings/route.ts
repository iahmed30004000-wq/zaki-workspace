import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { getEventsStatus, receiverAction, removeReceiver, saveEventsSettings } from "@/server/integrations/oms-events";

/**
 * The OWNER's settings of the orders system's events (I1.1a). GET: the state (the secret is never in it, only «saved»). POST `{ action }`: make the receiver's address, change
 * it, or make a secret here (returned ONCE). PUT: paste the secret the orders system made, set the rules (event to topic) and the daily card. DELETE: take the receiver out, the
 * secret with it. Anybody who is not the OWNER gets 403; POST and PUT answer 404 while the switch «أحداث نظام الطلبات» is off.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "cache-control": "no-store" } };

const actionSchema = z.object({ action: z.enum(["create", "rotate_id", "generate_secret"]) });
const settingsSchema = z.object({
  secret: z.string().max(400).optional(),
  routes: z.array(z.object({ event: z.string().max(80), conversationId: z.string().min(1).max(64) })).max(30).optional(),
  dailyCard: z.object({ hour: z.number().int().min(0).max(23), conversationId: z.string().min(1).max(64) }).nullable().optional(),
});

export async function GET() {
  return withApi(async () => NextResponse.json(await getEventsStatus(await requireActor()), NO_STORE));
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const { action } = await parseJson(actionSchema, req);
    const made = await receiverAction(actor, action);
    return NextResponse.json({ ...(await getEventsStatus(actor)), ...(made.secret ? { secret: made.secret } : {}) }, NO_STORE);
  });
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    await saveEventsSettings(actor, await parseJson(settingsSchema, req));
    return NextResponse.json(await getEventsStatus(actor), NO_STORE);
  });
}

export async function DELETE() {
  return withApi(async () => {
    const actor = await requireActor();
    await removeReceiver(actor);
    return NextResponse.json(await getEventsStatus(actor), NO_STORE);
  });
}
