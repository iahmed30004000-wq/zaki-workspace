import { cloneElement, type ComponentProps, type ReactElement } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { actorCanWork, type Actor } from "@/server/policy/actor";
import type { CurrentUser } from "@/server/auth";
import { SectionOffNotice } from "@/app/(app)/_access";
import BoardPage from "@/app/(app)/boards/[id]/page";
import { keepInSpace } from "@/server/services/current-space";
import { loadWorkScope, projectVisibleWhere, taskVisibleWhere } from "@/server/services/team-scope";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui/card";
import { BoardCreateButton } from "@/components/board-create-button";
import { MilestonesCard } from "@/components/milestones-card";
import { ProjectTeamPicker } from "@/components/project-team-picker";
import { BoardView } from "@/components/board-view";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { fmtDMY } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { getServerT } from "@/lib/i18n/server";
import { listMilestones } from "@/server/services/milestones";
import { rewardLensFor } from "@/server/services/rewards";
import { pinnedTasks } from "@/server/services/pinned";
import { PinnedStrip } from "@/components/rewards/pinned-strip";
import { fieldDefsOf } from "@/server/services/custom-fields";
import { ManageFields } from "@/components/custom-fields/manage-fields";
import { listRulesOf, ruleOptionsOf } from "@/server/services/task-rules";
import { RulesCard } from "@/components/task-rules/rules-card";
import { workScreenFor } from "@/server/services/my-work";
import { projectTrail } from "@/components/work/project/crumbs";
import { BoardPicker } from "@/components/work/project/board-picker";
import { ProjectTabs } from "@/components/work/project/project-tabs";
import { ProjectTasksView } from "@/components/work/project/project-tasks-view";
import { parseBoardParam, parseProjectTab, projectTabHref, projectTabLabelKey, projectTasksParams, projectTasksQuery } from "@/components/work/project/tabs";
import { hasFieldsTab, projectCardAccess, projectTabOffers } from "./project-chrome";

type Query = Record<string, string | string[] | undefined>;

/**
 * W1.5 - the project page on the new map (switch `navV2`): the trail «المساحة › المشروع»; the title with its status and progress; then ONE strip of tabs -
 * «اللوحة» (the default; a picker when the project has several boards) · «القائمة» · «التقويم» (W1.1's views with the scope «مشروع») · «الجدول الزمني» (its own
 * page, which wears the same strip) · «الحقول والقواعد» (custom fields, rules, milestones: the old cards) · «الإعدادات» (the team, the boards).
 *
 * The old page showed all of it at once, in one long column. The rule did not move: another team's project is «not found», the grid's «المشاريع» row gates
 * the page, and every card the page counts or lists goes through `taskVisibleWhere` (P0.2). A tab that would be a dead end is not offered (the fields tab
 * only when one of its cards exists for the person), and an address that names one anyway lands on the board.
 */
export async function ProjectPageV2({ params, searchParams, user, actor }: { params: { id: string }; searchParams: Query; user: CurrentUser; actor: Actor }) {
  const { t } = getServerT();
  const scope = await loadWorkScope(user.id);
  const visible = taskVisibleWhere(scope);
  const project = await db.project.findFirst({
    where: { id: params.id, AND: [projectVisibleWhere(scope)] },
    include: {
      // what is counted is what the person may open: a private task of somebody else is not (P0)
      boards: { where: { archived: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, _count: { select: { tasks: { where: { archived: false, AND: [visible] } } } } } },
      _count: { select: { tasks: { where: { archived: false, AND: [visible] } } } },
      workspace: { select: { id: true, name: true, organizationId: true } },
    },
  });
  if (!project) notFound();
  // the projects row of the person's grid
  if (!actorCanWork(actor, "projects.view")) return <SectionOffNotice />;
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  await keepInSpace(actor, project.workspace.id, `/projects/${project.id}`);

  const access = await projectCardAccess(actor, { workspaceId: project.workspace.id, organizationId: project.workspace.organizationId });
  const { tabs, embeddedViews } = await projectTabOffers(actor, project.id, access);
  const asked = parseProjectTab(searchParams?.["tab"]);
  // a tab that is not a page of its own here: the old pages for «القائمة» / «التقويم» when «مهامي» is off, the board when the fields tab is not offered
  if (!embeddedViews && (asked === "list" || asked === "calendar")) redirect(tabs.find((o) => o.tab === asked)?.href ?? projectTabHref(project.id, "board"));
  if (asked === "timeline") redirect(projectTabHref(project.id, "timeline"));
  const tab = asked === "fields" && !hasFieldsTab(access) ? "board" : asked;

  const doneColumns = await db.boardColumn.findMany({ where: { board: { projectId: project.id }, done: true }, select: { id: true } });
  const doneCount = doneColumns.length ? await db.task.count({ where: { projectId: project.id, archived: false, columnId: { in: doneColumns.map((c) => c.id) }, AND: [visible] } }) : 0;
  const open = project._count.tasks;
  const pct = open + doneCount > 0 ? Math.round((doneCount / (open + doneCount)) * 100) : 0;

  const places = { spaceName: project.workspace.name, projectId: project.id, projectName: project.name };
  const boardAsked = parseBoardParam(searchParams?.["board"]);
  const board = project.boards.find((b) => b.id === boardAsked) ?? project.boards[0] ?? null;
  const leaf = tab === "board" ? (project.boards.length > 1 && board ? board.name : null) : t(projectTabLabelKey(tab));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-project-page={tab}>
      <Breadcrumbs items={projectTrail(places, leaf)} />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge>{enumLabel("ProjectStatus", project.status)}</Badge>
          <span>
            {[project.targetDate ? t("proj.dueLine", { date: fmtDMY(project.targetDate) }) : null, t("proj.progressLine", { open, done: doneCount, pct })].filter(Boolean).join(" · ")}
          </span>
        </div>
        {project.description ? <p className="max-w-2xl text-sm text-fg-muted">{project.description}</p> : null}
      </header>

      <ProjectTabs tabs={tabs} current={tab} />

      {tab === "board" ? (
        <section className="space-y-3">
          {board ? (
            <>
              <BoardPicker projectId={project.id} boards={project.boards.map((b) => ({ id: b.id, name: b.name, tasks: b._count.tasks }))} currentId={board.id} />
              {await embeddedBoard({ actor, boardId: board.id, projectId: project.id, workspaceId: project.workspace.id, panel: embeddedViews })}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-fg-muted">{t("board.empty")}</p>
              <BoardCreateButton projectId={project.id} />
            </div>
          )}
        </section>
      ) : null}

      {tab === "list" || tab === "calendar" ? await tasksTab(actor, project.id, tab, searchParams ?? {}) : null}

      {tab === "fields" ? await fieldsTab(actor, project, access) : null}

      {tab === "settings" ? (
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-fg">{t("projpage.settings.team")}</h2>
            </CardHeader>
            <CardBody className="space-y-2">
              <p className="text-xs text-fg-muted">{t("projpage.settings.team_hint")}</p>
              <ProjectTeamPicker projectId={project.id} workspaceId={project.workspace.id} teamId={project.teamId} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-fg">{t("projpage.settings.boards")}</h2>
                <BoardCreateButton projectId={project.id} />
              </div>
            </CardHeader>
            <CardBody>
              {project.boards.length === 0 ? (
                <p className="text-sm text-fg-muted">{t("board.empty")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {project.boards.map((b, index) => (
                    <li key={b.id}>
                      <Link href={projectTabHref(project.id, "board", { boardId: index === 0 ? null : b.id })} className="flex min-h-11 items-center justify-between gap-2 text-sm text-fg hover:text-accent">
                        <span className="min-w-0 truncate">{b.name}</span>
                        <span className="shrink-0 text-xs text-muted">{t("proj.tasksCount", { n: b._count.tasks })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The board of the «اللوحة» tab: the board page's OWN screen (one builder, so the cards, the field chips and the visibility rule are the page's), dressed for
 * the tab - without its project line and its trail (the page above says both). A board the page answers with its notice (the grid's row is off) is drawn as that.
 */
async function embeddedBoard({ actor, boardId, projectId, workspaceId, panel }: { actor: Actor; boardId: string; projectId: string; workspaceId: string; panel: boolean }) {
  const screen = (await BoardPage({ params: { id: boardId } })) as ReactElement<ComponentProps<typeof BoardView>> | null;
  if (!screen || screen.type !== BoardView) return screen;
  const lens = await rewardLensFor(actor, workspaceId);
  const pinned = await pinnedTasks(actor, { projectId }, lens);
  return (
    <>
      <PinnedStrip tasks={pinned} />
      <div className="min-h-[32rem] overflow-hidden rounded-xl border border-border">{cloneElement(screen, { view: { crumbs: null, panel, embedded: true } })}</div>
    </>
  );
}

/** «القائمة» / «التقويم»: W1.1's views, scope «مشروع», the first answer drawn here (every row through `taskVisibleWhere` in `workScreenFor`). */
async function tasksTab(actor: Actor, projectId: string, tab: "list" | "calendar", query: Query) {
  const requested = projectTasksParams(query, projectId, tab);
  const now = new Date();
  const initial = await workScreenFor(actor, requested, now);
  const dataQuery = projectTasksQuery(requested);
  // `key`: an address the screen did not make itself is a NEW screen, not a stale one
  return <ProjectTasksView key={`${tab}${dataQuery}`} projectId={projectId} tab={tab} requested={requested} initial={initial} initialQuery={dataQuery} initialAt={now.getTime()} />;
}

/** «الحقول والقواعد»: the three cards the old page stacked under the boards - custom fields, rules, milestones - each only while it exists for this person. */
async function fieldsTab(
  actor: Actor,
  project: { id: string; teamId: string | null; workspace: { id: string } },
  access: Awaited<ReturnType<typeof projectCardAccess>>,
) {
  const { t } = getServerT();
  const customFields = access.fieldsOn ? await fieldDefsOf(project.id, { archived: access.canManageFields }) : [];
  const rules = access.rulesOn ? await listRulesOf(project.id) : [];
  const ruleOptions = access.rulesOn ? await ruleOptionsOf({ id: project.id, workspaceId: project.workspace.id, teamId: project.teamId }, actor.orgId) : null;
  const milestones = access.milestonesOn ? await listMilestones(project.id, actor.orgId, actor.userId) : [];
  return (
    <section className="space-y-5">
      {access.fieldsOn ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <a href={`/api/projects/${project.id}/fields/csv`} download title={t("fields.export_hint")} data-fields-export className="text-xs text-accent hover:underline">
            {t("fields.export")}
          </a>
        </div>
      ) : null}
      {access.fieldsOn ? <ManageFields projectId={project.id} initial={customFields} canEdit={access.canManageFields} /> : null}
      {access.rulesOn && ruleOptions ? <RulesCard projectId={project.id} initialRules={rules} options={ruleOptions} /> : null}
      {access.milestonesOn ? (
        <MilestonesCard
          projectId={project.id}
          canEdit={access.canEditMilestones}
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
    </section>
  );
}
