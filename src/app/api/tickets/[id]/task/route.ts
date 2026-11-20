import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { sourceTaskSchema } from "@/server/services/production";
import { ticketToTask } from "@/server/services/departments";

/**
 * POST: «حوّل لمهمة» — a ticket becomes a task (createTask), the task keeps `sourceTicketId` and the ticket shows it. Only a reader of the ticket (a
 * stranger gets 404), never a guest (403). A ticket from a private conversation makes a «المعنيين بس» task; «المساحة كلها» needs `confirmPublic` (422
 * `work.confirm_public_required`). 201 when the task was made now, 200 when the ticket already had one (the same task, nothing new).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(sourceTaskSchema, req);
    const result = await ticketToTask(ctx, params.id, input);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
}
