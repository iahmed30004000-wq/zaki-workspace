import type { ProjectStatus, TaskPriority } from "@prisma/client";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";

/** The hour a quick-added task is due at: noon in the company's zone. */
export const NOON_HOUR = 12;

/**
 * «اليوم» — the plain data the Today page is made of, and the small pure rules around it. No React, no database:
 * the service (src/server/services/today.ts) fills these shapes, the parts in src/components/today read them, and
 * the tests hold both. Everything here is a string, a number, a boolean or a list of those, so a server component
 * can hand it to a client component as it is; every date has already been turned into the words a person reads
 * (in the company's zone, by the service), so the browser does no date maths of its own and cannot disagree
 * with the server about what "today" is.
 */

/** How many of each thing the page shows (the rest is counted and linked: «عرض الباقي»). */
export const TODAY_LIMITS = {
  overdue: 8,
  today: 15,
  later: 5,
  projects: 6,
  pulse: 5,
  quickTargets: 30,
} as const;

/** The longest task title the API takes (POST /api/tasks). */
export const TASK_TITLE_MAX = 280;

// ───────────────────────────────────────── the greeting ─────────────────────────────────────────

export type GreetingPeriod = "morning" | "evening";

/** «صباح الخير» from five in the morning until noon; «مساء الخير» for the rest of the day and the night. */
export function greetingPeriod(hour: number): GreetingPeriod {
  return hour >= 5 && hour < 12 ? "morning" : "evening";
}

/**
 * The words that start a name and cannot stand alone: «عبد» is «servant», and the name is «عبد الله»; «أبو نزار» and
 * «أم خالد» are one name too. Compared without diacritics and with one kind of alef.
 */
const NAME_JOINERS: ReadonlySet<string> = new Set(["عبد", "ابو", "ام"]);

const plainWord = (word: string): string => word.replace(/[ً-ٰٟ]/g, "").replace(/[أإآ]/g, "ا");

/**
 * The first name: the greeting is «صباح الخير يا أحمد», not «يا أحمد الزكي»; and «صباح الخير يا عبد الله», never
 * «يا عبد». A name written as one word («عبدالله») is one word already.
 */
export function firstNameOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  const first = words[0];
  if (first === undefined) return "";
  const second = words[1];
  return second !== undefined && NAME_JOINERS.has(plainWord(first)) ? `${first} ${second}` : first;
}

// ───────────────────────────────────────── the shapes ─────────────────────────────────────────

export interface TodayTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  priority: TaskPriority;
  /** The priority in Arabic. */
  priorityLabel: string;
  /** The due day as people say it («أمس» «بكرا» «قبل 3 أيام»), counted in the company's zone; empty without a due date. */
  dueLabel: string;
  /** May the person finish it? (The server decides again when they try.) */
  editable: boolean;
}

export interface TodayCounts {
  open: number;
  overdue: number;
  today: number;
  later: number;
  /** The person's own tasks finished today (in the company's zone), whatever their due day. */
  doneToday: number;
}

/**
 * «المهمّة الجاية» — the one task the Today page puts first: the most overdue one, else the first one due
 * today. Nothing due (only later work, or none): no mission, and the card greets instead.
 */
export function missionOf(tasks: Pick<TodayTasks, "overdue" | "today">): TodayTask | null {
  return tasks.overdue[0] ?? tasks.today[0] ?? null;
}

/**
 * «x من y خلصت»: of the day's work — what was finished today plus what is still due (late or today) — how
 * much is done. Later work is not the day's; a day with nothing in it is 0 of 0.
 */
export function dayProgress(counts: TodayCounts): { done: number; total: number } {
  return { done: counts.doneToday, total: counts.doneToday + counts.overdue + counts.today };
}

export interface TodayTasks {
  /** Due before today, the most overdue first. */
  overdue: TodayTask[];
  /** Due today, earliest first. */
  today: TodayTask[];
  /** Due after today, nearest first, then the ones with no due date. */
  later: TodayTask[];
  /** The real totals: a list above may be shorter than its count. */
  counts: TodayCounts;
}

export interface TodayProject {
  id: string;
  name: string;
  status: ProjectStatus;
  /** The status in Arabic. */
  statusLabel: string;
  /** The project's open tasks; for an external partner only their own. */
  openTasks: number;
}

export interface PulseTask {
  id: string;
  title: string;
  projectName: string;
  assigneeName: string;
  dueLabel: string;
}

/** «نبض الفريق»: the owner's and the people managers' view of the spaces they can open. */
export interface TodayPulse {
  open: number;
  overdue: number;
  /** The most overdue tasks held by somebody who is still active. */
  worst: PulseTask[];
}

export interface QuickAddTarget {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  boardId: string;
}

/** What the quick add needs to build a request for the existing POST /api/tasks. */
export interface TodayQuickAddData {
  /** The person: a task added from Today is their own. */
  assigneeId: string;
  /** Where a task can go: a project with a board. May be empty (the form then says what to do first). */
  targets: QuickAddTarget[];
  /** Noon today and noon tomorrow in the company's zone, as ISO instants. */
  dueToday: string;
  dueTomorrow: string;
  /** The company's hour for a new task's due date; null (or absent): the whole day. */
  dueHour?: number | null;
}

export interface TodayData {
  /** The zone the days were counted in. */
  timeZone: string;
  greeting: { period: GreetingPeriod; firstName: string; hour: number };
  /** «الخميس 22 تشرين الأول 2026» */
  dateLabel: string;
  /** Is the person in any space at all? */
  hasSpaces: boolean;
  /** May they open a space of their own (`spaces.create`)? It changes what «no space yet» says to them. */
  canCreateSpaces: boolean;
  /** An external partner: their own tasks and projects, no company numbers, nothing to add. */
  isExternal: boolean;
  tasks: TodayTasks;
  projects: TodayProject[];
  /** Only for the owner and whoever holds users.manage, and only once they can open a space (no space, nothing to take the pulse of). */
  pulse: TodayPulse | null;
  /** Only for somebody who may add tasks in at least one space they can open. */
  quickAdd: TodayQuickAddData | null;
}

// ───────────────────────────────────────── the smart cards ─────────────────────────────────────────

/** The person's own numbers (the service counts them over the spaces they can open, in the company's days). */
export interface DashboardMine {
  /** Their open tasks. */
  open: number;
  /** Open and due before today. */
  overdue: number;
  /** Open and due today. */
  dueToday: number;
  /** Finished this week (the company's week, starting on the first day of the week, الأحد). */
  doneWeek: number;
  /** The week's work: what was finished plus what is still open and due by the end of the week (late ones included). */
  weekTotal: number;
  /** `doneWeek` out of `weekTotal` as a whole percent, 0 to 100; null when the week holds no work. */
  percent: number | null;
}

/** «الفريق هالأسبوع»: counts only, for the owner and whoever holds users.manage. No name, no customer, no price. */
export interface DashboardTeam {
  /** Tasks finished this week over the spaces they can open. */
  doneWeek: number;
  /** Open tasks due today. */
  dueToday: number;
  /** How many people (still active) hold at least one overdue task. */
  peopleLate: number;
}

/** What the smart cards of «اليوم» show. */
export interface TodayDashboard {
  /** Null without the tasks «يشوف» box: the cards of work are then not drawn. */
  mine: DashboardMine | null;
  /** The messages waiting in the chat of the space the person is in (the same count as the badge on «الدردشة»). */
  unreadChat: number;
  team: DashboardTeam | null;
}

/** The week's progress: `done` of `done + left` as a whole percent (null when there is no work in the week). */
export function weekProgress(done: number, left: number): { total: number; percent: number | null } {
  const total = Math.max(0, done) + Math.max(0, left);
  return { total, percent: total === 0 ? null : Math.min(100, Math.round((Math.max(0, done) / total) * 100)) };
}

// ───────────────────────────────────────── the quick add's request ─────────────────────────────────────────

export type QuickDue = "today" | "tomorrow" | "none";

/** The body of POST /api/tasks that the quick add sends. */
export interface QuickTaskBody {
  workspaceId: string;
  projectId: string;
  boardId: string;
  title: string;
  assigneeId: string;
  description?: string;
  /** Null: «بدون موعد» (an ABSENT date would take the company's default). */
  dueDate?: string | null;
}

/** The longest specification the quick add sends (the server accepts 10 000; a quick task is not a document). */
export const QUICK_DESCRIPTION_MAX = 2000;

/** The specification as it is sent: trimmed, cut, and absent when empty. */
function quickDescription(text: string | undefined): { description?: string } {
  const description = cutAt((text ?? "").trim(), QUICK_DESCRIPTION_MAX).trimEnd();
  return description === "" ? {} : { description };
}

/** At most `max` characters, never leaving the first half of an emoji at the end. */
function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** The wanted day at the company's hour (noon, «the whole day», when it has none) as an ISO instant; null for «no date». */
function quickDueAt(due: QuickDue, timeZone: string, now?: Date, hour?: number | null): string | null {
  if (due === "none") return null;
  const p = zonedParts(now ?? new Date(), timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: due === "today" ? p.day : p.day + 1, hour: hour ?? NOON_HOUR }, timeZone).toISOString();
}

/**
 * The request for the task the person typed, or null when there is nothing to send (a blank title, or a project
 * that is not on the list). Smart defaults, as the owner asked: the task is theirs, and due today unless they say
 * otherwise. The server checks everything again.
 *
 * The noon is computed HERE, at submit time, in the company's zone (`timeZone`, which the page
 * already carries) — not read from the server render. A phone app resumed the next morning must
 * not bake yesterday's noon into a new task. `now` is injectable so a test can stand in for the
 * clock; it defaults to the real present.
 */
export function quickTaskBody(
  quickAdd: TodayQuickAddData,
  input: { projectId: string; title: string; due: QuickDue; timeZone: string; now?: Date; assigneeId?: string; description?: string },
): QuickTaskBody | null {
  const title = cutAt(input.title.trim(), TASK_TITLE_MAX).trimEnd();
  if (title === "") return null;
  const target = quickAdd.targets.find((x) => x.projectId === input.projectId);
  if (!target) return null;
  const dueDate = quickDueAt(input.due, input.timeZone, input.now, quickAdd.dueHour);
  return {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    boardId: target.boardId,
    title,
    assigneeId: input.assigneeId || quickAdd.assigneeId,
    ...quickDescription(input.description),
    dueDate,
  };
}

// ───────────────────────────────────────── «صندوق المهام» (W1.2) ─────────────────────────────────────────

/**
 * What the quick add's «المشروع» list holds for «صندوق المهام»: not a project id (the inbox of the space may not exist yet, and
 * «الشركة» holds none) but this word; the server turns it into the real project (`POST /api/instant/inbox`, and the project
 * and board of «اعمل منها مهمة» in src/server/chat/make-work.ts).
 */
export const WORK_INBOX_REF = "inbox";

/** What `GET /api/instant` says about the inbox: null while the switch `workInbox` is off (or for a guest). */
export interface WorkInboxInfo {
  /** Where a quick task goes: the person's space, or the first standard space when they are in «الشركة»; null: they have none. */
  space: { id: string; name: string } | null;
  /** The inbox project of that space once it exists (so the list of projects does not show it twice). */
  projectId: string | null;
  /**
   * B4 — inside «الشركة» (or with no space) the person CHOOSES the space instead of the first one being used silently: `choose` says so, `spaces` are the spaces a
   * task can go to. Inside a space `choose` is false: the task goes to that space.
   */
  choose?: boolean;
  spaces?: { id: string; name: string }[];
}

/** The quick add must ask which space: the person is in «الشركة» and has more than one space to put the task in (with one, it is that one). */
export const mustChooseSpace = (inbox: WorkInboxInfo | null | undefined): boolean => Boolean(inbox?.choose && (inbox.spaces?.length ?? 0) > 1);

/** The body of POST /api/instant/inbox: the person's own task, due today unless they say otherwise. No project: the server knows where. */
export interface QuickInboxBody {
  title: string;
  /** The space it goes to, when the person chose one (inside «الشركة»). */
  spaceId?: string;
  assigneeId: string;
  /** What the task needs (its specification), when the person wrote it. */
  description?: string;
  dueDate?: string | null;
}

export function quickInboxBody(
  quickAdd: TodayQuickAddData,
  input: { title: string; due: QuickDue; timeZone: string; now?: Date; assigneeId?: string; description?: string; spaceId?: string | null },
): QuickInboxBody | null {
  const title = cutAt(input.title.trim(), TASK_TITLE_MAX).trimEnd();
  if (title === "") return null;
  const dueDate = quickDueAt(input.due, input.timeZone, input.now, quickAdd.dueHour);
  return { title, ...(input.spaceId ? { spaceId: input.spaceId } : {}), assigneeId: input.assigneeId || quickAdd.assigneeId, ...quickDescription(input.description), dueDate };
}

/** One line of «اليوم» inside «الشركة»: the person's own numbers in one space (`getTodayBySpace`). */
export interface TodayBySpaceRow {
  id: string;
  name: string;
  emoji: string | null;
  /** Open tasks the person holds there. */
  open: number;
  /** …of which late. */
  overdue: number;
  /** Messages waiting for them in its topics. */
  unread: number;
}

// ───────────────────────────────────────── «اليوم» simplified (W1.7) ─────────────────────────────────────────

/**
 * With the switch `navV2` ON, «اليوم» is up to SIX cards in this fixed order and nothing else on the main column:
 *   tasks      «مهامي اليوم» — today and overdue, the inline quick add at its foot (it lands in «صندوق المهام», W1.2)
 *   waiting    «بانتظار قرارك» — the count of W1.4's inbox and its newest five (only while `workRequests` is on, only when something waits)
 *   mentions   «ذكروك» — the unread messages that mention the person, each a link into its conversation (only when there is one)
 *   reminders  «تذكيراتي» (the switch `reminders`), with Q1.5's «مواعيد اليوم» (a ticket's follow-up day) beneath it
 *   checkin    «التسجيل اليومي» — only while its switch is on
 *   team       ONE team card for the owner and whoever manages people (the old pulse and the dashboard's team strip folded into it)
 * Everything else of the old page MOVED, nothing was deleted: `TODAY_HAND_OFF` says where each piece went and
 * `placeOfPiece` is the test's way to prove that no part of the old page is homeless.
 */
export const TODAY_CARD_KEYS = ["tasks", "waiting", "mentions", "reminders", "checkin", "team"] as const;
export type TodayCardKey = (typeof TODAY_CARD_KEYS)[number];
export const TODAY_CARD_MAX = 6;

/** What «اليوم › المزيد» holds, in its order. */
export const TODAY_MORE_KEYS = ["glance", "digest", "time", "pinned", "projects"] as const;
export type TodayMoreKey = (typeof TODAY_MORE_KEYS)[number];

export interface TodayLayoutInput {
  /** An external partner: their tasks, and nothing of the company. */
  external: boolean;
  /** How many things wait for the person's decision (0 while `workRequests` is off). */
  waiting: number;
  /** How many unread mentions. */
  mentions: number;
  /** The company's «ذكّرني» switch. */
  remindersOn: boolean;
  /** Tickets of the person whose follow-up day has come (Q1.5). */
  followUps: number;
  checkinsOn: boolean;
  /** The service gave this person the team numbers (the owner, whoever holds users.manage). */
  team: boolean;
  digestOn: boolean;
  timeOn: boolean;
  /** How many pinned tasks the space has for the person. */
  pinned: number;
  /** How many active projects. */
  projects: number;
  /** The personal ring and numbers of the dashboard exist for the person. */
  glance: boolean;
}

export interface TodayLayout {
  cards: TodayCardKey[];
  more: TodayMoreKey[];
}

/** Which cards the page draws and what goes under «المزيد»: pure, so the render tests and the page read one rule. */
export function todayLayout(input: TodayLayoutInput): TodayLayout {
  const cards: TodayCardKey[] = ["tasks"];
  if (!input.external) {
    if (input.waiting > 0) cards.push("waiting");
    if (input.mentions > 0) cards.push("mentions");
    if (input.remindersOn || input.followUps > 0) cards.push("reminders");
    if (input.checkinsOn) cards.push("checkin");
    if (input.team) cards.push("team");
  }
  const more: TodayMoreKey[] = [];
  if (!input.external && input.glance) more.push("glance");
  if (!input.external && input.digestOn) more.push("digest");
  if (!input.external && input.timeOn) more.push("time");
  if (input.pinned > 0) more.push("pinned");
  if (input.projects > 0) more.push("projects");
  return { cards, more };
}

/** The parts of the page before W1.7, so a test can prove each of them still has a home. */
export const OLD_TODAY_PIECES = [
  "hero",
  "controlPanel",
  "digest",
  "firstSteps",
  "dashboard",
  "dashboardTeam",
  "tasks",
  "installHint",
  "guide",
  "pinned",
  "reminders",
  "time",
  "checkins",
  "teamPulse",
  "projects",
] as const;
export type OldTodayPiece = (typeof OLD_TODAY_PIECES)[number];

export type TodayHandOff =
  | { piece: OldTodayPiece; to: "card"; card: TodayCardKey }
  | { piece: OldTodayPiece; to: "more"; more: TodayMoreKey }
  | { piece: OldTodayPiece; to: "panel"; href: string }
  | { piece: OldTodayPiece; to: "strip" };

/**
 * Where each old part of «اليوم» went with `navV2` ON (with it OFF the page is as it was).
 *  - the three team cards (the pulse, the dashboard's team strip, the owner's whole panel) became ONE card; the panel itself is
 *    «لوحة التحكم» at /owner (the card links to it; A2.1 gives it its final home);
 *  - the digest, the day's time, the pinned tasks, the projects and the personal numbers sit under «اليوم › المزيد»;
 *  - the hero, the first steps, the guide's welcome and the install hint are the guide's strips: they draw nothing when they have nothing to say.
 */
export const TODAY_HAND_OFF: readonly TodayHandOff[] = [
  { piece: "hero", to: "strip" },
  { piece: "firstSteps", to: "strip" },
  { piece: "guide", to: "strip" },
  { piece: "installHint", to: "strip" },
  { piece: "tasks", to: "card", card: "tasks" },
  { piece: "reminders", to: "card", card: "reminders" },
  { piece: "checkins", to: "card", card: "checkin" },
  { piece: "teamPulse", to: "card", card: "team" },
  { piece: "dashboardTeam", to: "card", card: "team" },
  { piece: "controlPanel", to: "panel", href: "/owner" },
  { piece: "digest", to: "more", more: "digest" },
  { piece: "time", to: "more", more: "time" },
  { piece: "pinned", to: "more", more: "pinned" },
  { piece: "projects", to: "more", more: "projects" },
  { piece: "dashboard", to: "more", more: "glance" },
];

export function placeOfPiece(piece: OldTodayPiece): TodayHandOff | null {
  return TODAY_HAND_OFF.find((h) => h.piece === piece) ?? null;
}

// ---------- «بانتظار قرارك» ----------

/** How many rows the card lists (the rest is one tap away in «الطلبات»). */
export const WAITING_TOP = 5;

export type WaitingKind = "approval" | "assign" | "ticket" | "card" | "sheet";

export interface WaitingRowView {
  id: string;
  kind: WaitingKind;
  title: string;
  href: string;
  /** The space or department the row belongs to. */
  place: string | null;
  /** ISO time the thing was asked. */
  at: string;
}

export interface TodayWaiting {
  /** The real count: the length of W1.4's «بانتظاري». */
  total: number;
  rows: WaitingRowView[];
  /** B4: only inside «الشركة»: what waits, space by space (`spaceId: null`: the company-wide tickets). The card draws these, each with «انتقل». */
  groups?: { spaceId: string | null; name: string | null; total: number }[];
}

/** The newest `WAITING_TOP` rows across the inbox's sections (each section is already filtered by what the person may see); null when nothing waits. */
export function topWaiting(sections: ReadonlyArray<{ total: number; rows: ReadonlyArray<WaitingRowView> }>, top: number = WAITING_TOP): TodayWaiting | null {
  const total = sections.reduce((sum, s) => sum + s.total, 0);
  if (total <= 0) return null;
  const rows = sections
    .flatMap((s) => s.rows)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
    .slice(0, top)
    .map((r): WaitingRowView => ({ id: r.id, kind: r.kind, title: r.title, href: r.href, place: r.place, at: r.at }));
  return { total, rows };
}

// ---------- «ذكروك» ----------

export const MENTIONS_TOP = 5;

export interface MentionRowView {
  id: string;
  /** The conversation's name (a private chat: the other person). */
  title: string;
  /** How many unread messages in it mention the person. */
  count: number;
  /** The conversation, or a space's forum while the person is in no space of their own. */
  href: string;
  place: string | null;
  at: string | null;
}

export interface TodayMentions {
  /** Every unread mention, over all the rows (not only the five listed). */
  total: number;
  rows: MentionRowView[];
}

/** What the chat list's row carries that this card reads (src/server/chat/dto.ts `ChatRowDto`). */
export interface MentionSourceRow {
  id: string;
  kind: string;
  title: string;
  space: { id: string; name: string } | null;
  lastMessage: { at: string } | null;
  mentionsUnread: number;
}

/**
 * The card's rows from the chat list's own rows (the existing unread-mentions numbers: `mentionsUnread` is 0 for a conversation the person
 * has no row in, so the owner's silent reading adds nothing): only the ones with a mention, newest first, five of them; null when there is none.
 */
export function mentionRowsOf(rows: ReadonlyArray<MentionSourceRow>, top: number = MENTIONS_TOP): TodayMentions | null {
  // a row with no id has nowhere to link to (a forum row of a conversation with no space): left out
  const hit = rows.filter((r) => r.mentionsUnread > 0 && r.id !== "");
  if (hit.length === 0) return null;
  const at = (r: MentionSourceRow) => (r.lastMessage ? Date.parse(r.lastMessage.at) : 0);
  const listed = [...hit].sort((a, b) => at(b) - at(a) || a.id.localeCompare(b.id)).slice(0, top);
  return {
    total: hit.reduce((sum, r) => sum + r.mentionsUnread, 0),
    rows: listed.map(
      (r): MentionRowView => ({
        id: r.id,
        title: r.title,
        count: r.mentionsUnread,
        href: r.kind === "SPACE" ? `/chat/s/${encodeURIComponent(r.id)}` : `/chat/${encodeURIComponent(r.id)}`,
        place: r.kind === "SPACE" ? null : (r.space?.name ?? null),
        at: r.lastMessage?.at ?? null,
      }),
    ),
  };
}

// ---------- «مواعيد اليوم» (Q1.5's follow-up day) ----------

export interface TodayFollowUp {
  id: string;
  title: string;
  /** «اليوم» «أمس» «قبل 3 أيام», counted by the company's calendar. */
  dueLabel: string;
  late: boolean;
}

// ---------- the one team card ----------

export type TeamScopeKind = "company" | "space" | "spaces";

/** What the team numbers were counted over, said on the card (every KPI shows its scope). */
export interface TeamScopeChip {
  kind: TeamScopeKind;
  /** The space's name when `kind` is «space». */
  name: string | null;
}

/** The owner outside a space: the company; inside a space: that space; a people manager outside one: the spaces they can open. */
export function teamScopeOf(input: { isOwner: boolean; spaceName: string | null }): TeamScopeChip {
  if (input.spaceName) return { kind: "space", name: input.spaceName };
  return { kind: input.isOwner ? "company" : "spaces", name: null };
}

export interface TodayTeamData {
  scope: TeamScopeChip;
  /** From the pulse: null when the person was not given the pulse (a missing number is not drawn, never drawn as 0). */
  open: number | null;
  overdue: number | null;
  /** From the dashboard's team strip: null when the person was not given it. */
  doneWeek: number | null;
  dueToday: number | null;
  /** How many people (still active) hold something overdue. */
  peopleLate: number | null;
  /** The most overdue tasks and who holds them (the old pulse's list); may be empty. */
  worst: PulseTask[];
}

/** ONE card from the two sets of numbers the page already has (the dashboard's team strip and the pulse); null when the person has neither. */
export function teamCardOf(team: DashboardTeam | null, pulse: TodayPulse | null, scope: TeamScopeChip): TodayTeamData | null {
  if (!team && !pulse) return null;
  return {
    scope,
    open: pulse?.open ?? null,
    overdue: pulse?.overdue ?? null,
    doneWeek: team?.doneWeek ?? null,
    dueToday: team?.dueToday ?? null,
    peopleLate: team?.peopleLate ?? null,
    worst: pulse?.worst ?? [],
  };
}
