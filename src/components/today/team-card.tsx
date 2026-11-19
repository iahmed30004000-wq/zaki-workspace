import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import type { TeamScopeChip, TodayTeamData } from "@/lib/today";
import { cn } from "@/lib/utils";

/** What the numbers were counted over, in words (every number on the card is over this and nothing else). */
export function scopeLabel(scope: TeamScopeChip): string {
  const { t } = getServerT();
  if (scope.kind === "space") return t("today.team.scope_space", { name: scope.name ?? "" });
  return scope.kind === "company" ? t("today.team.scope_company") : t("today.team.scope_spaces");
}

/**
 * «الفريق» — the ONE team card of the simplified «اليوم» (W1.7). It replaces three: the old «نبض الفريق», the smart cards' «الفريق هالأسبوع»
 * strip and (as a card) the owner's whole panel, which is «لوحة التحكم» at /owner (this card links to it when the person may open it).
 * The numbers are the services' own, unchanged: open and overdue tasks and the most overdue ones with who holds them (`getToday`'s pulse),
 * finished this week, due today and how many people are late (`getTodayDashboard`'s team). The scope chip is always visible, because
 * the card is for the owner and whoever manages people and each of them may be counting a different part of the company.
 *
 * ⚠️ The list of the most overdue tasks names people who still work here: 🔧 a suspended or offboarded person is never named (the service leaves
 * them out); the counts keep their work, as the reports do.
 */
export function TodayTeamCard({ team, panelHref }: { team: TodayTeamData; panelHref: string | null }) {
  const { t } = getServerT();
  const stats = [
    { n: team.open, label: t("today.team.open"), danger: false },
    { n: team.overdue, label: t("mywork.tab.overdue"), danger: team.overdue > 0 },
    { n: team.dueToday, label: t("today.team.today"), danger: false },
    { n: team.doneWeek, label: t("today.team.done"), danger: false },
    { n: team.peopleLate, label: t("today.team.late_people"), danger: team.peopleLate > 0 },
  ];
  return (
    <section aria-labelledby="today-team-title" className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="today-team-title" className="text-base font-semibold text-fg">
          {t("today.team.title")}
        </h2>
        <span data-today-scope={team.scope.kind} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-muted">
          <bdi>{scopeLabel(team.scope)}</bdi>
        </span>
        {panelHref ? (
          <Link href={panelHref} prefetch={false} className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
            {t("today.team.panel")}
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        {stats.map((s) => (
          <p key={s.label} className="flex items-baseline gap-2">
            <span className={cn("text-2xl font-bold", s.danger ? "text-danger" : "text-fg")}>{fmtNumber(s.n)}</span>
            <span className="text-sm text-fg-muted">{s.label}</span>
          </p>
        ))}
      </div>

      {team.worst.length > 0 ? (
        <details className="group mt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-sans text-xs font-semibold text-fg-muted">
            {t("today.team.worst")}
            <span className="text-fg-muted">({fmtNumber(team.worst.length)})</span>
          </summary>
          <ul role="list" className="divide-y divide-border">
            {team.worst.map((row) => (
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
        </details>
      ) : null}
    </section>
  );
}
