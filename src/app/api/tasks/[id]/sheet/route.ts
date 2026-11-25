import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { taskSheetFor } from "@/server/services/task-sheet";

/**
 * GET — ONE TASK AS ITS PAGE SHOWS IT, for the phone (M2 N2): the same `taskSheetFor` the task page draws from, so the two never
 * disagree — the task, whether the viewer may edit it, the people offered for «لمين» with their «طلب», the pending requests and what the
 * viewer may do with them, the labels, the board's columns (the «الحالة» picker), the steps, the reward (only to whom the lens shows it).
 * Read-only: every change still goes through the task's own routes (PATCH, move, complete, steps, comments, request/accept|return).
 * Outside the person's work scope the task is «not found»; without the tasks row of their grid it is refused.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const result = await taskSheetFor(actor.userId, actor, params.id);
    if (result.kind === "notFound") throw new NotFoundError("task.not_found");
    if (result.kind === "off") throw new ForbiddenError("section.view_denied");
    // what only the page's own cards use stays on the server
    const { internal: _internal, ...sheet } = result.sheet;
    return NextResponse.json(sheet);
  });
}
