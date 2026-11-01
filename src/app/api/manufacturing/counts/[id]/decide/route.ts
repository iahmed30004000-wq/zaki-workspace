import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { decideCount, decideSchema } from "@/server/services/manufacturing-ledger";

/** The second person approves or rejects a stocktake (never the one who counted). Approving is what changes the balance. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(decideSchema, req);
    return NextResponse.json({ count: await decideCount(actor, params.id, input) });
  });
}
