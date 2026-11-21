import Link from "next/link";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import type { DashboardMine, DashboardTeam, TodayDashboard as TodayDashboardData } from "@/lib/today";
import type { TeamScopeInfo } from "@/server/policy/people-scope";
import { ScopeChip } from "@/components/today/scope-chip";
import { cn } from "@/lib/utils";

/**
 * The smart cards of «اليوم»: a few numbers, each with its meaning beside it in a short Arabic label, and a
 * progress ring for the week. Every number is computed by the service (`getTodayDashboard`) over what the
 * person may already see; this file only draws it and decides nothing.
 *
 *  - «إنجازي هالأسبوع»: a ring (finished of the week's work). A week with no work shows an empty ring and says so.
 *  - «مهام متأخرة» · «مستحقة اليوم» · «مهامي المفتوحة»: links to the person's own task tabs; only a late number is
 *    drawn in the danger colour.
 *  - «رسائل بانتظارك»: the chat's own unread count, a link to the chat.
 *  - «الفريق هالأسبوع»: for the owner and whoever manages people (the service gives it to nobody else): counts
 *    only, no name, no customer, no price.
 *
 * ⚠️ The motion is decoration only: the ring fills and the cards rise, in CSS (`animate-ring-fill`, `animate-rise`),
 *    and only behind `motion-safe:`; with reduced motion the final picture is simply there. The numbers are text
 *    in the page from the first byte, never drawn by the animation, and never over a picture.
 * 🔧 Nothing here needs script, and a person who turned animation off loses nothing.
 */

const CARD = "flex min-w-0 grow basis-36 flex-col justify-between gap-1 rounded-card border border-border bg-surface-1 p-4 shadow-card motion-safe:animate-rise";
const LINK_CARD = cn(CARD, "transition-colors hover:bg-surface-2");

/** The cards rise one after the other (a step of 70ms), never longer than half a second in all. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 6) * 70}ms` });

/** The progress ring: a track and an arc of `percent` of it (`pathLength` 100, so the arc's length is the percent). */
function Ring({ percent }: { percent: number | null }) {
  const shown = percent ?? 0;
  return (
    <span className="relative inline-flex size-20 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden="true" focusable="false">
        <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className="stroke-border" />
        {shown > 0 ? (
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 - shown}
            className="stroke-accent motion-safe:animate-ring-fill"
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-fg">{percent === null ? "–" : `${fmtNumber(percent)}٪`}</span>
    </span>
  );
}

function Stat({ value, label, tone, index, href }: { value: number; label: string; tone?: "danger" | "info"; index: number; href: string }) {
  return (
    <Link href={href} prefetch={false} className={cn(LINK_CARD, "min-h-24")} style={stagger(index)}>
      <span className={cn("text-3xl font-bold leading-none", tone === "danger" ? "text-danger" : tone === "info" ? "text-info" : "text-fg")}>{fmtNumber(value)}</span>
      <span className="text-sm leading-5 text-fg-muted">{label}</span>
    </Link>
  );
}

function WeekRing({ mine }: { mine: DashboardMine }) {
  const { t } = getServerT();
  return (
    <section aria-labelledby="today-dash-week" className={cn(CARD, "basis-64 flex-row items-center justify-start gap-4")} style={stagger(0)}>
      <Ring percent={mine.percent} />
      <div className="min-w-0">
        <h3 id="today-dash-week" className="text-sm font-semibold text-fg">
          {t("today.dash.week")}
        </h3>
        <p className="text-sm leading-6 text-fg-muted">
          {mine.percent === null ? t("today.dash.week_none") : t("today.dash.week_of", { done: fmtNumber(mine.doneWeek), total: fmtNumber(mine.weekTotal) })}
        </p>
      </div>
    </section>
  );
}

function TeamStrip({ team }: { team: DashboardTeam & { scope?: TeamScopeInfo } }) {
  const { t } = getServerT();
  const stats = [
    { n: team.doneWeek, label: t("today.dash.team_done"), danger: false },
    { n: team.dueToday, label: t("today.dash.team_today"), danger: false },
    { n: team.peopleLate, label: t("today.dash.team_late"), danger: team.peopleLate > 0 },
  ];
  return (
    <section aria-labelledby="today-dash-team" className="rounded-card border border-border bg-surface-1 p-4 shadow-card motion-safe:animate-rise" style={stagger(5)}>
      <h3 id="today-dash-team" className="text-sm font-semibold text-fg">
        {t("today.dash.team")}
      </h3>
      {/* A2.3: every KPI says what it counted; without a scope from the service (an old caller) the strip keeps its general sentence */}
      {team.scope ? <ScopeChip info={team.scope} /> : <p className="text-xs leading-5 text-fg-muted">{t("today.dash.team_scope")}</p>}
      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
        {stats.map((s) => (
          <p key={s.label} className="flex items-baseline gap-2">
            <span className={cn("text-2xl font-bold", s.danger ? "text-danger" : "text-fg")}>{fmtNumber(s.n)}</span>
            <span className="text-sm text-fg-muted">{s.label}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

export function TodayDashboard({ data }: { data: TodayDashboardData | null }) {
  const { t } = getServerT();
  if (!data) return null;
  const { mine, unreadChat, team } = data;
  let at = 1;
  return (
    <section aria-labelledby="today-dash-title" className="flex flex-col gap-3">
      <h2 id="today-dash-title" className="sr-only">
        {t("today.dash.title")}
      </h2>
      <div className="flex flex-wrap gap-3">
        {mine ? <WeekRing mine={mine} /> : null}
        {mine ? <Stat value={mine.overdue} label={t("today.dash.overdue")} tone={mine.overdue > 0 ? "danger" : undefined} index={at++} href="/my-work?tab=overdue" /> : null}
        {mine ? <Stat value={mine.dueToday} label={t("today.dash.due_today")} index={at++} href="/my-work?tab=today" /> : null}
        {mine ? <Stat value={mine.open} label={t("today.dash.open")} index={at++} href="/my-work?tab=mine" /> : null}
        <Stat value={unreadChat} label={t("today.dash.unread")} tone={unreadChat > 0 ? "info" : undefined} index={at++} href="/chat" />
      </div>
      {team ? <TeamStrip team={team} /> : null}
    </section>
  );
}
