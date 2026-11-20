import Link from "next/link";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import type { TodayPulse } from "@/lib/today";
import type { TeamScopeInfo } from "@/server/policy/people-scope";
import { ScopeChip } from "@/components/today/scope-chip";
import { cn } from "@/lib/utils";

/**
 * «نبض الفريق»: how the company's work stands, for the owner and whoever manages people - the open tasks, the
 * overdue ones, and the few that are the most overdue, each with who holds it and a link to the task.
 *
 * The numbers are over the spaces this person can open (the service decides which), never a decoration behind
 * them. Only what is late is drawn in the danger colour; when nothing is late the card says so calmly instead of
 * showing an empty list. A person who is no longer active is never in the list (the service leaves them out).
 */
export function TeamPulse({ pulse }: { pulse: TodayPulse & { scope?: TeamScopeInfo } }) {
  const { t } = getServerT();
  return (
    <section aria-labelledby="today-pulse-title" className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <h2 id="today-pulse-title" className="text-base font-semibold text-fg">
        {t("today.pulse.title")}
      </h2>
      {/* A2.3: every KPI says what it counted. The service names its scope; without one (an old caller) the card keeps its general sentence */}
      {pulse.scope ? <ScopeChip info={pulse.scope} /> : <p className="text-xs leading-5 text-fg-muted">{t("today.pulse.scope")}</p>}

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <p className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-fg">{fmtNumber(pulse.open)}</span>
          <span className="text-sm text-fg-muted">{t("today.pulse.open")}</span>
        </p>
        <p className="flex items-baseline gap-2">
          <span className={cn("text-2xl font-bold", pulse.overdue > 0 ? "text-danger" : "text-fg")}>{fmtNumber(pulse.overdue)}</span>
          <span className="text-sm text-fg-muted">{t("mywork.tab.overdue")}</span>
        </p>
      </div>

      {pulse.worst.length > 0 ? (
        <div className="mt-3">
          <h3 className="font-sans text-xs font-semibold text-fg-muted">{t("today.pulse.worst")}</h3>
          <ul role="list" className="mt-1 divide-y divide-border">
            {pulse.worst.map((row) => (
              <li key={row.id}>
                <Link href={`/tasks/${row.id}`} prefetch={false} className="flex min-h-14 flex-col justify-center gap-0.5 rounded-lg px-1 py-2 transition-colors hover:bg-surface-2">
                  <span className="line-clamp-2 break-words text-sm font-medium leading-6 text-fg">
                    <bdi>{row.title}</bdi>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-fg-muted">
                    <span className="min-w-0 max-w-full truncate">
                      <bdi>{row.assigneeName}</bdi>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="min-w-0 max-w-full truncate">
                      <bdi>{row.projectName}</bdi>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-danger">{row.dueLabel}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : pulse.overdue === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{t("analytics.allGood")}</p>
      ) : null}
    </section>
  );
}
