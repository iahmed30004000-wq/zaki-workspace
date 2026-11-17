import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { copySchema, logCopy } from "@/server/services/knowledge";

/** One line in the log for each copy, so the owner sees what is used most. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(copySchema, req);
    await logCopy(actor, params.id, input.what);
    return NextResponse.json({ ok: true });
  });
}
