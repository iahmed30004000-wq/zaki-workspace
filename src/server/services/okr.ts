import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertFeatureOn } from "@/server/services/features";
import { mySpacesWhere } from "@/server/services/space-place";
import { KR_MAX, keyResultPercent, linkedValue, objectivePercent } from "@/lib/okr";

/**
 * «الأهداف والنتائج» — the key results of an objective (src/lib/okr.ts holds the arithmetic).
 *
 * The rules, in one place:
 *  - staff only (a guest gets 403 `guest.no_access`), and the objective must be one the person can read (their space, or from
 *    before spaces had their own): anything else is «not found»;
 *  - who WRITES: the objective's owner (its creator while none was named), the owner of the company, and the admin of its space.
 *    Changing the structure (the key results, the owner, the texts) also needs the «يضيف ويعدّل» box; a check-in and the status
 *    light only need «يشوف». Reading writes nothing, so the owner of the company reads in silence;
 *  - at most five key results per objective, counted under a lock on the objective so two requests cannot make a sixth;
 *  - a check-in is APPEND-ONLY: no route edits or deletes one;
 *  - a key result linked to a project or to tasks takes its value from their finished tasks, counted when read; check-ins are
 *    refused on it (⚠️ the number moves by itself; 🔧 the screen says so on the key result and hides the check-in button);
 *  - the whole feature is behind the `okr` switch: off, every route here answers «not found» and nothing stored is touched.
 */

type Tx = Prisma.TransactionClient;
const FEATURE = "okr" as const;

function refuse(path: string, key: string): never {
  throw new ValidationError([{ path, message: key }]);
}

// ---------- input ----------

const num = z.number().finite().min(-1e12).max(1e12);

export const keyResultInputSchema = z.object({
  title: z.string().trim().min(2, "okr.title_short").max(160),
  startValue: num.optional(),
  targetValue: num.optional(),
  currentValue: num.optional(),
  /** Free Arabic text: «عميل», «ألف دينار», «٪». */
  unit: z.string().trim().max(24, "okr.unit_long").optional(),
  /** Follow a whole project's finished tasks… */
  projectId: z.string().min(1).nullable().optional(),
  /** …or some tasks (not both). */
  taskIds: z.array(z.string().min(1)).max(50).optional(),
});
export type KeyResultInput = z.infer<typeof keyResultInputSchema>;

export const keyResultPatchSchema = keyResultInputSchema
  .omit({ currentValue: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "okr.no_change" });
export type KeyResultPatch = z.infer<typeof keyResultPatchSchema>;

export const checkInSchema = z.object({
  value: num,
  note: z.string().trim().max(500, "okr.note_long").optional(),
});

// ---------- who may do what ----------

export interface GoalFacts {
  id: string;
  orgId: string;
  workspaceId: string | null;
  creatorId: string;
  ownerId: string | null;
  periodStart: Date;
  periodEnd: Date;
}

/** The person answering for an objective: the one named, otherwise whoever created it. */
export function effectiveOwnerId(goal: { ownerId: string | null; creatorId: string }): string {
  return goal.ownerId ?? goal.creatorId;
}

/**
 * Is this person the objective's owner, or one of the people who may act for it (the owner of the company, the space's admin,
 * an org ADMIN who is in the space; for an objective from before spaces had their own: any org ADMIN)?
 * `spaceRole` is the person's row in the objective's space (`null`: none).
 */
export function goalRights(
  goal: { ownerId: string | null; creatorId: string; workspaceId: string | null },
  who: { userId: string; orgRole: string },
  spaceRole: string | null,
): { mine: boolean; manages: boolean; mayAct: boolean } {
  const mine = effectiveOwnerId(goal) === who.userId;
  const manages =
    who.orgRole === "OWNER" ||
    (goal.workspaceId === null ? who.orgRole === "ADMIN" : spaceRole !== null && spaceRole !== "GUEST" && (spaceRole === "ADMIN" || who.orgRole === "ADMIN"));
  return { mine, manages, mayAct: mine || manages };
}

export interface GoalAccess {
  goal: GoalFacts;
  orgRole: string;
  mine: boolean;
  manages: boolean;
}

/** One objective of the person's company they may read, with what they may do on it. 404 when it is not theirs to see. */
export async function goalAccess(ctx: { orgId: string; userId: string }, goalId: string): Promise<GoalAccess> {
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
    select: { status: true, role: true },
  });
  if (!member || member.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
  if (member.role === "GUEST") throw new ForbiddenError("guest.no_access");
  const goal = await db.goal.findFirst({
    where: { id: goalId, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] },
    select: { id: true, orgId: true, workspaceId: true, creatorId: true, ownerId: true, periodStart: true, periodEnd: true },
  });
  if (!goal) throw new NotFoundError("goal.not_found");
  const spaceRow = goal.workspaceId
    ? await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: goal.workspaceId, userId: ctx.userId } }, select: { role: true } })
    : null;
  const rights = goalRights(goal, { userId: ctx.userId, orgRole: member.role }, spaceRow?.role ?? null);
  return { goal, orgRole: member.role, mine: rights.mine, manages: rights.manages };
}

/** Changing the structure: the «يضيف ويعدّل» box, and being the owner or someone who may act for them. */
export async function assertMayEditGoal(ctx: { orgId: string; userId: string }, goalId: string): Promise<GoalAccess> {
  await assertMemberCan(ctx, "goals.edit", "goals.role_denied");
  const access = await goalAccess(ctx, goalId);
  if (!access.mine && !access.manages) throw new ForbiddenError("goals.not_owner");
  return access;
}

/** A check-in or the status light: «يشوف», and being the owner or someone who may act for them. */
export async function assertMayActOnGoal(ctx: { orgId: string; userId: string }, goalId: string): Promise<GoalAccess> {
  await assertMemberCan(ctx, "goals.view", "section.view_denied");
  const access = await goalAccess(ctx, goalId);
  if (!access.mine && !access.manages) throw new ForbiddenError("goals.not_owner");
  return access;
}

/** Someone who may be named the owner: an ACTIVE member who is not a guest, and (in a space) is in it — or is the company's owner. */
export async function assertEligibleOwner(orgId: string, workspaceId: string | null, userId: string): Promise<void> {
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { status: true, role: true },
  });
  if (!member || member.status !== "ACTIVE" || member.role === "GUEST") refuse("ownerId", "okr.owner_invalid");
  if (member.role === "OWNER" || !workspaceId) return;
  const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } });
  if (!row) refuse("ownerId", "okr.owner_invalid");
}

// ---------- the links to a project or to tasks ----------

interface Links {
  projectId: string | null;
  taskIds: string[];
}

/** Where a goal's links may point: its own space; an objective from before spaces had their own: any space the person is in. */
async function linkSpaces(ctx: { orgId: string; userId: string }, workspaceId: string | null): Promise<string[]> {
  return workspaceId ? [workspaceId] : accessibleWorkspaceIds(ctx.userId);
}

async function resolveLinks(
  ctx: { orgId: string; userId: string },
  workspaceId: string | null,
  input: { projectId?: string | null | undefined; taskIds?: string[] | undefined },
): Promise<Links> {
  const taskIds = [...new Set(input.taskIds ?? [])];
  const projectId = input.projectId ?? null;
  if (projectId && taskIds.length > 0) refuse("projectId", "okr.link_one_only");
  const spaces = projectId || taskIds.length > 0 ? await linkSpaces(ctx, workspaceId) : [];
  if (projectId) {
    const project = await db.project.findFirst({
      where: { id: projectId, workspaceId: { in: spaces }, workspace: { organizationId: ctx.orgId } },
      select: { id: true },
    });
    if (!project) refuse("projectId", "okr.link_not_found");
  }
  if (taskIds.length > 0) {
    const found = await db.task.count({ where: { id: { in: taskIds }, orgId: ctx.orgId, workspaceId: { in: spaces } } });
    if (found !== taskIds.length) refuse("taskIds", "okr.link_not_found");
  }
  return { projectId, taskIds };
}

/** How many tasks a link covers, and how many are finished (an archived task of a project is not counted). */
async function linkTotals(projectId: string | null, taskIds: string[]): Promise<{ total: number; done: number }> {
  if (projectId) {
    const [total, done] = await Promise.all([
      db.task.count({ where: { projectId, archived: false } }),
      db.task.count({ where: { projectId, archived: false, completedAt: { not: null } } }),
    ]);
    return { total, done };
  }
  if (taskIds.length === 0) return { total: 0, done: 0 };
  const [total, done] = await Promise.all([
    db.task.count({ where: { id: { in: taskIds } } }),
    db.task.count({ where: { id: { in: taskIds }, completedAt: { not: null } } }),
  ]);
  return { total, done };
}

// ---------- the key results, as the screen reads them ----------

export interface KeyResultDto {
  id: string;
  title: string;
  startValue: number;
  targetValue: number;
  /** The value now: the last check-in, or (linked) the finished tasks counted just now. */
  currentValue: number;
  unit: string;
  position: number;
  percent: number;
  /** `null`: a hand-fed key result. Otherwise the value follows tasks and check-ins are refused. */
  linked: { kind: "project"; projectId: string; projectName: string; done: number; total: number } | { kind: "tasks"; done: number; total: number } | null;
  lastCheckInAt: string | null;
}

/** The key results of the given objectives, in order, with their live numbers. Reads only. */
export async function keyResultsOf(goalIds: string[]): Promise<Map<string, KeyResultDto[]>> {
  const out = new Map<string, KeyResultDto[]>();
  if (goalIds.length === 0) return out;
  const rows = await db.keyResult.findMany({
    where: { goalId: { in: goalIds } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      goalId: true,
      title: true,
      startValue: true,
      targetValue: true,
      currentValue: true,
      unit: true,
      position: true,
      linkedProjectId: true,
      linkedProject: { select: { name: true } },
      tasks: { select: { task: { select: { completedAt: true } } } },
      updates: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const projectIds = [...new Set(rows.map((r) => r.linkedProjectId).filter((id): id is string => id !== null))];
  const [totals, dones] = projectIds.length
    ? await Promise.all([
        db.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, archived: false }, _count: { _all: true } }),
        db.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, archived: false, completedAt: { not: null } }, _count: { _all: true } }),
      ])
    : [[], []];
  const totalOf = new Map(totals.map((x) => [x.projectId, x._count._all]));
  const doneOf = new Map(dones.map((x) => [x.projectId, x._count._all]));

  for (const r of rows) {
    let linked: KeyResultDto["linked"] = null;
    let start = r.startValue;
    let current = r.currentValue;
    if (r.linkedProjectId && r.linkedProject) {
      const done = doneOf.get(r.linkedProjectId) ?? 0;
      linked = { kind: "project", projectId: r.linkedProjectId, projectName: r.linkedProject.name, done, total: totalOf.get(r.linkedProjectId) ?? 0 };
      start = 0;
      current = linkedValue(done);
    } else if (r.tasks.length > 0) {
      const done = r.tasks.filter((x) => x.task.completedAt !== null).length;
      linked = { kind: "tasks", done, total: r.tasks.length };
      start = 0;
      current = linkedValue(done);
    }
    const dto: KeyResultDto = {
      id: r.id,
      title: r.title,
      startValue: start,
      targetValue: r.targetValue,
      currentValue: current,
      unit: r.unit,
      position: r.position,
      percent: keyResultPercent({ startValue: start, targetValue: r.targetValue, currentValue: current }),
      linked,
      lastCheckInAt: r.updates[0]?.createdAt.toISOString() ?? null,
    };
    const list = out.get(r.goalId) ?? [];
    list.push(dto);
    out.set(r.goalId, list);
  }
  return out;
}

/**
 * Writes the objective's progress (the stored number the older screens and reports read) from its key results as they stand now.
 * The screen computes the number itself on every read; this keeps the stored one honest after a change. None: left as it was.
 */
async function syncProgress(goalId: string): Promise<number | null> {
  const krs = (await keyResultsOf([goalId])).get(goalId) ?? [];
  const percent = objectivePercent(krs);
  if (percent !== null) await db.goal.update({ where: { id: goalId }, data: { progress: percent } });
  return percent;
}

// ---------- writes ----------

/** Adds key results to a goal inside the caller's transaction (the goal row is already locked or brand new). Returns their ids. */
async function insertKeyResults(
  tx: Tx,
  goalId: string,
  inputs: KeyResultInput[],
  links: Links[],
  firstPosition: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const link = links[i]!;
    const linked = link.projectId !== null || link.taskIds.length > 0;
    let target = input.targetValue;
    if (target === undefined) {
      if (!linked) refuse(`keyResults.${i}.targetValue`, "okr.target_required");
      // a linked key result with no target asked for: every task of the link
      const totals = await linkTotals(link.projectId, link.taskIds);
      target = Math.max(1, totals.total);
    }
    const start = linked ? 0 : (input.startValue ?? 0);
    const created = await tx.keyResult.create({
      data: {
        goalId,
        title: input.title,
        startValue: start,
        targetValue: target,
        currentValue: linked ? 0 : (input.currentValue ?? start),
        unit: input.unit ?? "",
        position: firstPosition + i,
        linkedProjectId: link.projectId,
      },
      select: { id: true },
    });
    if (link.taskIds.length > 0) {
      await tx.keyResultTask.createMany({ data: link.taskIds.map((taskId) => ({ keyResultId: created.id, taskId })) });
    }
    ids.push(created.id);
  }
  return ids;
}

/** The key results written together with a brand-new objective (`createGoal`): up to five, links checked first. */
export async function createWithGoal(
  ctx: { orgId: string; userId: string },
  tx: Tx,
  goalId: string,
  workspaceId: string | null,
  inputs: KeyResultInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  if (inputs.length > KR_MAX) refuse("keyResults", "okr.max_five");
  const links: Links[] = [];
  for (const input of inputs) links.push(await resolveLinks(ctx, workspaceId, input));
  await insertKeyResults(tx, goalId, inputs, links, 0);
}

export async function addKeyResult(ctx: { orgId: string; userId: string }, goalId: string, input: KeyResultInput): Promise<KeyResultDto> {
  await assertFeatureOn(ctx.orgId, FEATURE);
  const access = await assertMayEditGoal(ctx, goalId);
  const link = await resolveLinks(ctx, access.goal.workspaceId, input);
  const id = await db.$transaction(async (tx) => {
    // the objective is locked for the count and the insert, so two requests cannot make a sixth
    await tx.$queryRaw`SELECT 1 FROM "Goal" WHERE id = ${goalId} FOR UPDATE`;
    const have = await tx.keyResult.aggregate({ where: { goalId }, _count: { _all: true }, _max: { position: true } });
    if (have._count._all >= KR_MAX) refuse("keyResults", "okr.max_five");
    const [created] = await insertKeyResults(tx, goalId, [input], [link], (have._max.position ?? -1) + 1);
    return created!;
  });
  await syncProgress(goalId);
  await audit("okr.key_result_added", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
  return oneDto(goalId, id);
}

async function oneDto(goalId: string, id: string): Promise<KeyResultDto> {
  const dto = (await keyResultsOf([goalId])).get(goalId)?.find((k) => k.id === id);
  if (!dto) throw new NotFoundError("okr.not_found");
  return dto;
}

/** The key result with its objective's facts, for the writes below. 404 when it is not the person's to see. */
async function loadKeyResult(ctx: { orgId: string; userId: string }, id: string): Promise<{ id: string; goalId: string; linkedProjectId: string | null; hasTasks: boolean }> {
  const row = await db.keyResult.findFirst({
    where: { id, goal: { orgId: ctx.orgId } },
    select: { id: true, goalId: true, linkedProjectId: true, _count: { select: { tasks: true } } },
  });
  if (!row) throw new NotFoundError("okr.not_found");
  return { id: row.id, goalId: row.goalId, linkedProjectId: row.linkedProjectId, hasTasks: row._count.tasks > 0 };
}

export async function updateKeyResult(ctx: { orgId: string; userId: string }, id: string, patch: KeyResultPatch): Promise<KeyResultDto> {
  await assertFeatureOn(ctx.orgId, FEATURE);
  const row = await loadKeyResult(ctx, id);
  const access = await assertMayEditGoal(ctx, row.goalId);
  const touchesLink = patch.projectId !== undefined || patch.taskIds !== undefined;
  const link = touchesLink ? await resolveLinks(ctx, access.goal.workspaceId, patch) : null;
  await db.$transaction(async (tx) => {
    await tx.keyResult.update({
      where: { id },
      data: {
        title: patch.title ?? undefined,
        startValue: patch.startValue ?? undefined,
        targetValue: patch.targetValue ?? undefined,
        unit: patch.unit ?? undefined,
        ...(link ? { linkedProjectId: link.projectId } : {}),
      },
    });
    if (link) {
      // the link is replaced as a whole: a project, or these tasks, or none
      await tx.keyResultTask.deleteMany({ where: { keyResultId: id } });
      if (link.taskIds.length > 0) await tx.keyResultTask.createMany({ data: link.taskIds.map((taskId) => ({ keyResultId: id, taskId })) });
    }
  });
  await syncProgress(row.goalId);
  await audit("okr.key_result_updated", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
  return oneDto(row.goalId, id);
}

export async function removeKeyResult(ctx: { orgId: string; userId: string }, id: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, FEATURE);
  const row = await loadKeyResult(ctx, id);
  await assertMayEditGoal(ctx, row.goalId);
  await db.keyResult.delete({ where: { id } });
  await syncProgress(row.goalId);
  await audit("okr.key_result_removed", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

export interface CheckInDto {
  id: string;
  value: number;
  previousValue: number;
  note: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
}

/** A check-in: the value now and a short note, appended to the key result's history. Refused on a key result that follows tasks. */
export async function checkIn(ctx: { orgId: string; userId: string }, id: string, input: z.infer<typeof checkInSchema>): Promise<{ keyResult: KeyResultDto; progress: number | null }> {
  await assertFeatureOn(ctx.orgId, FEATURE);
  const row = await loadKeyResult(ctx, id);
  await assertMayActOnGoal(ctx, row.goalId);
  if (row.linkedProjectId || row.hasTasks) refuse("value", "okr.linked_no_checkin");
  await db.$transaction(async (tx) => {
    // the key result is locked, so two check-ins at once each record the value they replaced
    await tx.$queryRaw`SELECT 1 FROM "KeyResult" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.keyResult.findUniqueOrThrow({ where: { id }, select: { currentValue: true } });
    await tx.keyResultUpdate.create({
      data: { keyResultId: id, value: input.value, previousValue: current.currentValue, note: input.note ?? "", authorId: ctx.userId },
    });
    await tx.keyResult.update({ where: { id }, data: { currentValue: input.value } });
  });
  const progress = await syncProgress(row.goalId);
  await audit("okr.checked_in", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
  return { keyResult: await oneDto(row.goalId, id), progress };
}

/** The history of a key result, newest first. Reads only: the owner of the company reads in silence. */
export async function listCheckIns(ctx: { orgId: string; userId: string }, id: string): Promise<CheckInDto[]> {
  await assertFeatureOn(ctx.orgId, FEATURE);
  const row = await loadKeyResult(ctx, id);
  await assertMemberCan(ctx, "goals.view", "section.view_denied");
  await goalAccess(ctx, row.goalId);
  const rows = await db.keyResultUpdate.findMany({
    where: { keyResultId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, value: true, previousValue: true, note: true, authorId: true, createdAt: true },
  });
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const),
  );
  return rows.map((r) => ({
    id: r.id,
    value: r.value,
    previousValue: r.previousValue,
    note: r.note,
    authorId: r.authorId,
    authorName: names.get(r.authorId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
