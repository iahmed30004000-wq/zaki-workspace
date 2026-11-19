import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/validation";
import { applyRoleTemplate, requireTemplatesActor } from "@/server/services/permission-templates";
import { withAccountsApi } from "../../../members/_http";

const bodySchema = z.object({ userId: z.string().trim().min(1).max(64) });

/** POST `{ userId }`: applies the template to that person through the account service; answers what they ended with. */
export async function POST(req: Request, { params }: { params: { id: string; templateId: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireTemplatesActor(params.id);
    const { userId } = await parseJson(bodySchema, req);
    return NextResponse.json(await applyRoleTemplate(actor, params.templateId, userId));
  });
}
