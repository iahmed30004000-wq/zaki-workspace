import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { summarizeTopic } from "@/server/services/digest";

/**
 * «لخّصلي» — the last 40 messages of THIS topic, summarised for the person who asks.
 *
 *   POST  →  { text, empty, cached: false, generatedAt }
 *
 * The answer goes back to the person only: nothing is posted to the conversation and nothing is kept. A topic the person cannot read, a
 * private chat, switch off, or a partner: 404. A topic with a guest among its people: refused (409 `digest.err.guest`).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAssistantApi(async () => NextResponse.json(await summarizeTopic(await requireActor(), params.id), noStore));
}
