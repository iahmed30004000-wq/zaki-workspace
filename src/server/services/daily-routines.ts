import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireProjectAccess } from "@/server/auth";
import { assertMemberCan, requireActor, type Actor } from "@/server/policy/actor";
import { assignKindByRank } from "@/server/policy/assign-rank";
import { assertFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { judgeAssignment } from "@/server/services/task-assign";
import { loadWorkScope, projectVisibleWhere, userSeesProject } from "@/server/services/team-scope";
import { isSpaceManager, workspaceRoleOf } from "@/server/workspace-role";
import { dayOfInstant } from "@/lib/due-day";
import { ruleOccurrenceAfter } from "@/lib/reminders/recurrence";
import { ruleOfRoutine, type RoutineInput, type RoutineStopReason } from "@/lib/daily-routine";
import { routineObstacle } from "@/server/services/daily-routine-spawn";

/**
 * «روتين يومي» — the routines screen: the list, and making, changing, pausing and resuming one.
 *
 * WHO: a routine is made by whoever may create a task in that project (their own row in the space: never a partner from
 * outside, never the owner reading a space he is not in), for a person of that space they may hand a task to DIRECTLY.
 * A manager of the space sees and manages all of its routines; anybody else sees the ones they made and the ones that
 * are theirs, and manages only what they made. The company's «مهمة متكررة» switch closes every door; nothing is lost.
 */

export interface RoutineDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string | null;
  assignee: { id: string; name: string };
  days: number[];
  time: string;
  dueTime: string;
  active: boolean;
  stoppedReason: RoutineStopReason | null;
  /** When the next card appears (null while paused or stopped). */
  nextRunAt: string | null;
  canManage: boolean;
}

export interface RoutineSpaceOption {
  id: string;
  name: string;
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
}

export interface RoutinesScreen {
  routines: RoutineDto[];
  spaces: RoutineSpaceOption[];
  timeZone: string;
}

/** The signed-in person, past the switch. A partner from outside has no routines. */
async function door(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.isExternal) throw new ForbiddenError("guest.readonly");
  await assertFeatureOn(actor.orgId, "recurringTasks");
  return actor;
}

/** The spaces the person is IN (their own row), and whether they manage each. */
async function seatsOf(actor: Actor) {
  const rows = await db.workspaceMember.findMany({
    where: { userId: actor.userId, workspace: { organizationId: actor.orgId, archivedAt: null } },
    select: { role: true, workspace: { select: { id: true, name: true, kind: true } } },
    orderBy: { workspace: { createdAt: "asc" } },
  });
  return rows.map((r) => ({
    id: r.workspace.id,
    name: r.workspace.name,
    kind: r.workspace.kind,
    manages: isSpaceManager(actor.role, r.role),
    writes: workspaceRoleOf(actor.role, r.role) !== "GUEST",
  }));
}
type Seat = Awaited<ReturnType<typeof seatsOf>>[number];

const INCLUDE = { workspace: { select: { name: true } }, project: { select: { name: true } } } as const;

async function dtos(actor: Actor, seats: Seat[], where: { id?: string } = {}): Promise<RoutineDto[]> {
  const managed = seats.filter((s) => s.manages).map((s) => s.id);
  const rows = await db.dailyRoutine.findMany({
    where: {
      ...where,
      orgId: actor.orgId,
      workspaceId: { in: seats.map((s) => s.id) },
      OR: [{ workspaceId: { in: managed } }, { createdById: actor.userId }, { assigneeId: actor.userId }],
    },
    include: INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assigneeId))] } }, select: { id: true, name: true } });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    workspaceName: r.workspace.name,
    projectId: r.projectId,
    projectName: r.project.name,
    title: r.title,
    description: r.description,
    assignee: { id: r.assigneeId, name: names.get(r.assigneeId) ?? "" },
    days: r.days,
    time: r.time,
    dueTime: r.dueTime,
    active: r.active,
    stoppedReason: (r.stoppedReason as RoutineStopReason | null) ?? null,
    nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    canManage: managed.includes(r.workspaceId) || r.createdById === actor.userId,
  }));
}

/** What the «new routine» form offers: the spaces the person writes in, the projects they see there, the people they may hand a task to. */
async function optionsOf(actor: Actor, seats: Seat[]): Promise<RoutineSpaceOption[]> {
  const open = seats.filter((s) => s.writes && s.kind !== "HQ");
  if (!open.length) return [];
  const ids = open.map((s) => s.id);
  const [projects, members] = await Promise.all([
    db.project.findMany({
      where: { AND: [{ workspaceId: { in: ids }, status: { not: "ARCHIVED" }, boards: { some: { archived: false } } }, projectVisibleWhere(await loadWorkScope(actor.userId))] },
      select: { id: true, name: true, workspaceId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.workspaceMember.findMany({
      where: { workspaceId: { in: ids }, user: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } } },
      select: { workspaceId: true, user: { select: { id: true, name: true, memberships: { where: { organizationId: actor.orgId, status: "ACTIVE" }, select: { role: true } } } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  return open
    .map((s) => ({
      id: s.id,
      name: s.name,
      projects: projects.filter((p) => p.workspaceId === s.id).map((p) => ({ id: p.id, name: p.name })),
      people: members
        .filter((m) => m.workspaceId === s.id)
        .filter((m) => {
          const rank = m.user.memberships[0]?.role;
          if (!rank || rank === "GUEST") return false;
          return m.user.id === actor.userId || assignKindByRank(actor.role, rank) === "direct";
        })
        .map((m) => ({ id: m.user.id, name: m.user.name })),
    }))
    .filter((s) => s.projects.length > 0);
}

export async function routinesScreen(): Promise<RoutinesScreen> {
  const actor = await door();
  await assertMemberCan(actor, "tasks.view", "section.view_denied");
  const seats = await seatsOf(actor);
  const [routines, spaces, timeZone] = await Promise.all([dtos(actor, seats), optionsOf(actor, seats), orgTimeZone(actor.orgId)]);
  return { routines, spaces, timeZone };
}

/** The first time AFTER now whose day has no card yet (an edit or a resume after today's card shows tomorrow). */
async function nextRunFor(routineId: string | null, days: number[], time: string, zone: string, now: Date): Promise<Date | null> {
  const rule = ruleOfRoutine(days, time);
  let next = ruleOccurrenceAfter(rule, zone, now);
  if (next && routineId) {
    const made = await db.dailyRoutineRun.findUnique({ where: { routineId_day: { routineId, day: dayOfInstant(next, zone) } }, select: { id: true } });
    if (made) next = ruleOccurrenceAfter(rule, zone, next);
  }
  return next;
}

/** Every rule of a new or changed routine; returns the board its cards will be born on. */
async function checkHome(actor: Actor, input: RoutineInput): Promise<string> {
  const access = await requireProjectAccess(input.projectId, ["ADMIN", "MEMBER"]);
  if (access.orgId !== actor.orgId || access.project.workspaceId !== input.workspaceId) throw new NotFoundError("project.not_found");
  const seat = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: actor.userId } }, select: { id: true } });
  if (!seat) throw new ForbiddenError("routine.not_in_space");
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied");
  // an archived project or space takes no routine: the runner would only stop it again
  const home = await db.project.findUnique({ where: { id: input.projectId }, select: { status: true, workspace: { select: { archivedAt: true } } } });
  if (!home || home.status === "ARCHIVED" || home.workspace.archivedAt) throw new ForbiddenError("daily_routine.archived");
  const board = await db.board.findFirst({ where: { projectId: input.projectId, archived: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  if (!board) throw new NotFoundError("board.not_found");
  const verdict = await judgeAssignment(db, actor, input.assigneeId, input.workspaceId);
  if (verdict !== "direct") throw new ForbiddenError("routine.assignee_above");
  if (access.project.teamId && !(await userSeesProject(input.assigneeId, access.project))) throw new ForbiddenError("assignee.not_in_team");
  return board.id;
}

const fieldsOf = (input: RoutineInput, boardId: string) => ({
  workspaceId: input.workspaceId,
  projectId: input.projectId,
  boardId,
  title: input.title,
  description: input.description || null,
  assigneeId: input.assigneeId,
  days: input.days,
  time: input.time,
  dueTime: input.dueTime,
});

async function oneDto(actor: Actor, id: string): Promise<RoutineDto> {
  const found = (await dtos(actor, await seatsOf(actor), { id }))[0];
  if (!found) throw new NotFoundError("daily_routine.not_found");
  return found;
}

export async function createDailyRoutine(input: RoutineInput, now: Date = new Date()): Promise<{ routine: RoutineDto; orgId: string; userId: string }> {
  const actor = await door();
  const boardId = await checkHome(actor, input);
  const zone = await orgTimeZone(actor.orgId);
  const made = await db.dailyRoutine.create({
    data: { ...fieldsOf(input, boardId), orgId: actor.orgId, createdById: actor.userId, nextRunAt: await nextRunFor(null, input.days, input.time, zone, now) },
    select: { id: true },
  });
  return { routine: await oneDto(actor, made.id), orgId: actor.orgId, userId: actor.userId };
}

/** The routine for somebody who may change it: unseen → 404, seen but not theirs to change → 403. */
async function manageable(id: string) {
  const actor = await door();
  const seen = await oneDto(actor, id);
  if (!seen.canManage) throw new ForbiddenError("routine.not_yours");
  const row = await db.dailyRoutine.findUniqueOrThrow({ where: { id } });
  return { actor, row };
}

/** A new version of the routine (cards already made stay as they are). It then acts as whoever changed it; a paused one stays paused. */
export async function updateDailyRoutine(id: string, input: RoutineInput, now: Date = new Date()) {
  const { actor, row } = await manageable(id);
  const boardId = await checkHome(actor, input);
  const zone = await orgTimeZone(actor.orgId);
  await db.dailyRoutine.update({
    where: { id },
    data: {
      ...fieldsOf(input, boardId),
      createdById: actor.userId,
      nextRunAt: row.active ? await nextRunFor(id, input.days, input.time, zone, now) : null,
      stoppedReason: null,
    },
  });
  return { routine: await oneDto(actor, id), orgId: actor.orgId, userId: actor.userId };
}

/** «إيقاف مؤقت»: nothing more is made; every card already made stays. */
export async function pauseDailyRoutine(id: string) {
  const { actor } = await manageable(id);
  await db.dailyRoutine.update({ where: { id }, data: { active: false, stoppedReason: null, nextRunAt: null } });
  return { routine: await oneDto(actor, id), orgId: actor.orgId, userId: actor.userId };
}

/** «تشغيل»: from the next time on, nothing made up for the days it was paused. */
export async function resumeDailyRoutine(id: string, now: Date = new Date()) {
  const { actor, row } = await manageable(id);
  const input: RoutineInput = {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    assigneeId: row.assigneeId,
    days: row.days,
    time: row.time,
    dueTime: row.dueTime,
  };
  // it keeps acting as its maker while they still can; otherwise whoever resumes it takes it over, under their own rights
  const keepsMaker = (await db.$transaction((tx) => routineObstacle(tx, row))) === null;
  const boardId = keepsMaker ? row.boardId : await checkHome(actor, input);
  const zone = await orgTimeZone(actor.orgId);
  await db.dailyRoutine.update({
    where: { id },
    data: {
      active: true,
      stoppedReason: null,
      boardId,
      ...(keepsMaker ? {} : { createdById: actor.userId }),
      nextRunAt: await nextRunFor(id, row.days, row.time, zone, now),
    },
  });
  return { routine: await oneDto(actor, id), orgId: actor.orgId, userId: actor.userId };
}
