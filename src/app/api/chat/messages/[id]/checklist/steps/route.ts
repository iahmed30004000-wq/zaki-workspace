import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { checklistToSteps, stepsSchema } from "@/server/chat/checklists";

/**
 * POST `{ taskId }`: «اعمل منها مهمة» — after the task was made from this message (`POST …/task`), its steps are the checklist's items (a done item done). Only for the
 * task whose source is this message, while it has no step, by a person who may write steps of that task.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(stepsSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await checklistToSteps(ctx, params.id, input.taskId), { status: 201 });
  });
}
