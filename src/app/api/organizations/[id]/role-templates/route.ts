import { NextResponse } from "next/server";
import { parseJson } from "@/server/validation";
import { listRoleTemplates, requireTemplatesActor, saveRoleTemplates, saveTemplatesSchema } from "@/server/services/permission-templates";
import { withAccountsApi } from "../members/_http";

/** GET: the company's templates (the starters until it saves its own) with the `rev` a save must send back. Behind the switch `permissionTemplates`. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireTemplatesActor(params.id);
    return NextResponse.json(await listRoleTemplates(actor));
  });
}

/** PUT: the owner's whole list; 409 `ptemplates.stale` when it was made from an older copy. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireTemplatesActor(params.id);
    const input = await parseJson(saveTemplatesSchema, req);
    return NextResponse.json(await saveRoleTemplates(actor, input));
  });
}
