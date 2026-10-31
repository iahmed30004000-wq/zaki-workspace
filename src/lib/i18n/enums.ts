/**
 * Arabic names for everything the database keeps as a code: the statuses, priorities, stages,
 * ranks and kinds that are Prisma enums, the few string "enums" that also reach a screen (the
 * direction of an integration event, a Telegram chat's kind), the default board columns and the
 * events the integrations log.
 *
 * The owner's rule is that no English reaches a screen, and a raw `{project.status}` is exactly
 * that. Every place that shows one of these values goes through here instead.
 *
 * Pure on purpose (no React, no server imports): server pages, client components and tests all
 * read the same Arabic, and server and client render identical text, so nothing mismatches while
 * hydrating. Arabic is the only language, so there is no `t` to pass in.
 *
 * Where the dictionary already had a label (`priority.URGENT`, `ticket.status_open`,
 * `crm.stage_won`, `role.admin`, ...) the registry points at that key, so a word is written once.
 * The values that had no label live in `ar.enums.json` as `enum.<Enum>.<VALUE>`.
 * tests/enums.test.ts fails when the schema gains an enum (or a value) without a label here.
 */
import { AR } from "./dict";
import { interpolate } from "./interpolate";

/** The enums of prisma/schema.prisma. */
export type PrismaEnumName =
  | "TicketStatus"
  | "CampaignStatus"
  | "GoalPeriod"
  | "GoalLight"
  | "MemberStatus"
  | "OrgRole"
  | "WorkspaceRole"
  | "WorkspaceKind"
  | "ProjectStatus"
  | "MilestoneStatus"
  | "TaskPriority"
  | "TaskType"
  | "TaskDependencyKind"
  | "TaskAssignRequestStatus"
  | "ReminderRepeat"
  | "ReminderStatus"
  | "TimeEntrySource"
  | "SkillSource"
  | "ReviewStatus"
  | "ReviewLight"
  | "DevGoalStatus"
  | "RecurrenceMode"
  | "TaskRuleTrigger"
  | "TaskRuleRunStatus"
  | "IdeaStatus"
  | "IntegrationType"
  | "OpportunityStage";

/** Values the schema stores as plain strings but a screen shows all the same. */
export type VirtualEnumName = "IntegrationDirection" | "IntegrationEventStatus" | "TelegramChatType";

export type EnumName = PrismaEnumName | VirtualEnumName;

/** `enum.<Enum>.<VALUE>` for the values that have no older label. */
function own(name: string, values: readonly string[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => [value, `enum.${name}.${value}`]));
}

/**
 * enum -> value -> dictionary key. The order of the values is the enum's order in the schema, which
 * is the order a select or a filter lists them in.
 */
export const ENUM_KEYS: Record<EnumName, Readonly<Record<string, string>>> = {
  TicketStatus: {
    OPEN: "ticket.status_open",
    IN_PROGRESS: "ticket.status_in_progress",
    RESOLVED: "ticket.status_resolved",
    CLOSED: "ticket.status_closed",
  },
  CampaignStatus: {
    DRAFT: "camp.status_draft",
    SCHEDULED: "camp.status_scheduled",
    RUNNING: "camp.status_running",
    DONE: "camp.status_done",
    CANCELLED: "camp.status_cancelled",
  },
  GoalPeriod: { WEEKLY: "goal.weekly", MONTHLY: "goal.monthly", QUARTERLY: "okr.quarterly" },
  GoalLight: { ON_TRACK: "okr.light.ON_TRACK", BEHIND: "okr.light.BEHIND", AT_RISK: "okr.light.AT_RISK" },
  MemberStatus: {
    ACTIVE: "members.status_active",
    SUSPENDED: "members.status_suspended",
    OFFBOARDED: "members.status_offboarded",
  },
  OrgRole: {
    OWNER: "role.owner",
    ADMIN: "role.admin",
    LEAD: "role.lead",
    MEMBER: "role.member",
    GUEST: "role.guest",
  },
  WorkspaceRole: { ADMIN: "ws.role_admin", MEMBER: "ws.role_member", GUEST: "ws.role_guest" },
  // The kind of a space (Phase 3): a plain space, a department's space, or the company's HQ space.
  WorkspaceKind: own("WorkspaceKind", ["STANDARD", "DEPARTMENT", "HQ"]),
  ProjectStatus: own("ProjectStatus", ["PLANNING", "ACTIVE", "ON_HOLD", "AT_RISK", "COMPLETED", "ARCHIVED"]),
  MilestoneStatus: own("MilestoneStatus", ["OPEN", "COMPLETED", "OVERDUE"]),
  TaskPriority: {
    URGENT: "priority.URGENT",
    HIGH: "priority.HIGH",
    NORMAL: "priority.NORMAL",
    LOW: "priority.LOW",
    NONE: "priority.NONE",
  },
  TaskType: own("TaskType", [
    "TASK",
    "BUG",
    "FEATURE",
    "IMPROVEMENT",
    "RESEARCH",
    "MEETING",
    "CONTENT",
    "MARKETING",
    "OPERATIONS",
    "AUTOMATION",
    "AI_AGENT",
  ]),
  TaskDependencyKind: own("TaskDependencyKind", ["BLOCKS", "BLOCKED_BY", "DUPLICATES"]),
  TaskAssignRequestStatus: own("TaskAssignRequestStatus", ["PENDING", "ACCEPTED", "RETURNED"]),
  ReminderRepeat: own("ReminderRepeat", ["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
  ReminderStatus: own("ReminderStatus", ["PENDING", "FIRED", "DISMISSED"]),
  TimeEntrySource: own("TimeEntrySource", ["TIMER", "MANUAL"]),
  // who entered a skill level («الأداء والتطوير»): the supervisor, or the person about themselves (the words are the skills screen's own)
  SkillSource: { MANUAL: "teamdev.skill.manual", SELF: "teamdev.skill.self" },
  // «الأداء والتطوير»: a review's status, the reviewer's status light and a development goal's status (the words are the feature's own)
  ReviewStatus: { DRAFT: "teamdev.review.status.DRAFT", SUBMITTED: "teamdev.review.status.SUBMITTED", SHARED: "teamdev.review.status.SHARED" },
  ReviewLight: { GREEN: "teamdev.light.GREEN", AMBER: "teamdev.light.AMBER", RED: "teamdev.light.RED" },
  DevGoalStatus: { OPEN: "teamdev.plan.status.OPEN", DONE: "teamdev.plan.status.DONE", CANCELLED: "teamdev.plan.status.CANCELLED" },
  RecurrenceMode: own("RecurrenceMode", ["ON_COMPLETE", "SCHEDULE"]),
  // «القواعد التلقائية»: the words of the rule's trigger and of a run's result live with the rest of the feature's words
  TaskRuleTrigger: {
    MOVED_TO_COLUMN: "taskrules.trigger.MOVED_TO_COLUMN",
    COMPLETED: "taskrules.trigger.COMPLETED",
    OVERDUE: "taskrules.trigger.OVERDUE",
    CREATED: "taskrules.trigger.CREATED",
  },
  TaskRuleRunStatus: {
    APPLIED: "taskrules.status.APPLIED",
    PARTIAL: "taskrules.status.PARTIAL",
    SKIPPED: "taskrules.status.SKIPPED",
    FAILED: "taskrules.status.FAILED",
  },
  IdeaStatus: {
    NEW: "ideas.status.NEW",
    UNDER_REVIEW: "ideas.status.UNDER_REVIEW",
    ACCEPTED: "ideas.status.ACCEPTED",
    REJECTED: "ideas.status.REJECTED",
    PLANNING: "ideas.status.PLANNING",
    LAUNCHED: "ideas.status.LAUNCHED",
  },
  IntegrationType: own("IntegrationType", ["TELEGRAM", "N8N", "GOOGLE_DRIVE"]),
  OpportunityStage: {
    LEAD: "crm.stage_lead",
    QUALIFIED: "crm.stage_qualified",
    PROPOSAL: "crm.stage_proposal",
    NEGOTIATION: "crm.stage_negotiation",
    WON: "crm.stage_won",
    LOST: "crm.stage_lost",
  },
  IntegrationDirection: own("IntegrationDirection", ["OUT", "IN"]),
  IntegrationEventStatus: own("IntegrationEventStatus", ["OK", "FAILED"]),
  TelegramChatType: {
    private: "telegram.type.private",
    group: "telegram.type.group",
    supergroup: "telegram.type.supergroup",
    channel: "telegram.type.channel",
  },
};

const hasOwn = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** "—" for no value at all. */
const DASH = (): string => AR["enum.none"] ?? "—";

export function enumNames(): EnumName[] {
  return Object.keys(ENUM_KEYS) as EnumName[];
}

/** The values of an enum, in the order the schema declares them. */
export function enumValues(name: EnumName): string[] {
  return Object.keys(ENUM_KEYS[name]);
}

/** Is this one of the values the enum is known to have? */
export function isEnumValue(name: EnumName, value: string | null | undefined): boolean {
  return value != null && hasOwn(ENUM_KEYS[name], value);
}

/**
 * The Arabic name of an enum value. Nothing yields the raw English: a missing value is a dash and
 * a value this code has never heard of (old data, a newer server) is «غير معروف».
 */
export function enumLabel(name: EnumName, value: string | null | undefined): string {
  if (value == null || value === "") return DASH();
  const key = hasOwn(ENUM_KEYS[name], value) ? ENUM_KEYS[name][value] : undefined;
  const text = key ? AR[key] : undefined;
  return text ?? AR["enum.unknown"] ?? DASH();
}

/** The options of a select or a filter: every value of the enum, labelled, in the schema's order. */
export function enumOptions(name: EnumName): { value: string; label: string }[] {
  return enumValues(name).map((value) => ({ value, label: enumLabel(name, value) }));
}

// ----------------------------------------------------------------------------------- board columns

export type ColumnKind = "backlog" | "todo" | "in_progress" | "review" | "done" | "blocked";

const COLUMN_KINDS: readonly ColumnKind[] = ["backlog", "todo", "in_progress", "review", "done", "blocked"];

/**
 * The English names columns have had so far (the old defaults and what people type), folded to lower
 * case with one space between words. A board that already exists keeps the names it was given; only
 * what is SHOWN is translated, so nothing in the database changes.
 */
const COLUMN_ENGLISH: Readonly<Record<string, ColumnKind>> = {
  backlog: "backlog",
  "to do": "todo",
  todo: "todo",
  "in progress": "in_progress",
  inprogress: "in_progress",
  doing: "in_progress",
  wip: "in_progress",
  review: "review",
  "in review": "review",
  done: "done",
  complete: "done",
  completed: "done",
  finished: "done",
  blocked: "blocked",
};

function foldColumnName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * Which family of steps a column belongs to - from its English name or from the Arabic default - or
 * null for a name somebody chose. (The tasks workflow classifies the existing columns the same way.)
 */
export function columnKind(name: string | null | undefined): ColumnKind | null {
  if (!name) return null;
  const folded = foldColumnName(name);
  if (hasOwn(COLUMN_ENGLISH, folded)) return COLUMN_ENGLISH[folded] ?? null;
  const typed = name.trim();
  for (const kind of COLUMN_KINDS) if (AR[`column.${kind}`] === typed) return kind;
  return null;
}

/**
 * What a board column is called on screen: the well-known English defaults in Arabic (any case),
 * every other name - Arabic or whatever somebody typed - exactly as it is.
 */
export function columnLabel(name: string | null | undefined): string {
  if (!name) return "";
  const folded = foldColumnName(name);
  if (!hasOwn(COLUMN_ENGLISH, folded)) return name;
  const kind = COLUMN_ENGLISH[folded];
  return (kind ? AR[`column.${kind}`] : undefined) ?? name;
}

// ----------------------------------------------------------------------------------- integration events

/**
 * The Arabic name of an event the integrations logged ("task.created", "telegram.connected", ...).
 * `n8n.inbound.<action>` carries the sender's own action name and shows as one inbound event; a type
 * this code does not know stays as the code it is (it is a technical identifier, shown left-to-right).
 */
export function eventLabel(type: string | null | undefined): string {
  if (!type) return DASH();
  const direct = AR[`event.${type}`];
  if (direct) return direct;
  if (type.startsWith("n8n.inbound.")) return AR["event.n8n.inbound"] ?? type;
  return type;
}

const DETAIL_KEYS: Readonly<Record<string, string>> = {
  "missing task fields": "detail.missing_task_fields",
  invalid: "detail.invalid",
  "task create failed": "detail.task_create_failed",
  "network error": "detail.network_error",
  "fetch failed": "detail.fetch_failed",
};

/**
 * The detail line of a logged event. The server stores either a dictionary key (`n8n.url_private`),
 * a short English phrase of its own ("network error", "HTTP 502") or the text of the error it caught;
 * the first two are shown in Arabic, anything else as it is (it is for whoever debugs the link).
 */
export function eventDetailLabel(detail: string | null | undefined): string {
  if (!detail) return "";
  const text = detail.trim();
  const translated = AR[text];
  if (translated) return translated;
  const known = hasOwn(DETAIL_KEYS, text.toLowerCase()) ? DETAIL_KEYS[text.toLowerCase()] : undefined;
  if (known && AR[known]) return AR[known] as string;
  const http = /^HTTP (\d{3})(\s*\(redirect not followed\))?$/.exec(text);
  if (http) {
    const key = http[2] ? "detail.http_redirect" : "detail.http";
    return interpolate(AR[key] ?? text, { code: http[1] as string });
  }
  if (/\b(aborted|timed? ?out)\b/i.test(text)) return AR["detail.timeout"] ?? text;
  return text;
}
