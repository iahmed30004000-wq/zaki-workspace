import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit, requireProjectAccess, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { judgeAssignment } from "@/server/services/task-assign";
import { userSeesProject } from "@/server/services/team-scope";
import {
  MAX_RULES,
  cleanRuleDraft,
  readActions,
  type ActionResult,
  type RuleDraft,
  type RuleOptions,
  type RuleDto,
  type RunDto,
  type RunStatus,
  type RuleTrigger,
} from "@/lib/task-rules";
import { eligiblePerson, usableTopic, type RuleProject } from "./task-rules-guards";

/**
 * «القواعد التلقائية» — the if-then rules of a project: who defines them, what a saved rule may name, and the log.
 *
 * WHO. The space's ADMIN and the owner alone (`requireProjectAccess` with the ADMIN role, then the projects row of the section
 * grid) — to read the rules and the log as well as to write them. A member, a colleague and an external partner get «not
 * found» / «forbidden» and never a line of it. The owner reading a space he is not in reads silently: a read writes nothing.
 * The company's `taskRules` switch closes every door of this file; the rules and the log already stored stay.
 *
 * WHAT A RULE MAY NAME is checked here when it is saved and again when it runs (task-rules-guards.ts): the board and columns are
 * the project's own, a person is ACTIVE, in the space and never a partner, an assignment never goes UP a rank (that would be
 * a request, not a rule), a topic is an open topic of this space. Money, rewards and customers are not in the action list at all.
 *
 * A rule is never really deleted: `deletedAt` takes it off the screen and out of the count of ten, and what it did stays in the
 * log. The log (`TaskRuleRun`) has no write in this file but the engine's one append.
 */

const FEATURE = "taskRules" as const;

type Tx = Prisma.TransactionClient;
type Access = OrgAccessContext & { project: { id: string; workspaceId: string; teamId: string | null } };

/** The door of every write: the space's ADMIN or the owner, the projects row, the switch. */
async function manageAccess(projectId: string): Promise<Access> {
  const access = await requireProjectAccess(projectId, ["ADMIN"]);
  await assertMemberCan(access, "projects.edit", "section.edit_denied");
  await assertFeatureOn(access.orgId, FEATURE);
  return access;
}

/** The door of every read (the rules, the options, the log): the same people, silently. */
async function readAccess(projectId: string): Promise<Access> {
  const access = await requireProjectAccess(projectId, ["ADMIN"]);
  await assertMemberCan(access, "projects.view", "section.view_denied");
  await assertFeatureOn(access.orgId, FEATURE);
  return access;
}

function problem(path: string, key: string): never {
  throw new ValidationError([{ path, message: key }]);
}

const SELECT = { id: true, name: true, trigger: true, boardId: true, triggerColumnId: true, actions: true, active: true, runAsId: true, createdAt: true, updatedAt: true } as const;
type Row = Prisma.TaskRuleGetPayload<{ select: typeof SELECT }>;

async function namesOf(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

function toDto(row: Row, names: Map<string, string>): RuleDto {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    boardId: row.boardId,
    triggerColumnId: row.triggerColumnId,
    actions: readActions(row.actions),
    active: row.active,
    runAsName: names.get(row.runAsId) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------- reading ----------

export async function listRulesOf(projectId: string): Promise<RuleDto[]> {
  const rows = await db.taskRule.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: SELECT });
  const names = await namesOf(rows.map((r) => r.runAsId));
  return rows.map((r) => toDto(r, names));
}

export async function listRules(projectId: string): Promise<RuleDto[]> {
  await readAccess(projectId);
  return listRulesOf(projectId);
}

/** What the rule form offers: the project's boards and columns, the people a rule may name, the topics it may post into. */
export async function ruleOptionsOf(project: RuleProject & { id: string }, orgId: string): Promise<RuleOptions> {
  const boards = await db.board.findMany({
    where: { projectId: project.id, archived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, columns: { orderBy: { position: "asc" }, select: { id: true, name: true, done: true } } },
  });
  const rows = await db.workspaceMember.findMany({
    where: {
      workspaceId: project.workspaceId,
      role: { not: "GUEST" },
      user: { memberships: { some: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" } } } },
    },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, name: true } } },
  });
  // a project of a team is seen by that team and the space's managers only: a rule never names anybody else
  const people: { id: string; name: string }[] = [];
  for (const r of rows) if (!project.teamId || (await userSeesProject(r.user.id, project))) people.push(r.user);
  const topics = await db.conversation.findMany({
    where: {
      orgId,
      kind: "TOPIC",
      spaceId: project.workspaceId,
      restricted: false,
      closedAt: null,
      archivedAt: null,
      OR: project.teamId ? [{ teamId: null }, { teamId: project.teamId }] : [{ teamId: null }],
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });
  return { boards, people, topics: topics.map((t) => ({ id: t.id, title: t.title ?? "" })) };
}

export async function ruleOptions(projectId: string): Promise<RuleOptions> {
  const access = await readAccess(projectId);
  return ruleOptionsOf(access.project, access.orgId);
}

// ---------- writing ----------

/** Everything a draft names must exist and be allowed, here and now. Throws a `ValidationError` / `ForbiddenError` with a key. */
async function assertDraftAllowed(tx: Tx, access: Access, draft: RuleDraft): Promise<void> {
  const project: RuleProject = { workspaceId: access.project.workspaceId, teamId: access.project.teamId };
  let columns: Set<string> | null = null;
  if (draft.boardId) {
    const board = await tx.board.findFirst({
      where: { id: draft.boardId, projectId: access.project.id, archived: false },
      select: { columns: { select: { id: true } } },
    });
    if (!board) problem("boardId", "taskrules.board_not_found");
    columns = new Set(board.columns.map((c) => c.id));
  }
  if (draft.triggerColumnId && !columns?.has(draft.triggerColumnId)) problem("triggerColumnId", "taskrules.column_not_found");
  for (const [i, action] of draft.actions.entries()) {
    if (action.type === "MOVE_TO_COLUMN" && !columns?.has(action.columnId)) problem(`actions.${i}.columnId`, "taskrules.column_not_found");
    if (action.type === "ASSIGN" || action.type === "NOTIFY") {
      if (!(await eligiblePerson(access.orgId, project, action.userId))) problem(`actions.${i}.userId`, "taskrules.person_not_allowed");
    }
    if (action.type === "ASSIGN") {
      // a rule hands a task over directly or not at all: «ask the higher person» is a conversation, not an automation
      let verdict: string;
      try {
        verdict = await judgeAssignment(tx, { userId: access.userId, orgId: access.orgId }, action.userId, project.workspaceId);
      } catch (err) {
        if (err instanceof ForbiddenError) problem(`actions.${i}.userId`, "taskrules.person_not_allowed");
        throw err;
      }
      if (verdict !== "direct") problem(`actions.${i}.userId`, "taskrules.person_higher");
    }
    if (action.type === "POST_MESSAGE" && !(await usableTopic(access.orgId, project, action.topicId))) problem(`actions.${i}.topicId`, "taskrules.topic_not_allowed");
  }
}

function draftOf(raw: unknown): RuleDraft {
  const cleaned = cleanRuleDraft(raw);
  if (!cleaned.ok) problem(cleaned.path, cleaned.key);
  return cleaned.value;
}

export async function createRule(projectId: string, raw: unknown): Promise<RuleDto> {
  const access = await manageAccess(projectId);
  const draft = draftOf(raw);
  const row = await db.$transaction(async (tx) => {
    // the project's row is held while the rules are counted and the new one is written, so two adds at once cannot pass ten
    await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    if ((await tx.taskRule.count({ where: { projectId, deletedAt: null } })) >= MAX_RULES) throw new ForbiddenError("taskrules.too_many");
    await assertDraftAllowed(tx, access, draft);
    return tx.taskRule.create({
      data: {
        orgId: access.orgId,
        projectId,
        boardId: draft.boardId,
        name: draft.name,
        trigger: draft.trigger,
        triggerColumnId: draft.triggerColumnId,
        actions: draft.actions as unknown as Prisma.InputJsonValue,
        runAsId: access.userId,
        createdById: access.userId,
      },
      select: SELECT,
    });
  });
  await audit("taskRule.created", { actorId: access.userId, orgId: access.orgId, target: row.id, meta: { projectId, trigger: draft.trigger, actions: draft.actions.map((a) => a.type) } });
  return toDto(row, await namesOf([row.runAsId]));
}

async function ruleOf(tx: Tx, projectId: string, orgId: string, ruleId: string) {
  const row = await tx.taskRule.findFirst({ where: { id: ruleId, projectId, orgId, deletedAt: null }, select: { ...SELECT, orgId: true } });
  if (!row) throw new NotFoundError("taskrules.not_found");
  return row;
}

/**
 * Saves a rule again (the same fields as a new one). The rule then runs with the rights of the person who saved it now, and a
 * rule that was already paused stays paused. What it already did stays in the log, and a task it already acted on is not acted on twice.
 */
export async function updateRule(projectId: string, ruleId: string, raw: unknown): Promise<RuleDto> {
  const access = await manageAccess(projectId);
  const draft = draftOf(raw);
  const row = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    const before = await ruleOf(tx, projectId, access.orgId, ruleId);
    await assertDraftAllowed(tx, access, draft);
    return tx.taskRule.update({
      where: { id: ruleId },
      data: {
        boardId: draft.boardId,
        name: draft.name,
        trigger: draft.trigger,
        triggerColumnId: draft.triggerColumnId,
        actions: draft.actions as unknown as Prisma.InputJsonValue,
        runAsId: access.userId,
        // a rule turned INTO «لما تتأخر» looks only forward from now
        ...(before.trigger !== draft.trigger && draft.trigger === "OVERDUE" ? { armedAt: new Date() } : {}),
      },
      select: SELECT,
    });
  });
  await audit("taskRule.updated", { actorId: access.userId, orgId: access.orgId, target: ruleId, meta: { projectId, trigger: draft.trigger, actions: draft.actions.map((a) => a.type) } });
  return toDto(row, await namesOf([row.runAsId]));
}

/**
 * Pause or resume. Resuming looks forward only: an «overdue» rule does not wake up to every task that fell due while it slept, and
 * it runs with the rights of the person who resumed it (their right is what the next run re-checks).
 */
export async function setRuleActive(projectId: string, ruleId: string, active: boolean): Promise<RuleDto> {
  const access = await manageAccess(projectId);
  const row = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    const before = await ruleOf(tx, projectId, access.orgId, ruleId);
    if (before.active === active) return before;
    return tx.taskRule.update({
      where: { id: ruleId },
      data: active ? { active: true, armedAt: new Date(), runAsId: access.userId } : { active: false },
      select: SELECT,
    });
  });
  await audit(active ? "taskRule.resumed" : "taskRule.paused", { actorId: access.userId, orgId: access.orgId, target: ruleId, meta: { projectId } });
  return toDto(row, await namesOf([row.runAsId]));
}

/** Takes the rule off the screen; its log stays. */
export async function deleteRule(projectId: string, ruleId: string): Promise<void> {
  const access = await manageAccess(projectId);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    await ruleOf(tx, projectId, access.orgId, ruleId);
    await tx.taskRule.update({ where: { id: ruleId }, data: { deletedAt: new Date(), active: false } });
  });
  await audit("taskRule.deleted", { actorId: access.userId, orgId: access.orgId, target: ruleId, meta: { projectId } });
}

// ---------- the log ----------

const LOG_PAGE = 50;

export async function runsOfProject(projectId: string, opts: { limit?: number; before?: Date | null } = {}): Promise<RunDto[]> {
  const rows = await db.taskRuleRun.findMany({
    where: { projectId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opts.limit ?? LOG_PAGE, 1), 200),
  });
  const names = await namesOf(rows.map((r) => r.runAsId));
  return rows.map((r) => ({
    id: r.id,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    trigger: r.trigger as RuleTrigger,
    taskId: r.taskId,
    taskKey: r.taskKey,
    taskTitle: r.taskTitle,
    runAsName: names.get(r.runAsId) ?? null,
    status: r.status as RunStatus,
    results: Array.isArray(r.results) ? (r.results as unknown as ActionResult[]) : [],
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function readLog(projectId: string, opts: { limit?: number; before?: Date | null } = {}): Promise<RunDto[]> {
  await readAccess(projectId);
  return runsOfProject(projectId, opts);
}

