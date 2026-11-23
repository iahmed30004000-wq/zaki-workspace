import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { bulkAssign, bulkAssignSchema, listOpenTasks } from "@/server/services/bulk-assign";

/** GET `?from=<userId>[&workspaceId=]`: the OPEN cards that person holds (first or beside) in the spaces the caller manages: the list the screen shows before it asks. */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    if (!from) throw new ValidationError([{ path: "from", message: "required" }]);
    const ctx = await activeOrgCtx();
    const tasks = await listOpenTasks(ctx, from, { workspaceId: url.searchParams.get("workspaceId") ?? undefined });
    return NextResponse.json({ count: tasks.length, tasks });
  });
}

/**
 * POST `{ from, to | null, workspaceId?, taskIds? }`: every open card of `from` goes to `to`, or to nobody (null). Each card is edited by the route of the task itself
 * (rank rule, space rule, team rule, bell): the answer says which moved, which were only ASKED of a higher rank, and which were skipped and why.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(bulkAssignSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await bulkAssign(ctx, input));
  });
}
