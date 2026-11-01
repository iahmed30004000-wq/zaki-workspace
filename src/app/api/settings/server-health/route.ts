import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { serverHealth } from "@/server/services/server-health";

/** GET: «حال السيرفر» — numbers about the process and the machine, never cached. The OWNER's alone (the service refuses everybody else). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await serverHealth(ctx), { headers: { "cache-control": "no-store" } });
  });
}
