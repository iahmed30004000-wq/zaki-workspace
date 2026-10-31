import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { revokeApiToken } from "@/server/services/api-tokens";

/** «الباب»: revoke one token, for good. Whoever holds «integrations.manage», while the switch is on. */
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  return withApi(async () => NextResponse.json({ item: await revokeApiToken(await requireActor(), ctx.params.id) }));
}
