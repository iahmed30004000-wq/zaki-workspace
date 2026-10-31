"use client";

import * as React from "react";
import Link from "next/link";
import { Pause, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ACTION_TYPES,
  MAX_RULES,
  MAX_RULE_NAME,
  MAX_RULE_NOTE,
  MAX_RULE_STEP,
  MAX_RULE_TEXT,
  RULE_PRIORITIES,
  TRIGGERS,
  type ActionStatus,
  type RuleAction,
  type RuleActionType,
  type RuleDto,
  type RuleOptions,
  type RulePriority,
  type RuleTrigger,
  type RunDto,
  type RunStatus,
} from "@/lib/task-rules";
import { errorKeyOf, rt } from "@/lib/reminders/client";
import { fmtDateTime } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { cn } from "@/lib/utils";

/**
 * «القواعد» on the project's page — the if-then rules of the project: add, edit, pause, resume and delete a rule, and read the log of
 * what the rules did. Only the space's ADMIN and the owner are ever handed this card (the page draws it for nobody else, and the
 * server decides again on every request).
 *
 * ⚠️ + 🔧: the card says, always, that rules act by themselves and how to stop one. Every change is sent at once and the list is
 * read back, so the screen is what is stored.
 */
interface DraftAction {
  type: RuleActionType;
  userId: string;
  priority: RulePriority;
  columnId: string;
  title: string;
  note: string;
  topicId: string;
  text: string;
}

interface Draft {
  id?: string;
  name: string;
  boardId: string;
  trigger: RuleTrigger;
  triggerColumnId: string;
  actions: DraftAction[];
}

const blankAction = (type: RuleActionType = "ASSIGN"): DraftAction => ({ type, userId: "", priority: "HIGH", columnId: "", title: "", note: "", topicId: "", text: "" });
const blank = (options: RuleOptions): Draft => ({
  name: "",
  boardId: options.boards.length === 1 ? (options.boards[0]?.id ?? "") : "",
  trigger: "CREATED",
  triggerColumnId: "",
  actions: [blankAction()],
});

function draftOf(rule: RuleDto): Draft {
  return {
    id: rule.id,
    name: rule.name,
    boardId: rule.boardId ?? "",
    trigger: rule.trigger,
    triggerColumnId: rule.triggerColumnId ?? "",
    actions: rule.actions.map((a) => ({
      ...blankAction(a.type),
      ...(a.type === "ASSIGN" || a.type === "NOTIFY" ? { userId: a.userId } : {}),
      ...(a.type === "NOTIFY" ? { note: a.note ?? "" } : {}),
      ...(a.type === "SET_PRIORITY" ? { priority: a.priority } : {}),
      ...(a.type === "MOVE_TO_COLUMN" ? { columnId: a.columnId } : {}),
      ...(a.type === "ADD_STEP" ? { title: a.title } : {}),
      ...(a.type === "POST_MESSAGE" ? { topicId: a.topicId, text: a.text } : {}),
    })),
  };
}

function actionPayload(a: DraftAction): RuleAction | Record<string, string> {
  switch (a.type) {
    case "ASSIGN":
      return { type: "ASSIGN", userId: a.userId };
    case "SET_PRIORITY":
      return { type: "SET_PRIORITY", priority: a.priority };
    case "MOVE_TO_COLUMN":
      return { type: "MOVE_TO_COLUMN", columnId: a.columnId };
    case "ADD_STEP":
      return { type: "ADD_STEP", title: a.title };
    case "NOTIFY":
      return { type: "NOTIFY", userId: a.userId, note: a.note };
    case "POST_MESSAGE":
      return { type: "POST_MESSAGE", topicId: a.topicId, text: a.text };
  }
}

const box = "h-11 w-full rounded-lg border-muted bg-surface px-3 text-base text-fg placeholder:text-muted focus:border-accent/60 md:h-9 md:text-sm";

const STATUS_CLASS: Record<RunStatus, string> = {
  APPLIED: "bg-ok/10 text-ok",
  PARTIAL: "bg-warn/10 text-warn",
  SKIPPED: "bg-surface-2 text-fg-muted",
  FAILED: "bg-danger/10 text-danger",
};

const RESULT_CLASS: Record<ActionStatus, string> = {
  APPLIED: "text-ok",
  SKIPPED: "text-fg-muted",
  FAILED: "text-danger",
};

export function RulesCard({ projectId, initialRules, options }: { projectId: string; initialRules: RuleDto[]; options: RuleOptions }) {
  const [rules, setRules] = React.useState<RuleDto[]>(initialRules);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [logOpen, setLogOpen] = React.useState(false);
  const [runs, setRuns] = React.useState<RunDto[]>([]);
  const [more, setMore] = React.useState(false);
  const base = `/api/projects/${encodeURIComponent(projectId)}/rules`;

  const columns = React.useMemo(() => new Map(options.boards.flatMap((b) => b.columns.map((c) => [c.id, c.name] as const))), [options]);
  const people = React.useMemo(() => new Map(options.people.map((p) => [p.id, p.name] as const)), [options]);
  const topics = React.useMemo(() => new Map(options.topics.map((p) => [p.id, p.title] as const)), [options]);
  const columnName = (id: string) => columns.get(id) ?? rt("taskrules.gone.column");

  async function reload(): Promise<void> {
    const res = await fetch(base, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setRules(((await res.json()) as { rules: RuleDto[] }).rules);
  }

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null), "taskrules.failed"));
        return false;
      }
      return true;
    } catch {
      setError("taskrules.failed");
      return false;
    } finally {
      await reload();
      if (logOpen) await loadLog(true);
      setBusy(false);
    }
  }

  async function loadLog(fresh: boolean): Promise<void> {
    const before = !fresh && runs.length > 0 ? `&before=${encodeURIComponent(runs[runs.length - 1]!.createdAt)}` : "";
    const res = await fetch(`${base}/log?limit=50${before}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const page = ((await res.json()) as { runs: RunDto[] }).runs;
    setRuns((old) => (fresh ? page : [...old, ...page]));
    setMore(page.length === 50);
  }

  function toggleLog() {
    const next = !logOpen;
    setLogOpen(next);
    if (next) void loadLog(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    const body = {
      name: draft.name,
      trigger: draft.trigger,
      boardId: draft.boardId || null,
      triggerColumnId: draft.trigger === "MOVED_TO_COLUMN" ? draft.triggerColumnId : null,
      actions: draft.actions.map(actionPayload),
    };
    const ok = draft.id
      ? await send(`${base}/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify(body) })
      : await send(base, { method: "POST", body: JSON.stringify(body) });
    if (ok) setDraft(null);
  }

  const setActive = (rule: RuleDto, active: boolean) => send(`${base}/${encodeURIComponent(rule.id)}`, { method: "PATCH", body: JSON.stringify({ active }) });
  async function remove(rule: RuleDto) {
    if (!window.confirm(rt("taskrules.delete_confirm"))) return;
    await send(`${base}/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
  }

  function whenText(rule: RuleDto): string {
    return rt(`taskrules.when.${rule.trigger}`, { column: rule.triggerColumnId ? columnName(rule.triggerColumnId) : "" });
  }
  function thenText(a: RuleAction): string {
    switch (a.type) {
      case "ASSIGN":
      case "NOTIFY":
        return rt(`taskrules.do.${a.type}`, { name: people.get(a.userId) ?? rt("taskrules.gone.person") });
      case "SET_PRIORITY":
        return rt("taskrules.do.SET_PRIORITY", { priority: enumLabel("TaskPriority", a.priority) });
      case "MOVE_TO_COLUMN":
        return rt("taskrules.do.MOVE_TO_COLUMN", { column: columnName(a.columnId) });
      case "ADD_STEP":
        return rt("taskrules.do.ADD_STEP", { title: a.title });
      case "POST_MESSAGE":
        return rt("taskrules.do.POST_MESSAGE", { topic: topics.get(a.topicId) ?? rt("taskrules.gone.topic"), text: a.text });
    }
  }

  const boardColumns = options.boards.find((b) => b.id === draft?.boardId)?.columns ?? [];
  const full = rules.length >= MAX_RULES;
  const namesColumn = draft ? draft.trigger === "MOVED_TO_COLUMN" || draft.actions.some((a) => a.type === "MOVE_TO_COLUMN") : false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-fg">
            <Zap className="h-4 w-4" aria-hidden="true" /> {rt("taskrules.title")}
          </p>
          <span data-rules-counter className="text-xs font-medium text-fg-muted">
            {rt("taskrules.counter", { n: rules.length, max: MAX_RULES })}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{rt("taskrules.hint")}</p>
      </CardHeader>
      <CardBody className="space-y-3">
        <div data-rules-warning className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-xs text-fg">
          <p>{rt("taskrules.note")}</p>
          <p>{rt("taskrules.fix")}</p>
        </div>

        {rules.length === 0 ? <p className="text-xs text-muted">{rt("taskrules.empty")}</p> : null}
        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <li key={rule.id} data-rule-row={rule.id} className={cn("rounded-lg border border-border bg-surface-2/50 p-2.5", !rule.active && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{rule.name}</p>
                {!rule.active ? <Badge>{rt("taskrules.paused_badge")}</Badge> : null}
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void setActive(rule, !rule.active)}>
                  {rule.active ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                  {rule.active ? rt("taskrules.pause") : rt("taskrules.resume")}
                </Button>
                <button type="button" disabled={busy} aria-label={`${rt("taskrules.edit")}: ${rule.name}`} onClick={() => setDraft(draftOf(rule))} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
                  <Pencil className="size-4" aria-hidden="true" />
                </button>
                <button type="button" disabled={busy} aria-label={`${rt("taskrules.delete")}: ${rule.name}`} onClick={() => void remove(rule)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1 text-xs text-fg-muted">{rt("taskrules.sentence", { when: whenText(rule), then: rule.actions.map(thenText).join(" + ") })}</p>
              {rule.runAsName ? <p className="mt-0.5 text-xs text-muted">{rt("taskrules.runs_as", { name: rule.runAsName })}</p> : null}
            </li>
          ))}
        </ul>

        {draft ? (
          <form onSubmit={save} data-rule-form className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("taskrules.form.name")}</span>
              <input value={draft.name} maxLength={MAX_RULE_NAME} required autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={rt("taskrules.form.name_placeholder")} className={box} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("taskrules.form.when")}</span>
              <select value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value as RuleTrigger })} className={cn(box, "max-w-sm")}>
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {rt(`taskrules.trigger.${t}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("taskrules.form.board")}</span>
              <select value={draft.boardId} onChange={(e) => setDraft({ ...draft, boardId: e.target.value, triggerColumnId: "", actions: draft.actions.map((a) => ({ ...a, columnId: "" })) })} required={namesColumn} className={cn(box, "max-w-sm")}>
                <option value="">{namesColumn ? rt("taskrules.form.board_pick") : rt("taskrules.form.board_all")}</option>
                {options.boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {namesColumn ? <span className="mt-1 block text-xs text-muted">{rt("taskrules.form.board_needed")}</span> : null}
            </label>
            {draft.trigger === "MOVED_TO_COLUMN" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("taskrules.form.column")}</span>
                <select value={draft.triggerColumnId} required onChange={(e) => setDraft({ ...draft, triggerColumnId: e.target.value })} className={cn(box, "max-w-sm")}>
                  <option value="">{rt("taskrules.form.column_pick")}</option>
                  {boardColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {draft.actions.map((a, i) => (
              <ActionEditor
                key={i}
                n={i + 1}
                action={a}
                options={options}
                boardColumns={boardColumns}
                taken={draft.actions.filter((_, j) => j !== i).map((x) => x.type)}
                onChange={(next) => setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? next : x)) })}
                onRemove={i === 1 ? () => setDraft({ ...draft, actions: draft.actions.slice(0, 1) }) : null}
              />
            ))}
            {draft.actions.length < 2 ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, actions: [...draft.actions, blankAction(ACTION_TYPES.find((t) => t !== draft.actions[0]?.type) ?? "NOTIFY")] })}>
                <Plus className="size-4" aria-hidden="true" /> {rt("taskrules.form.add_second")}
              </Button>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || draft.name.trim() === ""}>
                {draft.id ? rt("taskrules.form.save") : rt("taskrules.form.create")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {rt("taskrules.form.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled={busy || full} onClick={() => setDraft(blank(options))}>
            <Plus className="size-4" aria-hidden="true" /> {rt("taskrules.new")}
          </Button>
        )}
        {full && !draft ? <p className="text-xs text-muted">{rt("taskrules.limit_reached")}</p> : null}

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {rt(error)}
          </p>
        ) : null}

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-xs font-medium text-fg-muted">{rt("taskrules.log.title")}</p>
            <Button type="button" size="sm" variant="ghost" onClick={toggleLog} aria-expanded={logOpen}>
              {logOpen ? rt("taskrules.log.hide") : rt("taskrules.log.show")}
            </Button>
          </div>
          {logOpen ? (
            <div data-rules-log className="space-y-1.5">
              <p className="text-xs text-muted">{rt("taskrules.log.hint")}</p>
              {runs.length === 0 ? <p className="text-xs text-muted">{rt("taskrules.log.empty")}</p> : null}
              <ul className="space-y-1.5">
                {runs.map((run) => (
                  <li key={run.id} data-rule-run={run.id} className="rounded-lg border border-border px-2.5 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded px-1.5 py-0.5 font-medium", STATUS_CLASS[run.status])}>{rt(`taskrules.status.${run.status}`)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-fg">{run.ruleName}</span>
                      <span className="text-muted">{fmtDateTime(run.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-fg-muted">
                      <Link href={`/tasks/${run.taskId}`} className="text-accent hover:underline">
                        {run.taskKey}
                      </Link>{" "}
                      · {run.taskTitle}
                      {run.runAsName ? ` · ${rt("taskrules.log.as", { name: run.runAsName })}` : ""}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {run.results.map((r, i) => (
                        <li key={i} className={RESULT_CLASS[r.status]}>
                          {rt(`taskrules.action.${r.type}`)}: {rt(`taskrules.result.${r.status}`)}
                          {r.reason ? ` · ${rt(`taskrules.reason.${r.reason}`)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {more ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => void loadLog(false)}>
                  {rt("taskrules.log.more")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function ActionEditor({
  n,
  action,
  options,
  boardColumns,
  taken,
  onChange,
  onRemove,
}: {
  n: number;
  action: DraftAction;
  options: RuleOptions;
  boardColumns: { id: string; name: string }[];
  taken: RuleActionType[];
  onChange: (a: DraftAction) => void;
  onRemove: (() => void) | null;
}) {
  const set = (patch: Partial<DraftAction>) => onChange({ ...action, ...patch });
  return (
    <fieldset data-rule-action className="space-y-2 rounded-lg border border-border p-2.5">
      <legend className="px-1 text-xs font-medium text-fg-muted">{rt("taskrules.form.action", { n })}</legend>
      <label className="block">
        <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.action_type")}</span>
        <select value={action.type} onChange={(e) => set({ type: e.target.value as RuleActionType })} className={cn(box, "max-w-sm")}>
          {ACTION_TYPES.filter((t) => t === action.type || !taken.includes(t)).map((t) => (
            <option key={t} value={t}>
              {rt(`taskrules.action.${t}`)}
            </option>
          ))}
        </select>
      </label>
      {action.type === "ASSIGN" || action.type === "NOTIFY" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.person")}</span>
          <select value={action.userId} required onChange={(e) => set({ userId: e.target.value })} className={cn(box, "max-w-sm")}>
            <option value="">{rt("taskrules.form.person_pick")}</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {action.type === "NOTIFY" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.note")}</span>
          <input value={action.note} maxLength={MAX_RULE_NOTE} onChange={(e) => set({ note: e.target.value })} className={box} />
        </label>
      ) : null}
      {action.type === "SET_PRIORITY" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.priority")}</span>
          <select value={action.priority} onChange={(e) => set({ priority: e.target.value as RulePriority })} className={cn(box, "max-w-sm")}>
            {RULE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {enumLabel("TaskPriority", p)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {action.type === "MOVE_TO_COLUMN" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.column")}</span>
          <select value={action.columnId} required onChange={(e) => set({ columnId: e.target.value })} className={cn(box, "max-w-sm")}>
            <option value="">{rt("taskrules.form.column_pick")}</option>
            {boardColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {action.type === "ADD_STEP" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.step")}</span>
          <input value={action.title} maxLength={MAX_RULE_STEP} required onChange={(e) => set({ title: e.target.value })} className={box} />
        </label>
      ) : null}
      {action.type === "POST_MESSAGE" ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.topic")}</span>
            <select value={action.topicId} required onChange={(e) => set({ topicId: e.target.value })} className={cn(box, "max-w-sm")}>
              <option value="">{rt("taskrules.form.topic_pick")}</option>
              {options.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-fg-muted">{rt("taskrules.form.text")}</span>
            <input value={action.text} maxLength={MAX_RULE_TEXT} required onChange={(e) => set({ text: e.target.value })} placeholder={rt("taskrules.form.text_placeholder")} className={box} />
          </label>
        </>
      ) : null}
      {onRemove ? (
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          <Trash2 className="size-4" aria-hidden="true" /> {rt("taskrules.form.remove_second")}
        </Button>
      ) : null}
    </fieldset>
  );
}
