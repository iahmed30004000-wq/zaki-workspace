import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { archiveSheet, readSheet, updateSheet, updateSheetSchema } from "@/server/services/knowledge";

export const dynamic = "force-dynamic";
type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  return withApi(async () => NextResponse.json({ sheet: await readSheet(await requireActor(), params.id) }, { headers: { "cache-control": "no-store" } }));
}

export async function PATCH(req: Request, { params }: Params) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(updateSheetSchema, req);
    return NextResponse.json({ sheet: await updateSheet(actor, params.id, input) });
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  return withApi(async () => {
    await archiveSheet(await requireActor(), params.id);
    return NextResponse.json({ ok: true });
  });
}
