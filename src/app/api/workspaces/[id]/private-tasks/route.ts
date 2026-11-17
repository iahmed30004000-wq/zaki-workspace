import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireWorkspace } from "@/server/auth";
import { countPublicAssignedTasks, makeAssignedTasksPrivate } from "@/server/services/task-privacy-bulk";

/** GET: how many open, assigned tasks of the space are still «المساحة كلها» (what the click would change). The space's managers only. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN"]);
    return NextResponse.json({ count: await countPublicAssignedTasks(ctx.orgId, params.id) });
  });
}

/** POST: make them «المعنيين بس». The space's managers only; audited; each task gets a line in its log. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN"]);
    return NextResponse.json(await makeAssignedTasksPrivate({ userId: ctx.userId, orgId: ctx.orgId }, params.id));
  });
}
