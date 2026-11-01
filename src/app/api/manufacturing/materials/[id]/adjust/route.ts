import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { adjustStock, adjustSchema } from "@/server/services/manufacturing-ledger";

/** A movement of the ledger (append-only: it is never edited, a mistake is reversed by another movement). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(adjustSchema, req);
    return NextResponse.json(await adjustStock(actor, params.id, input), { status: 201 });
  });
}
