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
});

/** POST: «اعمل منها مهمة» — a task in a project the caller works in (a space's ADMIN or MEMBER), from a message they read. */
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
