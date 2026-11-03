import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { db } from "@/server/db";
import { requireWorkspace, audit, ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { teamFilterInSpace } from "@/server/services/team-scope";
import { assertMayCreateInTeam } from "@/server/services/teams";
import { parse, parseJson } from "@/server/validation";
import { assertWatchComment } from "@/server/watch/convert";

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  startDate: z.coerce.date().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
  /** A team of the space (a manager, or a member of that team), or none: the space as a whole. */
  teamId: z.string().min(1).optional().nullable(),
  /** «حوّل» in «نتفرّج سوا»: the comment this project is made from (checked by `assertWatchComment`) */
  sourceMessageId: z.string().min(1).optional(),
});

/** Projects visible to the caller in the given workspace. */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const { workspaceId } = parse(
      z.object({ workspaceId: z.string().min(1) }),
      Object.fromEntries(url.searchParams),
    );
    const ctx = await requireWorkspace(workspaceId);
    await assertMemberCan(ctx, "projects.view", "section.view_denied", { spaceGuestsPass: true });
    // inside a space with teams: the space's own projects and the caller's teams' (a manager sees all)
    const team = await teamFilterInSpace(ctx.userId, workspaceId, ctx.spaceManager === true);
    const projects = await db.project.findMany({
      where: { workspaceId, ...team },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        priority: true,
        startDate: true,
        targetDate: true,
        ownerId: true,
        updatedAt: true,
        _count: { select: { tasks: { where: { archived: false } }, boards: true } },
      },
    });
    return NextResponse.json({ projects, orgId: ctx.orgId });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const ctx = await requireWorkspace(input.workspaceId, ["ADMIN", "MEMBER"]);
    await assertMemberCan(ctx, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
    // «الشركة» (HQ) is the whole company's announcements and talk, not a place for work: a project there
    // would be seen by everybody (the owner's decision, 2026-10-25). The projects already there stay.
    const space = await db.workspace.findUnique({ where: { id: input.workspaceId }, select: { kind: true } });
    if (space?.kind === "HQ") throw new ForbiddenError("projects.not_in_hq");
    await assertMayCreateInTeam(ctx, input.workspaceId, input.teamId);
    const source = input.sourceMessageId ? await assertWatchComment(ctx, input.sourceMessageId) : null;
    const project = await db.project.create({
      data: {
        workspaceId: input.workspaceId,
        teamId: input.teamId ?? null,
        name: input.name,
        description: input.description ?? null,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        status: "PLANNING",
        sourceMessageId: source?.id ?? null,
      },
      select: { id: true, name: true, status: true },
    });
    await audit("project.created", { target: project.id, meta: { name: project.name } });
    return NextResponse.json({ project }, { status: 201 });
  });
}
