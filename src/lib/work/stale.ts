/**
 * W1.9 «مهام قديمة» — the pure half: what the review list is asked, what it answers and how the answer is grouped. No database, no server import,
 * so the page, the route, the service and the tests share ONE meaning of «قديمة».
 *
 * A task is OLD when it is open (not finished, not archived) and nobody touched it for N days: no edit, no move, no comment, no log line.
 * Default N = 14 (the owner saw 183 of 262 open tasks past that line on 2026-11-16).
 *
 * «آلي» (D-W4, the owner's answer is PENDING: this is the recommended default): a task that came in through the door from another system or an agent
 * (`Task.apiTokenId` is set — the column that already exists) is MARKED and COUNTED APART from the people's own work; the list can hide it or show only it.
 */

/** The days a task may sit untouched before it is on the list. */
export const STALE_DEFAULT_DAYS = 14;
export const STALE_MIN_DAYS = 1;
export const STALE_MAX_DAYS = 365;
/** Tasks one page of the list carries (the number above it is the real total; the oldest come first). */
export const STALE_LIST_LIMIT = 300;
/** Tasks one bulk action takes. */
export const STALE_SWEEP_MAX = 200;

/** The four bulk actions: سكّريها · عيّني مسؤول · أجّليها لتاريخ · أرشفيها. */
export const STALE_ACTIONS = ["close", "assign", "postpone", "archive"] as const;
export type StaleAction = (typeof STALE_ACTIONS)[number];
export const isStaleAction = (v: unknown): v is StaleAction => (STALE_ACTIONS as readonly string[]).includes(v as string);

/** Automated tasks: shown beside people's own work (the default, marked) · hidden · only those. */
export const STALE_AUTO_FILTERS = ["all", "hide", "only"] as const;
export type StaleAutoFilter = (typeof STALE_AUTO_FILTERS)[number];
export const isStaleAutoFilter = (v: unknown): v is StaleAutoFilter => (STALE_AUTO_FILTERS as readonly string[]).includes(v as string);

export interface StaleParams {
  days: number;
  auto: StaleAutoFilter;
  /** One of the spaces the person manages; null: all of them. */
  space: string | null;
}

export const DEFAULT_STALE_PARAMS: StaleParams = { days: STALE_DEFAULT_DAYS, auto: "all", space: null };

type Source = URLSearchParams | Record<string, string | string[] | undefined>;
const pick = (source: Source, key: string): string | undefined => {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const v = source[key];
  return Array.isArray(v) ? v[0] : v;
};

/** Days: a whole number between the limits; anything else is the default. */
export function clampStaleDays(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(n)) return STALE_DEFAULT_DAYS;
  return Math.min(STALE_MAX_DAYS, Math.max(STALE_MIN_DAYS, n));
}

/** The list's own question from an address or a query string; a bad value is never an error, it is the default. */
export function parseStaleParams(source: Source): StaleParams {
  const auto = pick(source, "auto");
  const space = pick(source, "space");
  return {
    days: clampStaleDays(pick(source, "days")),
    auto: isStaleAutoFilter(auto) ? auto : DEFAULT_STALE_PARAMS.auto,
    space: space && space.length <= 64 ? space : null,
  };
}

/** The query string the screen and the route share (a default is left out). */
export function staleApiQuery(params: StaleParams): string {
  const q = new URLSearchParams();
  if (params.days !== STALE_DEFAULT_DAYS) q.set("days", String(params.days));
  if (params.auto !== DEFAULT_STALE_PARAMS.auto) q.set("auto", params.auto);
  if (params.space) q.set("space", params.space);
  return q.toString();
}

/** The line: a task last touched BEFORE this instant is old. */
export function staleCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** «من كم يوم»: whole days between the last touch and now, never negative. */
export function daysIdle(lastTouchedAt: Date | string, now: Date): number {
  const then = new Date(lastTouchedAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/** A task is automated when it came through the door (an API token made it). */
export const isAutomated = (task: { apiTokenId?: string | null }): boolean => task.apiTokenId != null && task.apiTokenId !== "";

// ───────────────────────────────── what the list answers ─────────────────────────────────

export interface StaleTask {
  id: string;
  key: string;
  title: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  projectId: string;
  projectName: string;
  workspaceId: string;
  spaceName: string;
  /** ISO instant, or null. */
  dueDate: string | null;
  /** The last time anybody touched it (ISO). */
  lastTouchedAt: string;
  idleDays: number;
  /** «آلي»: it came through the door from a system or an agent. */
  automated: boolean;
  /** «المعنيين بس». */
  private: boolean;
}

export interface StaleProjectGroup {
  projectId: string;
  name: string;
  spaceName: string;
  tasks: StaleTask[];
}

export interface StalePerson {
  /** The person's id, or `none` for the tasks nobody holds. */
  key: string;
  userId: string | null;
  name: string | null;
  /** Old tasks in the list for this person (after the automated filter). */
  stale: number;
  /** Of those, how many are «آلي». */
  staleAuto: number;
  /** ALL the person's open tasks in the spaces the viewer manages that the viewer may see: their own work only (no «آلي»). */
  open: number;
  /** The «آلي» open tasks of the person, counted apart. */
  openAuto: number;
  projects: StaleProjectGroup[];
}

export interface StaleOption {
  id: string;
  name: string;
}

export interface StaleView {
  days: number;
  auto: StaleAutoFilter;
  space: string | null;
  builtAt: number;
  viewerId: string;
  /** Today as the company reads it (`YYYY-MM-DD`): the earliest day a postponement may name. */
  today: string;
  spaces: StaleOption[];
  /** Old tasks that match, all of them (the list below may carry fewer: `truncated`). */
  total: number;
  shown: number;
  truncated: boolean;
  /** How many of the old tasks are «آلي», whatever the filter says (the screen says how many it hides). */
  autoTotal: number;
  people: StalePerson[];
  /** The people a task of these spaces may be given to. */
  assignable: StaleOption[];
}

/** Open-task numbers per person: the key is the person's id or `none`. */
export type OpenCounts = Record<string, { people: number; auto: number }>;

/**
 * Groups the old tasks by PERSON, then by PROJECT. The busiest person is first, the tasks nobody holds come right after them when they are as many;
 * inside a project the oldest task is first. Pure: the same list in, the same groups out.
 */
export function groupStale(tasks: readonly StaleTask[], open: OpenCounts = {}): StalePerson[] {
  const byPerson = new Map<string, StalePerson>();
  for (const task of tasks) {
    const key = task.assigneeId ?? "none";
    let person = byPerson.get(key);
    if (!person) {
      const counts = open[key];
      person = { key, userId: task.assigneeId, name: task.assigneeName, stale: 0, staleAuto: 0, open: counts?.people ?? 0, openAuto: counts?.auto ?? 0, projects: [] };
      byPerson.set(key, person);
    }
    person.stale += 1;
    if (task.automated) person.staleAuto += 1;
    let group = person.projects.find((p) => p.projectId === task.projectId);
    if (!group) {
      group = { projectId: task.projectId, name: task.projectName, spaceName: task.spaceName, tasks: [] };
      person.projects.push(group);
    }
    group.tasks.push(task);
  }
  const people = [...byPerson.values()];
  for (const person of people) {
    for (const group of person.projects) group.tasks.sort((a, b) => b.idleDays - a.idleDays || a.id.localeCompare(b.id));
    person.projects.sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, "ar"));
  }
  return people.sort((a, b) => b.stale - a.stale || (a.userId === null ? -1 : b.userId === null ? 1 : 0) || (a.name ?? "").localeCompare(b.name ?? "", "ar"));
}

// ───────────────────────────────── what a bulk action answers ─────────────────────────────────

/** `done`: it happened · `requested`: the person asked for is of a HIGHER rank, so a request was made and the task kept its holder · `refused`: nothing changed. */
export type SweepOutcome = "done" | "requested" | "refused";

export interface SweepRow {
  taskId: string;
  outcome: SweepOutcome;
  /** The machine key of the refusal (the screen shows `t(error)`), only when `outcome` is `refused`. */
  error?: string;
}

export interface SweepResult {
  action: StaleAction;
  results: SweepRow[];
  done: number;
  requested: number;
  refused: number;
}

export function tallySweep(action: StaleAction, results: SweepRow[]): SweepResult {
  return {
    action,
    results,
    done: results.filter((r) => r.outcome === "done").length,
    requested: results.filter((r) => r.outcome === "requested").length,
    refused: results.filter((r) => r.outcome === "refused").length,
  };
}

/** The ONE event name of the log line each sweep writes on a task (the screen of a task prints `t("event." + name)`). */
export const STALE_EVENT = "task.stale_swept";
