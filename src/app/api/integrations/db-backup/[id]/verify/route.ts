import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { verifyBackup } from "@/server/services/db-backup";

/** «تحقّق»: the OWNER has one copy opened from Drive and counted (nothing is restored). The answer is the run with the result. */
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  return withApi(async () => NextResponse.json({ run: await verifyBackup(await requireActor(), ctx.params.id) }));
}
