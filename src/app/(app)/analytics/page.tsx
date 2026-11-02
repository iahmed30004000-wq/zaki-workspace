import { redirect } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorFeatureOn } from "@/server/services/features";
import { actorCan } from "@/server/policy/actor";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { getServerT } from "@/lib/i18n/server";
import { loadWorkScope, narrowScope, scopeSpaceIds } from "@/server/services/team-scope";
import { loadAnalytics } from "@/server/services/analytics";
import { ideaPlaceWhere } from "@/server/services/ideas";
import { fmtNumber } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { currentSpace } from "@/server/services/current-space";
import type { TaskPriority, IdeaStatus } from "@prisma/client";

export default async function AnalyticsPage() {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  // Company numbers: the idea funnel, the staff names with their workload. Not for an external partner,
  // whatever their tab shows; for the team, the reports box of the person's grid (a lead's and up by default).
  if (refusedToGuest(actor, "reports")) return <GuestNotice />;
  if (!actorCan(actor, "reports.view")) return <SectionOffNotice />;
  // «لوحة التحكم»: for the OWNER rank «التقارير» is a section of the panel while the panel (and the board under it) is on; the page stays as it
  // was for everybody else and for the owner when a switch is off
  if (actor.isOwner && (await actorFeatureOn(actor, "controlPanel")) && (await actorFeatureOn(actor, "ownerBoard"))) redirect("/owner?v=reports");
  // numbers for the active org (oldest ACTIVE membership), over the workspaces the user can open
  // …inside the space they are in (src/server/services/current-space.ts)
  const teams = narrowScope(await loadWorkScope(user.id), (await currentSpace(actor))?.id);
  // the space's ideas (and in «الشركة» the shared ones)
  const here = await currentSpace(actor);
  const data = await loadAnalytics(actor.orgId, scopeSpaceIds(teams), undefined, teams, {
    AND: [ideaPlaceWhere({ spaceId: here?.id ?? null, isHq: here?.kind === "HQ" })],
  });
  const byPriority = new Map(data.byPriority.map((row) => [row.priority, row._count._all]));
  const byStatus = new Map(data.byStatus30.map((row) => [row.status, row._count._all]));
  const maxWorkload = Math.max(1, ...data.assignees.map((a) => a._count._all));
const priorities: TaskPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"];
  const maxPriority = Math.max(1, ...priorities.map((p) => byPriority.get(p) ?? 0));
const ideaStatuses: IdeaStatus[] = ["NEW", "UNDER_REVIEW", "PLANNING", "LAUNCHED", "REJECTED"];
  const maxIdea = Math.max(1, ...ideaStatuses.map((s) => byStatus.get(s) ?? 0));
  const rate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t("analytics.title")}</h1>
        <p className="text-xs text-muted">{t("analytics.subtitle")}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("analytics.totalTasks")} value={data.total} hint={t("analytics.totalTasksHint")} />
        <StatCard label={t("analytics.openTasks")} value={data.open} />
        <StatCard label={t("analytics.completed")} value={data.completed} hint={t("analytics.completionRate", { rate: rate ?? 0 })} />
        <StatCard
          label={t("analytics.overdue")}
          value={data.overdue}
          tone={data.overdue > 0 ? "warn" : "good"}
          hint={data.overdue > 0 ? t("analytics.overdueNote") : t("analytics.allGood")}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={t("analytics.created30")} value={data.created30} />
        <StatCard label={t("analytics.completed30")} value={data.completed30} />
        <StatCard label={t("analytics.upcoming7")} value={data.upcoming7} />
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="mb-3 text-sm font-semibold">{t("analytics.openByPriority")}</h2>
        <div className="space-y-2">
          {priorities.map((p) => {
            const count = byPriority.get(p) ?? 0;
            return <BarRow key={p} label={enumLabel("TaskPriority", p)} count={count} pct={(count / maxPriority) * 100} barClass="bg-accent" />;
          })}
          {data.open === 0 ? <p className="text-xs text-muted">{t("analytics.noOpen")}</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="mb-3 text-sm font-semibold">{t("analytics.workload")}</h2>
        <div className="space-y-2">
          {data.assignees.map((a) => (
            <BarRow
              key={a.assigneeId}
              label={data.nameOf.get(a.assigneeId!) ?? "—"}
              count={a._count._all}
              pct={(a._count._all / maxWorkload) * 100}
              barClass="bg-ok"
            />
          ))}
          {data.assignees.length === 0 ? <p className="text-xs text-muted">{t("analytics.noWorkload")}</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="mb-3 text-sm font-semibold">
          {t("analytics.ideasFunnel")}
          <span className="ms-2 text-xs font-normal text-muted">{t("analytics.ideasTotal", { total: data.ideas })}</span>
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {ideaStatuses.map((status) => {
            const count = byStatus.get(status) ?? 0;
            return (
              <div key={status} className="rounded-lg border border-border p-2 text-center">
                <div className="text-lg font-semibold">{count}</div>
                <div className="text-xs text-muted">{enumLabel("IdeaStatus", status)}</div>
                <div className="mt-1 h-1 rounded bg-surface-2">
                  <div className="h-1 rounded bg-info" style={{ width: `${(count / maxIdea) * 100}%` }} />
                </div>
              </div>
            );
          })}
          {data.ideas === 0 ? <p className="col-span-4 text-xs text-muted">{t("analytics.noIdeas")}</p> : null}
        </div>
      </section>

      <footer className="flex flex-wrap gap-4 text-xs text-muted">
        <span>{t("analytics.statWorkspaces", { n: data.workspaces })}</span>
        <span>{t("analytics.statProjects", { n: data.projects })}</span>
        <span>{t("analytics.formulaNote")}</span>
      </footer>
    </div>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" | "good" }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-danger" : tone === "good" ? "text-ok" : ""}`}>
        {fmtNumber(value)}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function BarRow({ label, count, pct, barClass }: { label: string; count: number; pct: number; barClass: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-xs">{label}</span>
      <div className="flex-1">
        <div className="h-2 rounded bg-surface-2">
          <div className={`h-2 rounded ${barClass}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="w-8 text-end text-xs font-medium">{count}</span>
    </div>
  );
}

export const dynamic = "force-dynamic";
