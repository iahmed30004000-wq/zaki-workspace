import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { deskFactsFor } from "@/server/services/desks";

/**
 * The phone's facts for «الحملات», «الأقسام» and «الروتين اليومي»: what their pages read on the server before drawing (`deskFactsFor`).
 * Only the caller's own facts; nothing of anybody else. Each section's routes still decide on every request.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await deskFactsFor(actor));
  });
}
