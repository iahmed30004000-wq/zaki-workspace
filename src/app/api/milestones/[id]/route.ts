import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { NotFoundError, requireTeamWork } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { deleteMilestone, updateMilestone, milestonePatch } from "@/server/services/milestones";

/**
 * One milestone: PATCH its name, description, day or status; DELETE it.
 *
 * The milestone is named by its own id, and the door is the project it belongs to (`requireTeamWork`:
 * the space and the team), so an id from another company or another team answers «not found». Deleting
 * never deletes a task: the tasks attached to it keep their place and lose only the pointer.
 */

async function doorFor(milestoneId: string) {
  const row = await db.milestone.findUnique({
    where: { id: milestoneId },
    select: { id: true, project: { select: { id: true, workspaceId: true, teamId: true } } },
  });
  if (!row) throw new NotFoundError("milestone.not_found");
  const access = await requireTeamWork(row.project.workspaceId, row.project.teamId, ["ADMIN", "MEMBER"], "milestone.not_found", undefined, row.project.id);
  await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, "milestones");
  return access;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(milestonePatch, req);
    const access = await doorFor(params.id);
    const milestone = await updateMilestone(params.id, input, await orgTimeZone(access.orgId));
    return NextResponse.json({ milestone });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await doorFor(params.id);
    await deleteMilestone(params.id);
    return NextResponse.json({ ok: true });
  });
}
