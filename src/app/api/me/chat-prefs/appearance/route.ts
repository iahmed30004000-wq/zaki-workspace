import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { getMyAppearanceFacts } from "@/server/services/chat-prefs";

/**
 * C4.1 — GET → `{ themeV2: boolean }`: the one company switch that changes how a person's OWN appearance resolves (`themeV2Default`, «المظهر الجديد كافتراضي»):
 * what «تلقائي حسب الجهاز» and a person who never chose a theme become on a light or dark device. The caller's own company only (the person comes from the
 * session); it carries no other company setting. The screen keeps the answer in the device's copy so the first paint of the layout knows it.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await getMyAppearanceFacts(actor), { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
