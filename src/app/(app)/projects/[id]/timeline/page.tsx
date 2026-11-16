import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { pageUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { keepInSpace } from "@/server/services/current-space";
import { canSeeProject, loadWorkScope } from "@/server/services/team-scope";
import { getProjectTimeline } from "@/server/services/timeline";
import { TimelineGantt } from "@/components/timeline-gantt";
import { getServerT } from "@/lib/i18n/server";

/** Per-project timeline (Microsoft-Project-style Gantt), workspace-scoped. */
export default async function TimelinePage({ params }: { params: { id: string } }) {
  const { t } = await getServerT();
  const user = await pageUser();
  if (!user) redirect("/login");
  const scope = await loadWorkScope(user.id);
  // authorize BEFORE fetching data: resolve the project's space and team first
  const project = await db.project
    .findUnique({ where: { id: params.id }, select: { workspaceId: true, teamId: true } })
    .catch(() => null);
  const inScope = project && canSeeProject(scope, project) ? await getProjectTimeline(params.id, user.id).catch(() => null) : null;
  if (inScope && project) await keepInSpace(await requireActor(), project.workspaceId, `/projects/${params.id}/timeline`);
  if (!inScope) return <div className="p-6 text-sm text-fg-muted">{t("timeline.not_found")}</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
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
