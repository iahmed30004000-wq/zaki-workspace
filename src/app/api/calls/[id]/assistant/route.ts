import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { dismissAssistant, inviteAssistant } from "@/server/calls/assistant-agent";

const schema = z.object({ on: z.boolean() });

/** POST `{on}`: the owner calls his assistant into the call (`on: true`) or sends it out (`false`). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(schema, req);
    if (body.on) await inviteAssistant(ctx, params.id);
    else await dismissAssistant(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
