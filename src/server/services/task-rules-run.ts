import { Prisma, type TaskRule } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { RequiredFieldsError } from "@/server/custom-fields-error";
import { assertMemberCan } from "@/server/policy/actor";
import { AR } from "@/lib/i18n/dict";
import { isRewardTaskStatus } from "@/lib/rewards";
import { runStatusOf, readActions, type ActionResult, type RuleAction, type SkipReason } from "@/lib/task-rules";
import { pushNotification, notifyAssignment } from "@/server/notify";
import { writeSystemMessage } from "@/server/chat/system";
import { isFeatureOn } from "./features";
import { judgeAssignment } from "./task-assign";
import { insertStep } from "./task-steps";
import { moveTask, updateTask } from "./tasks";
import { eligiblePerson, stillManages, usableTopic } from "./task-rules-guards";
import { inRuleRun, withinRuleRun, type TaskRuleEvent } from "./task-rules-hook";

/**
 * THE ENGINE OF «القواعد التلقائية»: what happens when a task event meets a rule.
 *
 * The guarantees, each one pinned by tests/db/task-rules.test.ts:
 *  - NO LOOPS. A rule's actions run inside `withinRuleRun` (task-rules-hook.ts), so the move, the assignment or the priority a rule
 *    makes never starts a rule (depth one); and a rule acts ONCE on a task: the pair (rule, task) is a unique row of the log, taken
 *    under an advisory lock, so two events at once, a retry and a second visit to the same column are one run.
 *  - A RULE ACTS AS THE SYSTEM, NEVER AS MORE THAN ITS ADMIN. It runs with the rights of `runAsId` (the admin who last saved it):
 *    the real services are called with that person (so the section grid, the rank rules and the required fields all apply), and
 *    before anything the engine checks again that this person is still ACTIVE and still manages the space, and that every person
 *    it names is still ACTIVE, in the space and not a partner. A check that fails skips THAT action with a reason; it never widens.
 *  - NO MONEY. A task that carries a reward is left alone entirely, and no action touches a reward, an amount or a customer.
 *  - EVERY RUN IS RECORDED, skipped ones too, in the append-only log (`TaskRuleRun`): rule, task, who it ran as, when, and what each
 *    action did. The engine only ever inserts there.
 *  - A rule that throws is logged and the next rule still runs; the person's own action is never undone.
 */

const TASK_SELECT = {
  id: true,
  number: true,
  orgId: true,
  workspaceId: true,
  projectId: true,
  boardId: true,
  columnId: true,
  title: true,
  priority: true,
  assigneeId: true,
  dueDate: true,
  completedAt: true,
  archived: true,
  rewardStatus: true,
  project: { select: { teamId: true } },
} as const;

async function taskForRules(taskId: string) {
  return db.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
}
type TaskRow = NonNullable<Awaited<ReturnType<typeof taskForRules>>>;

const skipped = (type: RuleAction["type"], reason: SkipReason): ActionResult => ({ type, status: "SKIPPED", reason });
const applied = (type: RuleAction["type"], reason?: SkipReason): ActionResult => (reason ? { type, status: "APPLIED", reason } : { type, status: "APPLIED" });

/** What a thrown error means for one action. */
function failure(type: RuleAction["type"], err: unknown): ActionResult {
  if (err instanceof RequiredFieldsError) return skipped(type, "required_fields");
  if (err instanceof ForbiddenError || err instanceof NotFoundError) return skipped(type, "not_allowed");
  log.warn("taskrules.action_failed", { type, message: err instanceof Error ? err.message : String(err) });
  return { type, status: "FAILED", reason: "error" };
}

// ---------- one rule on one task ----------

/** Which events the rules of a project react to: the task, the rule's board filter and its column. */
export async function fireTaskRules(event: TaskRuleEvent): Promise<void> {
  if (inRuleRun()) return;
  const task = await taskForRules(event.taskId);
  if (!task || task.archived) return;
  const rules = await db.taskRule.findMany({
    where: {
      projectId: task.projectId,
      orgId: task.orgId,
      active: true,
      deletedAt: null,
      trigger: event.trigger,
      ...(event.trigger === "MOVED_TO_COLUMN" ? { triggerColumnId: event.columnId } : {}),
      OR: [{ boardId: null }, { boardId: task.boardId }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rules.length === 0) return;
  if (!(await isFeatureOn(task.orgId, "taskRules"))) return;
  for (const rule of rules) {
    try {
      await runRule(rule, task);
    } catch (err) {
      log.warn("taskrules.run_failed", { rule: rule.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

/**
 * Runs one rule on one task, once. Returns false when the rule had already acted on that task.
 * The advisory lock is on the pair, so two runs of the same pair queue up and the second finds the first one's log row.
 */
export async function runRule(rule: TaskRule, task: TaskRow): Promise<boolean> {
  const key = `taskrule:${rule.id}:${task.id}`;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const already = await tx.taskRuleRun.findUnique({ where: { ruleId_taskId: { ruleId: rule.id, taskId: task.id } }, select: { id: true } });
      if (already) return false;

      const results = await withinRuleRun(rule.id, () => executeActions(rule, task));
      const org = await tx.organization.findUnique({ where: { id: task.orgId }, select: { keyPrefix: true } });
      const status = runStatusOf(results);
      await tx.taskRuleRun.create({
        data: {
          orgId: task.orgId,
          projectId: task.projectId,
          ruleId: rule.id,
          ruleName: rule.name,
          trigger: rule.trigger,
          taskId: task.id,
          taskKey: `${org?.keyPrefix ?? ""}-${task.number}`,
          taskTitle: task.title.slice(0, 300),
          runAsId: rule.runAsId,
          status,
          results: results as unknown as object,
        },
      });
      return true;
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/** The actions of the rule, in order, each with its own re-check. Never throws. */
async function executeActions(rule: TaskRule, task: TaskRow): Promise<ActionResult[]> {
  const actions = readActions(rule.actions);
  const all = (reason: SkipReason) => actions.map((a) => skipped(a.type, reason));
  if (actions.length === 0) return [];

  // the admin the rule runs as: still ACTIVE, still managing the space, still holding the projects row
  const actor = { userId: rule.runAsId, orgId: task.orgId };
  if (!(await stillManages(task.orgId, task.workspaceId, rule.runAsId))) return all("runas_not_allowed");
  try {
    await assertMemberCan(actor, "projects.edit", "section.edit_denied");
  } catch {
    return all("runas_not_allowed");
  }
  // money is not a rule's to touch: a task that carries a reward is left alone, whoever asks
  if (isRewardTaskStatus(task.rewardStatus)) return all("reward_task");

  const results: ActionResult[] = [];
  for (const action of actions) {
    try {
      results.push(await runAction(rule, task, action, actor));
    } catch (err) {
      results.push(failure(action.type, err));
    }
  }
  return results;
}

async function runAction(rule: TaskRule, task: TaskRow, action: RuleAction, actor: { userId: string; orgId: string }): Promise<ActionResult> {
  const project = { workspaceId: task.workspaceId, teamId: task.project.teamId };
  // the task as it is now (an earlier action of the same rule may have changed it)
  const fresh = await taskForRules(task.id);
  if (!fresh || fresh.archived) return skipped(action.type, "task_archived");

  switch (action.type) {
    case "ASSIGN": {
      if (!(await eligiblePerson(actor.orgId, project, action.userId))) return skipped("ASSIGN", "person_not_allowed");
      if (fresh.assigneeId === action.userId) return applied("ASSIGN", "unchanged");
      // by rank, as for the admin himself: a person above the admin is asked, never assigned, and a rule asks nobody
      const verdict = await judgeAssignment(db, actor, action.userId, task.workspaceId);
      if (verdict !== "direct") return skipped("ASSIGN", "person_higher");
      await updateTask(actor, task.id, { assigneeId: action.userId });
      if (action.userId !== actor.userId) {
        const org = await db.organization.findUnique({ where: { id: task.orgId }, select: { keyPrefix: true } });
        await notifyAssignment({ assigneeId: action.userId, taskNumber: task.number, orgPrefix: org?.keyPrefix ?? "", taskId: task.id, title: task.title, workspaceId: task.workspaceId });
      }
      return applied("ASSIGN");
    }
    case "SET_PRIORITY": {
      if (fresh.priority === action.priority) return applied("SET_PRIORITY", "unchanged");
      await updateTask(actor, task.id, { priority: action.priority });
      return applied("SET_PRIORITY");
    }
    case "MOVE_TO_COLUMN": {
      const column = await db.boardColumn.findFirst({ where: { id: action.columnId, boardId: task.boardId }, select: { id: true } });
      if (!column) return skipped("MOVE_TO_COLUMN", "column_gone");
      if (fresh.columnId === column.id) return applied("MOVE_TO_COLUMN", "unchanged");
      await moveTask(actor, task.id, { columnId: column.id });
      return applied("MOVE_TO_COLUMN");
    }
    case "ADD_STEP": {
      if (!(await isFeatureOn(task.orgId, "taskSteps"))) return skipped("ADD_STEP", "feature_off");
      try {
        await insertStep(task.orgId, task.id, action.title);
      } catch (err) {
        if (err instanceof ForbiddenError && err.message === "step.too_many") return skipped("ADD_STEP", "steps_full");
        throw err;
      }
      return applied("ADD_STEP");
    }
    case "NOTIFY": {
      if (!(await eligiblePerson(actor.orgId, project, action.userId))) return skipped("NOTIFY", "person_not_allowed");
      const org = await db.organization.findUnique({ where: { id: task.orgId }, select: { keyPrefix: true } });
      const line = `${org?.keyPrefix ?? ""}-${task.number} · ${task.title}`;
      await pushNotification({
        userId: action.userId,
        type: "task_rule",
        title: AR["notif.type.task_rule"] ?? "قاعدة تلقائية",
        body: action.note ? `${line} — ${action.note}` : line,
        taskId: task.id,
        linkUrl: `/tasks/${task.id}`,
        workspaceId: task.workspaceId,
        organizationId: task.orgId,
      });
      return applied("NOTIFY");
    }
    case "POST_MESSAGE": {
      const topic = await usableTopic(actor.orgId, project, action.topicId);
      if (!topic) return skipped("POST_MESSAGE", "topic_unavailable");
      const org = await db.organization.findUnique({ where: { id: task.orgId }, select: { keyPrefix: true } });
      // a SYSTEM line (the screen composes the sentence): it is the rule talking, never a person, and it notifies nobody
      await db.$transaction(async (tx) => {
        await writeSystemMessage(tx, {
          orgId: task.orgId,
          conversationId: topic.id,
          authorId: actor.userId,
          k: "task_rule",
          p: { rule: rule.name, task: `${org?.keyPrefix ?? ""}-${task.number} · ${task.title}`.slice(0, 200), text: action.text },
          spaceId: task.workspaceId,
        });
        await tx.conversation.update({ where: { id: topic.id }, data: { updatedAt: new Date() } });
      });
      return applied("POST_MESSAGE");
    }
  }
}

// ---------- the overdue job ----------

export interface TaskRulesRun {
  /** Rule-and-task pairs the rules acted on this round. */
  fired: number;
}

const OVERDUE_RULES_PER_ROUND = 200;
const OVERDUE_TASKS_PER_RULE = 50;

/**
 * «لما تتأخر»: every active OVERDUE rule looks at the open tasks of its project (and board) whose due date has passed and that fell
 * due AFTER the rule was armed (made, or resumed), and that it has not acted on yet. Each pair runs once; a pair that was skipped
 * is logged like any other, so it is not looked at again. A company whose switch is off is not even selected.
 */
export async function fireOverdueRules(now: Date): Promise<TaskRulesRun> {
  const run: TaskRulesRun = { fired: 0 };
  const rules = await db.taskRule.findMany({
    where: { active: true, deletedAt: null, trigger: "OVERDUE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: OVERDUE_RULES_PER_ROUND,
  });
  if (rules.length === 0) return run;
  const off = new Set<string>();
  // the scan is the cost; a company with «القواعد التلقائية» or «تنبيهات الخلفية» off (economy mode included) is left out of it
  for (const orgId of new Set(rules.map((r) => r.orgId))) {
    if (!(await isFeatureOn(orgId, "taskRules")) || !(await isFeatureOn(orgId, "backgroundNudges"))) off.add(orgId);
  }

  for (const rule of rules) {
    if (off.has(rule.orgId)) continue;
    try {
      // the pair is not in the log yet (NOT EXISTS: a long log never starves the newer tasks of a round)
      const ids = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT t."id" FROM "Task" t
        WHERE t."projectId" = ${rule.projectId} AND t."orgId" = ${rule.orgId}
          ${rule.boardId ? Prisma.sql`AND t."boardId" = ${rule.boardId}` : Prisma.empty}
          AND t."completedAt" IS NULL AND t."archived" = false
          AND t."dueDate" < ${now} AND t."dueDate" >= ${rule.armedAt}
          AND NOT EXISTS (SELECT 1 FROM "TaskRuleRun" r WHERE r."ruleId" = ${rule.id} AND r."taskId" = t."id")
        ORDER BY t."dueDate" ASC, t."id" ASC
        LIMIT ${OVERDUE_TASKS_PER_RULE}`);
      for (const { id } of ids) {
        const task = await taskForRules(id);
        if (!task || task.archived || task.completedAt) continue;
        if (await runRule(rule, task)) run.fired++;
      }
    } catch (err) {
      log.warn("taskrules.overdue_failed", { rule: rule.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return run;
}
