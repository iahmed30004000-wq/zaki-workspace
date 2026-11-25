import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { pageUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { keepInSpace } from "@/server/services/current-space";
import { canSeeProject, projectVisibleWhere, loadWorkScope } from "@/server/services/team-scope";
import { getProjectTimeline } from "@/server/services/timeline";
import { actorFeatureOn } from "@/server/services/features";
import { TimelineGantt } from "@/components/timeline-gantt";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { ProjectTabs } from "@/components/work/project/project-tabs";
import { projectTrail } from "@/components/work/project/crumbs";
import { projectTabLabelKey } from "@/components/work/project/tabs";
import { getServerT } from "@/lib/i18n/server";
import { projectCardAccess, projectTabOffers } from "../project-chrome";

/**
 * Per-project timeline (Microsoft-Project-style Gantt), workspace-scoped. W1.5: with the switch `navV2` ON it is the «الجدول الزمني» tab of the project page -
 * the same trail and the same strip of tabs above it (its address is unchanged, so old links keep working); with it OFF it is the page it always was.
 */
export default async function TimelinePage({ params }: { params: { id: string } }) {
  const { t } = await getServerT();
  const user = await pageUser();
  if (!user) redirect("/login");
  const scope = await loadWorkScope(user.id);
  // authorize BEFORE fetching data: resolve the project's space and team first
  const project = await db.project
    .findUnique({ where: { id: params.id }, select: { workspaceId: true, teamId: true, name: true, workspace: { select: { name: true, organizationId: true } } } })
    .catch(() => null);
  // «كل واحد بيشوف مهامه بس»: the project must also be one the list rule offers them
  const offered = project && canSeeProject(scope, project) && (await db.project.count({ where: { id: params.id, AND: [projectVisibleWhere(scope)] } })) > 0;
  const inScope = offered ? await getProjectTimeline(params.id, user.id).catch(() => null) : null;
  const actor = inScope && project ? await requireActor() : null;
  if (actor && project) await keepInSpace(actor, project.workspaceId, `/projects/${params.id}/timeline`);
  if (!inScope || !project || !actor) return <div className="p-6 text-sm text-fg-muted">{t("timeline.not_found")}</div>;

  const v2 = await actorFeatureOn(actor, "navV2");
  const chrome = v2 ? await projectTabOffers(actor, params.id, await projectCardAccess(actor, { workspaceId: project.workspaceId, organizationId: project.workspace.organizationId })) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {chrome ? (
        <>
          <Breadcrumbs items={projectTrail({ spaceName: project.workspace.name, projectId: params.id, projectName: project.name }, t(projectTabLabelKey("timeline")))} />
          <ProjectTabs tabs={chrome.tabs} current="timeline" />
        </>
      ) : null}
      <TimelineGantt
        project={{
          id: inScope.project.id,
          name: inScope.project.name,
          startDate: inScope.project.startDate?.toISOString() ?? null,
          targetDate: inScope.project.targetDate?.toISOString() ?? null,
        }}
        tasks={inScope.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          start: task.start.toISOString(),
          end: task.end.toISOString(),
          done: task.done,
          priority: task.priority,
          assignee: task.assignee,
        }))}
        milestones={inScope.milestones.map((m) => ({
          id: m.id,
          name: m.name,
          date: m.date ? m.date.toISOString() : null,
          status: m.status,
        }))}
        undated={inScope.undated}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
