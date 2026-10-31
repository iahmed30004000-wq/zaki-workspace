import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit, requireWorkspace, type OrgAccessContext } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { loadWorkScope, narrowScope, taskVisibleWhere } from "@/server/services/team-scope";
import { addDays, dayKey, parseDayKey } from "@/lib/time-tracking";
import {
  DEFAULT_TIME_OF_DAY,
  MAX_ATTACHED_TASKS,
  cleanAnswers,
  cleanQuestions,
  defaultQuestions,
  idsOf,
  isParticipantsMode,
  normalizeWeekdays,
  parseTimeOfDay,
  questionsOf,
  roundIsOpen,
  statsOfRounds,
  summarizeDays,
  weekdaysOf,
  DEFAULT_WEEKDAYS,
  type ParticipantsMode,
  type PersonCheckinSummary,
  type PersonDayCount,
  type PersonTotals,
  type StatsRound,
} from "@/lib/checkins";

/**
 * «التسجيل اليومي» — a short stand-up per space (the owner's approved backlog, 2026-10-31).
 *
 * WHO
 *  - Turning it on, its questions, time, days and people: the space's ADMIN, and the owner (`requireWorkspace(id, ["ADMIN"])`).
 *  - Answering: a participant of the round (a snapshot of the space's people that morning: ACTIVE, not a guest), once per
 *    round, edited until the round closes (the end of the COMPANY's day); after that, refused. «إجازة اليوم» marks the person
 *    excused for that round, counted apart from missed.
 *  - Reading: the owner and the space's ADMIN read every answer of their space, SILENTLY (nothing is written: no «seen» mark,
 *    no row, no notice). A member reads their teammates' answers of a round only after submitting their own for THAT round
 *    (nobody copies). A person outside the space never; an external partner (a guest) never. A person on leave (excused)
 *    submitted nothing, so reads nothing either.
 *  - The company's `checkins` switch closes every door (404) and the job runner skips; nothing stored is lost.
 *  - No content goes to any AI; the push and the bell carry generic text, never an answer.
 *
 * ⚠️ A space's ADMIN reads every answer of their people. 🔧 The screen says so next to the question box, and who may read what is
 * decided here on the server, never by what the browser hides.
 */

export interface CheckinConfigDto {
  workspaceId: string;
  /** False until the space's ADMIN saves it once. */
  exists: boolean;
  active: boolean;
  questions: string[];
  timeOfDay: string;
  weekdays: number[];
  participantsMode: ParticipantsMode;
  participantIds: string[];
}

export interface PersonDto {
  id: string;
  name: string;
}

export interface TaskChip {
  id: string;
  title: string;
}

export interface AnswerDto {
  userId: string;
  userName: string;
  answers: string[];
  /** The attached tasks this reader may open (others are dropped, not named). */
  tasks: TaskChip[];
  submittedAt: string;
  editedAt: string | null;
}

export type RosterStatus = "answered" | "excused" | "pending" | "missed";

export interface RosterEntry {
  userId: string;
  name: string;
  status: RosterStatus;
}

export interface RoundDto {
  id: string;
  day: string;
  questions: string[];
  open: boolean;
  openedAt: string;
  closesAt: string;
}

export interface MyCheckin {
  /** Is the person one of the round's people? */
  participant: boolean;
  answered: boolean;
  excused: boolean;
  answers: string[];
  taskIds: string[];
  /** The tasks they attached, as chips (the ones they may still open). */
  tasks: TaskChip[];
  /** May they still submit or edit (a participant, the round open)? */
  canEdit: boolean;
}

export interface TodayView {
  /** The configuration exists and is on. */
  enabled: boolean;
  canManage: boolean;
  timeZone: string;
  day: string;
  schedule: { timeOfDay: string; weekdays: number[] } | null;
  /** Today's round; null while it has not opened (before its time, or not a working day). */
  round: RoundDto | null;
  me: MyCheckin | null;
  /** The person's open tasks, to attach to an answer (participants only, while the round is open). */
  myTasks: TaskChip[];
  roster: RosterEntry[];
  counts: { answered: number; excused: number; pending: number; missed: number };
  /** The teammates' answers; null until the reader has the right to see them (submitting their own). */
  team: AnswerDto[] | null;
}

export interface HistoryRound {
  round: RoundDto;
  roster: RosterEntry[];
  counts: { answered: number; excused: number; pending: number; missed: number };
  /** False: the reader did not answer that round, so its answers stay closed to them. */
  canSee: boolean;
  answers: AnswerDto[];
}

export interface HistoryView {
  timeZone: string;
  from: string;
  to: string;
  /** Everybody who appears in these rounds (for the «الشخص» filter), before any filter by person. */
  people: PersonDto[];
  rounds: HistoryRound[];
}

export type CardState = "none" | "pending" | "answered" | "excused";

// ───────────────────────────────────────── the guards ─────────────────────────────────────────

interface Gate {
  ctx: OrgAccessContext;
  /** The owner, the space's ADMIN, an org ADMIN who is in it: reads everything of the space. */
  manager: boolean;
}

/**
 * The space guard, then the company's switch. `manage`: only the space's ADMIN and the owner. Everybody else who is in the
 * space and is not an external partner. A guest, a stranger to the space: 403; the switch off: 404.
 */
async function gate(workspaceId: string, opts: { manage?: boolean } = {}): Promise<Gate> {
  await requireActor();
  const ctx = await requireWorkspace(workspaceId, opts.manage ? ["ADMIN"] : ["ADMIN", "MEMBER"]);
  await assertFeatureOn(ctx.orgId, "checkins");
  return { ctx, manager: ctx.spaceManager === true };
}

/** The people of a space a round may be opened for: in the space (not as a guest), ACTIVE in the company, not a guest there. */
export async function eligiblePeople(workspaceId: string, orgId: string): Promise<PersonDto[]> {
  const rows = await db.workspaceMember.findMany({ where: { workspaceId, role: { not: "GUEST" } }, select: { userId: true } });
  if (rows.length === 0) return [];
  const active = await db.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" }, userId: { in: rows.map((r) => r.userId) } },
    select: { user: { select: { id: true, name: true } } },
  });
  return active.map((m) => ({ id: m.user.id, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id));
}

/** The people a configuration opens a round for, out of the eligible ones. */
export function participantsOf(mode: ParticipantsMode, listed: readonly string[], eligible: readonly PersonDto[]): PersonDto[] {
  return mode === "ALL" ? [...eligible] : eligible.filter((p) => listed.includes(p.id));
}

async function namesOf(userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

const dayDate = (key: string): Date => new Date(`${key}T00:00:00.000Z`);
const keyOfDay = (day: Date): string => day.toISOString().slice(0, 10);
const bad = (path: string, message: string): never => {
  throw new ValidationError([{ path, message }]);
};

// ───────────────────────────────────────── the configuration ─────────────────────────────────────────

function configDto(workspaceId: string, row: { active: boolean; questions: unknown; timeOfDay: string; weekdays: number[]; participantsMode: string; participantIds: unknown } | null): CheckinConfigDto {
  if (!row) {
    return { workspaceId, exists: false, active: false, questions: defaultQuestions(), timeOfDay: DEFAULT_TIME_OF_DAY, weekdays: [...DEFAULT_WEEKDAYS], participantsMode: "ALL", participantIds: [] };
  }
  const questions = questionsOf(row.questions);
  return {
    workspaceId,
    exists: true,
    active: row.active,
    questions: questions.length > 0 ? questions : defaultQuestions(),
    timeOfDay: parseTimeOfDay(row.timeOfDay) ? row.timeOfDay : DEFAULT_TIME_OF_DAY,
    weekdays: weekdaysOf(row.weekdays),
    participantsMode: isParticipantsMode(row.participantsMode) ? row.participantsMode : "ALL",
    participantIds: idsOf(row.participantIds),
  };
}

/** The configuration for the settings dialog (the space's ADMIN and the owner), with the people who may be chosen. */
export async function getConfig(workspaceId: string): Promise<{ config: CheckinConfigDto; candidates: PersonDto[] }> {
  const g = await gate(workspaceId, { manage: true });
  const [row, candidates] = await Promise.all([db.checkinConfig.findUnique({ where: { workspaceId } }), eligiblePeople(workspaceId, g.ctx.orgId)]);
  return { config: configDto(workspaceId, row), candidates };
}

export interface ConfigInput {
  active: boolean;
  questions: unknown;
  timeOfDay: string;
  weekdays: unknown;
  participantsMode: string;
  participantIds?: unknown;
}

/** Saves the space's check-in. Everything is validated here again; a change never rewrites a round already opened. */
export async function saveConfig(workspaceId: string, input: ConfigInput): Promise<CheckinConfigDto> {
  const g = await gate(workspaceId, { manage: true });
  const questions = cleanQuestions(input.questions);
  if (!questions) return bad("questions", "checkins.e.questions_invalid");
  if (!parseTimeOfDay(input.timeOfDay)) return bad("timeOfDay", "checkins.e.time_invalid");
  const weekdays = normalizeWeekdays(input.weekdays);
  if (!weekdays) return bad("weekdays", "checkins.e.weekdays_invalid");
  if (!isParticipantsMode(input.participantsMode)) return bad("participantsMode", "checkins.e.participants_invalid");
  const mode = input.participantsMode;
  const listed = idsOf(input.participantIds, 500);
  const eligible = await eligiblePeople(workspaceId, g.ctx.orgId);
  const eligibleIds = new Set(eligible.map((p) => p.id));
  if (mode === "LIST") {
    if (listed.length === 0) return bad("participantIds", "checkins.e.participants_empty");
    if (listed.some((id) => !eligibleIds.has(id))) return bad("participantIds", "checkins.e.participants_invalid");
  }
  const data = {
    active: input.active === true,
    questions: questions as Prisma.InputJsonValue,
    timeOfDay: input.timeOfDay,
    weekdays,
    participantsMode: mode,
    participantIds: (mode === "LIST" ? listed : []) as Prisma.InputJsonValue,
    updatedById: g.ctx.userId,
  };
  const row = await db.checkinConfig.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
  await audit("checkins.config_saved", { actorId: g.ctx.userId, orgId: g.ctx.orgId, target: workspaceId, meta: { active: data.active, mode, questions: questions.length, timeOfDay: data.timeOfDay, weekdays } });
  return configDto(workspaceId, row);
}

// ───────────────────────────────────────── reading a round ─────────────────────────────────────────

type RoundRow = { id: string; workspaceId: string; day: Date; openedAt: Date; closedAt: Date; questions: unknown; participantIds: unknown };
type AnswerRow = { userId: string; answers: unknown; taskIds: unknown; excused: boolean; submittedAt: Date; editedAt: Date | null };

function roundDto(round: RoundRow, now: Date): RoundDto {
  return { id: round.id, day: keyOfDay(round.day), questions: questionsOf(round.questions), open: roundIsOpen(round, now), openedAt: round.openedAt.toISOString(), closesAt: round.closedAt.toISOString() };
}

/** Each person of the round and where they stand: answered, excused, still to answer (open round) or missed (closed round). */
function rosterOf(round: RoundRow, answers: readonly AnswerRow[], names: Map<string, string>, now: Date): RosterEntry[] {
  const open = roundIsOpen(round, now);
  const byUser = new Map(answers.map((a) => [a.userId, a] as const));
  const ids = [...new Set([...idsOf(round.participantIds), ...answers.map((a) => a.userId)])];
  return ids
    .map((userId): RosterEntry => {
      const a = byUser.get(userId);
      return { userId, name: names.get(userId) ?? "", status: a ? (a.excused ? "excused" : "answered") : open ? "pending" : "missed" };
    })
    .sort((x, y) => x.name.localeCompare(y.name, "ar") || x.userId.localeCompare(y.userId));
}

const countsOf = (roster: readonly RosterEntry[]) => ({
  answered: roster.filter((r) => r.status === "answered").length,
  excused: roster.filter((r) => r.status === "excused").length,
  pending: roster.filter((r) => r.status === "pending").length,
  missed: roster.filter((r) => r.status === "missed").length,
});

/** The chips a reader may open: the attached tasks, through the same scope every task list reads through. */
async function chipsFor(readerId: string, rows: readonly AnswerRow[]): Promise<Map<string, TaskChip>> {
  const ids = [...new Set(rows.flatMap((r) => idsOf(r.taskIds, MAX_ATTACHED_TASKS)))];
  if (ids.length === 0) return new Map();
  const scope = await loadWorkScope(readerId);
  const tasks = await db.task.findMany({ where: { id: { in: ids }, ...taskVisibleWhere(scope) }, select: { id: true, title: true } });
  return new Map(tasks.map((t) => [t.id, { id: t.id, title: t.title }]));
}

function answerDto(row: AnswerRow, names: Map<string, string>, chips: Map<string, TaskChip>, questionCount: number): AnswerDto {
  const texts = Array.isArray(row.answers) ? row.answers.filter((a): a is string => typeof a === "string") : [];
  while (texts.length < questionCount) texts.push("");
  return {
    userId: row.userId,
    userName: names.get(row.userId) ?? "",
    answers: texts,
    tasks: idsOf(row.taskIds, MAX_ATTACHED_TASKS).flatMap((id) => {
      const chip = chips.get(id);
      return chip ? [chip] : [];
    }),
    submittedAt: row.submittedAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  };
}

/** The person's open tasks of the space, to attach to an answer (assigned to them, as assignee or co-assignee, and openable by them). */
export async function myOpenTasks(userId: string, workspaceId: string): Promise<TaskChip[]> {
  const scope = narrowScope(await loadWorkScope(userId), workspaceId);
  return db.task.findMany({
    where: { workspaceId, archived: false, completedAt: null, AND: [{ OR: [{ assigneeId: userId }, { coAssignees: { some: { userId } } }] }, taskVisibleWhere(scope)] },
    select: { id: true, title: true },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 50,
  });
}

/**
 * «اليوم» for one space: today's round, my own answer, the roster (who answered, who did not) and — only for the owner,
 * the space's ADMIN, or somebody who has submitted — the teammates' answers. Reads nothing into the database.
 */
export async function getToday(workspaceId: string, now: Date = new Date()): Promise<TodayView> {
  const g = await gate(workspaceId);
  const [config, timeZone] = await Promise.all([db.checkinConfig.findUnique({ where: { workspaceId } }), orgTimeZone(g.ctx.orgId)]);
  const day = dayKey(now, timeZone);
  const view: TodayView = {
    enabled: config?.active === true,
    canManage: g.manager,
    timeZone,
    day,
    schedule: config ? { timeOfDay: configDto(workspaceId, config).timeOfDay, weekdays: weekdaysOf(config.weekdays) } : null,
    round: null,
    me: null,
    myTasks: [],
    roster: [],
    counts: { answered: 0, excused: 0, pending: 0, missed: 0 },
    team: null,
  };
  const round = await db.checkinRound.findUnique({ where: { workspaceId_day: { workspaceId, day: dayDate(day) } }, include: { answers: true } });
  if (!round) return view;

  const names = await namesOf([...idsOf(round.participantIds), ...round.answers.map((a) => a.userId)]);
  const mine = round.answers.find((a) => a.userId === g.ctx.userId) ?? null;
  const open = roundIsOpen(round, now);
  const participant = idsOf(round.participantIds).includes(g.ctx.userId);
  view.round = roundDto(round, now);
  view.roster = rosterOf(round, round.answers, names, now);
  view.counts = countsOf(view.roster);
  view.me = {
    participant,
    answered: !!mine && !mine.excused,
    excused: !!mine?.excused,
    answers: mine && !mine.excused ? [...(Array.isArray(mine.answers) ? (mine.answers as unknown[]).map(String) : [])] : [],
    taskIds: mine && !mine.excused ? idsOf(mine.taskIds, MAX_ATTACHED_TASKS) : [],
    tasks: [],
    canEdit: participant && open,
  };
  if (mine && !mine.excused) {
    const chips = await chipsFor(g.ctx.userId, [mine]);
    view.me.tasks = idsOf(mine.taskIds, MAX_ATTACHED_TASKS).flatMap((id) => (chips.has(id) ? [chips.get(id) as TaskChip] : []));
  }
  if (participant && open) view.myTasks = await myOpenTasks(g.ctx.userId, workspaceId);
  // the teammates' answers: a manager reads them all (silently); everybody else only after submitting their own
  if (g.manager || view.me.answered) {
    const visible = round.answers.filter((a) => !a.excused);
    const chips = await chipsFor(g.ctx.userId, visible);
    view.team = visible
      .map((a) => answerDto(a, names, chips, questionsOf(round.questions).length))
      .sort((x, y) => x.userName.localeCompare(y.userName, "ar") || x.userId.localeCompare(y.userId));
  }
  return view;
}

export interface HistoryQuery {
  userId?: string | null;
  from?: string | null;
  to?: string | null;
  day?: string | null;
}

const HISTORY_DEFAULT_DAYS = 30;
const HISTORY_MAX_DAYS = 366;
const HISTORY_MAX_ROUNDS = 100;

/**
 * The past rounds of a space, newest first: a range (default the last 30 days), one day, or one person's timeline. A round's
 * answers are shown to a manager always, and to anybody else only for a round where they submitted themselves.
 */
export async function history(workspaceId: string, query: HistoryQuery = {}, now: Date = new Date()): Promise<HistoryView> {
  const g = await gate(workspaceId);
  const timeZone = await orgTimeZone(g.ctx.orgId);
  const today = dayKey(now, timeZone);
  let from = query.day || query.from || addDays(today, -(HISTORY_DEFAULT_DAYS - 1));
  let to = query.day || query.to || today;
  if (!parseDayKey(from)) return bad("from", "checkins.e.bad_date");
  if (!parseDayKey(to)) return bad("to", "checkins.e.bad_date");
  if (from > to) [from, to] = [to, from];
  if (addDays(from, HISTORY_MAX_DAYS) < to) return bad("to", "checkins.e.range_long");

  const rounds = await db.checkinRound.findMany({
    where: { workspaceId, day: { gte: dayDate(from), lte: dayDate(to) } },
    orderBy: { day: "desc" },
    take: HISTORY_MAX_ROUNDS,
    include: { answers: true },
  });
  const personId = query.userId || null;
  const names = await namesOf(rounds.flatMap((r) => [...idsOf(r.participantIds), ...r.answers.map((a) => a.userId)]));
  // what the reader may open: a manager every round, anybody else the rounds they answered themselves
  const canSee = (r: (typeof rounds)[number]) => g.manager || r.answers.some((a) => a.userId === g.ctx.userId && !a.excused);
  const shown = rounds.flatMap((r) => (canSee(r) ? r.answers.filter((a) => !a.excused && (!personId || a.userId === personId)) : []));
  const chips = await chipsFor(g.ctx.userId, shown);

  const people = new Map<string, string>();
  for (const r of rounds) for (const e of rosterOf(r, r.answers, names, now)) people.set(e.userId, e.name);

  return {
    timeZone,
    from,
    to,
    people: [...people.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id)),
    rounds: rounds.map((r): HistoryRound => {
      const roster = rosterOf(r, r.answers, names, now);
      const see = canSee(r);
      const rows = see ? r.answers.filter((a) => !a.excused && (!personId || a.userId === personId)) : [];
      return {
        round: roundDto(r, now),
        roster: personId ? roster.filter((e) => e.userId === personId) : roster,
        counts: countsOf(roster),
        canSee: see,
        answers: rows.map((a) => answerDto(a, names, chips, questionsOf(r.questions).length)).sort((x, y) => x.userName.localeCompare(y.userName, "ar") || x.userId.localeCompare(y.userId)),
      };
    }),
  };
}

// ───────────────────────────────────────── answering ─────────────────────────────────────────

/** The round a person may write to: the one of `day` (default today), it must exist, be open, and the person be one of its people. */
async function openRoundForWriting(g: Gate, workspaceId: string, day: string | null | undefined, now: Date) {
  const timeZone = await orgTimeZone(g.ctx.orgId);
  const key = day || dayKey(now, timeZone);
  if (!parseDayKey(key)) return bad("day", "checkins.e.bad_date");
  const round = await db.checkinRound.findUnique({ where: { workspaceId_day: { workspaceId, day: dayDate(key) } } });
  if (!round) throw new NotFoundError("checkins.e.no_round");
  if (!roundIsOpen(round, now)) throw new ForbiddenError("checkins.e.closed");
  if (!idsOf(round.participantIds).includes(g.ctx.userId)) throw new ForbiddenError("checkins.e.not_participant");
  return round;
}

export interface SubmitInput {
  day?: string | null;
  answers: unknown;
  taskIds?: unknown;
}

/**
 * Submits (or edits, until the round closes) my answer. The texts are one per question, each at most 1000 characters, at
 * least one not blank; the tasks attached are mine, open, and openable by me (a task I attached before keeps its place even if
 * it was finished since). Submitting after an «إجازة اليوم» turns the excuse into an answer.
 */
export async function submitAnswer(workspaceId: string, input: SubmitInput, now: Date = new Date()): Promise<{ edited: boolean }> {
  const g = await gate(workspaceId);
  const round = await openRoundForWriting(g, workspaceId, input.day, now);
  const questions = questionsOf(round.questions);
  const cleaned = cleanAnswers(input.answers, questions.length);
  if (!cleaned.ok) return bad("answers", cleaned.problem === "long" ? "checkins.e.answer_long" : cleaned.problem === "empty" ? "checkins.e.answer_empty" : "checkins.e.answer_count");

  const wanted = idsOf(input.taskIds, MAX_ATTACHED_TASKS + 1);
  if (wanted.length > MAX_ATTACHED_TASKS || (Array.isArray(input.taskIds) && input.taskIds.length !== wanted.length)) return bad("taskIds", "checkins.e.tasks_invalid");
  const existing = await db.checkinAnswer.findUnique({ where: { roundId_userId: { roundId: round.id, userId: g.ctx.userId } } });
  if (wanted.length > 0) {
    const kept = existing && !existing.excused ? idsOf(existing.taskIds, MAX_ATTACHED_TASKS) : [];
    const allowed = new Set([...(await myOpenTasks(g.ctx.userId, workspaceId)).map((t) => t.id), ...kept]);
    if (wanted.some((id) => !allowed.has(id))) return bad("taskIds", "checkins.e.tasks_invalid");
    // a kept task must still be openable by the person
    const scope = narrowScope(await loadWorkScope(g.ctx.userId), workspaceId);
    const open = await db.task.count({ where: { id: { in: wanted }, ...taskVisibleWhere(scope) } });
    if (open !== wanted.length) return bad("taskIds", "checkins.e.tasks_invalid");
  }

  const edited = !!existing && !existing.excused;
  const texts = cleaned.answers as Prisma.InputJsonValue;
  const tasks = wanted as Prisma.InputJsonValue;
  try {
    if (existing) {
      await db.checkinAnswer.update({
        where: { id: existing.id },
        data: edited ? { answers: texts, taskIds: tasks, editedAt: now } : { answers: texts, taskIds: tasks, excused: false, submittedAt: now, editedAt: null },
      });
    } else {
      await db.checkinAnswer.create({ data: { roundId: round.id, userId: g.ctx.userId, answers: texts, taskIds: tasks, submittedAt: now } });
    }
  } catch (err) {
    // two submissions at the same moment: the unique row is the backstop; the second one is an edit of the first
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await db.checkinAnswer.update({ where: { roundId_userId: { roundId: round.id, userId: g.ctx.userId } }, data: { answers: texts, taskIds: tasks, excused: false, editedAt: now } });
      return { edited: true };
    }
    throw err;
  }
  return { edited };
}

/** «إجازة اليوم»: marks me excused for today's open round (or takes the mark back). Somebody who already answered cannot be excused. */
export async function setExcused(workspaceId: string, on: boolean, input: { day?: string | null } = {}, now: Date = new Date()): Promise<{ excused: boolean }> {
  const g = await gate(workspaceId);
  const round = await openRoundForWriting(g, workspaceId, input.day, now);
  const existing = await db.checkinAnswer.findUnique({ where: { roundId_userId: { roundId: round.id, userId: g.ctx.userId } } });
  if (!on) {
    if (existing?.excused) await db.checkinAnswer.delete({ where: { id: existing.id } });
    return { excused: false };
  }
  if (existing && !existing.excused) throw new ForbiddenError("checkins.e.already_answered");
  if (!existing) {
    try {
      await db.checkinAnswer.create({ data: { roundId: round.id, userId: g.ctx.userId, excused: true, answers: [], taskIds: [], submittedAt: now } });
    } catch (err) {
      // the same press twice at once: the row exists already, which is the answer wanted
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  return { excused: true };
}

// ───────────────────────────────────────── the Today card ─────────────────────────────────────────

/**
 * The one line on «اليوم»: does the person have a round to answer in this space? `none`: the switch is off, no check-in, no
 * round yet today, or they are not one of its people (a guest, the owner reading a space he is not in). Writes nothing.
 */
export async function cardState(workspaceId: string, now: Date = new Date()): Promise<CardState> {
  const g = await gate(workspaceId);
  const timeZone = await orgTimeZone(g.ctx.orgId);
  const round = await db.checkinRound.findUnique({
    where: { workspaceId_day: { workspaceId, day: dayDate(dayKey(now, timeZone)) } },
    select: { id: true, closedAt: true, participantIds: true, answers: { where: { userId: g.ctx.userId }, select: { excused: true } } },
  });
  if (!round || !roundIsOpen(round, now) || !idsOf(round.participantIds).includes(g.ctx.userId)) return "none";
  const mine = round.answers[0];
  return mine ? (mine.excused ? "excused" : "answered") : "pending";
}

/** Is the switch on for this company (for a page that decides before it calls the guards)? */
export const checkinsOn = (orgId: string): Promise<boolean> => isFeatureOn(orgId, "checkins");

// ───────────────────────────────────────── the counts, for the owner board (a later PR) ─────────────────────────────────────────

export interface StatsRange {
  from: string;
  to: string;
}

export interface CheckinStats {
  /** One entry per person per round of the range. */
  days: PersonDayCount[];
  /** The same, summed per person. */
  people: PersonTotals[];
}

/**
 * Answered, missed and excused counts per person per day of a space, over `[from, to]` (company days, `YYYY-MM-DD`,
 * inclusive). «Missed» is a participant of a CLOSED round with neither answer nor excuse; an open round is «pending».
 * The arithmetic is `statsOfRounds` (pure, in src/lib/checkins.ts).
 *
 * ⚠️ This reads the table directly and decides NOTHING about who may ask: the caller authorizes (the owner board, in a later
 * PR, with its own rules). It is not wired to any route.
 */
export async function checkinStats(spaceId: string, range: StatsRange, now: Date = new Date()): Promise<CheckinStats> {
  if (!parseDayKey(range.from) || !parseDayKey(range.to)) throw new ValidationError([{ path: "range", message: "checkins.e.bad_date" }]);
  const rounds = await db.checkinRound.findMany({
    where: { workspaceId: spaceId, day: { gte: dayDate(range.from), lte: dayDate(range.to) } },
    orderBy: { day: "asc" },
    select: { day: true, closedAt: true, participantIds: true, answers: { select: { userId: true, excused: true } } },
  });
  const input: StatsRound[] = rounds.map((r) => ({ day: keyOfDay(r.day), closedAt: r.closedAt, participantIds: idsOf(r.participantIds), answers: r.answers }));
  return statsOfRounds(input, now);
}

/**
 * «التسجيل اليومي» in a person's file: for each of these people, the days they answered, missed and were excused, and the run of
 * answered days, over `[from, to]` across EVERY space of the company (one number per person, not per space).
 *
 * ⚠️ NUMBERS ONLY. The query selects who answered and whether they were excused, never `answers` (the texts) or `taskIds`, so a
 * text cannot leak through this door by a later edit of the caller. It decides NOTHING about who may ask: the caller is the score,
 * which has already checked that the viewer may open this person's file. 🔧 Off, the switch returns an empty map.
 */
export async function checkinSummaryFor(
  orgId: string,
  userIds: readonly string[],
  range: StatsRange,
  now: Date = new Date(),
): Promise<Map<string, PersonCheckinSummary>> {
  const out = new Map<string, PersonCheckinSummary>();
  if (userIds.length === 0 || !(await isFeatureOn(orgId, "checkins"))) return out;
  if (!parseDayKey(range.from) || !parseDayKey(range.to)) throw new ValidationError([{ path: "range", message: "checkins.e.bad_date" }]);
  const rounds = await db.checkinRound.findMany({
    where: { workspace: { organizationId: orgId }, day: { gte: dayDate(range.from), lte: dayDate(range.to) } },
    select: { workspaceId: true, day: true, closedAt: true, participantIds: true, answers: { select: { userId: true, excused: true } } },
  });
  const perSpace = new Map<string, StatsRound[]>();
  for (const r of rounds) {
    const list = perSpace.get(r.workspaceId) ?? [];
    list.push({ day: keyOfDay(r.day), closedAt: r.closedAt, participantIds: idsOf(r.participantIds), answers: r.answers });
    perSpace.set(r.workspaceId, list);
  }
  const days: PersonDayCount[] = [];
  const wanted = new Set(userIds);
  for (const list of perSpace.values()) for (const d of statsOfRounds(list, now).days) if (wanted.has(d.userId)) days.push(d);
  const summaries = summarizeDays(days);
  for (const id of userIds) out.set(id, summaries.get(id) ?? { answered: 0, missed: 0, excused: 0, streak: 0 });
  return out;
}
