import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { pageUser } from "@/server/auth";
import { actorCanWork, requireActor } from "@/server/policy/actor";
import { SectionOffNotice } from "@/app/(app)/_access";
import { keepInSpace } from "@/server/services/current-space";
import { loadWorkScope, projectVisibleWhere } from "@/server/services/team-scope";
import { canWriteInWorkspace, isSpaceManager } from "@/server/workspace-role";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui/card";
import { BoardCreateButton } from "@/components/board-create-button";
import { MilestonesCard } from "@/components/milestones-card";
import { fmtDMY } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { getServerT } from "@/lib/i18n/server";
import { TimelineBadgeButton } from "@/components/timeline-badge-button";
import { ProjectTeamPicker } from "@/components/project-team-picker";
import { actorFeatureOn } from "@/server/services/features";
import { listMilestones } from "@/server/services/milestones";
import { rewardLensFor } from "@/server/services/rewards";
import { pinnedTasks } from "@/server/services/pinned";
import { PinnedStrip } from "@/components/rewards/pinned-strip";
import { fieldDefsOf, isPartnerIn } from "@/server/services/custom-fields";
import { ManageFields } from "@/components/custom-fields/manage-fields";
import { listRulesOf, ruleOptionsOf } from "@/server/services/task-rules";
import { RulesCard } from "@/components/task-rules/rules-card";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const { t } = getServerT();
  const user = await pageUser();
  if (!user) return null;
  // its space and its team: another team's project is «not found», like one that does not exist
  const scope = await loadWorkScope(user.id);
  const project = await db.project.findFirst({
    where: { id: params.id, AND: [projectVisibleWhere(scope)] },
    include: {
      boards: { where: { archived: false }, select: { id: true, name: true, _count: { select: { tasks: true } } } },
      _count: { select: { tasks: { where: { archived: false } } } },
      workspace: { select: { id: true, organizationId: true } },
    },
  });
  if (!project) notFound();
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  const actor = await requireActor();
  // the projects row of the person's grid
  if (!actorCanWork(actor, "projects.view")) return <SectionOffNotice />;
  await keepInSpace(actor, project.workspace.id, `/projects/${project.id}`);

  // «المعالم»: drawn only while the company's switch is on (off: nothing of it is offered, nothing is lost)
  const milestonesOn = await actorFeatureOn(actor, "milestones");
  // the same write rule the API applies: the real rank in the space, plus the projects row's «يضيف ويعدّل» box
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id, organizationId: project.workspace.organizationId, status: "ACTIVE" },
    select: { role: true },
  });
  const spaceRow = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspace.id, userId: user.id } },
    select: { role: true },
  });
  const canEditMilestones =
    milestonesOn &&
    membership != null &&
    canWriteInWorkspace(membership.role, spaceRow?.role) &&
    actorCanWork(actor, "projects.edit");
  const milestones = milestonesOn ? await listMilestones(project.id, actor.orgId) : [];

  // «حقول مخصصة»: «إدارة الحقول» is drawn while the company's switch is on and never for an external partner (no field is
  // theirs to read); the controls are the space's ADMIN's and the owner's (the server decides again on every request)
  const fieldsOn =
    (await actorFeatureOn(actor, "customFields")) &&
    !(await isPartnerIn({ orgId: actor.orgId, userId: user.id, orgRole: membership?.role ?? actor.role }, project.workspace.id));
  const canManageFields =
    fieldsOn &&
    membership != null &&
    (membership.role === "OWNER" || (membership.role !== "GUEST" && (spaceRow?.role === "ADMIN" || (membership.role === "ADMIN" && spaceRow != null)))) &&
    actorCanWork(actor, "projects.edit");
  const customFields = fieldsOn ? await fieldDefsOf(project.id, { archived: canManageFields }) : [];

  // «القواعد التلقائية»: the «القواعد» section is drawn while the company's switch is on and only for the people who define rules (the
  // space's ADMIN and the owner, and never an external partner); everybody else never gets a line of it, and the server decides again
  const rulesOn =
    (await actorFeatureOn(actor, "taskRules")) &&
    membership != null &&
    membership.role !== "GUEST" &&
    isSpaceManager(membership.role, spaceRow?.role) &&
    actorCanWork(actor, "projects.edit");
  const rules = rulesOn ? await listRulesOf(project.id) : [];
  const ruleOptions = rulesOn ? await ruleOptionsOf({ id: project.id, workspaceId: project.workspace.id, teamId: project.teamId }, actor.orgId) : null;

  // «مثبّتة»: the tasks pinned in this project, first thing on the page (while the company's switch is on)
  const lens = await rewardLensFor(actor, project.workspace.id);
  const pinned = await pinnedTasks(actor, { projectId: project.id }, lens);

  const doneColumnIds = await db.boardColumn.findMany({
    where: { board: { projectId: project.id }, done: true },
    select: { id: true },
  });
  const doneCount = doneColumnIds.length
    ? await db.task.count({ where: { projectId: project.id, archived: false, columnId: { in: doneColumnIds.map((c) => c.id) } } })
    : 0;
  const open = project._count.tasks;
  const pct = open + doneCount > 0 ? Math.round((doneCount / (open + doneCount)) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
          <TimelineBadgeButton projectId={project.id} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge>{enumLabel("ProjectStatus", project.status)}</Badge>
          <span>
            {[
              project.targetDate ? t("proj.dueLine", { date: fmtDMY(project.targetDate) }) : null,
              t("proj.progressLine", { open, done: doneCount, pct }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {project.description ? <p className="max-w-2xl text-sm text-fg-muted">{project.description}</p> : null}
        <ProjectTeamPicker projectId={project.id} workspaceId={project.workspace.id} teamId={project.teamId} />
      </header>

      <PinnedStrip tasks={pinned} />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{t("proj.boards")}</h2>
          <div className="flex items-center gap-2">
            {fieldsOn ? (
              <Link href={`/list?project=${project.id}`} className="text-xs text-accent hover:underline">
                {t("fields.list.open")}
              </Link>
            ) : null}
            {fieldsOn ? (
              <a href={`/api/projects/${project.id}/fields/csv`} download title={t("fields.export_hint")} data-fields-export className="text-xs text-accent hover:underline">
                {t("fields.export")}
              </a>
            ) : null}
            <BoardCreateButton projectId={project.id} />
          </div>
        </div>
        {project.boards.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("board.empty")}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {project.boards.map((b) => (
              <Link key={b.id} href={`/boards/${b.id}`}>
                <Card className="transition-colors hover:border-accent/40">
                  <CardBody className="py-3">
                    <p className="text-sm font-medium text-fg">{b.name}</p>
                    <p className="text-xs text-muted">{t("proj.tasksCount", { n: b._count.tasks })}</p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {fieldsOn ? <ManageFields projectId={project.id} initial={customFields} canEdit={canManageFields} /> : null}

      {rulesOn && ruleOptions ? <RulesCard projectId={project.id} initialRules={rules} options={ruleOptions} /> : null}

      {milestonesOn ? (
        <MilestonesCard
          projectId={project.id}
          canEdit={canEditMilestones}
          milestones={milestones.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            status: m.status,
            targetDate: m.targetDate ? m.targetDate.toISOString() : null,
            overdue: m.overdue,
            openTasks: m.openTasks,
          }))}
        />
      ) : null}
    </div>
  );
}
