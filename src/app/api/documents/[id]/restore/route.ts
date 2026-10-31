import { NextResponse } from "next/server";
import { withDocApi } from "@/server/doc-api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { restoreDocSchema, restoreDocument } from "@/server/services/documents";

/** «استرجاع»: an older version comes back as a NEW version (the history is never rewritten). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withDocApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(restoreDocSchema, req);
    return NextResponse.json({ document: await restoreDocument(actor, params.id, input) });
  });
}
