import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { readReports, reportQuerySchema } from "@/server/services/manufacturing-reports";

/** The reports of ONE manufacturing space (`?spaceId=&from=&to=`): quantities for whoever may view, money only for a holder of `manufacturing.cost`. */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const q = new URL(req.url).searchParams;
    const parsed = reportQuerySchema.safeParse({ spaceId: q.get("spaceId") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    if (!parsed.success) throw new ValidationError([{ path: "spaceId", message: "mfg.e.space" }]);
    return NextResponse.json(await readReports(actor, parsed.data));
  });
}
