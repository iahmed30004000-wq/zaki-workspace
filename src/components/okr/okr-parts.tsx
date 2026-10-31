"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History as HistoryIcon, Link2, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtAgo } from "@/lib/format";
import { GOAL_LIGHTS, KR_MAX, suggestLight, type GoalLightKey } from "@/lib/okr";
import { cn } from "@/lib/utils";

/** What the goals API says about a key result (src/server/services/okr.ts `KeyResultDto`). */
export interface KeyResultRow {
  id: string;
  title: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
  position: number;
  percent: number;
  linked: { kind: "project"; projectId: string; projectName: string; done: number; total: number } | { kind: "tasks"; done: number; total: number } | null;
  lastCheckInAt: string | null;
}

/** A readable number: Western digits, at most two decimals, thousands separated by plain commas. */
export function fmtValue(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  const [whole = "0", fraction] = String(Math.abs(rounded)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (rounded < 0 ? "-" : "") + grouped + (fraction ? "." + fraction : "");
}

/** The words of a refusal: the specific rule when the server named one, otherwise the general line. */
export function okrErrText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    const issue = Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined)?.message : undefined;
    for (const key of [typeof issue === "string" ? issue : null, err.messageKey]) {
      if (key) {
        const x = t(key);
        if (x !== key) return x;
      }
    }
  }
  return t("common.error");
}

const LIGHT_STYLE: Record<GoalLightKey, string> = {
  ON_TRACK: "border-ok/40 bg-ok/10 text-ok",
  BEHIND: "border-warn/40 bg-warn/10 text-warn",
  AT_RISK: "border-danger/40 bg-danger/10 text-danger",
};

export function LightBadge({ light }: { light: GoalLightKey }) {
  return <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", LIGHT_STYLE[light])}>{enumLabel("GoalLight", light)}</span>;
}

/**
 * The status light of a goal. A PERSON sets it (the owner of the goal, the space's admin, the owner of the company); the system only
 * SUGGESTS one, drawn apart and labelled «اقتراح» with the warning and its fix under it.
 */
export function LightPanel({
  goal,
  canAct,
  onSet,
  busy,
}: {
  goal: { light: GoalLightKey | null; progress: number; periodStart: string; periodEnd: string };
  canAct: boolean;
  onSet: (light: GoalLightKey | null) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const suggested = suggestLight({ percent: goal.progress, periodStart: new Date(goal.periodStart), periodEnd: new Date(goal.periodEnd), now: new Date() });
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-surface-1 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-fg-muted">{t("okr.lightTitle")}</span>
        {goal.light ? <LightBadge light={goal.light} /> : <span className="text-xs text-fg-muted">{t("okr.lightNone")}</span>}
      </div>
      {canAct ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {GOAL_LIGHTS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={busy}
              aria-pressed={goal.light === l}
              onClick={() => onSet(l)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                goal.light === l ? LIGHT_STYLE[l] : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {enumLabel("GoalLight", l)}
            </button>
          ))}
          {goal.light ? (
            <button type="button" disabled={busy} onClick={() => onSet(null)} className="text-xs text-fg-muted underline hover:text-fg disabled:opacity-50">
              {t("okr.lightClear")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-0.5 border-t border-border pt-1.5 text-xs text-fg-muted">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-fg">{t("okr.suggest", { light: enumLabel("GoalLight", suggested) })}</span>
        </p>
        <p>{t("okr.suggestWarn")}</p>
        <p>{t("okr.suggestFix")}</p>
      </div>
    </div>
  );
}

/** The small box that shows how the number was reached, with this goal's own figures. */
export function FormulaBox({ goal }: { goal: { progress: number; fromKeyResults: boolean; keyResults: KeyResultRow[] } }) {
  const { t } = useI18n();
  return (
    <div className="space-y-0.5 rounded-lg border border-border bg-surface-1 px-2.5 py-2 text-xs text-fg-muted">
      <p className="font-medium text-fg">{t("okr.formulaTitle")}</p>
      {goal.fromKeyResults ? (
        <>
          <p>{t("okr.formulaKr")}</p>
          <p>{t("okr.formulaGoal")}</p>
          <p className="font-medium text-fg" dir="ltr" style={{ unicodeBidi: "plaintext" }}>
            {"(" + goal.keyResults.map((k) => k.percent + "%").join(" + ") + ") ÷ " + goal.keyResults.length + " = " + goal.progress + "%"}
          </p>
        </>
      ) : (
        <p>{t("okr.formulaManual")}</p>
      )}
    </div>
  );
}

export interface KrDraft {
  title: string;
  startValue: string;
  targetValue: string;
  unit: string;
  projectId: string;
}

export const emptyDraft = (): KrDraft => ({ title: "", startValue: "0", targetValue: "", unit: "", projectId: "" });

export function draftOf(kr: KeyResultRow): KrDraft {
  return {
    title: kr.title,
    startValue: String(kr.startValue),
    targetValue: String(kr.targetValue),
    unit: kr.unit,
    projectId: kr.linked?.kind === "project" ? kr.linked.projectId : "",
  };
}

/** The body the API takes from a draft (numbers as numbers, a blank target left out so a linked one defaults to all its tasks). */
export function payloadOf(d: KrDraft, opts: { keepTaskLink?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = { title: d.title.trim(), unit: d.unit.trim() };
  if (!d.projectId) body["startValue"] = Number(d.startValue === "" ? 0 : d.startValue);
  if (d.targetValue !== "") body["targetValue"] = Number(d.targetValue);
  if (!opts.keepTaskLink) body["projectId"] = d.projectId || null;
  return body;
}

/** The fields of one key result (used by the goal's editor, one row each, and by the key result's own editor). */
export function KrFields({
  draft,
  onChange,
  projects,
  tasksLinked,
}: {
  draft: KrDraft;
  onChange: (d: KrDraft) => void;
  projects: { id: string; name: string }[];
  tasksLinked?: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<KrDraft>) => onChange({ ...draft, ...patch });
  const linked = Boolean(draft.projectId) || Boolean(tasksLinked);
  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">{t("okr.krTitle")}</span>
        <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} minLength={2} maxLength={160} placeholder={t("okr.krTitlePlaceholder")} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {linked ? null : (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">{t("okr.krStart")}</span>
            <Input type="number" step="any" value={draft.startValue} onChange={(e) => set({ startValue: e.target.value })} />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">{t("okr.krTarget")}</span>
          <Input type="number" step="any" value={draft.targetValue} onChange={(e) => set({ targetValue: e.target.value })} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">{t("okr.krUnit")}</span>
          <Input value={draft.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={24} placeholder={t("okr.krUnitPlaceholder")} />
        </label>
      </div>
      {tasksLinked ? null : projects.length > 0 ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">{t("okr.link")}</span>
          <Select value={draft.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">{t("okr.linkNone")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {t("okr.linkProject")}: {p.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {linked ? (
        <p className="text-xs text-fg-muted">
          {t("okr.linkedWarn")} {t("okr.linkedFix")}
        </p>
      ) : null}
    </div>
  );
}

/** Adds a key result to a goal, or edits one. */
export function KrEditor({
  goalId,
  kr,
  projects,
  onClose,
}: {
  goalId: string;
  kr: KeyResultRow | null;
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<KrDraft>(kr ? draftOf(kr) : emptyDraft());
  const tasksLinked = kr?.linked?.kind === "tasks";
  const save = useMutation({
    mutationFn: () => {
      const body = payloadOf(draft, { keepTaskLink: tasksLinked });
      return kr ? apiPatch(`/api/key-results/${kr.id}`, body) : apiPost(`/api/goals/${goalId}/key-results`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast(t("okr.krSaved"), "success");
      onClose();
    },
    onError: (err) => toast(okrErrText(err, t), "error"),
  });
  return (
    <Modal open onClose={onClose} title={kr ? t("okr.krEdit") : t("okr.add")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <KrFields draft={draft} onChange={setDraft} projects={projects} tasksLinked={tasksLinked} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** One check-in: the value now and a short note. */
export function CheckInDialog({ kr, onClose }: { kr: KeyResultRow; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState(String(kr.currentValue));
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => apiPost(`/api/key-results/${kr.id}/updates`, { value: Number(value), note: note.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["kr-updates", kr.id] });
      toast(t("okr.checkInDone"), "success");
      onClose();
    },
    onError: (err) => toast(okrErrText(err, t), "error"),
  });
  return (
    <Modal open onClose={onClose} title={t("okr.checkInTitle", { title: kr.title })}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (value !== "" && Number.isFinite(Number(value))) save.mutate();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">
            {t("okr.checkInValue")}
            {kr.unit ? " (" + kr.unit + ")" : ""}
          </span>
          <Input type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">{t("okr.checkInNote")}</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder={t("okr.checkInNotePlaceholder")} />
        </label>
        <p className="text-xs text-fg-muted">{t("okr.historyNote")}</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {t("okr.checkInSave")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface UpdateRow {
  id: string;
  value: number;
  previousValue: number;
  note: string;
  authorName: string | null;
  createdAt: string;
}

/** The history of one key result, newest first. Append-only: there is nothing here to edit or delete. */
export function History({ krId }: { krId: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["kr-updates", krId], queryFn: () => apiGet<{ updates: UpdateRow[] }>(`/api/key-results/${krId}/updates`) });
  const rows = q.data?.updates ?? [];
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-surface-1 p-2.5 text-xs">
      {q.isLoading ? null : rows.length === 0 ? (
        <p className="text-fg-muted">{t("okr.historyEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((u) => (
            <li key={u.id} className="space-y-0.5">
              <p className="font-medium text-fg" dir="ltr" style={{ unicodeBidi: "plaintext" }}>
                {t("okr.historyLine", { previous: fmtValue(u.previousValue), value: fmtValue(u.value) })}
              </p>
              {u.note ? <p className="text-fg">{u.note}</p> : null}
              <p className="text-fg-muted">{t("okr.historyBy", { name: u.authorName ?? "", when: fmtAgo(u.createdAt) })}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border pt-1.5 text-fg-muted">{t("okr.historyNote")}</p>
    </div>
  );
}

/** The key results of one goal, each with its numbers, its link, its check-in and its history. */
export function KeyResultsList({
  goalId,
  keyResults,
  canEdit,
  canAct,
  projects,
}: {
  goalId: string;
  keyResults: KeyResultRow[];
  canEdit: boolean;
  canAct: boolean;
  projects: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<KeyResultRow | "new" | null>(null);
  const [checking, setChecking] = useState<KeyResultRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/key-results/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast(t("okr.krRemoved"), "success");
    },
    onError: (err) => toast(okrErrText(err, t), "error"),
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg">{t("okr.keyResults")}</p>
        {canEdit ? (
          keyResults.length >= KR_MAX ? (
            <span className="text-xs text-fg-muted">{t("okr.maxFive")}</span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" />
              {t("okr.add")}
            </Button>
          )
        ) : null}
      </div>
      {keyResults.length === 0 ? (
        <p className="text-xs text-fg-muted">{t("okr.noKeyResults")}</p>
      ) : (
        <ul className="space-y-2">
          {keyResults.map((k) => (
            <li key={k.id} className="rounded-lg border border-border bg-surface-1 p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{k.title}</p>
                  <p className="text-xs text-fg-muted">
                    {k.unit
                      ? t("okr.krValueUnit", { value: fmtValue(k.currentValue), target: fmtValue(k.targetValue), unit: k.unit })
                      : t("okr.krValue", { value: fmtValue(k.currentValue), target: fmtValue(k.targetValue) })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="w-10 text-end text-xs font-semibold text-fg">{k.percent}%</span>
                  {canAct && !k.linked ? (
                    <Button size="sm" variant="secondary" onClick={() => setChecking(k)}>
                      <TrendingUp className="size-3.5" />
                      {t("okr.checkIn")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" aria-label={t("okr.history")} aria-pressed={open === k.id} onClick={() => setOpen(open === k.id ? null : k.id)}>
                    <HistoryIcon className="size-3.5" />
                  </Button>
                  {canEdit ? (
                    <>
                      <Button size="sm" variant="ghost" aria-label={t("okr.krEdit")} onClick={() => setEditing(k)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("okr.krRemove")}
                        className="text-danger"
                        onClick={() => {
                          if (confirm(t("okr.krRemoveConfirm", { title: k.title }))) remove.mutate(k.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className={cn("h-1.5 rounded-full transition-all", k.percent >= 100 ? "bg-ok" : "bg-accent")} style={{ width: `${k.percent}%` }} />
              </div>
              {k.linked ? (
                <div className="mt-1.5 space-y-0.5 text-xs text-fg-muted">
                  <p className="flex items-center gap-1">
                    <Link2 className="size-3" />
                    {k.linked.kind === "project"
                      ? t("okr.linkProjectLine", { name: k.linked.projectName, done: k.linked.done, total: k.linked.total })
                      : t("okr.linkTasksLine", { done: k.linked.done, total: k.linked.total })}
                  </p>
                  <p>{t("okr.linkedWarn")}</p>
                  <p>{t("okr.linkedFix")}</p>
                </div>
              ) : null}
              {open === k.id ? <History krId={k.id} /> : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <KrEditor goalId={goalId} kr={editing === "new" ? null : editing} projects={projects} onClose={() => setEditing(null)} /> : null}
      {checking ? <CheckInDialog kr={checking} onClose={() => setChecking(null)} /> : null}
    </div>
  );
}
