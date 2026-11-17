import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { syncOmsNow } from "@/server/services/oms-link";

/** «اقرأي هلّق»: the OWNER reads the products now. The answer holds a failure's CODE only, never the other side's words. */
export const dynamic = "force-dynamic";

export async function POST() {
  return withApi(async () => NextResponse.json(await syncOmsNow(await requireActor()), { headers: { "cache-control": "no-store" } }));
}
