import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { undeleteDocument } from "@/server/services/documents";

/** «رجّع المستند»: the owner brings a deleted document back to its space, as it was. Anybody else gets «not found». */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ document: await undeleteDocument(actor, params.id) });
  });
}
