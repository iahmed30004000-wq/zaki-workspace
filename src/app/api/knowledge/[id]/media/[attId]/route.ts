import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { removeMedia, setFeedbackState } from "@/server/services/knowledge-media";

/**
 * One picture of a sheet (Q1.2). PATCH `{ consent?, approve? }`: the customer's consent (an editor) and the approval (an approver, only with consent) that make
 * a feedback item offerable; DELETE removes it. The sheet's editors only.
 */
export const dynamic = "force-dynamic";
const patchSchema = z.object({ consent: z.boolean().optional(), approve: z.boolean().optional() }).refine((v) => v.consent !== undefined || v.approve !== undefined, { message: "knowledge.media.e.nothing" });

export async function PATCH(req: Request, { params }: { params: { id: string; attId: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(patchSchema, req);
    return NextResponse.json({ item: await setFeedbackState(actor, params.id, params.attId, input) });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; attId: string } }) {
  return withApi(async () => {
    await removeMedia(await requireActor(), params.id, params.attId);
    return NextResponse.json({ ok: true });
  });
}
