import { Prisma, type TimeEntry, type TimeEntrySource } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, requireTaskAccess, requireWorkspace, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan, requireActor, type Actor } from "@/server/policy/actor";
import { isSpaceManager } from "@/server/workspace-role";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { loadWorkScope, projectVisibleWhere, taskParticipantFilter, taskVisibleWhere } from "@/server/services/team-scope";
import {
  MAX_ENTRY_SECONDS,
  MAX_NOTE,
  MAX_REPORT_ROWS,
  addDays,
  closeTimer,
  dayAnchor,
  dayKey,
  dayWindow,
  editWindowOpen,
  fitsDay,
  groupTotals,
  parseDayKey,
  presetRange,
  secondsOfHM,
  sumSeconds,
  EDIT_WINDOW_DAYS,
  type Group,
} from "@/lib/time-tracking";

/**
 * «حساب وقت الشغل» — the time people log on tasks (the owner, 2026-10-30: «حساب وقت الشغل: نعم»).
 *
 * THE RULES THAT KEEP THE NUMBERS TRUE
 *  - A duration is whole SECONDS from two readings of the SERVER's clock (`startedAt`, `stoppedAt`); nothing a browser
 *    says about time is ever read. The screens draw a live clock from the server's `startedAt`, nothing more.
 *  - ONE running timer per person: «ابدأ» on another task closes the first (the answer says which, so the screen can
 *    toast it). Every write of one person's entries runs under a per-person advisory lock, and the partial unique index
 *    "TimeEntry_one_running_per_user" is the backstop that no code path can bypass.
 *  - A timer that ran MORE than 12 hours is closed at `startedAt + 12h` and marked `autoStopped` — by the job runner
 *    (src/server/jobs/time-entries.ts), or by whoever closes it first, with the same rule (`closeTimer`).
 *  - A manual entry is at most 24 h, and a person logs at most 24 h on one calendar day of the COMPANY's zone (manual
 *    entries and edits are checked against it; a real timer cannot lie about the clock). Never in the future.
 *  - An entry is changed or deleted by its owner within 14 days of creating it, or by the space's OWNER/ADMIN always.
 *    ⚠️ Every change keeps the previous values: an `AuditLog` row written in the SAME transaction (`time.entry_edited`,
 *    `time.entry_deleted`, `time.entry_auto_stopped`). 🔧 Nothing is silently overwritten.
 *  - An entry outlives its task: archiving touches nothing; a hard-deleted task sets `taskId` to null and the entry keeps
 *    its `taskTitle`.
 *
 * WHO
 *  - Tracking: a member of the space, on a task they may open. A GUEST (external partner) never. The OWNER reading a
 *    space he is not in (silent oversight) never starts a timer or adds time (403): a timer carries a name and a time,
 *    and silent reading leaves no trace. The company's `timeTracking` switch closes every door (404); nothing is lost.
 *  - Reading: a person sees only their own entries; the OWNER/ADMIN of a space (`isSpaceManager`) see everybody's in
 *    THAT space. Spaces are separate: another space's entries never show, and the report filters by the person's spaces.
 *  - No money anywhere: no rate, no cost.
 */

export interface EntryDto {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  taskId: string | null;
  taskTitle: string;
  startedAt: string;
  stoppedAt: string | null;
  seconds: number;
  note: string;
  source: TimeEntrySource;
  autoStopped: boolean;
  running: boolean;
  /** The company's day the entry belongs to (`YYYY-MM-DD`, the day it started in the company's zone). */
  day: string;
  /** May the viewer change or delete it (its owner within the window, or the space's OWNER/ADMIN)? The server decides again. */
  canEdit: boolean;
}

type Row = Pick<TimeEntry, "id" | "workspaceId" | "userId" | "taskId" | "taskTitle" | "startedAt" | "stoppedAt" | "seconds" | "note" | "source" | "autoStopped" | "createdAt">;

interface Viewer {
  userId: string;
  /** The spaces where the viewer is the OWNER/ADMIN (everybody's entries of those spaces are theirs to read and change). */
  managed: ReadonlySet<string> | "all";
}

const isManagerOf = (viewer: Viewer, workspaceId: string): boolean => viewer.managed === "all" || viewer.managed.has(workspaceId);

function toDto(row: Row, names: Map<string, string>, tz: string, viewer: Viewer, now: Date): EntryDto {
  const mine = row.userId === viewer.userId;
  const manager = isManagerOf(viewer, row.workspaceId);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    userName: names.get(row.userId) ?? "",
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt ? row.stoppedAt.toISOString() : null,
    seconds: row.seconds,
    note: row.note,
    source: row.source,
    autoStopped: row.autoStopped,
    running: row.stoppedAt === null,
    day: dayKey(row.startedAt, tz),
    canEdit: manager || (mine && editWindowOpen(row.createdAt, now)),
  };
}

async function namesOf(userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

const SELECT = { id: true, workspaceId: true, userId: true, taskId: true, taskTitle: true, startedAt: true, stoppedAt: true, seconds: true, note: true, source: true, autoStopped: true, createdAt: true } as const;

// ───────────────────────────────────────── the guards ─────────────────────────────────────────

/** The company's switch, then «not an external partner». Every door starts here. */
async function personGate(): Promise<Actor> {
  const actor = await requireActor();
  await assertFeatureOn(actor.orgId, "timeTracking");
  if (actor.isExternal) throw new ForbiddenError("tt.e.guest_denied");
  return actor;
}

type TaskGate = OrgAccessContext & { actor: Actor; task: { id: string; workspaceId: string }; title: string; archived: boolean; inSpace: boolean };

/**
 * A task's time card, for reading or writing: a member of the space who may open the task. An external partner (an org
 * GUEST, or a space row that says GUEST) never: `requireTaskAccess` is asked for the writing roles only.
 */
async function taskGate(taskId: string): Promise<TaskGate> {
  const actor = await personGate();
  const access = await requireTaskAccess(taskId, ["ADMIN", "MEMBER"]);
  await assertFeatureOn(access.orgId, "timeTracking");
  await assertMemberCan(access, "tasks.view", "section.view_denied");
  const [task, row] = await Promise.all([
    db.task.findUniqueOrThrow({ where: { id: taskId }, select: { title: true, archived: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: access.task.workspaceId, userId: access.userId } }, select: { userId: true } }),
  ]);
  return { ...access, actor, title: task.title, archived: task.archived, inSpace: !!row };
}

/** Tracking: the gate, and the OWNER in silent oversight (not in the space) never writes. */
async function taskWriteGate(taskId: string): Promise<TaskGate> {
  const gate = await taskGate(taskId);
  if (gate.orgRole === "OWNER" && !gate.inSpace) throw new ForbiddenError("tt.e.oversight_readonly");
  return gate;
}

export function cleanNote(raw: unknown): string {
  const note = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (note.length > MAX_NOTE) throw new ValidationError([{ path: "note", message: "tt.e.note_long" }]);
  return note;
}

/** One person's writes are serialised, so «one running timer» and «24 h a day» are checked against a quiet table. */
async function lockPerson(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`timeentry:${userId}`}, 0))`;
}

async function auditIn(
  tx: Prisma.TransactionClient,
  action: string,
  row: { id: string; orgId: string; workspaceId: string },
  actorId: string | null,
  meta: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditLog.create({ data: { action, actorId, orgId: row.orgId, target: row.id, workspaceId: row.workspaceId, meta } });
}

const snapshot = (r: Pick<TimeEntry, "startedAt" | "stoppedAt" | "seconds" | "note" | "autoStopped" | "taskId" | "taskTitle" | "userId" | "source">) => ({
  userId: r.userId,
  taskId: r.taskId,
  taskTitle: r.taskTitle,
  source: r.source,
  startedAt: r.startedAt.toISOString(),
  stoppedAt: r.stoppedAt ? r.stoppedAt.toISOString() : null,
  seconds: r.seconds,
  note: r.note,
  autoStopped: r.autoStopped,
});

// ───────────────────────────────────────── the timer ─────────────────────────────────────────

/** Closes a running row at `now` by the one rule (`closeTimer`). A row somebody else closed first (the runner) is returned as it is. */
async function closeRunning(tx: Prisma.TransactionClient, running: TimeEntry, now: Date, actorId: string): Promise<TimeEntry> {
  const closed = closeTimer(running.startedAt, now);
  const claimed = await tx.timeEntry.updateMany({
    where: { id: running.id, stoppedAt: null },
    data: { stoppedAt: closed.stoppedAt, seconds: closed.seconds, autoStopped: closed.autoStopped },
  });
  const row = await tx.timeEntry.findUniqueOrThrow({ where: { id: running.id } });
  if (claimed.count === 1 && closed.autoStopped) {
    // ran past 12 hours and was closed by a person's action before the runner got to it: the same audit row as the runner's
    await auditIn(tx, "time.entry_auto_stopped", row, actorId, { by: "person", before: snapshot(running), after: snapshot(row) });
  }
  return row;
}

export interface StartResult {
  entry: EntryDto;
  /** The timer that was running on another task and was closed by this start (null when none, or when this task's own was already running). */
  stopped: EntryDto | null;
  /** This task's own timer was already running: nothing changed. */
  already: boolean;
}

export async function startTimer(taskId: string, now: Date = new Date()): Promise<StartResult> {
  const gate = await taskWriteGate(taskId);
  if (gate.archived) throw new ValidationError([{ path: "taskId", message: "tt.e.task_archived" }]);
  const tz = await orgTimeZone(gate.orgId);
  const viewer = await viewerOf(gate.actor);
  const out = await db.$transaction(async (tx) => {
    await lockPerson(tx, gate.userId);
    const running = await tx.timeEntry.findFirst({ where: { userId: gate.userId, stoppedAt: null } });
    if (running && running.taskId === taskId) return { entry: running, stopped: null, already: true };
    const stopped = running ? await closeRunning(tx, running, now, gate.userId) : null;
    const entry = await tx.timeEntry.create({
      data: { orgId: gate.orgId, workspaceId: gate.task.workspaceId, userId: gate.userId, taskId, taskTitle: gate.title, startedAt: now, source: "TIMER" },
    });
    return { entry, stopped, already: false };
  });
  const names = await namesOf([gate.userId]);
  return {
    entry: toDto(out.entry, names, tz, viewer, now),
    stopped: out.stopped ? toDto(out.stopped, names, tz, viewer, now) : null,
    already: out.already,
  };
}

export async function stopTimer(now: Date = new Date()): Promise<EntryDto> {
  const actor = await personGate();
  const tz = await orgTimeZone(actor.orgId);
  const viewer = await viewerOf(actor);
  const row = await db.$transaction(async (tx) => {
    await lockPerson(tx, actor.userId);
    const running = await tx.timeEntry.findFirst({ where: { userId: actor.userId, stoppedAt: null } });
    if (!running) throw new NotFoundError("tt.e.not_running");
    return closeRunning(tx, running, now, actor.userId);
  });
  return toDto(row, await namesOf([actor.userId]), tz, viewer, now);
}

// ───────────────────────────────────────── manual entries ─────────────────────────────────────────

export interface ManualInput {
  /** The company's day, `YYYY-MM-DD`. */
  date: string;
  hours: number;
  minutes: number;
  note?: string;
}

/** The seconds of typed hours and minutes, with the reason it is wrong (too long, or just not a duration). */
function durationOf(hours: unknown, minutes: unknown): number {
  const seconds = secondsOfHM(hours, minutes);
  if (seconds !== null) return seconds;
  if (typeof hours === "number" && typeof minutes === "number" && Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && minutes >= 0 && minutes <= 59 && hours * 3600 + minutes * 60 > MAX_ENTRY_SECONDS) {
    throw new ValidationError([{ path: "hours", message: "tt.e.too_long" }]);
  }
  throw new ValidationError([{ path: "hours", message: "tt.e.bad_duration" }]);
}

/** A day a person may log on: a real date, not in the company's future, and (for a non-manager) not older than the window. */
function checkDay(key: string, today: string, manager: boolean): void {
  if (!parseDayKey(key)) throw new ValidationError([{ path: "date", message: "tt.e.bad_date" }]);
  if (key > today) throw new ValidationError([{ path: "date", message: "tt.e.future_date" }]);
  if (!manager && key < addDays(today, -EDIT_WINDOW_DAYS)) throw new ValidationError([{ path: "date", message: "tt.e.too_old" }]);
}

/** What the person already has finished on the company's day `[start, end)`, other than `exceptId`. */
async function loggedOnDay(tx: Prisma.TransactionClient, userId: string, start: Date, end: Date, exceptId?: string): Promise<number> {
  const sum = await tx.timeEntry.aggregate({
    _sum: { seconds: true },
    where: { userId, stoppedAt: { not: null }, startedAt: { gte: start, lt: end }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  return sum._sum.seconds ?? 0;
}

export async function addManualEntry(taskId: string, input: ManualInput, now: Date = new Date()): Promise<EntryDto> {
  const gate = await taskWriteGate(taskId);
  const seconds = durationOf(input.hours, input.minutes);
  const note = cleanNote(input.note);
  const tz = await orgTimeZone(gate.orgId);
  const today = dayKey(now, tz);
  checkDay(input.date, today, gate.spaceManager === true);
  const anchor = dayAnchor(input.date, tz)!;
  const window = dayWindow(input.date, tz)!;
  const viewer = await viewerOf(gate.actor);
  const row = await db.$transaction(async (tx) => {
    await lockPerson(tx, gate.userId);
    if (!fitsDay(await loggedOnDay(tx, gate.userId, window.start, window.end), seconds)) throw new ValidationError([{ path: "hours", message: "tt.e.day_full" }]);
    return tx.timeEntry.create({
      data: {
        orgId: gate.orgId,
        workspaceId: gate.task.workspaceId,
        userId: gate.userId,
        taskId,
        taskTitle: gate.title,
        startedAt: anchor,
        stoppedAt: new Date(anchor.getTime() + seconds * 1000),
        seconds,
        note,
        source: "MANUAL",
      },
    });
  });
  return toDto(row, await namesOf([gate.userId]), tz, viewer, now);
}

// ───────────────────────────────────────── edit and delete ─────────────────────────────────────────

/** The entry and the right to touch it: its owner within the window, or the space's OWNER/ADMIN. Anything else is «not found». */
async function touchGate(entryId: string, now: Date) {
  const actor = await personGate();
  const entry = await db.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.orgId !== actor.orgId) throw new NotFoundError("tt.e.not_found");
  let ctx: OrgAccessContext;
  try {
    ctx = await requireWorkspace(entry.workspaceId, ["ADMIN", "MEMBER"]);
  } catch {
    // a space the person is not in: the answer never says the entry exists
    throw new NotFoundError("tt.e.not_found");
  }
  const manager = ctx.spaceManager === true;
  if (entry.userId !== ctx.userId && !manager) throw new NotFoundError("tt.e.not_found");
  if (!manager && !editWindowOpen(entry.createdAt, now)) throw new ForbiddenError("tt.e.window_closed");
  return { actor, entry, ctx, manager };
}

export interface EntryPatch {
  note?: string;
  date?: string;
  hours?: number;
  minutes?: number;
}

export async function updateEntry(entryId: string, patch: EntryPatch, now: Date = new Date()): Promise<EntryDto> {
  const { actor, entry: seen, manager } = await touchGate(entryId, now);
  const wantsNote = patch.note !== undefined;
  const wantsDuration = patch.hours !== undefined || patch.minutes !== undefined;
  const wantsDate = patch.date !== undefined;
  const note = wantsNote ? cleanNote(patch.note) : null;
  const seconds = wantsDuration ? durationOf(patch.hours, patch.minutes) : null;
  const tz = await orgTimeZone(seen.orgId);
  const viewer = await viewerOf(actor);

  const row = await db.$transaction(async (tx) => {
    // the owner of the entry is locked, not the editor: the day's total is that person's
    await lockPerson(tx, seen.userId);
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundError("tt.e.not_found");

    const data: Prisma.TimeEntryUpdateInput = {};
    let startedAt = entry.startedAt;
    let secs = entry.seconds;
    if (note !== null && note !== entry.note) data.note = note;

    if (wantsDuration || wantsDate) {
      // time moves only for a finished entry: a running timer is stopped first
      if (entry.stoppedAt === null) throw new ValidationError([{ path: "hours", message: "tt.e.running_locked" }]);
      if (wantsDate) {
        if (entry.source !== "MANUAL") throw new ValidationError([{ path: "date", message: "tt.e.date_timer_locked" }]);
        checkDay(patch.date as string, dayKey(now, tz), manager);
        startedAt = dayAnchor(patch.date as string, tz)!;
      }
      if (seconds !== null) secs = seconds;
      const stoppedAt = new Date(startedAt.getTime() + secs * 1000);
      // only the logged time and its day count as a change (a timer's sub-second tail is not a correction)
      if (startedAt.getTime() !== entry.startedAt.getTime() || secs !== entry.seconds) {
        const window = dayWindow(dayKey(startedAt, tz), tz)!;
        if (!fitsDay(await loggedOnDay(tx, entry.userId, window.start, window.end, entry.id), secs)) throw new ValidationError([{ path: "hours", message: "tt.e.day_full" }]);
        data.startedAt = startedAt;
        data.stoppedAt = stoppedAt;
        data.seconds = secs;
        // the person corrected it: the «stopped automatically» mark has done its job (the audit row keeps what it was)
        if (entry.autoStopped) data.autoStopped = false;
      }
    }
    if (Object.keys(data).length === 0) return entry;

    const next = await tx.timeEntry.update({ where: { id: entryId }, data });
    await auditIn(tx, "time.entry_edited", next, actor.userId, { before: snapshot(entry), after: snapshot(next), byManager: next.userId !== actor.userId });
    return next;
  });
  return toDto(row, await namesOf([row.userId]), tz, viewer, now);
}

export async function deleteEntry(entryId: string, now: Date = new Date()): Promise<void> {
  const { actor, entry: seen } = await touchGate(entryId, now);
  await db.$transaction(async (tx) => {
    await lockPerson(tx, seen.userId);
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundError("tt.e.not_found");
    await tx.timeEntry.delete({ where: { id: entryId } });
    await auditIn(tx, "time.entry_deleted", entry, actor.userId, { before: snapshot(entry), byManager: entry.userId !== actor.userId });
  });
}

// ───────────────────────────────────────── reading ─────────────────────────────────────────

/** The spaces where the actor is OWNER/ADMIN. The company's OWNER manages every space (he reads them all, in or out). */
async function viewerOf(actor: Actor): Promise<Viewer> {
  if (actor.role === "OWNER") return { userId: actor.userId, managed: "all" };
  const rows = await db.workspaceMember.findMany({
    where: { userId: actor.userId, workspace: { organizationId: actor.orgId } },
    select: { workspaceId: true, role: true },
  });
  return { userId: actor.userId, managed: new Set(rows.filter((r) => isSpaceManager(actor.role, r.role)).map((r) => r.workspaceId)) };
}

export interface TaskTimeCard {
  /** The viewer's entries of this task (everybody's, for the space's OWNER/ADMIN), newest first. */
  entries: EntryDto[];
  /** The sum of the FINISHED entries listed (a running one counts when it stops). */
  totalSeconds: number;
  /** The viewer's own running timer, on this task or another (null: none). */
  running: EntryDto | null;
  /** The server's clock now: the screen draws the live clock from `running.startedAt` and this, never from its own date. */
  serverNow: string;
  timeZone: string;
  /** May the viewer start a timer or add time on this task (the card shows the buttons)? */
  canTrack: boolean;
  /** Does the viewer see everybody's entries of the space? */
  manager: boolean;
}

const LIST_LIMIT = 200;

/** The card of a task for somebody who has already passed the task's guard (the task page, `taskTimeCard`). */
export async function buildTaskTimeCard(
  ctx: { userId: string; orgId: string; orgRole: string; spaceRole: string | null | undefined; workspaceId: string; archived: boolean },
  taskId: string,
  now: Date = new Date(),
): Promise<TaskTimeCard> {
  const manager = isSpaceManager(ctx.orgRole, ctx.spaceRole);
  const tz = await orgTimeZone(ctx.orgId);
  const viewer: Viewer = { userId: ctx.userId, managed: ctx.orgRole === "OWNER" ? "all" : manager ? new Set([ctx.workspaceId]) : new Set() };
  const rows = await db.timeEntry.findMany({
    where: { taskId, orgId: ctx.orgId, ...(manager ? {} : { userId: ctx.userId }) },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    select: SELECT,
  });
  const running = await db.timeEntry.findFirst({ where: { userId: ctx.userId, stoppedAt: null }, select: SELECT });
  const names = await namesOf([...rows.map((r) => r.userId), ...(running ? [running.userId] : [])]);
  const finished = rows.filter((r) => r.stoppedAt !== null);
  const inSpace = ctx.spaceRole != null;
  return {
    entries: rows.map((r) => toDto(r, names, tz, viewer, now)),
    totalSeconds: sumSeconds(finished),
    running: running ? toDto(running, names, tz, viewer, now) : null,
    serverNow: now.toISOString(),
    timeZone: tz,
    canTrack: ctx.orgRole !== "GUEST" && !ctx.archived && (ctx.orgRole !== "OWNER" || inSpace),
    manager,
  };
}

export async function taskTimeCard(taskId: string, now: Date = new Date()): Promise<TaskTimeCard> {
  const gate = await taskGate(taskId);
  const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: gate.task.workspaceId, userId: gate.userId } }, select: { role: true } });
  return buildTaskTimeCard(
    { userId: gate.userId, orgId: gate.orgId, orgRole: gate.orgRole, spaceRole: row?.role, workspaceId: gate.task.workspaceId, archived: gate.archived },
    taskId,
    now,
  );
}

export interface MyTimeToday {
  running: EntryDto | null;
  /** The finished time the person logged on the company's today. */
  todaySeconds: number;
  serverNow: string;
  timeZone: string;
}

/** «وقتي اليوم»: the person's own running timer and today's finished total. */
export async function myTimeToday(now: Date = new Date()): Promise<MyTimeToday> {
  const actor = await personGate();
  const tz = await orgTimeZone(actor.orgId);
  const window = dayWindow(dayKey(now, tz), tz)!;
  const viewer = await viewerOf(actor);
  const [running, sum] = await Promise.all([
    db.timeEntry.findFirst({ where: { userId: actor.userId, stoppedAt: null }, select: SELECT }),
    db.timeEntry.aggregate({ _sum: { seconds: true }, where: { userId: actor.userId, stoppedAt: { not: null }, startedAt: { gte: window.start, lt: window.end } } }),
  ]);
  const names = await namesOf([actor.userId]);
  return { running: running ? toDto(running, names, tz, viewer, now) : null, todaySeconds: sum._sum.seconds ?? 0, serverNow: now.toISOString(), timeZone: tz };
}

/**
 * The task the person's OWN timer is running on right now, for the little «الوقت شغّال» on rows and cards. null when none,
 * when the company switched the feature off, or for an external partner. One indexed read.
 */
export async function myRunningTaskId(actor: Pick<Actor, "userId" | "orgId" | "isExternal">): Promise<string | null> {
  if (actor.isExternal || !(await isFeatureOn(actor.orgId, "timeTracking"))) return null;
  const row = await db.timeEntry.findFirst({ where: { userId: actor.userId, stoppedAt: null }, select: { taskId: true } });
  return row?.taskId ?? null;
}

// ───────────────────────────────────────── the report ─────────────────────────────────────────

export interface ReportQuery {
  from?: string | null;
  to?: string | null;
  userId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  workspaceId?: string | null;
}

export interface ReportRow {
  id: string;
  day: string;
  userId: string;
  userName: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string;
  seconds: number;
  note: string;
  source: TimeEntrySource;
  autoStopped: boolean;
}

export interface TimeReport {
  from: string;
  to: string;
  timeZone: string;
  totalSeconds: number;
  rows: ReportRow[];
  byPerson: Group[];
  byProject: Group[];
  byDay: Group[];
  /** Who the viewer may pick: everybody of the spaces they manage, or only themselves. */
  people: { id: string; name: string }[];
  canPickPerson: boolean;
  spaces: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  filters: { userId: string | null; projectId: string | null; taskId: string | null; workspaceId: string | null };
}

const SPAN_LIMIT_DAYS = 366;

function daysBetween(from: string, to: string): number {
  const a = parseDayKey(from)!;
  const b = parseDayKey(to)!;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export async function timeReport(query: ReportQuery, now: Date = new Date()): Promise<TimeReport> {
  const actor = await personGate();
  const tz = await orgTimeZone(actor.orgId);
  const fallback = presetRange("week", now, tz);
  const from = query.from || fallback.from;
  const to = query.to || fallback.to;
  if (!parseDayKey(from) || !parseDayKey(to) || from > to) throw new ValidationError([{ path: "from", message: "tt.e.bad_range" }]);
  if (daysBetween(from, to) >= SPAN_LIMIT_DAYS) throw new ValidationError([{ path: "to", message: "tt.e.range_too_long" }]);
  const start = dayWindow(from, tz)!.start;
  const end = dayWindow(to, tz)!.end;

  // spaces are separate sites: only the spaces the person is in (the OWNER: every space of the company)
  const viewer = await viewerOf(actor);
  const spaceRows = await db.workspace.findMany({
    where: actor.role === "OWNER" ? { organizationId: actor.orgId } : { organizationId: actor.orgId, members: { some: { userId: actor.userId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const accessible = spaceRows.map((s) => s.id);
  const managedIds = accessible.filter((id) => isManagerOf(viewer, id));
  const canPickPerson = managedIds.length > 0;
  if (query.userId && query.userId !== actor.userId && !canPickPerson) throw new ForbiddenError("tt.e.report_person_denied");
  if (query.workspaceId && !accessible.includes(query.workspaceId)) throw new NotFoundError("tt.e.not_found");

  const scope = await loadWorkScope(actor.userId);
  const [projectRows, visibleTask] = await Promise.all([
    db.project.findMany({
      where: { workspaceId: { in: query.workspaceId ? [query.workspaceId] : accessible }, AND: [projectVisibleWhere(scope)] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    query.taskId ? db.task.findFirst({ where: { id: query.taskId, orgId: actor.orgId, AND: [taskVisibleWhere(scope)] }, select: { id: true } }) : Promise.resolve(null),
  ]);
  // a task or project the person may not open is «not found», as its own page would say
  if (query.taskId && !visibleTask) throw new NotFoundError("tt.e.not_found");
  if (query.projectId && !projectRows.some((p) => p.id === query.projectId)) throw new NotFoundError("tt.e.not_found");

  const where: Prisma.TimeEntryWhereInput = {
    orgId: actor.orgId,
    stoppedAt: { not: null },
    startedAt: { gte: start, lt: end },
    // everybody's entries of the spaces they manage; only their own of any other space of theirs
    OR: [{ workspaceId: { in: managedIds } }, { userId: actor.userId, workspaceId: { in: accessible } }],
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.taskId ? { taskId: query.taskId } : {}),
    ...(query.projectId ? { task: { projectId: query.projectId } } : {}),
    // a private task's entries are read by the task's own people, its managers and oversight, not by every OWNER-rank person (P0 review)
    AND: [{ OR: [{ taskId: null }, { task: await taskParticipantFilter(actor.userId) }] }],
  };
  const found = await db.timeEntry.findMany({
    where,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: MAX_REPORT_ROWS + 1,
    select: { ...SELECT, task: { select: { number: true, title: true, project: { select: { id: true, name: true } }, organization: { select: { keyPrefix: true } } } } },
  });
  if (found.length > MAX_REPORT_ROWS) throw new ValidationError([{ path: "from", message: "tt.e.report_too_big" }]);

  const names = await namesOf(found.map((r) => r.userId));
  const rows: ReportRow[] = found.map((r) => ({
    id: r.id,
    day: dayKey(r.startedAt, tz),
    userId: r.userId,
    userName: names.get(r.userId) ?? "",
    workspaceId: r.workspaceId,
    projectId: r.task?.project.id ?? null,
    projectName: r.task?.project.name ?? null,
    taskId: r.taskId,
    taskKey: r.task ? `${r.task.organization.keyPrefix}-${r.task.number}` : null,
    // the task's own title while it exists (a renamed task reads right), the snapshot once it is gone
    taskTitle: r.task?.title ?? r.taskTitle,
    seconds: r.seconds,
    note: r.note,
    source: r.source,
    autoStopped: r.autoStopped,
  }));

  let people: { id: string; name: string }[] = [{ id: actor.userId, name: (await namesOf([actor.userId])).get(actor.userId) ?? "" }];
  if (canPickPerson) {
    const members = await db.workspaceMember.findMany({
      where: { workspaceId: { in: managedIds }, user: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } } },
      select: { user: { select: { id: true, name: true } } },
    });
    const owner = actor.role === "OWNER" ? [{ user: { id: actor.userId, name: people[0]!.name } }] : [];
    const map = new Map([...members, ...owner].map((m) => [m.user.id, m.user.name]));
    // somebody who has since left a space keeps their entries: they are still pickable for the report
    for (const r of rows) if (!map.has(r.userId)) map.set(r.userId, r.userName);
    people = [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }

  return {
    from,
    to,
    timeZone: tz,
    totalSeconds: sumSeconds(rows),
    rows,
    byPerson: groupTotals(rows, (r) => ({ key: r.userId, label: r.userName })),
    byProject: groupTotals(rows, (r) => ({ key: r.projectId ?? "none", label: r.projectName ?? "" })),
    byDay: groupTotals(rows, (r) => ({ key: r.day, label: r.day })).sort((a, b) => (a.key < b.key ? -1 : 1)),
    people,
    canPickPerson,
    spaces: spaceRows,
    projects: projectRows,
    filters: { userId: query.userId ?? null, projectId: query.projectId ?? null, taskId: query.taskId ?? null, workspaceId: query.workspaceId ?? null },
  };
}
