import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { shareDocSchema, shareDocument } from "@/server/services/documents";

/** «مشاركة مع الشركاء»: the document's author, a manager of the space or the owner lets external partners read it, or takes that back. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const { shared } = await parseJson(shareDocSchema, req);
    return NextResponse.json({ document: await shareDocument(actor, params.id, shared) });
  });
}
