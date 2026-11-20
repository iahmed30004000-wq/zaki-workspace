import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { db } from "@/server/db";
import { requireWorkspace, audit, ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { isFeatureOn } from "@/server/services/features";
import { INSTANT_PROJECT_KEY } from "@/server/services/instant-work";
import { taskParticipantFilter, teamFilterInSpace } from "@/server/services/team-scope";
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
  /** a source that is somebody's private talk: the person confirms the project is for the space (400 `work.confirm_public_required` otherwise) */
  confirmPublic: z.boolean().optional(),
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
    // the count of a project is the tasks the caller may open: a private one of somebody else is not counted (P0 review)
    const participants = await taskParticipantFilter(ctx.userId);
    // «صندوق المهام» (W1.2, `workInbox` ON) is the quick-task place, not a project to pick (the chat dialog, goals, ideas, the cards' picker): it has its own pinned card on
    // «المشاريع» and its own first choice where tasks are made. OFF: the hidden quick-task project is an ordinary row, as it was.
    const inbox = await isFeatureOn(ctx.orgId, "workInbox");
    const rows = await db.project.findMany({
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
        systemKey: true,
        updatedAt: true,
        _count: { select: { tasks: { where: { archived: false, AND: [participants] } }, boards: true } },
      },
    });
    // hidden only while there is something else to pick: a space whose only project is the inbox still offers it (the cards' «حوّلها لمهمة» has no other target)
    const others = inbox ? rows.filter((p) => p.systemKey !== INSTANT_PROJECT_KEY) : rows;
    const projects = (others.length > 0 ? others : rows).map(({ systemKey: _systemKey, ...project }) => project);
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
    const source = input.sourceMessageId ? await assertWatchComment(ctx, input.sourceMessageId, input.confirmPublic) : null;
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
