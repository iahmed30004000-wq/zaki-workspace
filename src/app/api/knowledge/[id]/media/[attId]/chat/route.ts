import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendMediaToChat } from "@/server/services/knowledge-media";

/** POST `{ conversationId }`: «ابعتيها بالمحادثة» — a copy of a picture of the sheet goes into the conversation (Q1.2). */
export const dynamic = "force-dynamic";
const schema = z.object({ conversationId: z.string().min(1).max(64) });

export async function POST(req: Request, { params }: { params: { id: string; attId: string } }) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const actor = await requireActor();
    const ctx = await activeOrgCtx();
    return NextResponse.json(await sendMediaToChat(actor, ctx, params.id, params.attId, input.conversationId), { status: 201 });
  });
}
