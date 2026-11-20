"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckSquare, ChevronLeft, ChevronRight, Cog, Factory, Plus, Square, Trash2, Pencil } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtLongDate } from "@/lib/format";
import { zonedParts } from "@/lib/zoned-time";
import { cn } from "@/lib/utils";

function errText(err: unknown, t: (k: string) => string): string {
	if (err instanceof ApiError && err.messageKey) {
		const x = t(err.messageKey);
		return x !== err.messageKey ? x : t("common.error");
	}
	return t("common.error");
}

interface ChecklistItem {
	id: string;
	title: string;
	description: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	doneAt: string | null;
	/** W1.6: the routine became a recurring task; this line is its old log, read-only. */
	archived?: boolean;
}

/** W1.6: the task a routine became, as this person may read it (named, or only «hidden»). */
type LinkedTask = { state: "visible"; id: string; key: string; title: string } | { state: "hidden" };

interface RoutineRow {
	id: string;
	title: string;
	description: string | null;
	departmentId: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	weekdays: string;
	active: boolean;
	convertedTask?: LinkedTask | null;
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayIso(d: Date, timeZone?: string): string {
	if (timeZone) {
		const p = zonedParts(d, timeZone);
		const m = p.month;
		const day = p.day;
		return p.year + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
	}
	const m = d.getMonth() + 1;
	const day = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}

function shiftDay(s: string, delta: number): string {
	const p = s.split("-");
	const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
	d.setDate(d.getDate() + delta);
	const m = d.getMonth() + 1;
	const dd = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
}

/** "الخميس 22 تشرين الأول 2026" for a "YYYY-MM-DD" day. */
function dayLabel(day: string): string {
	const p = day.split("-");
	return fmtLongDate(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12));
}

/**
 * W1.6 ⚠️ + 🔧: the daily routine does what a recurring task does. We do not remove it, we mark it and give the way out: every routine can become ONE
 * recurring task (the old routine is archived, its logs stay readable). Shown to everybody who may open the page.
 */
export function RoutineDuplicateNotice() {
	const { t } = useI18n();
	return (
		<div role="note" data-duplicate-notice="routine" className="space-y-0.5 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg">
			<p className="font-medium">
				<span aria-hidden="true">⚠️ </span>
				{t("prod.dup.warn")}
			</p>
			<p className="text-fg-muted">
				<span aria-hidden="true">🔧 </span>
				{t("prod.dup.fix")}
			</p>
		</div>
	);
}

/** «حوّل الروتين لمهام متكررة»: ONE routine, ONE recurring task; a second click only says it was done. */
function ConvertRoutineButton({ routineId }: { routineId: string }) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const convert = useMutation({
		mutationFn: () => apiPost<{ created: boolean; task: LinkedTask }>(`/api/production/routines/${routineId}/convert`, {}),
		onSuccess: (res) => {
			toast(t(res.created ? "prod.dup.done" : "prod.dup.already"), "success");
			qc.invalidateQueries({ queryKey: ["production"] });
		},
		onError: (err) => toast(errText(err, t), "error"),
	});
	return (
		<Button size="sm" variant="secondary" disabled={convert.isPending} onClick={() => convert.mutate()}>
			<span aria-hidden="true">🔧</span>
			{t(convert.isPending ? "prod.dup.converting" : "prod.dup.convert")}
		</Button>
	);
}

/** The task a routine became: a link when the person may open it, else only the fact. */
function ConvertedTaskLine({ task }: { task: LinkedTask }) {
	const { t } = useI18n();
	return task.state === "visible" ? (
		<Link href={`/tasks/${task.id}`} className="text-xs text-accent hover:underline">
			{t("prod.dup.task_open")} · {task.key}
		</Link>
	) : (
		<span className="text-xs text-muted">{t("prod.dup.task_hidden")}</span>
	);
}

/** الروتين اليومي — recurring daily checklist with per-day completion. */
/** `readOnly`: an external partner (guest) sees the checklist but cannot tick anything (the server refuses too). */
export function ProductionView({
	canManage,
	canDelete = canManage,
	readOnly = false,
	timeZone,
}: {
	/** The production box «يضيف ويعدّل»: opens the routine manager. */
	canManage: boolean;
	/** «يحذف»: the delete button in the manager (absent: as `canManage`). */
	canDelete?: boolean;
	readOnly?: boolean;
	/** The company's zone: the default day is its today, not the browser's. */
	timeZone?: string;
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [day, setDay] = useState(() => dayIso(new Date(), timeZone));
	const [manageOpen, setManageOpen] = useState(false);

	const checklist = useQuery({
		queryKey: ["production", "checklist", day],
		queryFn: () => apiGet<{ day: string; items: ChecklistItem[] }>(`/api/production?day=${day}`),
	});

	const routines = useQuery({
		queryKey: ["production", "routines"],
		queryFn: () => apiGet<{ routines: RoutineRow[] }>("/api/production/routines"),
		enabled: canManage && manageOpen,
	});

	const directory = useQuery({
		queryKey: ["ws-directory"],
		queryFn: () => apiGet<{ people: { userId: string; user: { id: string; name: string } }[] }>("/api/chat/directory"),
		enabled: canManage && manageOpen,
	});

	const toggle = useMutation({
		mutationFn: ({ routineId, done }: { routineId: string; done: boolean }) =>
			apiPost("/api/production/checklist", { routineId, day, done }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["production", "checklist", day] }),
		onError: (err) => toast(errText(err, t), "error"),
	});

	const items = checklist.data?.items ?? [];
	const doneCount = items.filter((i) => i.doneAt).length;

	return (
		<div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
						<Factory className="size-5 text-accent" />
						{t("prod.title")}
					</h1>
					<p className="text-xs text-fg-muted">{t("prod.subtitle")}</p>
				</div>
				{canManage ? (
					<Button size="sm" variant="secondary" onClick={() => setManageOpen(true)}>
						<Cog className="size-4" />
						{t("prod.manage")}
					</Button>
				) : null}
			</header>

			<RoutineDuplicateNotice />

			<div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
				<Button size="sm" variant="ghost" aria-label={t("prod.prevDay")} onClick={() => setDay(shiftDay(day, -1))}>
					<ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
				</Button>
				<div className="text-center">
					<p className="text-sm font-semibold text-fg">{dayLabel(day)}</p>
					<p className="text-xs text-muted">
						{items.length > 0 ? `${doneCount}/${items.length} ${t("prod.doneRatio")}` : t("prod.noSchedule")}
					</p>
				</div>
				<Button size="sm" variant="ghost" aria-label={t("prod.nextDay")} onClick={() => setDay(shiftDay(day, 1))}>
					<ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" />
				</Button>
			</div>

			<div className="h-2 overflow-hidden rounded-full bg-surface-2">
				<div
					className="h-2 rounded-full bg-accent transition-all"
					style={{ width: items.length > 0 ? `${(doneCount / items.length) * 100}%` : "0%" }}
				/>
			</div>

			<ul className="space-y-2">
				{items.map((item) => {
					const done = item.doneAt != null;
					const archived = item.archived === true;
					return (
						<li
							key={item.id}
							className={cn(
								"flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-card transition-colors",
								done && "border-ok/40 bg-ok/5",
							)}
						>
							<button
								aria-label={done ? t("prod.uncheck") : t("prod.check")}
								disabled={toggle.isPending || readOnly || archived}
								onClick={() => toggle.mutate({ routineId: item.id, done: !done })}
								className="shrink-0"
							>
								{done ? (
									<CheckSquare className="size-5 text-ok" />
								) : (
									<Square className="size-5 text-muted hover:text-accent" />
								)}
							</button>
							<div className="min-w-0 flex-1">
								<p className={cn("truncate text-sm font-medium", done ? "text-muted line-through" : "text-fg")}>
									{item.title}
								</p>
								<p className="truncate text-xs text-muted">
									{item.assigneeName ? `${t("prod.assignedTo")} ${item.assigneeName}` : t("prod.unassigned")}
									{item.departmentName ? ` · ${item.departmentName}` : ""}
								</p>
								{archived ? <p className="text-xs text-muted">{t("prod.dup.archived_hint")}</p> : null}
							</div>
							{archived ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{t("prod.dup.archived")}</span> : null}
							{canManage && !readOnly && !archived ? <ConvertRoutineButton routineId={item.id} /> : null}
							{item.doneAt ? (
								<span className="flex shrink-0 items-center gap-1 text-xs text-ok">
									<CalendarCheck className="size-3.5" />
									{t("prod.done")}
								</span>
							) : null}
						</li>
					);
				})}
				{items.length === 0 ? (
					<li className="rounded-xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-muted">
						{t("prod.noSchedule")}
					</li>
				) : null}
			</ul>

			{canManage && manageOpen ? (
				<ManageRoutinesModal
					open
					onClose={() => setManageOpen(false)}
					routines={routines.data?.routines ?? []}
					loading={routines.isLoading}
					people={(directory.data?.people ?? []).map((p) => ({ id: p.userId, name: p.user.name }))}
					canDelete={canDelete}
				/>
			) : null}
		</div>
	);
}

function ManageRoutinesModal({
	open,
	onClose,
	routines,
	loading,
	people,
	canDelete,
}: {
	open: boolean;
	onClose: () => void;
	routines: RoutineRow[];
	loading: boolean;
	people: { id: string; name: string }[];
	canDelete: boolean;
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [editing, setEditing] = useState<RoutineRow | "new" | null>(null);

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["production", "routines"] });
		qc.invalidateQueries({ queryKey: ["production", "checklist"] });
	};

	const remove = useMutation({
		mutationFn: (id: string) => apiDelete(`/api/production/routines/${id}`),
		onSuccess: () => {
			toast(t("prod.routineDeleted"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	return (
		<Modal open={open} onClose={onClose} title={t("prod.manageTitle")}>
			<div className="space-y-3">
				<Button
					size="sm"
					onClick={() => setEditing("new")}
					className="w-full"
				>
					<Plus className="size-4" />
					{t("prod.newRoutine")}
				</Button>
				<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
					{routines.map((r) => (
						<li key={r.id} className="flex items-center gap-2 px-3 py-2">
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium text-fg">{r.title}</p>
								<p className="truncate text-xs text-muted">
									{r.weekdays === "" ? t("prod.everyDay") : r.weekdays.split(",").map((w) => t(`prod.wd_${WEEKDAY_KEYS[Number(w)]}`)).join(" · ")}
									{r.assigneeName ? ` · ${r.assigneeName}` : ""}
									{!r.active ? ` · ${t("prod.paused")}` : ""}
								</p>
								{r.convertedTask ? <ConvertedTaskLine task={r.convertedTask} /> : null}
							</div>
							{!r.convertedTask ? <ConvertRoutineButton routineId={r.id} /> : null}
							<Button size="sm" variant="ghost" aria-label={t("prod.editRoutine")} onClick={() => setEditing(r)}>
								<Pencil className="size-3.5" />
							</Button>
							{canDelete ? (
								<Button
									size="sm"
									variant="ghost"
									aria-label={t("prod.deleteRoutine")}
									className="text-danger"
									onClick={() => remove.mutate(r.id)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							) : null}
						</li>
					))}
					{loading ? <li className="px-3 py-3 text-xs text-muted">…</li> : null}
					{!loading && routines.length === 0 ? (
						<li className="px-3 py-4 text-center text-xs text-muted">{t("prod.noRoutines")}</li>
					) : null}
				</ul>
				{editing ? (
					<RoutineEditor
						routine={editing === "new" ? null : editing}
						people={people}
						onClose={() => setEditing(null)}
					/>
				) : null}
			</div>
		</Modal>
	);
}

function RoutineEditor({
	routine,
	people,
	onClose,
}: {
	routine: RoutineRow | null;
	people: { id: string; name: string }[];
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [title, setTitle] = useState(routine?.title ?? "");
	const [description, setDescription] = useState(routine?.description ?? "");
	const [assigneeId, setAssigneeId] = useState(routine?.assigneeId ?? "");
	const [weekdays, setWeekdays] = useState<string[]>(
		routine
			? routine.weekdays === ""
				? [...WEEKDAY_KEYS]
				: routine.weekdays.split(",").map((w) => WEEKDAY_KEYS[Number(w)] ?? "mon")
			: [...WEEKDAY_KEYS],
	);
	const [active, setActive] = useState(routine ? routine.active : true);

	const save = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			routine ? apiPatch(`/api/production/routines/${routine.id}`, payload) : apiPost("/api/production/routines", payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["production"] });
			toast(t("prod.saved"), "success");
			onClose();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const toggleDay = (key: string) => {
		setWeekdays((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
	};

	return (
		<div className="rounded-lg border border-border bg-surface-1 p-3">
			<p className="mb-2 text-xs font-semibold text-fg">{routine ? t("prod.editRoutineTitle") : t("prod.newRoutineTitle")}</p>
			<form
				className="space-y-2"
				onSubmit={(e) => {
					e.preventDefault();
					const payload: Record<string, unknown> = {
						title: title.trim(),
						description: description || null,
						assigneeId: assigneeId || null,
						weekdays: weekdays.map((k) => WEEKDAY_KEYS.indexOf(k)),
						active,
					};
					save.mutate(payload);
				}}
			>
				<Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={120} placeholder={t("prod.routineTitle")} />
				<Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("prod.routineDesc")} />
				<div className="flex flex-wrap gap-1">
					{WEEKDAY_KEYS.map((k) => (
						<button
							key={k}
							type="button"
							onClick={() => toggleDay(k)}
							className={cn(
								"rounded-md border px-2 py-1 text-xs font-medium transition-colors",
								weekdays.includes(k) ? "border-accent/60 bg-accent/10 text-fg" : "border-border text-muted hover:border-accent/40",
							)}
						>
							{t(`prod.wd_${k}`)}
						</button>
					))}
				</div>
				<Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
					<option value="">{t("ticket.unassigned")}</option>
					{people.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</Select>
				<label className="flex items-center gap-2 text-xs text-fg">
					<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
					{t("prod.active")}
				</label>
				<div className="flex justify-end gap-2 pt-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" size="sm" disabled={save.isPending}>
						{t("common.save")}
					</Button>
				</div>
			</form>
		</div>
	);
}
