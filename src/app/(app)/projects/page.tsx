import Link from "next/link";
import { Inbox } from "lucide-react";
import { actorCanWork } from "@/server/policy/actor";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, taskParticipantWhere } from "@/server/services/team-scope";
import { currentSpace } from "@/server/services/current-space";
import { isFeatureOn } from "@/server/services/features";
import { INSTANT_PROJECT_KEY } from "@/server/services/instant-work";
import { goHref } from "@/lib/space-link";
import { Card, CardBody } from "@/components/ui/card";
import { PROJECT_TONE, QuietEmpty, StateChip } from "@/components/work/look";
import { ProjectsToolbar } from "@/components/projects-toolbar";
import { WorkspaceMembersButton } from "@/components/workspace-members-button";
import { WorkspaceTeamsButton } from "@/components/workspace-teams-button";
import { fmtDMY } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { getServerT } from "@/lib/i18n/server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { workspace?: string };
}) {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  // the projects row of the person's grid (a guest works in their shared spaces by the space's rules)
  if (!actorCanWork(actor, "projects.view")) return <SectionOffNotice />;
  const space = await currentSpace(actor);
  const everything = await loadWorkScope(user.id);
  // an old link naming another space of theirs (`?workspace=`) enters that space first, then comes back here;
  // a space that is not theirs is ignored (it says nothing about it)
  const named = searchParams.workspace;
  if (named && space && named !== space.id && scopeSpaceIds(everything).includes(named)) redirect(goHref(named, "/projects"));
  // the projects of the space the person is in — and inside a space with «مقاطع» only its own and theirs
  const scope = narrowScope(everything, space?.id);
  const accessible = scopeSpaceIds(scope);
  if (accessible.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-[19px] font-bold text-fg">{t("nav.projects")}</h1>
          <ProjectsToolbar />
        </header>
        <QuietEmpty title={t("proj.noWorkspaces")} hint={t("proj.noWorkspacesHint")} />
      </div>
    );
  }
  // one space: the one the person is in (`accessible` holds it alone)
  const wsFilter: string | { in: string[] } = accessible.length === 1 ? (accessible[0] as string) : { in: accessible };
  const projects = await db.project.findMany({
    where: {
      workspaceId: typeof wsFilter === "string" ? wsFilter : { in: wsFilter.in },
      status: { not: "ARCHIVED" },
      AND: [projectVisibleWhere(scope)],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      systemKey: true,
      description: true,
      status: true,
      priority: true,
      targetDate: true,
      workspace: { select: { name: true } },
      _count: { select: { tasks: { where: { archived: false, AND: [taskParticipantWhere(everything)] } }, boards: true } },
    },
  });
  // «صندوق المهام» (W1.2, switch `workInbox`): the space's quick-task project is drawn once, pinned on top with its own icon, and is not
  // in the ordinary list again. Off: it is an ordinary card, as it was.
  const inboxes = (await isFeatureOn(actor.orgId, "workInbox")) ? projects.filter((p) => p.systemKey === INSTANT_PROJECT_KEY) : [];
  const ordinary = inboxes.length > 0 ? projects.filter((p) => p.systemKey !== INSTANT_PROJECT_KEY) : projects;
  const wsInfo =
    typeof wsFilter === "string"
      ? await db.workspace.findUnique({ where: { id: wsFilter }, select: { name: true, description: true } })
      : null;
  const wsName = wsInfo?.name ?? "";
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-[19px] font-bold text-fg">
          {t("nav.projects")}
          {wsName ? <span className="text-sm font-normal text-fg-muted"> · {wsName}</span> : null}
        </h1>
        <div className="flex items-center gap-2">
          {wsInfo ? (
            <>
              {/* «تعديل المساحة» and «أعضاء المساحة» moved to «الإدارة» > «المساحة» for whoever manages the space
                  (2026-10-30); the people list stays here, read-only, for everybody else in it (it was never taken away) */}
              {space?.manager ? null : <WorkspaceMembersButton workspaceId={wsFilter as string} />}
              <WorkspaceTeamsButton workspaceId={wsFilter as string} />
            </>
          ) : null}
          <ProjectsToolbar />
        </div>
      </header>
      {inboxes.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} data-work-inbox="pinned" className="block">
          <Card className="rounded-2xl border-0 bg-accent/10 transition-shadow hover:shadow-card-hover">
            <CardBody className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-1 text-accent">
                <Inbox className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] font-bold text-fg">{p.name === t("instant.project") ? t("work.inbox.name") : p.name}</p>
                <p className="mt-0.5 text-[13px] text-fg-muted">
                  {t("work.inbox.hint")}
                  {inboxes.length > 1 ? ` · ${p.workspace.name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StateChip tone="accent">{t("work.inbox.pinned")}</StateChip>
                <span className="text-[13px] text-fg-muted">{t("work.inbox.line", { tasks: p._count.tasks })}</span>
              </div>
            </CardBody>
          </Card>
        </Link>
      ))}
      {ordinary.length === 0 ? (
        <QuietEmpty title={t("proj.emptyTitle")} hint={t("proj.emptyHint")} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-3">
          {ordinary.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block">
              <Card className="rounded-2xl border-0 transition-shadow hover:shadow-card-hover">
                <CardBody className="px-3.5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[15.5px] font-bold text-fg">{p.name}</p>
                    <StateChip tone={PROJECT_TONE[p.status] ?? "neutral"} className="shrink-0">
                      {enumLabel("ProjectStatus", p.status)}
                    </StateChip>
                  </div>
                  {p.description ? (
                    <p className="mt-1 line-clamp-2 text-[13px] text-fg-muted">{p.description}</p>
                  ) : null}
                  <p className="mt-2 text-[13px] text-fg-muted">
                    {t("proj.cardLine", { tasks: p._count.tasks, boards: p._count.boards })}
                    {p.targetDate ? ` · ${t("proj.dueLine", { date: fmtDMY(p.targetDate) })}` : ""}
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
