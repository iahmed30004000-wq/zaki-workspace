import Link from "next/link";
import type { ServerT } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtNumber } from "@/lib/format";
import { formatDays, formatRate, sectionText } from "@/lib/owner-board";
import type { Cards, Overview, PersonRow, PersonView, SortKey } from "@/server/services/owner-board";
import { boardHref, fmtClock, fmtDayKey, fmtDueDay, fmtMoment } from "./format";
import { Sparkline } from "./sparkline";

/**
 * «لوحة المالك» — the screens, as plain server components (no state, no client code: the filters are a GET form and the
 * sorting is a link, so a page is one request).
 *
 * The owner's rule «every indicator with its formula»: every number below carries a short Arabic line saying how it is
 * computed (a card shows it under its number, a table column in the legend under the table and as the header's tooltip).
 * No ranking words, no automatic judgement: numbers, titles and zeros that say what they are.
 */

type Params = Record<string, string | null | undefined>;

/** The filters of the page as a query: what the links carry along. */
export function paramsOf(o: { window: { preset: string; from: string; to: string }; filters: { space: string | null; person?: string | null } }): Params {
  const w = o.window.preset === "custom" ? { from: o.window.from, to: o.window.to } : { range: o.window.preset };
  return { ...w, space: o.filters.space };
}

// ───────────────────────────────────────── the definition ─────────────────────────────────────────

export function DefinitionNote({ t }: { t: ServerT }) {
  return (
    <details className="rounded-xl border border-border bg-surface p-3 text-sm shadow-card" data-testid="ob-definition">
      <summary className="cursor-pointer font-medium">{t("ownerboard.def.title")}</summary>
      <p className="mt-2 leading-7 text-muted">{t("ownerboard.def.body")}</p>
      <p className="mt-1 leading-7 text-muted">{t("ownerboard.def.zero")}</p>
    </details>
  );
}

// ───────────────────────────────────────── the filter bar ─────────────────────────────────────────

const PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "ownerboard.filter.today" },
  { key: "7", label: "ownerboard.filter.d7" },
  { key: "14", label: "ownerboard.filter.d14" },
  { key: "30", label: "ownerboard.filter.d30" },
];

/** A plain GET form: the window (preset or custom range), the space and the person. `people` is the list the person select offers. */
export function FilterBar({ t, action, o, people, csvHref }: { t: ServerT; action: string; o: Pick<Overview, "window" | "filters" | "spaces">; people?: { userId: string; name: string }[]; csvHref?: string }) {
  const custom = o.window.preset === "custom";
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 shadow-card" data-testid="ob-filters">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("ownerboard.filter.range")}
        <select name="range" defaultValue={custom ? "" : o.window.preset} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {t(p.label)}
            </option>
          ))}
          <option value="">{t("ownerboard.filter.custom")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("ownerboard.filter.from")}
        <input type="date" name="from" defaultValue={custom ? o.window.from : ""} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("ownerboard.filter.to")}
        <input type="date" name="to" defaultValue={custom ? o.window.to : ""} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg" />
      </label>
      {o.spaces.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("ownerboard.filter.space")}
          <select name="space" defaultValue={o.filters.space ?? ""} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg">
            <option value="">{t("ownerboard.filter.all_spaces")}</option>
            {o.spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {people && people.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("ownerboard.filter.person")}
          <select name="person" defaultValue={o.filters.person ?? ""} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg">
            <option value="">{t("ownerboard.filter.all_people")}</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="submit" className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg">
        {t("ownerboard.filter.apply")}
      </button>
      <Link href={action} className="py-1.5 text-sm text-muted underline">
        {t("ownerboard.filter.reset")}
      </Link>
      {csvHref ? (
        <a href={csvHref} className="ms-auto py-1.5 text-sm text-info underline" data-testid="ob-csv">
          {t("ownerboard.download")}
        </a>
      ) : null}
      <p className="basis-full text-xs text-muted">
        {t("ownerboard.filter.window", { from: fmtDayKey(o.window.from), to: fmtDayKey(o.window.to), days: fmtNumber(o.window.days.length) })} {t("ownerboard.filter.maxdays")}
      </p>
    </form>
  );
}

// ───────────────────────────────────────── the cards ─────────────────────────────────────────

type CardKey = "completed" | "open" | "overdue" | "late" | "avgDays" | "messages" | "active" | "idle";

export function BoardCards({ t, cards, title }: { t: ServerT; cards: Cards; title: string }) {
  const items: { key: CardKey; value: string; unit?: string }[] = [
    { key: "completed", value: fmtNumber(cards.completed) },
    { key: "open", value: fmtNumber(cards.open) },
    { key: "overdue", value: fmtNumber(cards.overdue) },
    { key: "late", value: fmtNumber(cards.late) },
    { key: "avgDays", value: formatDays(cards.avgDays), ...(cards.avgDays === null ? {} : { unit: t("ownerboard.unit.days") }) },
    { key: "messages", value: fmtNumber(cards.messages) },
    { key: "active", value: fmtNumber(cards.activePeople) },
    { key: "idle", value: fmtNumber(cards.idlePeople) },
  ];
  return (
    <section aria-label={title} data-testid="ob-cards">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((c) => (
          <li key={c.key} className="rounded-xl border border-border bg-surface p-3 shadow-card" data-card={c.key}>
            <div className="text-xs text-muted">{t(`ownerboard.card.${c.key}`)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums" data-value={c.value}>
              {c.value}
              {c.unit ? <span className="ms-1 text-sm font-normal text-muted">{c.unit}</span> : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">{t(`ownerboard.card.${c.key}.formula`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────────────────────── «اليوم» ─────────────────────────────────────────

export function TodayStrip({ t, today, timeZone, personHref }: { t: ServerT; today: NonNullable<Overview["today"]>; timeZone: string; personHref: (userId: string) => string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-3 shadow-card" data-testid="ob-today">
      <h2 className="text-sm font-semibold">{t("ownerboard.today.title")}</h2>
      <p className="mt-1 text-xs text-muted">{t("ownerboard.today.formula")}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-medium text-ok">{t("ownerboard.today.done")}</h3>
          {today.done.length === 0 ? (
            <p className="text-sm text-muted">{t("ownerboard.today.none_done")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {today.done.map((r) => (
                <li key={r.userId} className="flex flex-wrap items-baseline justify-between gap-2" data-today-done={r.userId}>
                  <Link href={personHref(r.userId)} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-xs text-muted">
                    {t("ownerboard.today.line", { tasks: fmtNumber(r.tasks), steps: fmtNumber(r.steps), messages: fmtNumber(r.messages) })} · {fmtClock(r.last, timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-warn">{t("ownerboard.today.idle")}</h3>
          {today.idle.length === 0 ? (
            <p className="text-sm text-muted">{t("ownerboard.today.none_idle")}</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-2 text-sm">
                {today.idle.map((p) => (
                  <li key={p.userId} data-today-idle={p.userId}>
                    <Link href={personHref(p.userId)} className="rounded-lg border border-border px-2 py-0.5 hover:underline">
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">{t("ownerboard.today.idle_note")}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────────────────── the people table ─────────────────────────────────────────

const COLUMNS: { key: SortKey | "spark"; label: string }[] = [
  { key: "name", label: "ownerboard.col.name" },
  { key: "completed", label: "ownerboard.col.completed" },
  { key: "spark", label: "ownerboard.col.spark" },
  { key: "openTasks", label: "ownerboard.col.open" },
  { key: "overdue", label: "ownerboard.col.overdue" },
  { key: "onTime", label: "ownerboard.col.onTime" },
  { key: "steps", label: "ownerboard.col.steps" },
  { key: "messages", label: "ownerboard.col.messages" },
  { key: "lastActivity", label: "ownerboard.col.lastActivity" },
];

const FORMULA_OF: Record<string, string> = {
  name: "ownerboard.col.completed.formula",
  completed: "ownerboard.col.completed.formula",
  spark: "ownerboard.col.spark.formula",
  openTasks: "ownerboard.col.open.formula",
  overdue: "ownerboard.col.overdue.formula",
  onTime: "ownerboard.col.onTime.formula",
  steps: "ownerboard.col.steps.formula",
  messages: "ownerboard.col.messages.formula",
  lastActivity: "ownerboard.col.lastActivity.formula",
};

export function PeopleTable({ t, o, personHref, sortHref }: { t: ServerT; o: Overview; personHref: (userId: string) => string; sortHref: (key: SortKey, dir: "asc" | "desc") => string }) {
  const tz = o.window.timeZone;
  return (
    <section data-testid="ob-people">
      <h2 className="mb-2 text-sm font-semibold">{t("ownerboard.people.title")}</h2>
      {o.people.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-muted">{t("ownerboard.people.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                {COLUMNS.map((c) => {
                  const sortable = c.key !== "spark";
                  const active = o.filters.sort === c.key;
                  const nextDir = active ? (o.filters.dir === "desc" ? "asc" : "desc") : c.key === "name" ? "asc" : "desc";
                  return (
                    <th key={c.key} scope="col" className="px-3 py-2 text-start font-medium" title={t(FORMULA_OF[c.key] ?? "")} aria-sort={active ? (o.filters.dir === "asc" ? "ascending" : "descending") : "none"}>
                      {sortable ? (
                        <Link href={sortHref(c.key as SortKey, nextDir)} aria-label={t("ownerboard.sort_by", { column: t(c.label) })} className="hover:underline">
                          {t(c.label)}
                          {active ? (o.filters.dir === "asc" ? " ▲" : " ▼") : ""}
                        </Link>
                      ) : (
                        t(c.label)
                      )}
                    </th>
                  );
                })}
                {o.sections.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2 text-start font-medium" title={t(c.formulaKey)}>
                    {t(c.labelKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {o.people.map((p) => (
                <PersonTr key={p.userId} t={t} p={p} tz={tz} href={personHref(p.userId)} o={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 rounded-xl border border-border bg-surface-1 p-3" data-testid="ob-legend">
        <h3 className="text-xs font-semibold">{t("ownerboard.people.legend")}</h3>
        <dl className="mt-2 space-y-1 text-xs leading-5 text-muted">
          {COLUMNS.filter((c) => c.key !== "name").map((c) => (
            <div key={c.key}>
              <dt className="inline font-medium text-fg">{t(c.label)}: </dt>
              <dd className="inline">{t(FORMULA_OF[c.key] ?? "")}</dd>
            </div>
          ))}
          {o.sections.map((c) => (
            <div key={c.key}>
              <dt className="inline font-medium text-fg">{t(c.labelKey)}: </dt>
              <dd className="inline">{t(c.formulaKey)}</dd>
            </div>
          ))}
          <div>
            <dt className="inline font-medium text-fg">{t("ownerboard.online")}: </dt>
            <dd className="inline">{t("ownerboard.online.formula")}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const sectionCell = sectionText;

function PersonTr({ t, p, tz, href, o }: { t: ServerT; p: PersonRow; tz: string; href: string; o: Overview }) {
  const total = p.spark.reduce((a, b) => a + b, 0);
  const inactive = p.status !== "ACTIVE";
  return (
    <tr className="border-t border-border hover:bg-surface-1" data-person={p.userId}>
      <td className="px-3 py-2">
        <Link href={href} className="font-medium hover:underline">
          {p.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
          <span>{enumLabel("OrgRole", p.role)}</span>
          {inactive ? <span className="rounded-md border border-warn/40 bg-warn/10 px-1.5 text-warn">{t("ownerboard.status.inactive")}</span> : null}
          {p.online ? <span className="rounded-md bg-ok/10 px-1.5 text-ok">{t("ownerboard.online")}</span> : null}
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums">{fmtNumber(p.completed)}</td>
      <td className="px-3 py-2">
        <Sparkline values={p.spark} label={t("ownerboard.spark.label", { total: fmtNumber(total), days: fmtNumber(p.spark.length) })} />
      </td>
      <td className="px-3 py-2 tabular-nums">{fmtNumber(p.openTasks)}</td>
      <td className="px-3 py-2 tabular-nums">{fmtNumber(p.overdue)}</td>
      <td className="px-3 py-2 tabular-nums">{formatRate(p.onTimeRate)}</td>
      <td className="px-3 py-2 tabular-nums">{fmtNumber(p.steps)}</td>
      <td className="px-3 py-2 tabular-nums">{fmtNumber(p.messages)}</td>
      <td className="px-3 py-2 tabular-nums">{fmtMoment(p.lastActivity, tz)}</td>
      {o.sections.map((c) => (
        <td key={c.key} className="px-3 py-2 tabular-nums">
          {sectionCell(c.kind, o.sectionValues[p.userId]?.[c.key])}
        </td>
      ))}
    </tr>
  );
}

// ───────────────────────────────────────── a person ─────────────────────────────────────────

export function PersonPage({ t, v, taskHref }: { t: ServerT; v: PersonView; taskHref: (id: string) => string }) {
  const p = v.person;
  const tz = v.window.timeZone;
  const total = p.spark.reduce((a, b) => a + b, 0);
  const cards: Cards = {
    completed: p.completed,
    open: p.openTasks,
    overdue: p.overdue,
    late: p.late,
    avgDays: p.avgDays,
    messages: p.messages,
    activePeople: p.completed + p.steps + p.messages > 0 ? 1 : 0,
    idlePeople: p.completed + p.steps + p.messages > 0 ? 0 : 1,
  };
  return (
    <div className="space-y-5" data-testid="ob-person">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t("ownerboard.person_title", { name: p.name })}</h2>
        <span className="text-sm text-muted">{enumLabel("OrgRole", p.role)}</span>
        {p.status !== "ACTIVE" ? <span className="rounded-md border border-warn/40 bg-warn/10 px-1.5 text-xs text-warn">{t("ownerboard.status.inactive")}</span> : null}
        {p.online ? <span className="rounded-md bg-ok/10 px-1.5 text-xs text-ok">{t("ownerboard.online")}</span> : null}
      </header>

      <section aria-label={t("ownerboard.person.summary")} data-testid="ob-person-summary">
        <h3 className="mb-2 text-sm font-semibold">{t("ownerboard.person.summary")}</h3>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["completed", fmtNumber(cards.completed)],
              ["open", fmtNumber(cards.open)],
              ["overdue", fmtNumber(cards.overdue)],
              ["late", fmtNumber(cards.late)],
              ["avgDays", formatDays(cards.avgDays)],
              ["messages", fmtNumber(cards.messages)],
            ] as const
          ).map(([key, value]) => (
            <li key={key} className="rounded-xl border border-border bg-surface p-3 shadow-card" data-card={key}>
              <div className="text-xs text-muted">{t(`ownerboard.card.${key}`)}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" data-value={value}>
                {value}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">{t(`ownerboard.card.${key}.formula`)}</p>
            </li>
          ))}
          <li className="rounded-xl border border-border bg-surface p-3 shadow-card" data-card="onTime">
            <div className="text-xs text-muted">{t("ownerboard.col.onTime")}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums" data-value={formatRate(p.onTimeRate)}>
              {formatRate(p.onTimeRate)}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">{t("ownerboard.col.onTime.formula")}</p>
          </li>
          <li className="rounded-xl border border-border bg-surface p-3 shadow-card" data-card="steps">
            <div className="text-xs text-muted">{t("ownerboard.col.steps")}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums" data-value={fmtNumber(p.steps)}>
              {fmtNumber(p.steps)}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">{t("ownerboard.col.steps.formula")}</p>
          </li>
          {v.sections.map((c) => (
            <li key={c.key} className="rounded-xl border border-border bg-surface p-3 shadow-card" data-card={c.key}>
              <div className="text-xs text-muted">{t(c.labelKey)}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" data-value={sectionCell(c.kind, v.sectionValues[c.key])}>
                {sectionCell(c.kind, v.sectionValues[c.key])}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">{t(c.formulaKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-surface p-3 shadow-card" data-testid="ob-trend">
        <h3 className="text-sm font-semibold">{t("ownerboard.person.trend")}</h3>
        <p className="mb-2 mt-1 text-xs text-muted">{t("ownerboard.person.trend.formula")}</p>
        <Sparkline large values={p.spark} label={t("ownerboard.spark.label", { total: fmtNumber(total), days: fmtNumber(p.spark.length) })} />
      </section>

      <section data-testid="ob-days">
        <h3 className="text-sm font-semibold">{t("ownerboard.person.days")}</h3>
        <p className="mb-2 mt-1 text-xs text-muted">{t("ownerboard.person.days.formula")}</p>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                {["date", "tasks", "steps", "messages", "first", "last"].map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`ownerboard.person.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.days.map((d) => (
                <tr key={d.day} className="border-t border-border align-top" data-day={d.day}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDayKey(d.day)}</td>
                  <td className="px-3 py-2">
                    {d.tasks.length === 0 ? (
                      <span className="text-muted">{t("ownerboard.person.no_tasks")}</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {d.tasks.map((task) => (
                          <li key={task.id}>
                            <Link href={taskHref(task.id)} className="hover:underline">
                              {task.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtNumber(d.steps)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtNumber(d.messages)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtClock(d.first, tz)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtClock(d.last, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section data-testid="ob-open">
        <h3 className="text-sm font-semibold">{t("ownerboard.person.open")}</h3>
        <p className="mb-2 mt-1 text-xs text-muted">{t("ownerboard.person.open.formula")}</p>
        {v.open.length === 0 ? (
          <p className="text-sm text-muted">{t("ownerboard.person.open_none")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
            {v.open.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-open={task.id}>
                <span>
                  <Link href={taskHref(task.id)} className="font-medium hover:underline">
                    {task.title}
                  </Link>
                  <span className="ms-2 text-xs text-muted">{task.space}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {task.overdue ? <span className="rounded-md border border-danger/40 bg-danger/10 px-1.5 text-danger">{t("ownerboard.person.overdue_tag")}</span> : null}
                  {task.dueDate ? t("ownerboard.person.due", { date: fmtDueDay(task.dueDate, tz) }) : t("ownerboard.person.no_due")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {v.openTotal > v.open.length ? <p className="mt-1 text-xs text-muted">{t("ownerboard.person.open_more", { shown: fmtNumber(v.open.length), total: fmtNumber(v.openTotal) })}</p> : null}
      </section>

      <section data-testid="ob-spaces">
        <h3 className="text-sm font-semibold">{t("ownerboard.person.spaces")}</h3>
        <p className="mb-2 mt-1 text-xs text-muted">{t("ownerboard.person.spaces.formula")}</p>
        {v.spaces.length === 0 ? (
          <p className="text-sm text-muted">{t("ownerboard.person.spaces_none")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {v.spaces.map((s) => (
              <li key={s.id} className="rounded-lg border border-border bg-surface px-2 py-0.5">
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { boardHref };
