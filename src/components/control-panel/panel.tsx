import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ServerT } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtNumber } from "@/lib/format";
import { seriesMax, type Insight, type InsightTone } from "@/lib/control-panel";
import { formatDays } from "@/lib/owner-board";
import type { PanelHome, PanelKpis, PanelReports } from "@/server/services/control-panel";
import { TodayStrip } from "@/components/owner-board/board";
import { cn } from "@/lib/utils";
import { insightText } from "./text";

/**
 * «لوحة التحكم» — the screens, as plain server components (no state, no client code: a section is a link, a filter is a GET form).
 *
 * The owner's rule stays: every number carries its formula. A card shows it under the number, a sentence opens it under «كيف انحسبت؟»,
 * a chart says it under the chart. The motion is decoration only (`motion-safe:animate-rise`): with reduced motion the picture is just there,
 * and every number is text in the page from the first byte.
 */

const CARD = "rounded-card border border-border bg-surface-1 p-4 shadow-card";
const RISE = "motion-safe:animate-rise";
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 6) * 70}ms` });

// ───────────────────────────────────────── the cards ─────────────────────────────────────────

function Kpi({ label, value, hint, formula, tone, index }: { label: string; value: string; hint?: string; formula: string; tone?: "danger" | "ok"; index: number }) {
  return (
    <li className={cn(CARD, RISE, "flex min-w-0 flex-col gap-1")} style={stagger(index)} data-kpi={label}>
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={cn("text-3xl font-bold leading-none tabular-nums", tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-fg")}>{value}</span>
      {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
      <p className="mt-1 text-xs leading-5 text-fg-muted">{formula}</p>
    </li>
  );
}

/** `compact`: two cards a row whatever the screen (the home's column is narrow); otherwise four from a large screen up. */
export function KpiGrid({ t, kpis, compact = false }: { t: ServerT; kpis: PanelKpis; compact?: boolean }) {
  const rate = kpis.onTimeRate;
  const weekHint =
    kpis.completedChange === null
      ? t("cp.kpi.week_none")
      : kpis.completedChange > 0
        ? t("cp.kpi.week_up", { pct: kpis.completedChange })
        : kpis.completedChange < 0
          ? t("cp.kpi.week_down", { pct: Math.abs(kpis.completedChange) })
          : t("cp.kpi.week_same");
  return (
    <section aria-label={t("cp.kpi.title")}>
      <ul className={cn("grid grid-cols-2 gap-3", compact ? "" : "lg:grid-cols-4")}>
        <Kpi label={t("cp.kpi.done_today")} value={fmtNumber(kpis.doneToday)} hint={`${t("cp.kpi.week_line", { n: fmtNumber(kpis.completedWeek) })} · ${weekHint}`} formula={t("cp.kpi.done_today.formula")} index={0} />
        <Kpi label={t("cp.kpi.overdue")} value={fmtNumber(kpis.overdue)} tone={kpis.overdue > 0 ? "danger" : "ok"} formula={t("cp.kpi.overdue.formula")} index={1} />
        <Kpi
          label={t("cp.kpi.on_time")}
          value={rate === null ? "—" : `${rate}%`}
          {...(kpis.onTimePrev !== null ? { hint: t("cp.kpi.on_time.prev", { prev: kpis.onTimePrev }) } : {})}
          formula={t("cp.kpi.on_time.formula")}
          index={2}
        />
        <Kpi label={t("cp.kpi.active")} value={t("cp.kpi.active_value", { n: fmtNumber(kpis.activeToday), total: fmtNumber(kpis.staff) })} formula={t("cp.kpi.active.formula")} index={3} />
      </ul>
    </section>
  );
}

// ───────────────────────────────────────── the sentences ─────────────────────────────────────────

const TONE: Record<InsightTone, { icon: typeof Info; cls: string }> = {
  warn: { icon: AlertTriangle, cls: "text-warn" },
  info: { icon: Info, cls: "text-info" },
  good: { icon: CheckCircle2, cls: "text-ok" },
};

export function InsightList({ t, insights, limit }: { t: ServerT; insights: readonly Insight[]; limit?: number }) {
  const shown = limit ? insights.slice(0, limit) : insights;
  return (
    <section aria-labelledby="cp-insights" data-testid="cp-insights">
      <h2 id="cp-insights" className="text-sm font-semibold">
        {t("cp.insights.title")}
      </h2>
      <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cp.insights.hint")}</p>
      <ul className="mt-2 space-y-2">
        {shown.map((insight, i) => {
          const { icon: Icon, cls } = TONE[insight.tone];
          const { sentence, formula } = insightText(t, insight);
          return (
            <li key={insight.id} className={cn("rounded-card border border-border bg-surface-1 p-3 shadow-card", RISE)} style={stagger(i)} data-insight={insight.id} data-tone={insight.tone}>
              <div className="flex items-start gap-2">
                <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", cls)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 text-fg">
                    {sentence}
                    {insight.href ? (
                      <>
                        {" "}
                        <Link href={insight.href} className="text-info underline">
                          {t("cp.insight.open")}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <details className="mt-1 text-xs text-fg-muted">
                    <summary className="cursor-pointer">{t("cp.insights.how")}</summary>
                    <p className="mt-1 leading-5">{formula}</p>
                  </details>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {limit && insights.length > limit ? (
        <p className="mt-2 text-xs">
          <Link href="/owner" className="text-info underline">
            {t("cp.insights.more", { n: insights.length })}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

// ───────────────────────────────────────── the home screen ─────────────────────────────────────────

/** The owner's panel on «اليوم»: the cards, the first sentences, who did what today. `aiChip` is the client chip (it asks for its own state). */
export function ControlPanelHome({ t, view, aiChip }: { t: ServerT; view: PanelHome; aiChip: React.ReactNode }) {
  const strip = { done: view.todayStrip.done.slice(0, 6), idle: view.todayStrip.idle.slice(0, 12) };
  return (
    <section aria-labelledby="cp-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4" data-testid="control-panel">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="cp-title" className="text-base font-semibold tracking-tight">
            {t("cp.title")}
          </h2>
          <p className="text-xs text-fg-muted">{t("cp.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {aiChip}
          <Link href="/owner" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface-1 px-3 text-sm hover:bg-surface-2 md:min-h-9">
            {t("cp.open_full")}
          </Link>
        </div>
      </header>
      <KpiGrid t={t} kpis={view.kpis} compact />
      <InsightList t={t} insights={view.insights} limit={5} />
      <TodayStrip t={t} today={strip} timeZone={view.timeZone} personHref={(id) => `/owner/people/${id}`} />
    </section>
  );
}

// ───────────────────────────────────────── the sections of the full page ─────────────────────────────────────────

export const PANEL_SECTIONS = ["overview", "people", "reports", "ai"] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];

export function sectionOf(value: string | string[] | undefined): PanelSection {
  const one = Array.isArray(value) ? value[0] : value;
  return (PANEL_SECTIONS as readonly string[]).includes(one ?? "") ? (one as PanelSection) : "overview";
}

export function SectionNav({ t, current, hrefOf }: { t: ServerT; current: PanelSection; hrefOf: (section: PanelSection) => string }) {
  return (
    <nav aria-label={t("cp.nav.label")} className="flex flex-wrap gap-2" data-testid="cp-nav">
      {PANEL_SECTIONS.map((s) => (
        <Link
          key={s}
          href={hrefOf(s)}
          aria-current={s === current ? "page" : undefined}
          className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm md:min-h-9", s === current ? "border-accent bg-accent/10 font-medium text-fg" : "border-border bg-surface-1 text-fg-muted hover:bg-surface-2")}
        >
          {t(`cp.nav.${s}`)}
        </Link>
      ))}
    </nav>
  );
}

// ───────────────────────────────────────── the merged reports ─────────────────────────────────────────

function Bar({ label, count, pct, barClass }: { label: string; count: number; pct: number; barClass: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-xs">{label}</span>
      <div className="h-2 flex-1 rounded bg-surface-2">
        <div className={cn("h-2 rounded", barClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-end text-xs font-medium tabular-nums">{fmtNumber(count)}</span>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "ok" }) {
  return (
    <li className={cn(CARD, "min-w-0")}>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-fg")}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-fg-muted">{hint}</div> : null}
    </li>
  );
}

/** Eight weeks, two bars each (new and finished), in SVG with the theme's tokens: no chart library, every value is also text in the title. */
export function WeekChart({ t, series }: { t: ServerT; series: PanelReports["series"] }) {
  const max = seriesMax(series);
  const W = 24;
  const H = 64;
  return (
    <section className={CARD} data-testid="cp-series">
      <h3 className="text-sm font-semibold">{t("cp.rep.series")}</h3>
      <svg viewBox={`0 0 ${series.length * W} ${H}`} role="img" aria-label={t("cp.rep.series")} className="mt-3 h-40 w-full" preserveAspectRatio="none">
        {series.map((p, i) => {
          const hc = Math.max(p.created === 0 ? 0.6 : 2, (p.created / max) * (H - 4));
          const hd = Math.max(p.completed === 0 ? 0.6 : 2, (p.completed / max) * (H - 4));
          return (
            <g key={p.ago} data-week={p.ago}>
              <title>{`${p.ago === 0 ? t("cp.rep.week_now") : t("cp.rep.week_ago", { n: p.ago })}: ${t("cp.rep.created")} ${p.created} · ${t("cp.rep.done")} ${p.completed}`}</title>
              <rect x={i * W + 3} y={H - hc} width={8} height={hc} rx={1} className="fill-info" opacity={p.created === 0 ? 0.35 : 1} />
              <rect x={i * W + 12} y={H - hd} width={8} height={hd} rx={1} className="fill-ok" opacity={p.completed === 0 ? 0.35 : 1} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-fg-muted">
        <span>{t("cp.rep.week_ago", { n: series.length - 1 })}</span>
        <span>{t("cp.rep.week_now")}</span>
      </div>
      <p className="mt-2 flex flex-wrap gap-4 text-xs">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-info" />
          {t("cp.rep.created")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-ok" />
          {t("cp.rep.done")}
        </span>
      </p>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{t("cp.rep.series.formula")}</p>
    </section>
  );
}

const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"] as const;
const IDEA_STATUSES = ["NEW", "UNDER_REVIEW", "PLANNING", "LAUNCHED", "REJECTED"] as const;

export function ReportsView({ t, r }: { t: ServerT; r: PanelReports }) {
  const byPriority = new Map(r.byPriority.map((x) => [x.priority, x.n]));
  const maxPriority = Math.max(1, ...PRIORITIES.map((p) => byPriority.get(p) ?? 0));
  const maxWork = Math.max(1, ...r.workload.map((w) => w.n));
  const byStatus = new Map(r.ideas.byStatus.map((x) => [x.status, x.n]));
  const maxIdea = Math.max(1, ...IDEA_STATUSES.map((s) => byStatus.get(s) ?? 0));
  const { totals } = r;
  return (
    <div className="space-y-4" data-testid="cp-reports">
      <header>
        <h2 className="text-base font-semibold">{t("cp.rep.title")}</h2>
        <p className="text-xs text-fg-muted">{t("cp.rep.subtitle")}</p>
      </header>

      <form method="get" action="/owner" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <input type="hidden" name="v" value="reports" />
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t("cp.rep.space")}
          <select name="space" defaultValue={r.spaceId ?? ""} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg">
            <option value="">{t("cp.rep.all")}</option>
            {r.spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg">
          {t("cp.rep.apply")}
        </button>
      </form>

      <section aria-label={t("cp.rep.totals")}>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("analytics.totalTasks")} value={fmtNumber(totals.total)} hint={t("analytics.totalTasksHint")} />
          <Stat label={t("analytics.openTasks")} value={fmtNumber(totals.open)} />
          <Stat label={t("analytics.completed")} value={fmtNumber(totals.completed)} hint={t("analytics.completionRate", { rate: totals.rate ?? 0 })} />
          <Stat label={t("analytics.overdue")} value={fmtNumber(totals.overdue)} tone={totals.overdue > 0 ? "danger" : "ok"} hint={totals.overdue > 0 ? t("analytics.overdueNote") : t("analytics.allGood")} />
          <Stat label={t("analytics.created30")} value={fmtNumber(totals.created30)} />
          <Stat label={t("analytics.completed30")} value={fmtNumber(totals.completed30)} />
          <Stat label={t("analytics.upcoming7")} value={fmtNumber(totals.upcoming7)} />
          <Stat label={t("cp.rep.avg_days")} value={totals.avgDays === null ? "—" : t("cp.rep.avg_days_value", { n: formatDays(totals.avgDays) })} hint={t("cp.rep.avg_days.formula")} />
        </ul>
      </section>

      <WeekChart t={t} series={r.series} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD}>
          <h3 className="mb-3 text-sm font-semibold">{t("analytics.openByPriority")}</h3>
          <div className="space-y-2">
            {PRIORITIES.map((p) => (
              <Bar key={p} label={enumLabel("TaskPriority", p)} count={byPriority.get(p) ?? 0} pct={((byPriority.get(p) ?? 0) / maxPriority) * 100} barClass="bg-accent" />
            ))}
            {totals.open === 0 ? <p className="text-xs text-fg-muted">{t("analytics.noOpen")}</p> : null}
          </div>
        </section>
        <section className={CARD}>
          <h3 className="mb-3 text-sm font-semibold">{t("analytics.workload")}</h3>
          <div className="space-y-2">
            {r.workload.map((w) => (
              <Bar key={w.userId} label={w.name} count={w.n} pct={(w.n / maxWork) * 100} barClass="bg-ok" />
            ))}
            {r.workload.length === 0 ? <p className="text-xs text-fg-muted">{t("analytics.noWorkload")}</p> : null}
          </div>
        </section>
      </div>

      <section className={CARD}>
        <h3 className="mb-3 text-sm font-semibold">
          {t("analytics.ideasFunnel")}
          <span className="ms-2 text-xs font-normal text-fg-muted">{t("analytics.ideasTotal", { total: r.ideas.total })}</span>
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {IDEA_STATUSES.map((status) => {
            const n = byStatus.get(status) ?? 0;
            return (
              <div key={status} className="rounded-lg border border-border p-2 text-center">
                <div className="text-lg font-semibold tabular-nums">{fmtNumber(n)}</div>
                <div className="text-xs text-fg-muted">{enumLabel("IdeaStatus", status)}</div>
                <div className="mt-1 h-1 rounded bg-surface-2">
                  <div className="h-1 rounded bg-info" style={{ width: `${(n / maxIdea) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {r.ideas.total === 0 ? <p className="mt-2 text-xs text-fg-muted">{t("analytics.noIdeas")}</p> : null}
      </section>

      <section className={CARD}>
        <h3 className="mb-1 text-sm font-semibold">{t("cp.rep.by_space")}</h3>
        <p className="mb-2 text-xs leading-5 text-fg-muted">{t("cp.rep.by_space.formula")}</p>
        {r.bySpace.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("cp.rep.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("cp.rep.col.space")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("cp.rep.col.open")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("cp.rep.col.overdue")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("cp.rep.col.done30")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.bySpace.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-2 py-1.5 font-medium">{s.name}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNumber(s.open)}</td>
                    <td className={cn("px-2 py-1.5 tabular-nums", s.overdue > 0 ? "text-danger" : "")}>{fmtNumber(s.overdue)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNumber(s.done30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="flex flex-wrap gap-4 text-xs text-fg-muted">
        <span>{t("analytics.formulaNote")}</span>
      </footer>
    </div>
  );
}
