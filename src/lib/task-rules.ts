/**
 * «القواعد التلقائية» — the if-then rules of a project, pure (no React, no server imports): the shapes the screen and the
 * server share, and the one validator of a rule that is being saved.
 *
 * A rule is ONE trigger and one or two actions:
 *   trigger  a task is moved to a column · a task is completed · a task becomes overdue · a task is created
 *   action   assign it to a person · set its priority · move it to a column · add a step · notify a person · post a line
 *            into a topic of the space
 * Nothing here can touch money, a reward or a customer: the action list is closed.
 */

/** Most rules one project keeps (the paused ones count; a deleted one does not). */
export const MAX_RULES = 10;
export const MAX_RULE_NAME = 80;
export const MAX_RULE_TEXT = 300;
export const MAX_RULE_NOTE = 200;
export const MAX_RULE_STEP = 200;

export const TRIGGERS = ["MOVED_TO_COLUMN", "COMPLETED", "OVERDUE", "CREATED"] as const;
export type RuleTrigger = (typeof TRIGGERS)[number];

export const ACTION_TYPES = ["ASSIGN", "SET_PRIORITY", "MOVE_TO_COLUMN", "ADD_STEP", "NOTIFY", "POST_MESSAGE"] as const;
export type RuleActionType = (typeof ACTION_TYPES)[number];

/** The priorities a rule may set (a task with no priority is not something a rule restores). */
export const RULE_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export type RulePriority = (typeof RULE_PRIORITIES)[number];

export type RuleAction =
  | { type: "ASSIGN"; userId: string }
  | { type: "SET_PRIORITY"; priority: RulePriority }
  | { type: "MOVE_TO_COLUMN"; columnId: string }
  | { type: "ADD_STEP"; title: string }
  | { type: "NOTIFY"; userId: string; note?: string }
  | { type: "POST_MESSAGE"; topicId: string; text: string };

/** What the owner of a project saves: the shape every writer (the screen, the route, the service) agrees on. */
export interface RuleDraft {
  name: string;
  trigger: RuleTrigger;
  /** null: every board of the project (only for a rule that names no column). */
  boardId: string | null;
  /** MOVED_TO_COLUMN only. */
  triggerColumnId: string | null;
  actions: RuleAction[];
}

/** Why a run (or one of its actions) did not do what the rule says. The screen reads `taskrules.reason.<key>`. */
export const SKIP_REASONS = [
  "feature_off",
  "runas_not_allowed",
  "task_archived",
  "reward_task",
  "person_not_allowed",
  "person_higher",
  "column_gone",
  "topic_unavailable",
  "not_allowed",
  "required_fields",
  "steps_full",
  "unchanged",
  "error",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type ActionStatus = "APPLIED" | "SKIPPED" | "FAILED";
export interface ActionResult {
  type: RuleActionType;
  status: ActionStatus;
  reason?: SkipReason;
}

export type RunStatus = "APPLIED" | "PARTIAL" | "SKIPPED" | "FAILED";

/** The status of a whole run from what each action did: all done -> APPLIED, some -> PARTIAL, none: SKIPPED (or FAILED when one failed). */
export function runStatusOf(results: readonly ActionResult[]): RunStatus {
  if (results.length === 0) return "SKIPPED";
  const applied = results.filter((r) => r.status === "APPLIED").length;
  if (applied === results.length) return "APPLIED";
  if (applied > 0) return "PARTIAL";
  return results.some((r) => r.status === "FAILED") ? "FAILED" : "SKIPPED";
}

export type RuleProblem = { ok: false; path: string; key: string };
export type Cleaned<T> = { ok: true; value: T } | RuleProblem;

const bad = (path: string, key: string): RuleProblem => ({ ok: false, path, key });

function oneLine(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

export function isTrigger(v: unknown): v is RuleTrigger {
  return typeof v === "string" && (TRIGGERS as readonly string[]).includes(v);
}

function cleanAction(raw: unknown, at: string): Cleaned<RuleAction> {
  if (!raw || typeof raw !== "object") return bad(at, "taskrules.action_invalid");
  const a = raw as Record<string, unknown>;
  switch (a["type"]) {
    case "ASSIGN":
      return isId(a["userId"]) ? { ok: true, value: { type: "ASSIGN", userId: a["userId"] } } : bad(`${at}.userId`, "taskrules.person_required");
    case "SET_PRIORITY":
      return typeof a["priority"] === "string" && (RULE_PRIORITIES as readonly string[]).includes(a["priority"])
        ? { ok: true, value: { type: "SET_PRIORITY", priority: a["priority"] as RulePriority } }
        : bad(`${at}.priority`, "taskrules.priority_invalid");
    case "MOVE_TO_COLUMN":
      return isId(a["columnId"]) ? { ok: true, value: { type: "MOVE_TO_COLUMN", columnId: a["columnId"] } } : bad(`${at}.columnId`, "taskrules.column_required");
    case "ADD_STEP": {
      const title = oneLine(a["title"]);
      if (!title) return bad(`${at}.title`, "taskrules.step_empty");
      if (title.length > MAX_RULE_STEP) return bad(`${at}.title`, "taskrules.step_long");
      return { ok: true, value: { type: "ADD_STEP", title } };
    }
    case "NOTIFY": {
      if (!isId(a["userId"])) return bad(`${at}.userId`, "taskrules.person_required");
      const note = oneLine(a["note"]);
      if (note.length > MAX_RULE_NOTE) return bad(`${at}.note`, "taskrules.note_long");
      return { ok: true, value: note ? { type: "NOTIFY", userId: a["userId"], note } : { type: "NOTIFY", userId: a["userId"] } };
    }
    case "POST_MESSAGE": {
      if (!isId(a["topicId"])) return bad(`${at}.topicId`, "taskrules.topic_required");
      const text = oneLine(a["text"]);
      if (!text) return bad(`${at}.text`, "taskrules.text_empty");
      if (text.length > MAX_RULE_TEXT) return bad(`${at}.text`, "taskrules.text_long");
      return { ok: true, value: { type: "POST_MESSAGE", topicId: a["topicId"], text } };
    }
    default:
      return bad(`${at}.type`, "taskrules.action_invalid");
  }
}

/**
 * The one validator of a rule being saved. Unknown keys are dropped (a rule never carries anything the list above does not
 * name), one or two actions of different kinds, and a rule that names a column also names its board.
 */
export function cleanRuleDraft(raw: unknown): Cleaned<RuleDraft> {
  if (!raw || typeof raw !== "object") return bad("", "taskrules.rule_invalid");
  const r = raw as Record<string, unknown>;
  const name = oneLine(r["name"]);
  if (!name) return bad("name", "taskrules.name_empty");
  if (name.length > MAX_RULE_NAME) return bad("name", "taskrules.name_long");
  if (!isTrigger(r["trigger"])) return bad("trigger", "taskrules.trigger_invalid");
  const trigger = r["trigger"];

  const boardId = r["boardId"] == null || r["boardId"] === "" ? null : r["boardId"];
  if (boardId !== null && !isId(boardId)) return bad("boardId", "taskrules.board_invalid");
  let triggerColumnId: string | null = null;
  if (trigger === "MOVED_TO_COLUMN") {
    if (!isId(r["triggerColumnId"])) return bad("triggerColumnId", "taskrules.column_required");
    triggerColumnId = r["triggerColumnId"];
  }

  if (!Array.isArray(r["actions"]) || r["actions"].length < 1 || r["actions"].length > 2) return bad("actions", "taskrules.actions_count");
  const actions: RuleAction[] = [];
  for (const [i, raw] of (r["actions"] as unknown[]).entries()) {
    const one = cleanAction(raw, `actions.${i}`);
    if (!one.ok) return one;
    if (actions.some((a) => a.type === one.value.type)) return bad(`actions.${i}`, "taskrules.action_duplicate");
    actions.push(one.value);
  }

  // a column belongs to ONE board: a rule that names one has to say which board it is about
  const namesColumn = triggerColumnId !== null || actions.some((a) => a.type === "MOVE_TO_COLUMN");
  if (namesColumn && boardId === null) return bad("boardId", "taskrules.board_required");

  return { ok: true, value: { name, trigger, boardId, triggerColumnId, actions } };
}

/** Reads the stored `actions` back (a row written by a newer release with an unknown kind is dropped, never trusted). */
export function readActions(stored: unknown): RuleAction[] {
  if (!Array.isArray(stored)) return [];
  const out: RuleAction[] = [];
  for (const [i, raw] of stored.entries()) {
    const one = cleanAction(raw, String(i));
    if (one.ok) out.push(one.value);
  }
  return out;
}

/** The people an action names (for the screen's «لسّا بالمساحة؟» check and the run-time re-check). */
export function actionPeople(actions: readonly RuleAction[]): string[] {
  return [...new Set(actions.flatMap((a) => (a.type === "ASSIGN" || a.type === "NOTIFY" ? [a.userId] : [])))];
}

/** What a screen needs about one rule. Dates are ISO strings so it crosses JSON unchanged. */
export interface RuleDto {
  id: string;
  name: string;
  trigger: RuleTrigger;
  boardId: string | null;
  triggerColumnId: string | null;
  actions: RuleAction[];
  active: boolean;
  runAsName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunDto {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: RuleTrigger;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  runAsName: string | null;
  status: RunStatus;
  results: ActionResult[];
  createdAt: string;
}

/** What the rule form offers: the project's boards and columns, the people a rule may name, the topics it may post into. */
export interface RuleOptions {
  boards: { id: string; name: string; columns: { id: string; name: string; done: boolean }[] }[];
  people: { id: string; name: string }[];
  topics: { id: string; title: string }[];
}
