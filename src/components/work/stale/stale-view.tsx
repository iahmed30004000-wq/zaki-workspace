"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { STALE_ACTIONS, STALE_AUTO_FILTERS, staleApiQuery, type StaleAction, type StaleAutoFilter, type StalePerson, type StaleTask, type StaleView, type SweepResult } from "@/lib/work/stale";
import { WORK_LIST, WORK_SELECT } from "@/components/work/look";
import { AutoMark } from "./auto-mark";

/** The days the picker offers (the person may also type `?days=` in the address: any whole number up to a year). */
const DAY_CHOICES = [7, 14, 30, 60, 90] as const;
export const STALE_KEY = ["work-stale"] as const;

/**
 * «مهام قديمة» — the review list. The server hands the first answer (already cut to what the person manages and may open); the filters are addresses
 * (a link, so the page is the same screen for anybody who pastes it); a bulk action posts to `/api/work/stale` and the list is read again, so a task
 * that was dealt with leaves it without a reload. Each task is judged on its own by the server: the answer is shown line by line.
 */
export function StaleTasksView({ initial }: { initial: StaleView }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = staleApiQuery(initial);
  const list = useQuery({
    queryKey: [...STALE_KEY, query, initial.builtAt],
    queryFn: () => apiGet<StaleView>(`/api/work/stale${query ? `?${query}` : ""}`),
    initialData: initial,
    staleTime: 30_000,
  });
  const view = list.data;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<SweepResult | null>(null);
  const titles = useMemo(() => new Map(view.people.flatMap((p) => p.projects.flatMap((g) => g.tasks.map((task) => [task.id, task.title] as const)))), [view]);
  const allIds = useMemo(() => view.people.flatMap((p) => p.projects.flatMap((g) => g.tasks.map((task) => task.id))), [view]);

  const go = (patch: Partial<{ days: number; auto: StaleAutoFilter; space: string | null }>) => {
    const next = staleApiQuery({ days: view.days, auto: view.auto, space: view.space, ...patch });
    router.push(`/my-work/stale${next ? `?${next}` : ""}`);
  };
  const toggle = (ids: readonly string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });
  const afterSweep = async (done: SweepResult) => {
    setResult(done);
    setPicked(new Set());
    await queryClient.invalidateQueries({ queryKey: STALE_KEY });
    router.refresh();
  };

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" data-stale-list>
      <header className="space-y-1">
        <h1 className="text-[19px] font-bold leading-tight text-fg">{t("stale.title")}</h1>
        <p className="text-[13px] text-fg-muted">{t("stale.subtitle")}</p>
      </header>

      <Filters view={view} onChange={go} />

      {list.isError ? (
        <div className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm" role="alert">
          <span>{t("stale.error.load")}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {t("stale.error.retry")}
          </Button>
        </div>
      ) : null}

      {result ? <ResultPanel result={result} titles={titles} onClose={() => setResult(null)} /> : null}

      {view.people.length === 0 ? (
        <EmptyState title={t("stale.empty.title")} hint={t("stale.empty.hint", { n: fmtNumber(view.days) })} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-fg-muted" data-stale-total>
              {t("stale.count", { n: fmtNumber(view.total) })}
              {view.truncated ? <span className="ms-2 text-xs">{t("stale.truncated", { shown: fmtNumber(view.shown), total: fmtNumber(view.total) })}</span> : null}
              {view.auto === "hide" && view.autoTotal > 0 ? <span className="ms-2 text-xs">{t("stale.auto.hidden", { n: fmtNumber(view.autoTotal) })}</span> : null}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => toggle(allIds, true)}>
                {t("stale.select.all")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
                {t("stale.select.none")}
              </Button>
            </div>
          </div>
          {view.people.map((person) => (
            <PersonBlock key={person.key} person={person} picked={picked} onToggle={toggle} />
          ))}
        </>
      )}

      {picked.size > 0 ? <BulkBar view={view} picked={[...picked]} onDone={afterSweep} /> : null}
    </div>
  );
}

function Filters({ view, onChange }: { view: StaleView; onChange: (patch: Partial<{ days: number; auto: StaleAutoFilter; space: string | null }>) => void }) {
  const { t } = useI18n();
  const dayChoices = [...new Set<number>([...DAY_CHOICES, view.days])].sort((a, b) => a - b);
  const field = `min-h-11 md:min-h-9 ${WORK_SELECT}`;
  return (
    <section aria-label={t("stale.filters")} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          {t("stale.days.label")}
          <select className={field} value={view.days} onChange={(e) => onChange({ days: Number(e.target.value) })}>
            {dayChoices.map((n) => (
              <option key={n} value={n}>
                {t("stale.days.option", { n: fmtNumber(n) })}
              </option>
            ))}
          </select>
        </label>
        {view.spaces.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            {t("stale.space.label")}
            <select className={field} value={view.space ?? ""} onChange={(e) => onChange({ space: e.target.value || null })}>
              <option value="">{t("stale.space.all")}</option>
              {view.spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div role="group" aria-label={t("stale.auto.label")} className="flex flex-wrap gap-1">
          {STALE_AUTO_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view.auto === key}
              onClick={() => onChange({ auto: key })}
              className={`min-h-11 rounded-full px-3 text-[13px] font-semibold transition-colors md:min-h-9 ${view.auto === key ? "bg-accent/10 text-accent" : "bg-surface-2 text-fg-muted hover:text-fg"}`}
            >
              {t(`stale.auto.${key}`)}
            </button>
          ))}
        </div>
      </div>
      {/* D-W4 is the owner's: the mark and the separate count are the recommended default, built and labelled as waiting for his answer */}
      <p className="text-xs text-fg-muted" data-stale-pending>
        {t("stale.auto.pending")}
      </p>
    </section>
  );
}

function PersonBlock({ person, picked, onToggle }: { person: StalePerson; picked: ReadonlySet<string>; onToggle: (ids: readonly string[], on: boolean) => void }) {
  const { t } = useI18n();
  const ids = person.projects.flatMap((g) => g.tasks.map((task) => task.id));
  const all = ids.every((id) => picked.has(id));
  const heading = `stale-person-${person.key}`;
  const name = person.name ?? t("stale.person.none");
  return (
    <section aria-labelledby={heading} className="space-y-2" data-stale-person={person.key}>
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-accent"
          checked={all}
          aria-label={t("stale.select.person", { name })}
          onChange={(e) => onToggle(ids, e.target.checked)}
        />
        <h2 id={heading} className="text-[15px] font-bold text-fg">
          {name}
        </h2>
        <span className="text-xs text-fg-muted">
          {person.userId ? t("stale.person.counts", { stale: fmtNumber(person.stale), open: fmtNumber(person.open) }) : t("stale.count", { n: fmtNumber(person.stale) })}
          {person.openAuto > 0 ? <span className="ms-1">{t("stale.person.auto", { n: fmtNumber(person.openAuto) })}</span> : null}
        </span>
      </div>
      {person.projects.map((group) => (
        <div key={group.projectId} className="space-y-1">
          <h3 className="px-1 text-[13px] font-bold text-fg-muted">
            {group.name}
            <span className="ms-2 text-xs font-normal">{group.spaceName}</span>
          </h3>
          <ul className={WORK_LIST}>
            {group.tasks.map((task) => (
              <StaleRow key={task.id} task={task} picked={picked.has(task.id)} onToggle={(on) => onToggle([task.id], on)} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function StaleRow({ task, picked, onToggle }: { task: StaleTask; picked: boolean; onToggle: (on: boolean) => void }) {
  const { t } = useI18n();
  return (
    <li className="flex min-h-12 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2" data-stale-task={task.id}>
      <input type="checkbox" className="size-5 shrink-0 accent-accent" checked={picked} aria-label={t("stale.row.pick")} onChange={(e) => onToggle(e.target.checked)} />
      <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-2" title={t("stale.row.open")}>
        <span dir="ltr" className="shrink-0 font-mono text-xs text-muted">
          {task.key}
        </span>
        <span className="truncate text-[15px] font-medium text-fg">{task.title}</span>
        {task.private ? <Lock className="h-3 w-3 shrink-0 text-fg-muted" aria-label={t("taskpriv.lock")} /> : null}
        {task.automated ? <AutoMark /> : null}
      </Link>
      <span className="shrink-0 text-xs text-fg-muted">{t("stale.row.idle", { n: fmtNumber(task.idleDays) })}</span>
    </li>
  );
}

function BulkBar({ view, picked, onDone }: { view: StaleView; picked: string[]; onDone: (result: SweepResult) => Promise<void> }) {
  const { t } = useI18n();
  const [action, setAction] = useState<StaleAction | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = action === "close" || action === "archive" || (action === "assign" && assigneeId !== "") || (action === "postpone" && day !== "");

  async function run() {
    if (!action || busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const done = await apiPost<SweepResult>("/api/work/stale", {
        action,
        taskIds: picked,
        ...(action === "assign" ? { assigneeId } : {}),
        ...(action === "postpone" ? { day } : {}),
      });
      setAction(null);
      await onDone(done);
    } catch (err) {
      // the call's own mistakes (a past day, too many tasks) come back as a key; anything else is the plain sentence
      const key = err instanceof ApiError ? ((err.details as { message?: string }[] | undefined)?.[0]?.message ?? err.messageKey) : undefined;
      setError(key && key.startsWith("stale.") ? t(key) : t("stale.error.sweep"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="region" aria-label={t("stale.bulk.aria")} className="sticky bottom-2 z-10 space-y-2 rounded-2xl bg-surface-1 p-3 shadow-card-hover" data-stale-bar>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg">{t("stale.select.count", { n: fmtNumber(picked.length) })}</span>
        {STALE_ACTIONS.map((key) => (
          <Button key={key} type="button" size="sm" variant={action === key ? "tonal" : "secondary"} aria-pressed={action === key} onClick={() => { setAction(key); setError(null); }}>
            {t(`stale.action.${key}`)}
          </Button>
        ))}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center gap-2">
          {action === "assign" ? (
            <select
              aria-label={t("stale.assign.pick")}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="min-h-11 rounded-lg border border-border bg-surface px-2 text-sm text-fg md:min-h-9"
            >
              <option value="">{t("stale.assign.pick")}</option>
              {view.assignable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          {action === "postpone" ? (
            <input
              type="date"
              aria-label={t("stale.postpone.pick")}
              value={day}
              min={view.today}
              onChange={(e) => setDay(e.target.value)}
              className="min-h-11 rounded-lg border border-border bg-surface px-2 text-sm text-fg md:min-h-9"
            />
          ) : null}
          <span className="text-xs text-fg-muted">{t(`stale.confirm.${action}`, { n: fmtNumber(picked.length) })}</span>
          <Button type="button" size="sm" disabled={!ready || busy} onClick={() => void run()}>
            {t("stale.action.apply")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setAction(null)}>
            {t("stale.action.cancel")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ResultPanel({ result, titles, onClose }: { result: SweepResult; titles: ReadonlyMap<string, string>; onClose: () => void }) {
  const { t } = useI18n();
  const refused = result.results.filter((r) => r.outcome === "refused");
  const asked = result.results.filter((r) => r.outcome === "requested");
  return (
    <div role="status" className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-sm" data-stale-result>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium text-fg">{t("stale.result.title")}</p>
          {result.done > 0 ? <p className="text-ok">{t("stale.result.done", { n: fmtNumber(result.done) })}</p> : null}
          {result.requested > 0 ? <p className="text-info">{t("stale.result.requested", { n: fmtNumber(result.requested) })}</p> : null}
          {result.refused > 0 ? <p className="text-danger">{t("stale.result.refused", { n: fmtNumber(result.refused) })}</p> : null}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t("stale.result.close")}
        </Button>
      </div>
      {asked.length || refused.length ? (
        <ul className="space-y-1 text-xs text-fg-muted">
          {refused.map((row) => (
            <li key={row.taskId}>
              <Link href={`/tasks/${row.taskId}`} className="text-fg hover:underline">
                {titles.get(row.taskId) ?? row.taskId}
              </Link>
              {" — "}
              {t("stale.result.reason")}: {t(row.error ?? "stale.refused.failed")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
