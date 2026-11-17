import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { setSheetStatus, sheetStatusSchema } from "@/server/services/knowledge";

/** Send a sheet to review, approve it (the owner or a named approver) or take it back to a draft. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(sheetStatusSchema, req);
    return NextResponse.json({ sheet: await setSheetStatus(actor, params.id, input.status) });
  });
}
