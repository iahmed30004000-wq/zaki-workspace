import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { NotFoundError, requireTeamWork } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { createMilestone, listMilestones, milestoneInput } from "@/server/services/milestones";

/**
 * «المعالم» of one project.
 *
 *  GET  every milestone of the project (what the page and the task's picker read).
 *  POST one milestone: `{ name, description?, targetDate? }`.
 *
 * The project's space AND its team gate both (`requireTeamWork`, the board's own door); writing needs
 * the «projects.edit» box. The whole feature sits behind the company's «المعالم» switch: off, this door
 * answers «not found» and nothing stored is touched.
 */

async function projectFor(projectId: string, capability: "projects.view" | "projects.edit") {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true, teamId: true },
  });
  if (!project) throw new NotFoundError("project.not_found");
  const roles = capability === "projects.edit" ? (["ADMIN", "MEMBER"] as const) : undefined;
  const access = await requireTeamWork(project.workspaceId, project.teamId, roles ? [...roles] : undefined, "project.not_found");
  await assertMemberCan(access, capability, "section.view_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, "milestones");
  return { project, access };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { access } = await projectFor(params.id, "projects.view");
    return NextResponse.json({ milestones: await listMilestones(params.id, access.orgId, access.userId) });
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(milestoneInput, req);
    const { access } = await projectFor(params.id, "projects.edit");
    const milestone = await createMilestone(params.id, input, await orgTimeZone(access.orgId));
    return NextResponse.json({ milestone }, { status: 201 });
  });
}
