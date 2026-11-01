import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { countSchema, startCount } from "@/server/services/manufacturing-ledger";

/** «جرد»: counts a material. A difference waits for a SECOND person; the balance does not move until then. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(countSchema, req);
    return NextResponse.json({ count: await startCount(actor, params.id, input) }, { status: 201 });
  });
}
