import { db } from "@/server/db";
import { actorCanWork, type Actor } from "@/server/policy/actor";
import { canWriteInWorkspace, isSpaceManager } from "@/server/workspace-role";
import { actorFeatureOn } from "@/server/services/features";
import { isPartnerIn } from "@/server/services/custom-fields";
import { projectTabsFor, type TabOffer } from "@/components/work/project/tabs";

/**
 * W1.5 - what the project page with tabs (and the timeline page, which wears the same tabs) decides about the person looking at it: which of the
 * «الحقول والقواعد» cards exist for them and whether they may change them, and so which tabs they are offered. The rules are the old page's, word for word
 * (the server decides again on every request): «المعالم» while the company's switch is on; «إدارة الحقول» while its switch is on and never for an external
 * partner; «القواعد» for the space's managers and the owner only, never a partner.
 */
export interface ProjectCardAccess {
  /** The same write rule the API applies for a project's boards and cards: the real rank in the space plus the projects row's «يضيف ويعدّل» box. */
  canEdit: boolean;
  milestonesOn: boolean;
  canEditMilestones: boolean;
  fieldsOn: boolean;
  canManageFields: boolean;
  rulesOn: boolean;
}

export async function projectCardAccess(actor: Actor, project: { workspaceId: string; organizationId: string }): Promise<ProjectCardAccess> {
  const userId = actor.userId;
  // independent reads together: the switches, the rank in the company and the row in the space
  const [milestonesOn, fieldsSwitch, rulesSwitch, membership, spaceRow] = await Promise.all([
    actorFeatureOn(actor, "milestones"),
    actorFeatureOn(actor, "customFields"),
    actorFeatureOn(actor, "taskRules"),
    db.organizationMember.findFirst({ where: { userId, organizationId: project.organizationId, status: "ACTIVE" }, select: { role: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } }, select: { role: true } }),
  ]);
  const canEdit = membership != null && canWriteInWorkspace(membership.role, spaceRow?.role) && actorCanWork(actor, "projects.edit");
  const canEditMilestones = milestonesOn && canEdit;

  const fieldsOn = fieldsSwitch && !(await isPartnerIn({ orgId: actor.orgId, userId, orgRole: membership?.role ?? actor.role }, project.workspaceId));
  const canManageFields =
    fieldsOn &&
    membership != null &&
    (membership.role === "OWNER" || (membership.role !== "GUEST" && (spaceRow?.role === "ADMIN" || (membership.role === "ADMIN" && spaceRow != null)))) &&
    actorCanWork(actor, "projects.edit");

  const rulesOn =
    rulesSwitch &&
    membership != null &&
    membership.role !== "GUEST" &&
    isSpaceManager(membership.role, spaceRow?.role) &&
    actorCanWork(actor, "projects.edit");

  return { canEdit, milestonesOn, canEditMilestones, fieldsOn, canManageFields, rulesOn };
}

/** The tab «الحقول والقواعد» exists only when at least one of its cards does for this person. */
export const hasFieldsTab = (access: ProjectCardAccess): boolean => access.fieldsOn || access.rulesOn || access.milestonesOn;

/**
 * The tabs of a project for this person. «القائمة» and «التقويم» are W1.1's views while the company's switch `workMyTasks` is on (it owns their data door);
 * with it off they are the old pages for this project, so no tab is a dead end.
 */
export async function projectTabOffers(actor: Actor, projectId: string, access: ProjectCardAccess): Promise<{ tabs: TabOffer[]; embeddedViews: boolean }> {
  const embeddedViews = await actorFeatureOn(actor, "workMyTasks");
  return { tabs: projectTabsFor({ projectId, embeddedViews, fieldsTab: hasFieldsTab(access) }), embeddedViews };
}
