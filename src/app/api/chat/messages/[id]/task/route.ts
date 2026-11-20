import { NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson, priorities } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { messageToTask } from "@/server/chat/make-work";

const schema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  title: z.string().trim().max(280).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: z.enum(priorities).optional(),
  visibility: z.enum(["SPACE", "PARTICIPANTS"]).optional(),
  confirmPublic: z.boolean().optional(),
  /** C3b.5: the rest of a selection («حدّد» then «اعمل مهمة»): ONE task from all of them, the earliest is the source; at most 100 in all (the service counts the path's id too) */
  alsoMessageIds: z.array(z.string().min(1).max(100)).max(100).optional(),
});

/**
 * POST: «اعمل منها مهمة» — a task in a project the caller works in (a space's ADMIN or MEMBER), from a message they read. With `alsoMessageIds` (C3b.5) the task is made
 * from the whole selection and the company's switch `chatMultiSelect` must be on (off: 404); the rules of one message are applied to every one of them.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const ctx = await activeOrgCtx();
    const ws = await requireWorkspace(input.workspaceId, ["ADMIN", "MEMBER"]);
    // the message and the project live in the same company
    if (ws.orgId !== ctx.orgId) throw new NotFoundError("project.not_found");
    const res = await messageToTask(ctx, ws, params.id, input);
    return NextResponse.json(res, { status: 201 });
  });
}
