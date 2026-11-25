import { NextResponse } from "next/server";
import { ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { myWorkForApp } from "@/server/services/today-app";

/**
 * GET `?tab=today|upcoming|overdue|completed|mine|created` — «مهامي» as data, for the phone (M2 N2): the page's own `getMyWork`, in the
 * space the person is in, with every tab's count. Read-only; ticking a task is `POST /api/tasks/[id]/complete` as on the site.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const result = await myWorkForApp(actor, new URL(req.url).searchParams.get("tab"));
    if (!result) throw new ForbiddenError("section.view_denied");
    return NextResponse.json(result);
  });
}
