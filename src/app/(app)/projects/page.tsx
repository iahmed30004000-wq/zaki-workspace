import { orgTimeZone } from "@/server/services/org-day";
import { fmtStamp } from "@/lib/work/stamp";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { actorCanWork } from "@/server/policy/actor";
import { redirect } from "next/navigation";

import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { loadWorkScope, narrowScope, scopeSpaceIds } from "@/server/services/team-scope";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { projectsScreenFor } from "@/server/services/work-app";

import { goHref } from "@/lib/space-link";
import { Card, CardBody } from "@/components/ui/card";
import { PROJECT_TONE, QuietEmpty, StateChip } from "@/components/work/look";
import { ProjectsToolbar } from "@/components/projects-toolbar";
import { WorkspaceMembersButton } from "@/components/workspace-members-button";
import { WorkspaceTeamsButton } from "@/components/workspace-teams-button";
import { SettingsLink } from "@/components/space-settings/settings-link";
import { settingsHref } from "@/components/space-settings/tabs";
import { fmtDMY } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { getServerT } from "@/lib/i18n/server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { workspace?: string; sort?: string };
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
  // the projects of the space the person is in — and inside a space with «مقاطع» only its own and theirs. M2 N3: read by
  // `projectsScreenFor`, the same function the phone's door `GET /api/work/projects` answers with, so the two cannot drift
  const screen = await projectsScreenFor(actor, searchParams.sort === "created" ? { sort: "created" } : {});
  if (screen.kind !== "ok") return <SectionOffNotice />;
  const accessible = scopeSpaceIds(narrowScope(everything, space?.id));
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
  // «صندوق المهام» (W1.2, switch `workInbox`): the space's quick-task project is drawn once, pinned on top with its own icon, and is not
  // in the ordinary list again. Off: it is an ordinary card, as it was.
  const { inboxes, projects: ordinary } = screen.data;
  const wsInfo = screen.data.space;
  const wsFilter = wsInfo?.id ?? "";
  const wsName = wsInfo?.name ?? "";
  const byCreated = searchParams.sort === "created";
  const zone = await orgTimeZone(actor.orgId);
  // who made each project and when: the names are read once by `projectsScreenFor`
  const createdLine = (p: { createdAt: string; createdByName: string | null }) => {
    const when = fmtStamp(p.createdAt, zone);
    return p.createdByName ? t("task.created_line", { name: p.createdByName, when }) : t("task.created_at", { when });
  };
  const sortLink = (on: boolean) => `rounded-full px-3 py-1.5 text-[13px] ${on ? "bg-accent/15 font-semibold text-accent" : "text-fg-muted hover:bg-surface-2"}`;
  // A2.2: with the switch `controlPanelV2` ON the buttons of the space (its people, its «المقاطع») are links to the space's ONE settings page; an external partner
  // is not offered that page and keeps the dialogs
  const settingsPage = !actor.isExternal && (await actorFeatureOn(actor, "controlPanelV2"));
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-[19px] font-bold text-fg">
          {t("nav.projects")}
          {wsName ? <span className="text-sm font-normal text-fg-muted"> · {wsName}</span> : null}
        </h1>
        <div className="flex items-center gap-2">
          {wsInfo && settingsPage ? (
            <>
              {space?.manager ? (
                <SettingsLink href={settingsHref(wsFilter as string)} label={t("spset.open")} icon="general" />
              ) : (
                <SettingsLink href={settingsHref(wsFilter as string, "people")} label={t("ws.members")} icon="people" />
              )}
              <SettingsLink href={settingsHref(wsFilter as string, "teams")} label={t("spaceteams.title")} icon="teams" />
            </>
          ) : wsInfo ? (
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
                  {inboxes.length > 1 ? ` · ${p.workspaceName}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StateChip tone="accent">{t("work.inbox.pinned")}</StateChip>
                <span className="text-[13px] text-fg-muted">{t("work.inbox.line", { tasks: p.tasks })}</span>
              </div>
            </CardBody>
          </Card>
        </Link>
      ))}
      {ordinary.length > 1 ? (
        <nav aria-label={t("mytasks.sort.label")} className="flex items-center gap-1">
          <Link href="/projects" aria-current={byCreated ? undefined : "true"} className={sortLink(!byCreated)}>
            {t("proj.sort.updated")}
          </Link>
          <Link href="/projects?sort=created" aria-current={byCreated ? "true" : undefined} className={sortLink(byCreated)}>
            {t("mytasks.sort.created")}
          </Link>
        </nav>
      ) : null}
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
                    {t("proj.cardLine", { tasks: p.tasks, boards: p.boards })}
                    {p.targetDate ? ` · ${t("proj.dueLine", { date: fmtDMY(p.targetDate) })}` : ""}
                  </p>
                  <p data-project-created className="mt-1 text-xs text-fg-muted">
                    {createdLine(p)}
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
