"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronLeft, ChevronRight, Pencil, Plus, Target, Trash2, UserRound } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtShort, monthName } from "@/lib/format";
import { KR_MAX, type GoalLightKey } from "@/lib/okr";
import { cn } from "@/lib/utils";
import {
	FormulaBox,
	KeyResultsList,
	KrFields,
	LightBadge,
	LightPanel,
	emptyDraft,
	okrErrText,
	payloadOf,
	type KeyResultRow,
	type KrDraft,
} from "@/components/okr/okr-parts";

const errText = okrErrText;

type Period = "WEEKLY" | "MONTHLY" | "QUARTERLY";

interface GoalRow {
	id: string;
	title: string;
	description: string | null;
	period: Period;
	periodStart: string;
	periodEnd: string;
	progress: number;
	manualProgress: number;
	fromKeyResults: boolean;
	departmentId: string | null;
	departmentName: string | null;
	creatorName: string;
	// «الأهداف والنتائج» (all empty / false while the switch is off)
	ownerId: string | null;
	ownerName: string | null;
	light: GoalLightKey | null;
	keyResults: KeyResultRow[];
	/** The viewer may change the texts, the key results and the owner / check in and set the light. */
	canEdit: boolean;
	canAct: boolean;
}

interface GoalsAnswer {
	goals: GoalRow[];
	/** The space the viewer is in: where the editor looks for people and projects. */
	spaceId: string | null;
	/** The «الأهداف والنتائج» switch. */
	okr: boolean;
}

function shiftPeriod(period: Period, iso: string, delta: number): string {
	const p = iso.split("-").map(Number);
	const d = new Date(p[0]!, p[1]! - 1, p[2]!, 12);
	if (period === "WEEKLY") {
		d.setDate(d.getDate() + delta * 7);
	} else if (period === "QUARTERLY") {
		d.setMonth(d.getMonth() + delta * 3);
	} else {
		d.setMonth(d.getMonth() + delta);
	}
	const m = d.getMonth() + 1;
	const dd = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
}

function inPeriod(goal: GoalRow, iso: string): boolean {
	const p = iso.split("-").map(Number);
	const day = new Date(p[0]!, p[1]! - 1, p[2]!, 12).getTime();
	return day >= new Date(goal.periodStart).getTime() && day <= new Date(goal.periodEnd).getTime();
}

/** A day inside the goal's period (its middle), as the person's calendar writes it: the stored start is an instant, and its UTC date may be the day before. */
function anchorOf(goal: GoalRow): string {
	const d = new Date((new Date(goal.periodStart).getTime() + new Date(goal.periodEnd).getTime()) / 2);
	const m = d.getMonth() + 1;
	const dd = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
}

function periodLabel(period: Period, iso: string, t: (k: string, p?: Record<string, string | number>) => string): string {
	const p = iso.split("-").map(Number);
	const d = new Date(p[0]!, p[1]! - 1, p[2]!, 12);
	if (period === "MONTHLY") {
		return monthName(d.getMonth()) + " " + d.getFullYear();
	}
	if (period === "QUARTERLY") {
		return t("okr.quarterLabel", { n: Math.floor(d.getMonth() / 3) + 1, year: d.getFullYear() });
	}
	const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay(), 12);
	const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
	return fmtShort(start) + " — " + fmtShort(end);
}

const PERIOD_KEY: Record<Period, string> = { WEEKLY: "goal.weekly", MONTHLY: "goal.monthly", QUARTERLY: "okr.quarterly" };

/** الأهداف الأسبوعية والشهرية والربعية — period goals with live progress and, behind the «الأهداف والنتائج» switch, key results. */
/** `canManage`: the goals box «يضيف ويعدّل»; `canDelete`: «يحذف» (absent: as `canManage`). */
export function GoalsView({ canManage, canDelete = canManage }: { canManage: boolean; canDelete?: boolean }) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [period, setPeriod] = useState<Period>("WEEKLY");
	const [anchor, setAnchor] = useState(() => {
		const d = new Date();
		const m = d.getMonth() + 1;
		const dd = d.getDate();
		return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
	});
	const [editing, setEditing] = useState<GoalRow | "new" | null>(null);

	const goals = useQuery({
		queryKey: ["goals"],
		queryFn: () => apiGet<GoalsAnswer>("/api/goals"),
	});
	const okr = goals.data?.okr ?? false;
	const spaceId = goals.data?.spaceId ?? null;

	// the space's projects, for «ربط النتيجة بمشروع» (the projects of «الشركة» are none: nothing to link there)
	const projects = useQuery({
		queryKey: ["goal-projects", spaceId],
		enabled: okr && Boolean(spaceId),
		queryFn: () => apiGet<{ projects: { id: string; name: string }[] }>(`/api/projects?workspaceId=${spaceId}`),
		retry: false,
	});
	const projectList = projects.data?.projects ?? [];

	const invalidate = () => qc.invalidateQueries({ queryKey: ["goals"] });

	const remove = useMutation({
		mutationFn: (id: string) => apiDelete(`/api/goals/${id}`),
		onSuccess: () => {
			toast(t("goal.deleted"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const progress = useMutation({
		mutationFn: ({ id, progress }: { id: string; progress: number }) =>
			apiPatch(`/api/goals/${id}`, { progress }),
		onSuccess: () => invalidate(),
		onError: (err) => toast(errText(err, t), "error"),
	});

	const setLight = useMutation({
		mutationFn: ({ id, light }: { id: string; light: GoalLightKey | null }) => apiPatch(`/api/goals/${id}`, { light }),
		onSuccess: () => {
			invalidate();
			toast(t("okr.lightSaved"), "success");
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const periods: Period[] = okr ? ["WEEKLY", "MONTHLY", "QUARTERLY"] : ["WEEKLY", "MONTHLY"];
	// the quarterly tab disappears with the switch: fall back to the month
	const shown: Period = periods.includes(period) ? period : "MONTHLY";
	const inView = (goals.data?.goals ?? []).filter((g) => g.period === shown && inPeriod(g, anchor));

	return (
		<div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
						<Target className="size-5 text-accent" />
						{t(okr ? "okr.pageTitle" : "goal.title")}
					</h1>
					<p className="text-xs text-fg-muted">{t(okr ? "okr.subtitle" : "goal.subtitle")}</p>
				</div>
				{canManage ? (
					<Button size="sm" onClick={() => setEditing("new")}>
						<Plus className="size-4" />
						{t("goal.new")}
					</Button>
				) : null}
			</header>

			<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
				<div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
					{periods.map((p) => (
						<button
							key={p}
							type="button"
							onClick={() => setPeriod(p)}
							className={cn(
								"rounded-md px-3 py-1 text-xs font-medium transition-colors",
								shown === p ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg",
							)}
						>
							{t(PERIOD_KEY[p])}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="ghost" aria-label={t("goal.prev")} onClick={() => setAnchor(shiftPeriod(shown, anchor, -1))}>
						<ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
					</Button>
					<span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
						<CalendarRange className="size-4 text-accent" />
						{periodLabel(shown, anchor, t)}
					</span>
					<Button size="sm" variant="ghost" aria-label={t("goal.next")} onClick={() => setAnchor(shiftPeriod(shown, anchor, 1))}>
						<ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" />
					</Button>
				</div>
			</div>

			{inView.length === 0 ? (
				<p className="rounded-xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-muted">
					{t("goal.none")}
				</p>
			) : (
				<ul className="space-y-3">
					{inView.map((g) => {
						const achieved = g.progress >= 100;
						// switched off, the box alone decides (as before); on, it also takes being the goal's owner or an admin of its space
						const mayEdit = okr ? g.canEdit : canManage;
						return (
							<li key={g.id} className="rounded-xl border border-border bg-surface p-4 shadow-card">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div className="min-w-0 flex-1">
										<p className={cn("text-sm font-semibold", achieved ? "text-ok" : "text-fg")}>
											{g.title}
										</p>
										{g.description ? <p className="mt-0.5 text-xs text-muted">{g.description}</p> : null}
										<p className="mt-0.5 text-xs text-muted">
											{g.departmentName ? g.departmentName + " · " : ""}
											{periodLabel(g.period, anchorOf(g), t)}
										</p>
										{okr && g.ownerName ? (
											<p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
												<UserRound className="size-3" />
												{t("okr.ownerLine", { name: g.ownerName })}
											</p>
										) : null}
									</div>
									<div className="flex shrink-0 items-center gap-1">
										{okr && g.light ? <LightBadge light={g.light} /> : null}
										{achieved ? (
											<span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok">
												{t("goal.achieved")}
											</span>
										) : null}
										{canManage && mayEdit ? (
											<>
												<Button size="sm" variant="ghost" aria-label={t("goal.edit")} onClick={() => setEditing(g)}>
													<Pencil className="size-3.5" />
												</Button>
												{canDelete ? (
													<Button
														size="sm"
														variant="ghost"
														aria-label={t("goal.remove")}
														className="text-danger"
														onClick={() => {
															if (confirm(t("goal.removeConfirm", { title: g.title }))) remove.mutate(g.id);
														}}
													>
														<Trash2 className="size-3.5" />
													</Button>
												) : null}
											</>
										) : null}
									</div>
								</div>
								<div className="mt-2 flex items-center gap-3">
									<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
										<div
											className={cn("h-2.5 rounded-full transition-all", achieved ? "bg-ok" : "bg-accent")}
											style={{ width: `${g.progress}%` }}
										/>
									</div>
									<span className="w-10 text-end text-xs font-semibold text-fg">{g.progress}%</span>
								</div>
								{okr ? (
									<p className="mt-1 text-xs text-fg-muted">
										{g.fromKeyResults ? t("okr.progressFrom", { n: g.keyResults.length }) : t("okr.progressManual")}
									</p>
								) : null}
								{mayEdit && canManage && !(okr && g.fromKeyResults) ? (
									<input
										type="range"
										min={0}
										max={100}
										value={g.progress}
										onChange={(e) => {
											const v = Number(e.target.value);
											progress.mutate({ id: g.id, progress: v });
										}}
										className="mt-2 w-full accent-[var(--accent)]"
										aria-label={t("goal.progress")}
									/>
								) : null}
								{okr ? (
									<div className="mt-3 space-y-3">
										<KeyResultsList goalId={g.id} keyResults={g.keyResults} canEdit={canManage && g.canEdit} canAct={g.canAct} projects={projectList} />
										<FormulaBox goal={g} />
										<LightPanel
											goal={g}
											canAct={g.canAct}
											busy={setLight.isPending}
											onSet={(light) => setLight.mutate({ id: g.id, light })}
										/>
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}

			{editing ? (
				<GoalEditor
					goal={editing === "new" ? null : editing}
					defaultAnchor={anchor}
					defaultPeriod={shown}
					okr={okr}
					spaceId={spaceId}
					projects={projectList}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</div>
	);
}

function GoalEditor({
	goal,
	defaultAnchor,
	defaultPeriod,
	okr,
	spaceId,
	projects,
	onClose,
}: {
	goal: GoalRow | null;
	defaultAnchor: string;
	defaultPeriod: Period;
	okr: boolean;
	spaceId: string | null;
	projects: { id: string; name: string }[];
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [title, setTitle] = useState(goal?.title ?? "");
	const [description, setDescription] = useState(goal?.description ?? "");
	const [period, setPeriod] = useState<string>(goal?.period ?? defaultPeriod);
	const [anchorDate, setAnchorDate] = useState(goal ? anchorOf(goal) : defaultAnchor);
	const [progress, setProgress] = useState(goal?.manualProgress ?? 0);
	// the owner: "" is «اللي أنشأ الهدف»
	const [ownerId, setOwnerId] = useState(goal?.ownerId ?? "");
	const [drafts, setDrafts] = useState<KrDraft[]>([]);

	const members = useQuery({
		queryKey: ["goal-members", spaceId],
		enabled: okr && Boolean(spaceId),
		queryFn: () => apiGet<{ members: { id: string; name: string; role?: string }[] }>(`/api/workspaces/${spaceId}/members`),
		retry: false,
	});
	const people = (members.data?.members ?? []).filter((m) => m.role !== "GUEST" && m.role !== "EXTERNAL");

	const save = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			goal ? apiPatch(`/api/goals/${goal.id}`, payload) : apiPost("/api/goals", payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["goals"] });
			toast(t("goal.saved"), "success");
			onClose();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	return (
		<Modal open onClose={onClose} title={goal ? t("goal.editTitle") : t("goal.newTitle")}>
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					const payload: Record<string, unknown> = {
						title: title.trim(),
						description: description || null,
						period,
						anchorDate,
					};
					if (goal) {
						// the hand-moved number only counts while the goal has no key result
						if (!(okr && goal.fromKeyResults)) payload.progress = progress;
					} else payload.progress = 0;
					if (okr) {
						// a person was chosen, or the goal goes back to the one who made it
						if (goal ? ownerId !== (goal.ownerId ?? "") : ownerId !== "") payload.ownerId = ownerId || null;
						if (!goal) {
							const rows = drafts.filter((d) => d.title.trim() !== "");
							if (rows.length > 0) payload.keyResults = rows.map((d) => payloadOf(d));
						}
					}
					save.mutate(payload);
				}}
			>
				<Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={160} placeholder={t("goal.titlePlaceholder")} />
				<Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("goal.descPlaceholder")} />
				<div className="grid grid-cols-2 gap-2">
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("goal.periodLabel")}</span>
						<Select value={period} onChange={(e) => setPeriod(e.target.value)}>
							<option value="WEEKLY">{t("goal.weekly")}</option>
							<option value="MONTHLY">{t("goal.monthly")}</option>
							{okr || period === "QUARTERLY" ? <option value="QUARTERLY">{t("okr.quarterly")}</option> : null}
						</Select>
					</label>
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("goal.anchorLabel")}</span>
						<Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="h-8" />
					</label>
				</div>
				{okr ? (
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("okr.ownerPick")}</span>
						<Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
							<option value="">{t("okr.ownerDefault")}</option>
							{people.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
								</option>
							))}
						</Select>
					</label>
				) : null}
				{goal && !(okr && goal.fromKeyResults) ? (
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("goal.progress")}: {progress}%</span>
						<input
							type="range"
							min={0}
							max={100}
							value={progress}
							onChange={(e) => setProgress(Number(e.target.value))}
							className="w-full accent-[var(--accent)]"
						/>
					</label>
				) : null}
				{okr && !goal ? (
					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div>
								<p className="text-xs font-semibold text-fg">{t("okr.keyResults")}</p>
								<p className="text-xs text-fg-muted">{t("okr.keyResultsHint")}</p>
							</div>
							{drafts.length < KR_MAX ? (
								<Button type="button" size="sm" variant="ghost" onClick={() => setDrafts([...drafts, emptyDraft()])}>
									<Plus className="size-3.5" />
									{t("okr.add")}
								</Button>
							) : (
								<span className="text-xs text-fg-muted">{t("okr.maxFive")}</span>
							)}
						</div>
						{drafts.map((d, i) => (
							<div key={i} className="space-y-2 rounded-lg border border-border bg-surface-1 p-2.5">
								<KrFields draft={d} projects={projects} onChange={(next) => setDrafts(drafts.map((x, j) => (j === i ? next : x)))} />
								<div className="flex justify-end">
									<Button type="button" size="sm" variant="ghost" className="text-danger" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
										<Trash2 className="size-3.5" />
										{t("okr.krRemove")}
									</Button>
								</div>
							</div>
						))}
					</div>
				) : null}
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
