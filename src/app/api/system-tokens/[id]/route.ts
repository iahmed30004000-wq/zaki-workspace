import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { revokeSystemToken } from "@/server/services/system-tokens";

/** «توكنات الأنظمة»: the owner revokes one token, for good, also while the switch «باب الربط» is off. */
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  return withApi(async () => NextResponse.json({ item: await revokeSystemToken(await requireActor(), ctx.params.id) }));
}
