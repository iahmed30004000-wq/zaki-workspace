import type { Prisma, ReviewLight } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertMayOpenPerson, devAccess, isSelf, readsAsReviewer, type DevAccess } from "@/server/policy/team-development";
import { loadPeopleActivity, type PersonRow } from "@/server/services/owner-board";
import { orgTimeZone } from "@/server/services/org-day";
import { countedReviewsFor } from "@/server/services/team-reviews";
import { SCORE_SECTIONS } from "@/server/services/team-score-sections";
import { loadSections, type BoardSection } from "@/server/services/owner-board-sections";
import { headlineLight, readRatings } from "@/lib/team-reviews";
import {
  DEFAULT_WEIGHTS,
  INDICATOR_KEYS,
  baselineFor,
  composite,
  countToScore,
  currentPeriod,
  isFuture,
  manualAverage,
  manualToScore,
  onTimeToScore,
  parsePeriod,
  previousPeriods,
  readWeights,
  shownScore,
  suggestedLight,
  type Band,
  type Baseline,
  type Composite,
  type Light,
  type Period,
  type PeriodKind,
  type Weights,
} from "@/lib/team-score";
import { dayKeyOf, resolveWindow, type BoardWindow } from "@/lib/owner-board";

/**
 * «السكور» — a transparent composite per person per period, read from data that already exists. Nothing is stored: every number is
 * computed on the request, from the owner board's own figures (`loadPeopleActivity` is the board's query, so the two screens can
 * never disagree), the time tracked, and the reviews. The arithmetic and its rules are in src/lib/team-score.ts and are printed on
 * the screen next to every number.
 *
 * WHO READS: the owner (everybody who is staff and not an OWNER), a supervisor (their subtree), and the person (THEIR OWN score only,
 * with the manual part taken from the reviews SHARED with them: a score must not reveal a review they have not been given).
 * Nobody reads a ranking: the table is sorted by NAME unless the viewer clicks the score column.
 */

export const weightsSchema = z
  .object({
    manual: z.number().int("teamdev.weights_invalid").min(0, "teamdev.weights_invalid").max(100, "teamdev.weights_invalid"),
    completed: z.number().int("teamdev.weights_invalid").min(0, "teamdev.weights_invalid").max(100, "teamdev.weights_invalid"),
    onTime: z.number().int("teamdev.weights_invalid").min(0, "teamdev.weights_invalid").max(100, "teamdev.weights_invalid"),
    steps: z.number().int("teamdev.weights_invalid").min(0, "teamdev.weights_invalid").max(100, "teamdev.weights_invalid"),
  })
  .refine((w) => w.manual + w.completed + w.onTime + w.steps > 0, { message: "teamdev.weights_zero" });

function weightsOfSettings(settings: unknown): Weights {
  const stored = settings && typeof settings === "object" ? (settings as { teamDevelopment?: { weights?: unknown } }).teamDevelopment?.weights : undefined;
  return readWeights(stored);
}

export async function getWeights(actor: Actor): Promise<Weights> {
  const access = await devAccess(actor);
  const org = await db.organization.findUnique({ where: { id: access.orgId }, select: { settings: true } });
  return weightsOfSettings(org?.settings);
}

/** The owner's weights. Owner (and partners) only; every other key of the company's settings is kept. Audited. */
export async function setWeights(actor: Actor, weights: Weights): Promise<Weights> {
  const access = await devAccess(actor);
  if (!access.isOwner) throw new NotFoundError("teamdev.not_found");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${access.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: access.orgId }, select: { settings: true } });
    const base = org?.settings && typeof org.settings === "object" ? (org.settings as Record<string, unknown>) : {};
    const td = base["teamDevelopment"] && typeof base["teamDevelopment"] === "object" ? (base["teamDevelopment"] as Record<string, unknown>) : {};
    await tx.organization.update({ where: { id: access.orgId }, data: { settings: { ...base, teamDevelopment: { ...td, weights } } as Prisma.InputJsonValue } });
  });
  await audit("team.weights_set", { actorId: actor.userId, orgId: access.orgId, meta: { ...weights } });
  return weights;
}

// ───────────────────────────────────────── the numbers ─────────────────────────────────────────

export interface IndicatorDetail {
  /** 0-100, or null: «—». */
  value: number | null;
  /** The weight the owner gave it, and the share after re-normalising over the present ones (percent; null when absent). */
  weight: number;
  share: number | null;
}

export interface ScoreDetail {
  userId: string;
  period: { key: string; kind: PeriodKind; from: string; to: string; /** The period is not over yet: its numbers are partial. */ partial: boolean };
  weights: Weights;
  /** The viewer is the person: the manual part counts only the reviews SHARED with them. */
  sharedOnly: boolean;
  /** 0-100 whole number for the screen, null when nothing is present. */
  score: number | null;
  band: Band | null;
  /** The reviewers' light (the most worrying of the counted reviews). It is the one that counts. */
  light: Light | null;
  /** What the system suggests from the score. A suggestion only. */
  suggestedLight: Light | null;
  composite: Composite;
  manual: IndicatorDetail & { average: number | null; reviews: number };
  completed: IndicatorDetail & { count: number; baseline: Baseline | null };
  onTime: IndicatorDetail & { onTime: number; withDue: number; rate: number | null };
  steps: IndicatorDetail & { count: number; baseline: Baseline | null };
  /** Shown beside the score, never in it. */
  extras: {
    openNow: number;
    overdueNow: number;
    messages: number;
    trackedMinutes: number | null;
    /** «التسجيل اليومي»: days answered and the run of them. Numbers only, never an answer; null while the switch is off. */
    checkins: { answered: number; streak: number } | null;
  };
}

interface Computed {
  details: Map<string, ScoreDetail>;
}

const noScope = () => ({ restricted: false, workspaceIds: [] as string[], teamIds: [] as string[] });

async function activity(orgId: string, ids: readonly string[], win: BoardWindow, tz: string, now: Date): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  return new Map((await loadPeopleActivity(orgId, ids, win, tz, now)).map((r) => [r.userId, r]));
}

const windowOf = (p: Period, now: Date, tz: string): BoardWindow => resolveWindow({ from: p.from, to: p.to }, now, tz);

/**
 * The score of these people for one period. `teamIds` is who the team's median is taken over (every ACTIVE staff member who is not an
 * OWNER); `sharedOnly` makes the manual part use only reviews shared with the person (the person's own view).
 */
async function computeScores(
  orgId: string,
  ids: readonly string[],
  teamIds: readonly string[],
  period: Period,
  opts: { now: Date; tz: string; sharedOnly: boolean; sections?: readonly BoardSection[] },
): Promise<Computed> {
  const { now, tz, sharedOnly } = opts;
  const win = windowOf(period, now, tz);
  const today = dayKeyOf(now, tz);
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const weights = weightsOfSettings(org?.settings);

  const thisPeriod = await activity(orgId, [...new Set([...ids, ...teamIds])], win, tz, now);
  const previous = await Promise.all(previousPeriods(period, 3).map((p) => activity(orgId, ids, windowOf(p, now, tz), tz, now)));
  const sections = await loadSections({ orgId, timeZone: tz, window: win, scope: noScope(), userIds: [...ids] }, opts.sections ?? SCORE_SECTIONS);
  const reviews = await countedReviewsFor(orgId, ids, period.key, { sharedOnly });

  const teamCompleted = teamIds.map((id) => thisPeriod.get(id)?.completed ?? 0);
  const teamSteps = teamIds.map((id) => thisPeriod.get(id)?.steps ?? 0);
  const details = new Map<string, ScoreDetail>();

  for (const id of ids) {
    const row = thisPeriod.get(id);
    const completed = row?.completed ?? 0;
    const steps = row?.steps ?? 0;
    const mine = reviews.filter((r) => r.userId === id);
    const manual = manualAverage(mine.map((r) => readRatings(r.ratings)));
    const completedBase = baselineFor(previous.map((m) => m.get(id)?.completed ?? 0), teamCompleted);
    const stepsBase = baselineFor(previous.map((m) => m.get(id)?.steps ?? 0), teamSteps);
    const values = {
      manual: manualToScore(manual.average),
      completed: countToScore(completed, completedBase?.value ?? null),
      onTime: onTimeToScore(row?.onTimeRate ?? null),
      steps: countToScore(steps, stepsBase?.value ?? null),
    };
    const comp = composite(INDICATOR_KEYS.map((key) => ({ key, value: values[key] })), weights);
    const line = (key: (typeof INDICATOR_KEYS)[number]): IndicatorDetail => {
      const l = comp.lines.find((x) => x.key === key)!;
      return { value: l.value, weight: l.weight, share: l.share };
    };
    const light = headlineLight(mine.map((r) => r.light as ReviewLight | null)) as Light | null;
    const timeCell = sections.values.get(id)?.["time.minutes"];
    const answeredCell = sections.values.get(id)?.["checkins.answered"];
    const streakCell = sections.values.get(id)?.["checkins.streak"];
    details.set(id, {
      userId: id,
      period: { key: period.key, kind: period.kind, from: period.from, to: period.to, partial: period.to >= today },
      weights,
      sharedOnly,
      score: shownScore(comp.score),
      band: comp.band,
      light,
      suggestedLight: suggestedLight(comp.score),
      composite: comp,
      manual: { ...line("manual"), average: manual.average, reviews: manual.count },
      completed: { ...line("completed"), count: completed, baseline: completedBase },
      onTime: { ...line("onTime"), onTime: row?.onTime ?? 0, withDue: row?.withDue ?? 0, rate: row?.onTimeRate ?? null },
      steps: { ...line("steps"), count: steps, baseline: stepsBase },
      extras: { openNow: row?.openTasks ?? 0, overdueNow: row?.overdue ?? 0, messages: row?.messages ?? 0, trackedMinutes: typeof timeCell === "number" ? timeCell : null,
        checkins: typeof answeredCell === "number" ? { answered: answeredCell, streak: typeof streakCell === "number" ? streakCell : 0 } : null,
      },
    });
  }
  return { details };
}

/** The period asked for (or the current month), refused when it is not a period or has not begun. */
async function resolvePeriod(access: DevAccess, asked: string | undefined, kind: PeriodKind | undefined): Promise<{ period: Period; now: Date; tz: string }> {
  const tz = await orgTimeZone(access.orgId);
  const now = new Date();
  const period = asked === undefined ? currentPeriod(now, tz, kind ?? "month") : parsePeriod(asked);
  if (!period) throw new ValidationError([{ path: "period", message: "teamdev.period_invalid" }]);
  if (isFuture(period, dayKeyOf(now, tz))) throw new ValidationError([{ path: "period", message: "teamdev.period_future" }]);
  return { period, now, tz };
}

/** Everybody the team's median is taken over: ACTIVE staff, not guests, not OWNER-rank. */
const teamOf = (access: DevAccess): string[] => [...access.staff].filter(([, p]) => p.role !== "OWNER").map(([id]) => id);

export interface ScoreTable {
  period: ScoreDetail["period"];
  weights: Weights;
  sort: "name" | "score";
  rows: { userId: string; name: string; jobTitle: string | null; score: number | null; band: Band | null; light: Light | null; suggestedLight: Light | null; reviews: number }[];
}

/** The people the viewer reads, with their score band and light for the period. Sorted by name; by score only when asked. */
export async function loadScoreTable(actor: Actor, opts: { period?: string; kind?: PeriodKind; sort?: string } = {}): Promise<ScoreTable> {
  const access = await devAccess(actor);
  if (!access.isOwner && !access.isSupervisor) throw new NotFoundError("teamdev.not_found");
  const { period, now, tz } = await resolvePeriod(access, opts.period, opts.kind);
  const team = teamOf(access);
  const ids = team.filter((id) => (access.reach === null ? true : access.reach.has(id)));
  const { details } = await computeScores(access.orgId, ids, team, period, { now, tz, sharedOnly: false });
  const sort = opts.sort === "score" ? "score" : "name";
  const rows = ids
    .map((id) => {
      const d = details.get(id)!;
      const p = access.staff.get(id)!;
      return { userId: id, name: p.name, jobTitle: p.jobTitle, score: d.score, band: d.band, light: d.light, suggestedLight: d.suggestedLight, reviews: d.manual.reviews };
    })
    .sort((a, b) => (sort === "score" ? (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "ar") : a.name.localeCompare(b.name, "ar")));
  const first = details.values().next().value as ScoreDetail | undefined;
  return {
    period: first?.period ?? { key: period.key, kind: period.kind, from: period.from, to: period.to, partial: period.to >= dayKeyOf(now, tz) },
    weights: first?.weights ?? DEFAULT_WEIGHTS,
    sort,
    rows,
  };
}

/**
 * One person's score. The person reads their OWN (manual part from the reviews shared with them); the owner and the supervisors read
 * everything in reach. Anybody else gets 404. The owner's rank has no score (nobody reviews the owner).
 */
export async function loadPersonScore(actor: Actor, userId: string, opts: { period?: string; kind?: PeriodKind } = {}): Promise<ScoreDetail> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  const subject = access.staff.get(userId);
  if (!subject || subject.role === "OWNER") throw new NotFoundError("teamdev.not_found");
  const self = isSelf(access, userId);
  if (!self && !readsAsReviewer(access, userId)) throw new NotFoundError("teamdev.not_found");
  const { period, now, tz } = await resolvePeriod(access, opts.period, opts.kind);
  const { details } = await computeScores(access.orgId, [userId], teamOf(access), period, { now, tz, sharedOnly: self });
  return details.get(userId) as ScoreDetail;
}

