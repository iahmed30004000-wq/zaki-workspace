import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, audit, requireWorkspace, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertCanWrite } from "@/server/services/guest-guard";
import { assertActiveAssignee } from "@/server/services/active-people";
import { resolveTimeZone, zonedParts, zonedWallTime } from "@/lib/zoned-time";
import { mySpacesWhere, placeWhere, type SpacePlace } from "@/server/services/space-place";
import { AR } from "@/lib/i18n/dict";
import { DEFAULT_BOARD_COLUMNS, createTask } from "@/server/services/tasks";
import { INSTANT_PROJECT_KEY, inboxSpaceFor, inboxTarget } from "@/server/services/instant-work";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { setRecurrence } from "@/server/services/task-recurrence";
import { loadWorkScope, taskVisibleWhere, type TaskVisibility } from "@/server/services/team-scope";
import type { SpaceSubject } from "@/server/services/current-space";
import type { RuleInput } from "@/lib/task-recurrence";

/**
 * Daily production. Reading the checklist and the routine list stays open to every
 * org member; every write (tick a routine off, create/edit/delete one) is refused to
 * org GUESTs with `guest.readonly`, and managing routines is OWNER/ADMIN only.
 * A routine is only ever handed to an ACTIVE member of the organization; one that somebody
 * already holds stays readable (and editable around them) after they are suspended or leave.
 */

/** Local calendar day string "YYYY-MM-DD" (the whole app runs on one machine). */
export function dayIso(d: Date, timeZone?: string): string {
  if (timeZone) {
    // the company's day: the zone's calendar date, whatever the machine says
    const p = zonedParts(d, resolveTimeZone(timeZone));
    const m = p.month;
    const day = p.day;
    return p.year + "-" + (m < 10 ? "0" + m : String(m)) + "-" + (day < 10 ? "0" + day : String(day));
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const mm = m < 10 ? "0" + m : String(m);
  const dd = day < 10 ? "0" + day : String(day);
  return y + "-" + mm + "-" + dd;
}

/** Noon (in `timeZone`, or the machine's zone without one) of the "YYYY-MM-DD" day `s`. */
export function parseDayIso(s: string, timeZone?: string): Date {
  const parts = s.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (timeZone) {
    return zonedWallTime({ year: y, month: m, day: d, hour: 12 }, resolveTimeZone(timeZone));
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function shiftDay(s: string, delta: number): string {
	const d = parseDayIso(s);
	d.setDate(d.getDate() + delta);
	return dayIso(d);
}

export interface RoutineRow {
	id: string;
	title: string;
	description: string | null;
	departmentId: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	weekdays: string;
	active: boolean;
	/** W1.6: the recurring task this routine was turned into (the viewer reads it only when they may open it: else just «hidden»); absent when no viewer was given. */
	convertedTask?: LinkedTaskView | null;
}

/** W1.6: a task a source (a routine, a ticket, a campaign item) was turned into, as one viewer may read it: its name, or only the fact that it exists. */
export type LinkedTaskView = { state: "visible"; id: string; key: string; title: string } | { state: "hidden" };

/**
 * The tasks behind a list of links, as `viewer` may read each one: a task they may open is named, a task that exists but that
 * they may not open is only «hidden» (never its title, key or id), a task that is gone is not in the answer.
 */
export async function taskLinkViews(viewer: { userId: string; orgId: string }, taskIds: readonly string[]): Promise<Map<string, LinkedTaskView>> {
	const ids = [...new Set(taskIds)];
	const out = new Map<string, LinkedTaskView>();
	if (ids.length === 0) return out;
	const scope = await loadWorkScope(viewer.userId);
	const [open, existing] = await Promise.all([
		db.task.findMany({
			where: { id: { in: ids }, orgId: viewer.orgId, AND: [taskVisibleWhere(scope)] },
			select: { id: true, title: true, number: true, organization: { select: { keyPrefix: true } } },
		}),
		// task-visibility: only WHETHER a row exists is read here (no field of it is ever returned): the visible ones are named above, the rest are «hidden»
		db.task.findMany({ where: { id: { in: ids }, orgId: viewer.orgId }, select: { id: true } }),
	]);
	for (const e of existing) out.set(e.id, { state: "hidden" });
	for (const t of open) out.set(t.id, { state: "visible", id: t.id, key: `${t.organization.keyPrefix}-${t.number}`, title: t.title });
	return out;
}

/** The audit line that remembers «this routine became that task» (the routine has no column for it: nothing is added to the routine's table). */
const ROUTINE_CONVERTED = "routine.converted";

/** Routine id → the task it became (the latest line whose task still exists). */
async function convertedTaskIds(orgId: string, routineIds: readonly string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (routineIds.length === 0) return out;
	const rows = await db.auditLog.findMany({
		where: { orgId, action: ROUTINE_CONVERTED, target: { in: [...routineIds] } },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		select: { target: true, meta: true },
	});
	const candidates = rows.flatMap((r) => {
		const m = typeof r.meta === "object" && r.meta !== null ? (r.meta as Record<string, unknown>) : {};
		return r.target && typeof m["taskId"] === "string" ? [{ routineId: r.target, taskId: m["taskId"] }] : [];
	});
	if (candidates.length === 0) return out;
	// task-visibility: only whether the task still exists is read (the viewer's reading of it is `taskLinkViews`)
	const alive = new Set((await db.task.findMany({ where: { id: { in: candidates.map((c) => c.taskId) }, orgId }, select: { id: true } })).map((t) => t.id));
	for (const c of candidates) if (alive.has(c.taskId) && !out.has(c.routineId)) out.set(c.routineId, c.taskId);
	return out;
}

export async function listRoutines(orgId: string, place?: SpacePlace, viewer?: { userId: string }): Promise<RoutineRow[]> {
	const rows = await db.routine.findMany({
		// the routines of the space the person is in (and in «الشركة» the ones from before spaces had their own)
		where: { orgId, ...(place ? { AND: [placeWhere(place)] } : {}) },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			title: true,
			description: true,
			departmentId: true,
			assigneeId: true,
			assignee: { select: { name: true } },
			weekdays: true,
			active: true,
			department: { select: { name: true } },
		},
	});
	// W1.6: which of them became a recurring task, as the viewer may read it (the routine list of a manager)
	let links = new Map<string, LinkedTaskView>();
	let converted = new Map<string, string>();
	if (viewer) {
		converted = await convertedTaskIds(orgId, rows.filter((r) => !r.active).map((r) => r.id));
		links = await taskLinkViews({ userId: viewer.userId, orgId }, [...converted.values()]);
	}
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		description: r.description,
		departmentId: r.departmentId,
		departmentName: r.department?.name ?? null,
		assigneeId: r.assigneeId,
		assigneeName: r.assignee?.name ?? null,
		weekdays: r.weekdays,
		active: r.active,
		...(viewer ? { convertedTask: links.get(converted.get(r.id) ?? "") ?? null } : {}),
	}));
}

/** Does a routine run on the given day? Empty weekdays = every day. The weekday is `timeZone`'s (or the machine's). */
export function runsOnDay(weekdays: string, day: string, timeZone?: string): boolean {
	if (!weekdays || weekdays === "") return true;
	const parts = weekdays.split(",");
	const weekday = String(parseDayIso(day, timeZone).getDay());
	return parts.indexOf(weekday) !== -1;
}

/** Checklist for one day: active routines scheduled that day + today's completion state. */
export async function dayChecklist(orgId: string, day: string, timeZone?: string, place?: SpacePlace) {
	const routines = await db.routine.findMany({
		where: { orgId, active: true, ...(place ? { AND: [placeWhere(place)] } : {}) },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			title: true,
			description: true,
			departmentId: true,
			department: { select: { name: true } },
			assigneeId: true,
			assignee: { select: { name: true } },
			weekdays: true,
		},
	});
	const due = routines.filter((r) => runsOnDay(r.weekdays, day, timeZone));
	const logs = await db.routineLog.findMany({
		where: { routineId: { in: due.map((r) => r.id) }, day },
		select: { routineId: true, completedAt: true, completedById: true },
	});
	const doneMap = new Map(logs.map((l) => [l.routineId, l.completedAt.toISOString()]));
	const items: ChecklistItem[] = due.map((r) => ({
		id: r.id,
		title: r.title,
		description: r.description,
		departmentName: r.department?.name ?? null,
		assigneeId: r.assigneeId,
		assigneeName: r.assignee?.name ?? null,
		doneAt: doneMap.get(r.id) ?? null,
	}));
	// W1.6: a routine that was turned into a recurring task is archived, not deleted: on a day it was ticked, its log is still read here (marked, never ticked again)
	const oldLogs = await db.routineLog.findMany({
		where: { day, routine: { orgId, active: false, ...(place ? { AND: [placeWhere(place)] } : {}) } },
		select: {
			completedAt: true,
			routine: { select: { id: true, title: true, description: true, department: { select: { name: true } }, assigneeId: true, assignee: { select: { name: true } } } },
		},
	});
	if (oldLogs.length > 0) {
		const converted = await convertedTaskIds(orgId, oldLogs.map((l) => l.routine.id));
		for (const l of oldLogs) {
			if (!converted.has(l.routine.id)) continue;
			items.push({
				id: l.routine.id,
				title: l.routine.title,
				description: l.routine.description,
				departmentName: l.routine.department?.name ?? null,
				assigneeId: l.routine.assigneeId,
				assigneeName: l.routine.assignee?.name ?? null,
				doneAt: l.completedAt.toISOString(),
				archived: true,
			});
		}
	}
	return { day, items };
}

export interface ChecklistItem {
	id: string;
	title: string;
	description: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	doneAt: string | null;
	/** W1.6: the routine was turned into a recurring task; this line is its old log, read-only. */
	archived?: true;
}

export const routineSchema = z.object({
	title: z.string().trim().min(2, "title.too_short").max(120),
	description: z.string().trim().max(500).nullable().optional(),
	departmentId: z.string().nullable().optional(),
	assigneeId: z.string().nullable().optional(),
	weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
	active: z.boolean().optional(),
});

function weekdaysToCsv(days: number[] | undefined): string {
	if (!days || days.length === 0 || days.length === 7) return "";
	const sorted = [...new Set(days)].sort((a, b) => a - b);
	return sorted.join(",");
}

/**
 * A department named in a write must be one of the caller's own company (goals and routines both
 * store a `departmentId`): another company's id is "not found", like everywhere else (review B7).
 */
export async function assertDepartmentInOrg(orgId: string, departmentId: string | null | undefined): Promise<void> {
	if (!departmentId) return;
	const dept = await db.department.findFirst({ where: { id: departmentId, orgId }, select: { id: true } });
	if (!dept) throw new NotFoundError("dept.not_found");
}

async function assertRoutineOrg(orgId: string, routineId: string, userId?: string) {
	// of one of the person's spaces (or from before spaces had their own): anything else is «not found»
	const mine = userId ? { AND: [await mySpacesWhere(userId)] } : {};
	const r = await db.routine.findFirst({ where: { id: routineId, orgId, ...mine }, select: { id: true, assigneeId: true } });
	if (!r) throw new NotFoundError("routine.not_found");
	return r;
}

export async function createRoutine(ctx: { orgId: string; userId: string }, input: z.infer<typeof routineSchema>, spaceId: string | null = null) {
	await assertCanManageRoutines(ctx);
	if (input.assigneeId) await assertActiveAssignee(ctx.orgId, input.assigneeId);
	await assertDepartmentInOrg(ctx.orgId, input.departmentId);
	const routine = await db.routine.create({
		data: {
			orgId: ctx.orgId,
			title: input.title,
			description: input.description ?? null,
			departmentId: input.departmentId ?? null,
			assigneeId: input.assigneeId ?? null,
			weekdays: weekdaysToCsv(input.weekdays),
			active: input.active ?? true,
			// set in the space the person is in
			workspaceId: spaceId,
		},
		select: { id: true },
	});
	await audit("routine.created", { actorId: ctx.userId, orgId: ctx.orgId, target: routine.id });
	return routine;
}

export async function updateRoutine(ctx: { orgId: string; userId: string }, id: string, input: z.infer<typeof routineSchema>) {
	await assertCanManageRoutines(ctx);
	const current = await assertRoutineOrg(ctx.orgId, id, ctx.userId);
	// a NEW assignee must be active; re-sending the current one (who may have left since) changes nothing
	if (input.assigneeId && input.assigneeId !== current.assigneeId) await assertActiveAssignee(ctx.orgId, input.assigneeId);
	await assertDepartmentInOrg(ctx.orgId, input.departmentId);
	await db.routine.update({
		where: { id },
		data: {
			title: input.title ?? undefined,
			description: input.description ?? undefined,
			departmentId: input.departmentId ?? undefined,
			assigneeId: input.assigneeId ?? undefined,
			weekdays: input.weekdays !== undefined ? weekdaysToCsv(input.weekdays) : undefined,
			active: input.active ?? undefined,
		},
	});
	await audit("routine.updated", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

export async function deleteRoutine(ctx: { orgId: string; userId: string }, id: string) {
	await assertCanManageRoutines(ctx, "delete");
	await assertRoutineOrg(ctx.orgId, id, ctx.userId);
	await db.routine.delete({ where: { id } });
	await audit("routine.deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

/**
 * Managing routines takes the production boxes of the person's grid: «يضيف ويعدّل» to create or edit one, «يحذف» to
 * delete one (by default the admins', as before the grid). A guest is told it is read-only (`guest.readonly`), anyone
 * else without the box that their permission does not allow it.
 */
async function assertCanManageRoutines(ctx: { orgId: string; userId: string }, action: "edit" | "delete" = "edit"): Promise<void> {
	assertCanWrite({ orgRole: await orgRoleOf(ctx.orgId, ctx.userId) });
	await assertMemberCan(ctx, action === "edit" ? "production.edit" : "production.delete", "production.routines_role_denied");
}

/** Toggle (or force) one routine's completion for one day. Any org member except a guest may check off. */
export async function setRoutineDone(
	ctx: { orgId: string; userId: string },
	routineId: string,
	day: string,
	done: boolean,
): Promise<void> {
	assertCanWrite({ orgRole: await orgRoleOf(ctx.orgId, ctx.userId) });
	await assertMemberCan(ctx, "production.view", "section.view_denied");
	const routine = await db.routine.findFirst({ where: { id: routineId, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] }, select: { id: true } });
	if (!routine) throw new NotFoundError("routine.not_found");
	if (done) {
		await db.routineLog.upsert({
			where: { routineId_day: { routineId, day } },
			create: { routineId, day, completedById: ctx.userId },
			update: { completedById: ctx.userId },
		});
	} else {
		await db.routineLog.deleteMany({ where: { routineId, day } });
	}
}

/** The person's role in the organization. A suspended or offboarded member has none: they are "not a member". */
export async function orgRoleOf(orgId: string, userId: string) {
	const m = await db.organizationMember.findUnique({
		where: { organizationId_userId: { organizationId: orgId, userId } },
		select: { role: true, status: true },
	});
	if (!m || m.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
	return m.role;
}

// ───────────────────────────── W1.6: the conversions to a task ─────────────────────────────
// ⚠️ A routine, a campaign item and a ticket each do what a task does. 🔧 We mark them and give a way out: a conversion through `createTask` (every
// rule of a task applies), the link stored on a row (never only in a log), nothing deleted, and a second click that makes nothing new.
// D-W2 (folding them into Task types for good) is the owner's later answer and is not built here.

/** What a conversion may be told: where (a space of the person's), who holds it, and «مين بيشوفها؟». */
export const sourceTaskSchema = z.object({
	workspaceId: z.string().min(1).max(64).optional(),
	assigneeId: z.string().min(1).max(64).nullable().optional(),
	visibility: z.enum(["SPACE", "PARTICIPANTS"]).optional(),
	/** «المساحة كلها» for a task whose source is a private conversation needs this, on the server (P0.3). */
	confirmPublic: z.boolean().optional(),
});
export type SourceTaskInput = z.infer<typeof sourceTaskSchema> & { visibility?: TaskVisibility };

/**
 * Runs `run` while holding a lock named `key` (a Postgres advisory lock, released when the lock's transaction ends): two clicks on the same
 * conversion are taken one after the other, so the second one finds what the first made. `run` uses its own connections; only the lock lives here.
 */
export async function withSourceLock<T>(key: string, run: () => Promise<T>): Promise<T> {
	return db.$transaction(
		async (tx) => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
			return run();
		},
		{ timeout: 60_000, maxWait: 30_000 },
	);
}

/** The inbox project, board and «للتنفيذ» column of a space: the switched-on inbox's own service, else the hidden «مهام فورية» project the quick task has always used (made if it is not there). */
async function inboxPlace(ctx: OrgAccessContext, workspaceId: string): Promise<{ projectId: string; boardId: string; columnId: string }> {
	if (await isFeatureOn(ctx.orgId, "workInbox")) return inboxTarget(ctx, workspaceId);
	const pick = (cols: { id: string; done: boolean }[]) => {
		const open = cols.filter((c) => !c.done);
		return (open[1] ?? open[0] ?? cols[0])!.id;
	};
	const find = () =>
		db.project.findUnique({
			where: { workspaceId_systemKey: { workspaceId, systemKey: INSTANT_PROJECT_KEY } },
			select: { id: true, boards: { where: { archived: false }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true, done: true } } } } },
		});
	let project = await find();
	if (!project) {
		try {
			await db.project.create({
				data: {
					workspaceId,
					systemKey: INSTANT_PROJECT_KEY,
					name: AR["instant.project"] ?? "مهام فورية",
					status: "ACTIVE",
					boards: { create: { name: AR["instant.board"] ?? "فوري", columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })) } } },
				},
			});
		} catch (err) {
			// somebody else made it a moment ago
			if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
		}
		project = await find();
	}
	if (!project) throw new ForbiddenError("instant.unavailable");
	let board = project.boards[0];
	if (!board || board.columns.length === 0) {
		board = await db.board.create({
			data: { projectId: project.id, name: AR["instant.board"] ?? "فوري", columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })) } },
			select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true, done: true } } },
		});
	}
	return { projectId: project.id, boardId: board.id, columnId: pick(board.columns) };
}

/**
 * Where a converted task lands: «صندوق المهام» of a space the person works in (W1.2). `spaceId` is one the person ASKED for (refused when it is not
 * theirs); `prefer` is the source's own space when it has one (taken when it is theirs, else ignored); with neither, the first STANDARD space of
 * `subject` (the person, or whoever the task is for). The person must be able to work in it, and with `seat` an owner reading it without a seat is refused
 * (a series acts as the person who set it).
 */
export async function sourceTaskPlace(
	ctx: OrgAccessContext,
	want: { spaceId?: string | null; prefer?: string | null; subject?: SpaceSubject; seat?: boolean } = {},
): Promise<{ workspaceId: string; projectId: string; boardId: string; columnId: string }> {
	const me: SpaceSubject = { userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole };
	let space = null as Awaited<ReturnType<typeof inboxSpaceFor>>;
	if (want.spaceId) {
		space = await inboxSpaceFor(me, want.spaceId);
		if (!space) throw new ForbiddenError("instant.no_space");
	}
	if (!space && want.prefer) space = await inboxSpaceFor(me, want.prefer);
	if (!space) space = await inboxSpaceFor(want.subject ?? me, null);
	if (!space) throw new ForbiddenError("instant.no_space");
	// the person who makes it works in that space (a stranger of it is refused here, before anything is made)
	await requireWorkspace(space.id, ["ADMIN", "MEMBER"]);
	if (want.seat && ctx.orgRole === "OWNER") {
		const seat = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: space.id, userId: ctx.userId } }, select: { userId: true } });
		if (!seat) throw new ForbiddenError("recurrence.oversight_readonly");
	}
	return { workspaceId: space.id, ...(await inboxPlace(ctx, space.id)) };
}

/** The weekdays of a routine («1,3», empty = every day) as the rule of a series. */
function ruleOfWeekdays(weekdays: string): RuleInput {
	const days = weekdays.split(",").filter((d) => d !== "").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
	return days.length > 0 && days.length < 7 ? { kind: "WEEKLY", days } : { kind: "DAILY" };
}

/**
 * «حوّل الروتين لمهام متكررة»: ONE routine becomes ONE recurring task: a template titled like the routine, held by the routine's assignee, in the
 * «صندوق المهام» of the routine's space (a routine with no space — or in «الشركة», which holds no project — goes to the assignee's first STANDARD space),
 * with a series on the routine's weekdays made by the recurrence service («حسب الجدول»). The routine is ARCHIVED (switched off), never deleted: its
 * row and its logs stay, and a day it was ticked still shows it on the checklist. A second click makes nothing new: the routine remembers its task (the
 * audit line `routine.converted`), and a conversion that stopped before the series was made is finished by the next click.
 */
export async function convertRoutineToTask(ctx: { orgId: string; userId: string }, routineId: string): Promise<{ created: boolean; task: LinkedTaskView }> {
	await assertCanManageRoutines(ctx);
	await assertFeatureOn(ctx.orgId, "recurringTasks");
	const orgRole = await orgRoleOf(ctx.orgId, ctx.userId);
	const access: OrgAccessContext = { orgId: ctx.orgId, orgRole, userId: ctx.userId };
	const routine = await db.routine.findFirst({
		where: { id: routineId, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] },
		select: { id: true, title: true, description: true, assigneeId: true, weekdays: true, workspaceId: true, workspace: { select: { kind: true } } },
	});
	if (!routine) throw new NotFoundError("routine.not_found");

	let created = false;
	const taskId = await withSourceLock(`routine:${routine.id}`, async () => {
		let id = (await convertedTaskIds(ctx.orgId, [routine.id])).get(routine.id) ?? null;
		if (!id) {
			// the person it is for must still be active (one who left has no task to hold: the template then stays unassigned)
			const holder = routine.assigneeId
				? await db.organizationMember.findFirst({ where: { organizationId: ctx.orgId, userId: routine.assigneeId, status: "ACTIVE" }, select: { role: true } })
				: null;
			const ownSpace = routine.workspaceId && routine.workspace?.kind !== "HQ" ? routine.workspaceId : null;
			const place = await sourceTaskPlace(access, {
				spaceId: ownSpace,
				subject: holder && routine.assigneeId ? { userId: routine.assigneeId, orgId: ctx.orgId, role: holder.role } : undefined,
				seat: true,
			});
			if (holder && routine.assigneeId) {
				// the same rule as a quick task: whoever holds it must be in the space (the company's owner always may), or they would hold a task they cannot open
				const seat = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: place.workspaceId, userId: routine.assigneeId } }, select: { userId: true } });
				if (!seat && holder.role !== "OWNER") throw new ForbiddenError("instant.not_in_space");
			}
			const task = await createTask(
				{ userId: ctx.userId, orgId: ctx.orgId },
				{ ...place, title: routine.title.slice(0, 280), description: routine.description, assigneeId: holder ? routine.assigneeId : null, dueDate: null },
			);
			id = task.id;
			await audit(ROUTINE_CONVERTED, { actorId: ctx.userId, orgId: ctx.orgId, target: routine.id, meta: { taskId: id } });
			created = true;
		}
		// the series (the existing recurrence service: it judges who may edit the task, the switch and the rule); missing only after a half-made conversion
		// task-visibility: whether the series exists is read here; setRecurrence itself passes requireTaskAccess
		const row = await db.task.findFirst({ where: { id, orgId: ctx.orgId }, select: { recurrenceId: true } });
		if (row && !row.recurrenceId) await setRecurrence(id, { rule: ruleOfWeekdays(routine.weekdays), mode: "SCHEDULE", endsOn: null });
		// archived, never deleted
		const archived = await db.routine.updateMany({ where: { id: routine.id, active: true }, data: { active: false } });
		if (archived.count > 0) await audit("routine.archived", { actorId: ctx.userId, orgId: ctx.orgId, target: routine.id });
		return id;
	});
	const view = (await taskLinkViews(ctx, [taskId])).get(taskId) ?? ({ state: "hidden" } as const);
	return { created, task: view };
}
