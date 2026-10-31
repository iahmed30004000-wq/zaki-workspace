import { db } from "@/server/db";
import { isSpaceManager } from "@/server/workspace-role";
import { userSeesProject } from "./team-scope";

/**
 * THE QUESTIONS A RULE ASKS ABOUT PEOPLE AND PLACES («القواعد التلقائية») — one place, asked twice: when a rule is SAVED
 * (the admin's screen) and again every time it RUNS (what was true at saving may not be true any more).
 *
 * A rule never grants anything the admin who saved it could not do:
 *  - it runs with the rights of `runAsId` (the admin who last saved it), who must still be ACTIVE and still manage the space;
 *  - the person it names (to assign, to notify) must be ACTIVE, in the space, able to see the project, and never an external
 *    partner (a guest never gets a task or a notice from a rule);
 *  - the topic it posts into must be an open topic of the project's own space, not a restricted one and not another team's.
 */

export interface RuleProject {
  workspaceId: string;
  teamId: string | null;
}

/** Is this person someone a rule may hand a task or a notice to? */
export async function eligiblePerson(orgId: string, project: RuleProject, userId: string): Promise<boolean> {
  const om = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId, status: "ACTIVE" }, select: { role: true } });
  if (!om || om.role === "GUEST") return false;
  if (om.role !== "OWNER") {
    const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } }, select: { role: true } });
    if (!row || row.role === "GUEST") return false;
  }
  return userSeesProject(userId, project);
}

/** Does this person still manage the space (its ADMIN, an org ADMIN in it, or the owner) while being ACTIVE and not a guest? */
export async function stillManages(orgId: string, workspaceId: string, userId: string): Promise<boolean> {
  const om = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId, status: "ACTIVE" }, select: { role: true } });
  if (!om || om.role === "GUEST") return false;
  const row = om.role === "OWNER" ? null : await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } });
  return isSpaceManager(om.role, row?.role);
}

/** The topic, when a rule may post into it (null otherwise). */
export async function usableTopic(orgId: string, project: RuleProject, topicId: string): Promise<{ id: string; title: string } | null> {
  const row = await db.conversation.findFirst({
    where: {
      id: topicId,
      orgId,
      kind: "TOPIC",
      spaceId: project.workspaceId,
      restricted: false,
      closedAt: null,
      archivedAt: null,
      OR: project.teamId ? [{ teamId: null }, { teamId: project.teamId }] : [{ teamId: null }],
    },
    select: { id: true, title: true },
  });
  return row ? { id: row.id, title: row.title ?? "" } : null;
}
