import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, audit } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertDepartmentInOrg } from "@/server/services/production";
import { resolveTimeZone, zonedParts, zonedWallTime } from "@/lib/zoned-time";
import { mySpacesWhere, placeWhere, type SpacePlace } from "@/server/services/space-place";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { KR_MAX, objectivePercent, type GoalLightKey } from "@/lib/okr";
import {
	assertEligibleOwner,
	assertMayActOnGoal,
	assertMayEditGoal,
	createWithGoal,
	goalAccess,
	goalRights,
	keyResultInputSchema,
	keyResultsOf,
	type KeyResultDto,
} from "@/server/services/okr";

export type GoalPeriodT = "WEEKLY" | "MONTHLY" | "QUARTERLY";

/**
 * The week starts on the zone's weekday index 0 (the machine's `getDay() == 0` day, the first of
 * the seven); the month is the calendar month containing the anchor, the quarter the calendar quarter
 * (months 1-3, 4-6, 7-9, 10-12) — in `timeZone` (the company's zone) when one is given, otherwise the
 * machine's clock as before. A mistyped zone resolves to the company default, never throws.
 */
export function periodWindow(period: GoalPeriodT, anchor: Date, timeZone?: string): { start: Date; end: Date } {
	if (timeZone) {
		const zone = resolveTimeZone(timeZone);
		const p = zonedParts(anchor, zone);
		if (period === "WEEKLY") {
			const start = zonedWallTime({ year: p.year, month: p.month, day: p.day - p.weekday }, zone);
			return { start, end: new Date(zonedWallTime({ year: p.year, month: p.month, day: p.day - p.weekday + 7 }, zone).getTime() - 1) };
		}
		if (period === "QUARTERLY") {
			const first = Math.floor((p.month - 1) / 3) * 3 + 1;
			const start = zonedWallTime({ year: p.year, month: first, day: 1 }, zone);
			return { start, end: new Date(zonedWallTime({ year: p.year, month: first + 3, day: 1 }, zone).getTime() - 1) };
		}
		const start = zonedWallTime({ year: p.year, month: p.month, day: 1 }, zone);
		return { start, end: new Date(zonedWallTime({ year: p.year, month: p.month + 1, day: 1 }, zone).getTime() - 1) };
	}
	if (period === "WEEKLY") {
		const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay(), 0, 0, 0, 0);
		const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
		end.setMilliseconds(-1);
		return { start, end };
	}
	if (period === "QUARTERLY") {
		const first = Math.floor(anchor.getMonth() / 3) * 3;
		const start = new Date(anchor.getFullYear(), first, 1, 0, 0, 0, 0);
		const end = new Date(anchor.getFullYear(), first + 3, 1, 0, 0, 0, 0);
		end.setMilliseconds(-1);
		return { start, end };
	}
	const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
	const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 0, 0, 0, 0);
	end.setMilliseconds(-1);
	return { start, end };
}

export const goalSchema = z.object({
	title: z.string().trim().min(2, "title.too_short").max(160),
	description: z.string().trim().max(1000).nullable().optional(),
	period: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY"]),
	anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "goal.bad_date"),
	progress: z.number().int().min(0).max(100).optional(),
	departmentId: z.string().nullable().optional(),
	// «الأهداف والنتائج» (behind the `okr` switch): who answers for it, the light that person sets, and its key results (create only)
	ownerId: z.string().min(1).nullable().optional(),
	light: z.enum(["ON_TRACK", "BEHIND", "AT_RISK"]).nullable().optional(),
	keyResults: z.array(keyResultInputSchema).max(KR_MAX, "okr.max_five").optional(),
});

/** Does this input use anything of «الأهداف والنتائج»? (Then the `okr` switch must be on.) */
function usesOkr(input: { period?: string | undefined; ownerId?: unknown; light?: unknown; keyResults?: unknown[] | undefined }): boolean {
	return input.period === "QUARTERLY" || input.ownerId !== undefined || input.light !== undefined || (input.keyResults?.length ?? 0) > 0;
}

export function goalStatus(goal: { periodEnd: Date; progress: number }, now: Date): string {
	if (goal.progress >= 100) return "achieved";
	if (now > goal.periodEnd) return "missed";
	return "active";
}

export interface GoalDto {
	id: string;
	title: string;
	description: string | null;
	period: GoalPeriodT;
	periodStart: string;
	periodEnd: string;
	/** What the screen shows: the average of the key results when there are some, otherwise the number moved by hand. */
	progress: number;
	/** The hand-moved number (the one that counts when there is no key result). */
	manualProgress: number;
	fromKeyResults: boolean;
	departmentId: string | null;
	departmentName: string | null;
	creatorName: string;
	ownerId: string | null;
	ownerName: string | null;
	light: GoalLightKey | null;
	lightSetAt: string | null;
	keyResults: KeyResultDto[];
	/** The viewer may change the structure (the texts, the key results, the owner) / check in and set the light. */
	canEdit: boolean;
	canAct: boolean;
}

/**
 * The goals of the viewer's company. They are the company's own plans (titles, descriptions, departments, who set them): an
 * external partner (guest) is refused here as well as at the route, so a new caller that forgets the door still hands a guest
 * nothing (docs/PHASE0-AUDIT.md R10).
 *
 * `viewer.userId` lets the answer say what the viewer may do on each goal; `mayEdit` is the «يضيف ويعدّل» box. Without them
 * the flags are false. With `okr` switched off the answer is the one from before «الأهداف والنتائج»: no quarter, no owner, no
 * light, no key results, the hand-moved number.
 */
export async function listGoals(viewer: { orgId: string; orgRole: string; userId?: string; mayEdit?: boolean }, place?: SpacePlace): Promise<GoalDto[]> {
	assertNotGuest(viewer);
	const okr = await isFeatureOn(viewer.orgId, "okr");
	const rows = await db.goal.findMany({
		// the goals of the space the person is in (and in «الشركة» the ones from before spaces had their own)
		where: { orgId: viewer.orgId, ...(okr ? {} : { period: { in: ["WEEKLY", "MONTHLY"] } }), ...(place ? { AND: [placeWhere(place)] } : {}) },
		orderBy: [{ periodStart: "desc" }, { createdAt: "asc" }],
		select: {
			id: true,
			title: true,
			description: true,
			period: true,
			periodStart: true,
			periodEnd: true,
			progress: true,
			departmentId: true,
			department: { select: { name: true } },
			creator: { select: { name: true } },
			createdAt: true,
			workspaceId: true,
			creatorId: true,
			ownerId: true,
			owner: { select: { name: true } },
			light: true,
			lightSetAt: true,
		},
	});
	const krs = okr ? await keyResultsOf(rows.map((g) => g.id)) : new Map<string, KeyResultDto[]>();
	// the viewer's rows in the spaces these goals belong to (is the viewer that space's admin?)
	const spaceRoles = new Map<string, string>();
	if (viewer.userId) {
		const spaceIds = [...new Set(rows.map((g) => g.workspaceId).filter((id): id is string => id !== null))];
		if (spaceIds.length > 0) {
			for (const r of await db.workspaceMember.findMany({ where: { userId: viewer.userId, workspaceId: { in: spaceIds } }, select: { workspaceId: true, role: true } })) {
				spaceRoles.set(r.workspaceId, r.role);
			}
		}
	}
	return rows.map((g) => {
		const keyResults = krs.get(g.id) ?? [];
		const fromKrs = okr ? objectivePercent(keyResults) : null;
		const rights = viewer.userId
			? goalRights(g, { userId: viewer.userId, orgRole: viewer.orgRole }, g.workspaceId ? (spaceRoles.get(g.workspaceId) ?? null) : null)
			: { mine: false, manages: false, mayAct: false };
		return {
			id: g.id,
			title: g.title,
			description: g.description,
			period: g.period as GoalPeriodT,
			periodStart: g.periodStart.toISOString(),
			periodEnd: g.periodEnd.toISOString(),
			progress: fromKrs ?? g.progress,
			manualProgress: g.progress,
			fromKeyResults: fromKrs !== null,
			departmentId: g.departmentId,
			departmentName: g.department?.name ?? null,
			creatorName: g.creator.name,
			ownerId: okr ? (g.ownerId ?? g.creatorId) : null,
			ownerName: okr ? (g.owner?.name ?? g.creator.name) : null,
			light: okr ? (g.light as GoalLightKey | null) : null,
			lightSetAt: okr ? (g.lightSetAt?.toISOString() ?? null) : null,
			keyResults,
			// switched off, as before: whoever holds the box edits any goal of their spaces
			canEdit: Boolean(viewer.mayEdit) && (okr ? rights.mayAct : true),
			canAct: rights.mayAct,
		};
	});
}

/** The org's stored zone, resolved (falls back to the company default). Small helper for the goal windows. */
async function orgZone(orgId: string): Promise<string> {
	return resolveTimeZone(
		(await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }))?.timezone,
	);
}

export async function createGoal(ctx: { orgId: string; userId: string }, input: z.infer<typeof goalSchema>, spaceId: string | null = null) {
	await assertMemberCan(ctx, "goals.edit", "goals.role_denied");
	if (usesOkr(input)) await assertFeatureOn(ctx.orgId, "okr");
	await assertDepartmentInOrg(ctx.orgId, input.departmentId);
	if (input.ownerId) await assertEligibleOwner(ctx.orgId, spaceId, input.ownerId);
	const anchor = parseAnchor(input.anchorDate);
	// the period is the company's week / month / quarter, cut in its zone
	const win = periodWindow(input.period, anchor, await orgZone(ctx.orgId));
	const goal = await db.$transaction(async (tx) => {
		const made = await tx.goal.create({
			data: {
				orgId: ctx.orgId,
				title: input.title,
				description: input.description ?? null,
				period: input.period,
				periodStart: win.start,
				periodEnd: win.end,
				progress: input.progress ?? 0,
				departmentId: input.departmentId ?? null,
				creatorId: ctx.userId,
				// set in the space the person is in
				workspaceId: spaceId,
				ownerId: input.ownerId ?? null,
				light: input.light ?? null,
				lightSetAt: input.light ? new Date() : null,
			},
			select: { id: true },
		});
		await createWithGoal(ctx, tx, made.id, spaceId, input.keyResults ?? []);
		return made;
	});
	await audit("goal.created", { actorId: ctx.userId, orgId: ctx.orgId, target: goal.id });
	return goal;
}

export const goalPatchSchema = goalSchema
	.omit({ keyResults: true })
	.partial()
	.refine((v) => Object.keys(v).length > 0, { message: "goal.no_change" });
export type GoalPatch = z.infer<typeof goalPatchSchema>;

/**
 * Edits a goal. Its texts, period, hand-moved number, department and owner are the structure: the «يضيف ويعدّل» box AND being the
 * goal's owner or someone who may act for them. Only the status light needs just «يشوف» and the same standing: a person sets it,
 * the system never does.
 */
export async function updateGoal(ctx: { orgId: string; userId: string }, id: string, input: GoalPatch) {
	const { light, ...rest } = input;
	const structural = Object.keys(rest).length > 0;
	if (usesOkr(input)) await assertFeatureOn(ctx.orgId, "okr");
	let workspaceId: string | null;
	// both doors say «not found» for a goal outside the person's spaces, after the box check. Switched off, nobody is the goal's owner:
	// whoever holds the box edits any goal of their spaces, as before
	if (!(await isFeatureOn(ctx.orgId, "okr"))) {
		await assertMemberCan(ctx, "goals.edit", "goals.role_denied");
		const found = await db.goal.findFirst({ where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] }, select: { workspaceId: true } });
		if (!found) throw new NotFoundError("goal.not_found");
		workspaceId = found.workspaceId;
	} else if (structural) workspaceId = (await assertMayEditGoal(ctx, id)).goal.workspaceId;
	else workspaceId = (await assertMayActOnGoal(ctx, id)).goal.workspaceId;
	const existing = await db.goal.findUniqueOrThrow({ where: { id }, select: { periodStart: true, periodEnd: true, period: true } });
	await assertDepartmentInOrg(ctx.orgId, input.departmentId);
	if (input.ownerId) await assertEligibleOwner(ctx.orgId, workspaceId, input.ownerId);
	const data: Record<string, unknown> = {
		title: input.title ?? undefined,
		description: input.description ?? undefined,
		progress: input.progress ?? undefined,
		departmentId: input.departmentId ?? undefined,
		// `ownerId: null` hands the goal back to its creator
		ownerId: input.ownerId,
	};
	if (light !== undefined) {
		data["light"] = light;
		data["lightSetAt"] = light ? new Date() : null;
	}
	if (input.period || input.anchorDate) {
		const period = (input.period ?? existing.period) as GoalPeriodT;
		const anchor = input.anchorDate
			? parseAnchor(input.anchorDate)
			: new Date(Math.min(Math.max(Date.now(), existing.periodStart.getTime()), existing.periodEnd.getTime()));
		const win = periodWindow(period, anchor, await orgZone(ctx.orgId));
		data["period"] = period;
		data["periodStart"] = win.start;
		data["periodEnd"] = win.end;
	}
	await db.goal.update({ where: { id }, data });
	await audit("goal.updated", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

export async function deleteGoal(ctx: { orgId: string; userId: string }, id: string) {
	await assertMemberCan(ctx, "goals.delete", "goals.role_denied");
	const existing = await db.goal.findFirst({ where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] }, select: { id: true } });
	if (!existing) throw new NotFoundError("goal.not_found");
	// the key results and their check-ins go with it: «يحذف» alone is not enough to delete somebody else's goal; it takes the
	// goal's owner, the space's admin or the owner of the company too
	if (await isFeatureOn(ctx.orgId, "okr")) {
		const access = await goalAccess(ctx, id);
		if (!access.mine && !access.manages) throw new ForbiddenError("goals.not_owner");
	}
	await db.goal.delete({ where: { id } });
	await audit("goal.deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

function parseAnchor(s: string): Date {
	const parts = s.split("-");
	return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
}
