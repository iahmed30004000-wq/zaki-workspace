import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { ProjectStatus } from "@prisma/client";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { db } from "@/server/db";
import { NotFoundError, ForbiddenError, requireTeamWork } from "@/server/auth";
import { audit } from "@/server/auth";
import { moveProjectToTeam } from "@/server/services/teams";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: z.string().max(24).optional(),
  priority: z.string().max(16).optional(),
  startDate: z.coerce.date().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
  /** Into a team of the space, or back to the space as a whole (null). A space manager only. */
  teamId: z.string().min(1).optional().nullable(),
});

/** PATCH: project fields incl. department binding (dept must live in the project's org). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const project = await db.project.findUnique({ where: { id: params.id }, select: { id: true, workspaceId: true, teamId: true } });
    if (!project) throw new NotFoundError("project.not_found");
    const ctx = await requireTeamWork(project.workspaceId, project.teamId, ["ADMIN", "MEMBER"], "project.not_found", undefined, params.id);
    await assertMemberCan(ctx, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });

    if (input.departmentId) {
      const dept = await db.department.findFirst({
        where: { id: input.departmentId, orgId: ctx.orgId },
        select: { id: true },
      });
      if (!dept) throw new ForbiddenError("dept.not_found");
    }

    // moving between teams changes who sees the project: a manager decides it, through the one service
    if (input.teamId !== undefined && input.teamId !== project.teamId) {
      await moveProjectToTeam(ctx, project, input.teamId);
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.startDate !== undefined) data.startDate = input.startDate ?? null;
    if (input.targetDate !== undefined) data.targetDate = input.targetDate ?? null;
    if (input.departmentId !== undefined) data.departmentId = input.departmentId ? input.departmentId : null;
    // every real status; a value that is not one is ignored (it used to whitelist a status that does not exist)
    if (input.status && (Object.values(ProjectStatus) as string[]).includes(input.status)) {
      data.status = input.status;
    }
    if (input.priority && ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"].includes(input.priority)) {
      data.priority = input.priority;
    }

    const updated = await db.project.update({
      where: { id: project.id },
      data,
      select: { id: true, name: true, status: true, departmentId: true },
    });
    await audit("project.updated", { target: project.id, meta: { name: updated.name } });
    return NextResponse.json({ project: updated });
  });
}
