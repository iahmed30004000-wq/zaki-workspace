import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { todayForApp } from "@/server/services/today-app";

/**
 * GET — «اليوم» as data, for the phone (M2 N2): the same service calls the page makes, for the space the person is in (`todayForApp`).
 * The website keeps drawing its page from the services directly; nothing here changes what it shows. Read-only.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await todayForApp(actor));
  });
}
