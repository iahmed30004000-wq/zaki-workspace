import type { ServerT } from "@/lib/i18n/server";
import { fmtMinutes, fmtNumber, monthName } from "@/lib/format";
import { BAND_EXCELLENT, BAND_GOOD, LIGHT_AMBER, LIGHT_GREEN, MIN_TEAM_FOR_MEDIAN, type IndicatorKey, type Period, type PeriodKind } from "@/lib/team-score";
import type { ScoreDetail, ScoreTable } from "@/server/services/team-score";
import { BandBadge, LightBadge } from "./badges";

/**
 * «السكور» on the screen — every number with how it is computed, the weights, and the formula box. No ranking words and no
 * leaderboard: the table is sorted by name, and by score only when the viewer clicks the column.
 */

const INDICATOR_LABEL: Record<IndicatorKey, string> = {
  manual: "teamdev.score.ind.manual",
  completed: "teamdev.score.ind.completed",
  onTime: "teamdev.score.ind.onTime",
  steps: "teamdev.score.ind.steps",
};

/** A GET form: the period (a month or a quarter, one list) and nothing else. `extra` carries what must survive (the sort). */
export function PeriodPicker({ t, action, options, selected, extra = {} }: { t: ServerT; action: string; options: Period[]; selected: string; extra?: Record<string, string> }) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 shadow-card" data-period-form>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {t("teamdev.col.period")}
        <select name="period" defaultValue={selected} className="h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9">
          {options.map((p) => (
            <option key={p.key} value={p.key}>
              {periodLabel(p, t)}
            </option>
          ))}
        </select>
      </label>
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className="h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 md:h-9">
        {t("teamdev.period.show")}
      </button>
    </form>
  );
}

export function periodLabel(p: Period, t: ServerT): string {
  return p.kind === "month" ? `${monthName(p.index - 1)} ${p.year}` : `${t("teamdev.period.quarter_n", { n: p.index })} ${p.year}`;
}

// ───────────────────────────────────────── one person's score ─────────────────────────────────────────

function Cell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function ScoreView({ score, t }: { score: ScoreDetail; t: ServerT }) {
  const lines: { key: IndicatorKey; how: React.ReactNode; weight: number; share: number | null; value: number | null }[] = [
    {
      key: "manual",
      value: score.manual.value,
      weight: score.manual.weight,
      share: score.manual.share,
      how:
        score.manual.average === null
          ? t("teamdev.score.how.manual_none")
          : t("teamdev.score.how.manual", { avg: fmtNumber(Math.round(score.manual.average * 10) / 10), n: fmtNumber(score.manual.reviews) }),
    },
    {
      key: "completed",
      value: score.completed.value,
      weight: score.completed.weight,
      share: score.completed.share,
      how: score.completed.baseline
        ? t("teamdev.score.how.count", { n: fmtNumber(score.completed.count), base: fmtNumber(score.completed.baseline.value), src: t(`teamdev.score.baseline.${score.completed.baseline.source}`) })
        : t("teamdev.score.how.count_none", { n: fmtNumber(score.completed.count) }),
    },
    {
      key: "onTime",
      value: score.onTime.value,
      weight: score.onTime.weight,
      share: score.onTime.share,
      how: score.onTime.withDue === 0 ? t("teamdev.score.how.ontime_none") : t("teamdev.score.how.ontime", { a: fmtNumber(score.onTime.onTime), b: fmtNumber(score.onTime.withDue) }),
    },
    {
      key: "steps",
      value: score.steps.value,
      weight: score.steps.weight,
      share: score.steps.share,
      how: score.steps.baseline
        ? t("teamdev.score.how.count", { n: fmtNumber(score.steps.count), base: fmtNumber(score.steps.baseline.value), src: t(`teamdev.score.baseline.${score.steps.baseline.source}`) })
        : t("teamdev.score.how.count_none", { n: fmtNumber(score.steps.count) }),
    },
  ];
  return (
    <div className="space-y-4" data-score-view>
      <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-fg-muted">{t("teamdev.col.score")}</div>
            <div className="text-4xl font-semibold tabular-nums" data-score={score.score ?? "none"}>
              {score.score === null ? "—" : fmtNumber(score.score)}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-fg-muted">{t("teamdev.col.band")}:</span>
              <BandBadge band={score.band} t={t} />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-fg-muted">{t("teamdev.col.light")}:</span>
              <LightBadge light={score.light} t={t} />
            </div>
            {score.suggestedLight ? (
              <div className="flex items-center gap-2 text-sm" data-suggestion>
                <span className="text-fg-muted">{t("teamdev.light.system")}:</span>
                <LightBadge light={score.suggestedLight} suggested t={t} />
              </div>
            ) : null}
          </div>
        </div>
        {score.score === null ? <p className="mt-3 text-sm text-fg-muted">{t("teamdev.score.nothing")}</p> : null}
        {score.period.partial ? <p className="mt-3 text-xs text-warn">⚠️ {t("teamdev.score.partial")}</p> : null}
        {score.sharedOnly ? <p className="mt-2 text-xs text-fg-muted">{t("teamdev.score.shared_only")}</p> : null}
      </section>

      <section className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[34rem] text-sm" data-score-lines>
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.score.indicator")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.score.how")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.score.value")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.score.weight")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-border/60 last:border-0" data-indicator={l.key}>
                <td className="px-3 py-2 font-medium">{t(INDICATOR_LABEL[l.key])}</td>
                <td className="px-3 py-2 text-fg-muted">{l.how}</td>
                <td className="px-3 py-2 tabular-nums">{l.value === null ? "—" : fmtNumber(Math.round(l.value))}</td>
                <td className="px-3 py-2 tabular-nums">
                  {l.share === null ? <span className="text-fg-muted">{t("teamdev.score.left_out")}</span> : `${fmtNumber(Math.round(l.share))}%`}
                  <span className="ms-1 text-xs text-fg-muted">({fmtNumber(l.weight)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-border bg-surface p-3 text-sm shadow-card" data-score-extras>
        <h3 className="mb-2 font-medium">{t("teamdev.score.extras")}</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <Cell label={t("teamdev.score.open_now")}>{fmtNumber(score.extras.openNow)}</Cell>
          <Cell label={t("teamdev.score.overdue_now")}>{fmtNumber(score.extras.overdueNow)}</Cell>
          <Cell label={t("teamdev.score.messages")}>{fmtNumber(score.extras.messages)}</Cell>
          <Cell label={t("teamdev.score.time")}>{score.extras.trackedMinutes === null ? "—" : fmtMinutes(score.extras.trackedMinutes)}</Cell>
          {score.extras.checkins ? (
            <>
              <Cell label={t("teamdev.score.checkins")}>{fmtNumber(score.extras.checkins.answered)}</Cell>
              <Cell label={t("teamdev.score.checkins_streak")}>{fmtNumber(score.extras.checkins.streak)}</Cell>
            </>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-5 text-fg-muted">{t("teamdev.score.extras_note")}</p>
        {score.extras.checkins ? <p className="mt-1 text-xs leading-5 text-fg-muted">{t("teamdev.score.checkins_note")}</p> : null}
      </section>

      <ScoreFormula t={t} weights={score.weights} />
    </div>
  );
}

// ───────────────────────────────────────── the formula box ─────────────────────────────────────────

/** The legend: how a score is made, in plain words, with the weights actually in force. Printed wherever a score is. */
export function ScoreFormula({ t, weights }: { t: ServerT; weights: ScoreDetail["weights"] }) {
  return (
    <details className="rounded-xl border border-border bg-surface p-3 text-sm shadow-card" data-score-formula>
      <summary className="min-h-11 cursor-pointer py-2 font-medium">{t("teamdev.formula.title")}</summary>
      <div className="mt-2 space-y-2 leading-7 text-fg-muted">
        <p>{t("teamdev.formula.intro")}</p>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t("teamdev.formula.manual")}</li>
          <li>{t("teamdev.formula.ontime")}</li>
          <li>{t("teamdev.formula.completed", { min: MIN_TEAM_FOR_MEDIAN })}</li>
          <li>{t("teamdev.formula.steps")}</li>
        </ul>
        <p>{t("teamdev.formula.never_invent")}</p>
        <p data-formula-weights>
          {t("teamdev.formula.weights", {
            manual: fmtNumber(weights.manual),
            completed: fmtNumber(weights.completed),
            onTime: fmtNumber(weights.onTime),
            steps: fmtNumber(weights.steps),
          })}
        </p>
        <p>{t("teamdev.formula.bands", { excellent: BAND_EXCELLENT, good: BAND_GOOD })}</p>
        <p>⚠️ {t("teamdev.formula.light", { green: LIGHT_GREEN, amber: LIGHT_AMBER })}</p>
        <p>🔧 {t("teamdev.formula.light_fix")}</p>
      </div>
    </details>
  );
}

// ───────────────────────────────────────── the table of people ─────────────────────────────────────────

export function ScoreTableView({ table, t, kind, sortHref, csvHref, personHref }: { table: ScoreTable; t: ServerT; kind: PeriodKind; sortHref: (sort: "name" | "score") => string; csvHref: string; personHref: (id: string) => string }) {
  void kind;
  return (
    <section className="space-y-2" data-score-table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t("teamdev.table.title")}</h2>
        <a href={csvHref} className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2 md:min-h-9" data-csv>
          {t("teamdev.csv")}
        </a>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[34rem] text-sm" data-people-table>
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th className="px-3 py-2 text-start font-medium">
                <a href={sortHref("name")} className="hover:underline" aria-sort={table.sort === "name" ? "ascending" : undefined}>
                  {t("teamdev.col.person")}
                </a>
              </th>
              <th className="px-3 py-2 text-start font-medium">
                <a href={sortHref("score")} className="hover:underline" data-sort-score aria-sort={table.sort === "score" ? "descending" : undefined}>
                  {t("teamdev.col.score")}
                </a>
              </th>
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.band")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.light")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("teamdev.col.suggested")}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.userId} className="border-b border-border/60 last:border-0" data-score-row={r.userId} data-person-row={r.userId}>
                <td className="px-3 py-2">
                  <a href={personHref(r.userId)} className="inline-flex min-h-11 items-center font-medium hover:underline md:min-h-0">
                    {r.name}
                  </a>
                  {r.jobTitle ? <span className="ms-2 text-xs text-fg-muted">{r.jobTitle}</span> : null}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.score === null ? "—" : fmtNumber(r.score)}</td>
                <td className="px-3 py-2">
                  <BandBadge band={r.band} t={t} />
                </td>
                <td className="px-3 py-2">
                  <LightBadge light={r.light} t={t} />
                </td>
                <td className="px-3 py-2">
                  <LightBadge light={r.suggestedLight} suggested t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-fg-muted">{t("teamdev.table.note")}</p>
    </section>
  );
}
