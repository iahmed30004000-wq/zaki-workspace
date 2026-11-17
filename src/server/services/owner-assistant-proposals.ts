import type { Prisma } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { enumLabel } from "@/lib/i18n/enums";
import { dueInstantForDay } from "@/lib/due-day";
import { fmtDayKey } from "@/components/owner-board/format";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import { log } from "@/server/log";
import { pushNotification } from "@/server/notify";
import { PROPOSAL_TTL_MS, isActionType, MAX_PROPOSALS_PER_ANSWER, parseStored, proposalFromCall, type ActionType, type DropReason, type Proposed, type StoredParams } from "@/server/ai/actions";
import { AssistantError } from "@/server/ai/api";
import type { RefTable } from "@/server/ai/redact";
import { orgTimeZone } from "@/server/services/org-day";
import { createTask, updateTask } from "@/server/services/tasks";
import { setPinned } from "@/server/services/rewards";
import { restorerFor, taskText, type NameBook } from "@/server/services/owner-assistant-names";

/**
 * «مساعد المالك» — PROPOSALS: what the model SUGGESTED, and what happens ONLY when the owner presses «وافق».
 *
 *  - A proposal is born from a tool call of the model (`prepareProposals`): the type must be on the whitelist, the params must
 *    parse, every reference must be in the conversation's table, and every id is checked against the database (inside the
 *    owner's company; a task that carries a reward is refused; a person must be an ACTIVE member who is not a guest).
 *    Anything else is DROPPED and only a counter is logged. Nothing is executed at this point, ever.
 *  - «وافق» (`approveProposal`) claims the row with a conditional UPDATE from PENDING (a second click, or two at once, claims
 *    nothing: 409), checks everything AGAIN (the data may have changed in the meantime), and then runs it through the ORDINARY
 *    services as the owner: `createTask`, `updateTask` (so the rank rule, the reward lock, the space rules and the activity log
 *    all apply and an assignment the rank rule turns into a request IS a request), `setPinned`, `pushNotification`. The audit row
 *    `ai.proposal_approved` carries the proposal's id, not the model's text. A failure marks the proposal FAILED with an Arabic
 *    reason and changes nothing else.
 *  - A pending proposal expires after 48 hours (`expireStale`, run on every read and by the job runner).
 */

export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "FAILED";

export interface ProposalLine {
  labelKey: string;
  value: string;
}

export interface ProposalView {
  id: string;
  type: string;
  status: ProposalStatus;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  lines: ProposalLine[];
  reason: string;
  /** A dictionary key for the reason a proposal FAILED (shown through `t`). */
  errorKey: string | null;
  /** The ordinary service turned the assignment into a request for a higher person: shown as a note. */
  requested: boolean;
}

const REWARD_LOCKED = new Set(["OPEN", "AWARDED"]);

async function isStaff(orgId: string, userId: string): Promise<boolean> {
  const row = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } });
  return row !== null;
}

/** An open task of this company that carries no reward (what a proposal may touch). */
async function touchableTask(orgId: string, taskId: string): Promise<{ id: string; workspaceId: string }> {
  // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
  const t = await db.task.findFirst({ where: { id: taskId, orgId }, select: { id: true, workspaceId: true, completedAt: true, archived: true, rewardStatus: true } });
  if (!t) throw new AssistantError("assistant.exec_task_missing", "not_found");
  // money is never touched by the assistant, whoever approves
  if (t.rewardStatus && REWARD_LOCKED.has(t.rewardStatus)) throw new AssistantError("assistant.exec_reward_task", "forbidden");
  if (t.completedAt || t.archived) throw new AssistantError("assistant.exec_task_closed", "conflict");
  return { id: t.id, workspaceId: t.workspaceId };
}

/**
 * Every id of a proposal, against the database. Used when the proposal is made AND again when it is approved. Returns the
 * board a new task goes to (the first board of the project).
 */
export async function checkParams(orgId: string, type: ActionType, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const stored = parseStored(type, params);
  if (!stored) throw new AssistantError("assistant.exec_invalid", "validation.failed");
  switch (type) {
    case "create_task": {
      const p = stored as StoredParams["create_task"];
      const project = await db.project.findFirst({
        where: { id: p.projectId, workspaceId: p.workspaceId, systemKey: null, workspace: { id: p.workspaceId, organizationId: orgId, archivedAt: null } },
        select: { boards: { where: { archived: false }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } },
      });
      const board = project?.boards[0];
      if (!project || !board) throw new AssistantError("assistant.exec_project_missing", "not_found");
      if (p.assigneeId && !(await isStaff(orgId, p.assigneeId))) throw new AssistantError("assistant.exec_person_missing", "not_found");
      return { ...p, boardId: board.id };
    }
    case "reassign_task": {
      const p = stored as StoredParams["reassign_task"];
      await touchableTask(orgId, p.taskId);
      if (!(await isStaff(orgId, p.assigneeId))) throw new AssistantError("assistant.exec_person_missing", "not_found");
      return { ...p };
    }
    case "set_due_date":
    case "pin_task": {
      const p = stored as StoredParams["set_due_date"] | StoredParams["pin_task"];
      await touchableTask(orgId, p.taskId);
      return { ...p };
    }
    case "remind_person": {
      const p = stored as StoredParams["remind_person"];
      if (!(await isStaff(orgId, p.userId))) throw new AssistantError("assistant.exec_person_missing", "not_found");
      return { ...p };
    }
  }
}

export interface Prepared {
  items: Proposed[];
  dropped: Record<DropReason, number>;
}

/**
 * The model's tool calls as proposals worth showing, and a counter of what was dropped (and why: the reason is a word, never
 * the model's text). Nothing is written here.
 */
export async function prepareProposals(orgId: string, table: RefTable, calls: readonly { name: string; input: unknown }[]): Promise<Prepared> {
  const dropped: Record<DropReason, number> = { tool: 0, shape: 0, type: 0, params: 0, reference: 0, limit: 0 };
  const items: Proposed[] = [];
  for (const call of calls) {
    if (items.length >= MAX_PROPOSALS_PER_ANSWER) {
      dropped.limit += 1;
      continue;
    }
    const made = proposalFromCall(call, table);
    if (!made.ok) {
      dropped[made.reason] += 1;
      continue;
    }
    try {
      const params = await checkParams(orgId, made.proposal.type, made.proposal.params);
      items.push({ type: made.proposal.type, params, reason: made.proposal.reason });
    } catch (err) {
      if (!(err instanceof AssistantError)) throw err;
      dropped.reference += 1;
    }
  }
  const total = Object.values(dropped).reduce((a, b) => a + b, 0);
  if (total > 0) log.warn("ai.proposal_dropped", { ...dropped, total });
  return { items, dropped };
}

/** Writes the prepared proposals (PENDING) on the caller's transaction. */
export async function saveProposals(tx: Prisma.TransactionClient, ctx: { orgId: string; conversationId: string; messageId: string }, items: readonly Proposed[]): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const row = await tx.aiProposal.create({
      data: { orgId: ctx.orgId, conversationId: ctx.conversationId, messageId: ctx.messageId, type: item.type, paramsJson: item.params as Prisma.InputJsonValue, reasonText: item.reason, status: "PENDING" },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

// ───────────────────────────────────────── expiry ─────────────────────────────────────────

/** Every pending proposal older than 48 hours becomes EXPIRED (one conditional UPDATE; running it twice changes nothing more). */
export async function expireStale(now: Date, orgId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - PROPOSAL_TTL_MS);
  const res = await db.aiProposal.updateMany({ where: { status: "PENDING", createdAt: { lt: cutoff }, ...(orgId ? { orgId } : {}) }, data: { status: "EXPIRED", decidedAt: now } });
  return res.count;
}

// ───────────────────────────────────────── how a proposal reads ─────────────────────────────────────────

interface Row {
  id: string;
  type: string;
  paramsJson: Prisma.JsonValue;
  reasonText: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  resultJson: Prisma.JsonValue | null;
}

const paramsOf = (row: Row): Record<string, unknown> => (row.paramsJson && typeof row.paramsJson === "object" && !Array.isArray(row.paramsJson) ? (row.paramsJson as Record<string, unknown>) : {});
const resultOf = (row: Row): Record<string, unknown> => (row.resultJson && typeof row.resultJson === "object" && !Array.isArray(row.resultJson) ? (row.resultJson as Record<string, unknown>) : {});

function idsOf(rows: readonly Row[]) {
  const users = new Set<string>();
  const tasks = new Set<string>();
  const spaces = new Set<string>();
  const projects = new Set<string>();
  for (const row of rows) {
    const p = paramsOf(row);
    for (const k of ["assigneeId", "userId"]) if (typeof p[k] === "string") users.add(p[k] as string);
    if (typeof p["taskId"] === "string") tasks.add(p["taskId"]);
    if (typeof p["workspaceId"] === "string") spaces.add(p["workspaceId"]);
    if (typeof p["projectId"] === "string") projects.add(p["projectId"]);
  }
  return { users, tasks, spaces, projects };
}

const dash = AR["enum.none"] ?? "—";

function linesOf(type: string, p: Record<string, unknown>, book: NameBook): ProposalLine[] {
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const person = (k: string) => book.users.get(str(k) ?? "") ?? dash;
  const task = () => {
    const t = book.tasks.get(str("taskId") ?? "");
    return t ? taskText(t) : dash;
  };
  const due = (k: string) => (str(k) ? fmtDayKey(str(k) as string) : dash);
  switch (type) {
    case "create_task":
      return [
        { labelKey: "assistant.field.title", value: str("title") ?? dash },
        { labelKey: "assistant.field.space", value: book.spaces.get(str("workspaceId") ?? "") ?? dash },
        { labelKey: "assistant.field.project", value: book.projects.get(str("projectId") ?? "") ?? dash },
        ...(str("assigneeId") ? [{ labelKey: "assistant.field.assignee", value: person("assigneeId") }] : []),
        ...(str("dueDate") ? [{ labelKey: "assistant.field.due", value: due("dueDate") }] : []),
        ...(str("priority") ? [{ labelKey: "assistant.field.priority", value: enumLabel("TaskPriority", str("priority")) }] : []),
      ];
    case "reassign_task":
      return [
        { labelKey: "assistant.field.task", value: task() },
        { labelKey: "assistant.field.assignee", value: person("assigneeId") },
      ];
    case "set_due_date":
      return [
        { labelKey: "assistant.field.task", value: task() },
        { labelKey: "assistant.field.due", value: due("dueDate") },
      ];
    case "pin_task":
      return [{ labelKey: "assistant.field.task", value: task() }];
    case "remind_person":
      return [
        { labelKey: "assistant.field.person", value: person("userId") },
        { labelKey: "assistant.field.text", value: str("text") ?? dash },
      ];
    default:
      return [];
  }
}

/** Proposals as the owner reads them: the exact parameters in plain Arabic, real names and titles put back (server side). */
export async function proposalViews(orgId: string, rows: readonly Row[], table: RefTable): Promise<ProposalView[]> {
  if (rows.length === 0) return [];
  const { users, tasks, spaces, projects } = idsOf(rows);
  const restorer = await restorerFor(orgId, table, rows.flatMap((r) => [r.reasonText, typeof paramsOf(r)["text"] === "string" ? (paramsOf(r)["text"] as string) : ""]), { users, tasks, spaces, projects });
  return rows.map((row) => {
    const params = paramsOf(row);
    const lines = linesOf(row.type, params, restorer.book).map((l) => (l.labelKey === "assistant.field.text" ? { ...l, value: restorer.restore(l.value) } : l));
    const result = resultOf(row);
    return {
      id: row.id,
      type: row.type,
      status: row.status as ProposalStatus,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      expiresAt: new Date(row.createdAt.getTime() + PROPOSAL_TTL_MS).toISOString(),
      lines,
      reason: restorer.restore(row.reasonText),
      errorKey: row.status === "FAILED" && typeof result["error"] === "string" ? (result["error"] as string) : null,
      requested: result["requested"] === true,
    };
  });
}

// ───────────────────────────────────────── deciding ─────────────────────────────────────────

const ROW_SELECT = { id: true, type: true, paramsJson: true, reasonText: true, status: true, createdAt: true, decidedAt: true, resultJson: true } as const;

async function ownRow(actor: { orgId: string; userId: string }, id: string) {
  const row = await db.aiProposal.findFirst({
    where: { id, orgId: actor.orgId, conversation: { userId: actor.userId, orgId: actor.orgId } },
    select: { ...ROW_SELECT, conversation: { select: { refs: true } } },
  });
  if (!row) throw new NotFoundError("assistant.not_found");
  const table = row.conversation.refs && typeof row.conversation.refs === "object" && !Array.isArray(row.conversation.refs) ? (row.conversation.refs as RefTable) : {};
  return { row, table };
}

/** A refusal key a screen can show: a known dictionary key, or the generic one. Never a message that came from anywhere else. */
export function failureKey(err: unknown): string {
  const message = err instanceof AssistantError || err instanceof ForbiddenError || err instanceof NotFoundError ? err.message : err instanceof ValidationError ? "assistant.exec_invalid" : "";
  if (message && /^[a-z][\w.]*$/.test(message) && message in AR) return message;
  if (!(err instanceof AssistantError || err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof ValidationError)) {
    log.error("ai.proposal_exec_error", { name: err instanceof Error ? err.name : "unknown" });
  }
  return "assistant.exec_failed";
}

export interface DecideActor {
  userId: string;
  orgId: string;
  role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
}

interface Executed {
  result: Record<string, unknown>;
}

async function execute(actor: DecideActor, type: ActionType, params: Record<string, unknown>, table: RefTable): Promise<Executed> {
  const ctx = { userId: actor.userId, orgId: actor.orgId };
  const tz = await orgTimeZone(actor.orgId);
  switch (type) {
    case "create_task": {
      const p = params as StoredParams["create_task"] & { boardId: string };
      const dueDate = p.dueDate ? dueInstantForDay(p.dueDate, tz) : null;
      const made = await createTask(ctx, {
      visibility: "SPACE",
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        boardId: p.boardId,
        title: p.title,
        ...(p.assigneeId ? { assigneeId: p.assigneeId } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(p.priority ? { priority: p.priority } : {}),
      });
      return { result: { taskId: made.id, number: made.number, requested: made.assignRequest !== null || made.coRequests.length > 0 } };
    }
    case "reassign_task": {
      const p = params as StoredParams["reassign_task"];
      const saved = await updateTask(ctx, p.taskId, { assigneeId: p.assigneeId });
      return { result: { taskId: saved.id, requested: saved.assignRequest !== null } };
    }
    case "set_due_date": {
      const p = params as StoredParams["set_due_date"];
      const dueDate = dueInstantForDay(p.dueDate, tz);
      if (!dueDate) throw new AssistantError("assistant.exec_invalid", "validation.failed");
      const saved = await updateTask(ctx, p.taskId, { dueDate });
      return { result: { taskId: saved.id } };
    }
    case "pin_task": {
      const p = params as StoredParams["pin_task"];
      const pinned = await setPinned({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, p.taskId, true);
      return { result: { taskId: pinned.id } };
    }
    case "remind_person": {
      const p = params as StoredParams["remind_person"];
      // the owner read this text with the real names in it; those are what the person receives
      const { restore } = await restorerFor(actor.orgId, table, [p.text]);
      await pushNotification({ userId: p.userId, type: "owner_note", title: AR["notif.type.owner_note"] ?? "ملاحظة من المالك", body: restore(p.text), organizationId: actor.orgId });
      return { result: { userId: p.userId } };
    }
  }
}

async function viewOf(actor: { orgId: string }, id: string, table: RefTable): Promise<ProposalView> {
  const row = await db.aiProposal.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
  const [view] = await proposalViews(actor.orgId, [row], table);
  return view as ProposalView;
}

/**
 * «وافق»: runs ONE proposal, once. 409 `assistant.proposal_not_pending` for a proposal already decided (a second click, a
 * concurrent click); 409 `assistant.proposal_expired` after 48 hours. The answer is the proposal as it is now: APPROVED with its
 * result, or FAILED with the reason.
 */
export async function approveProposal(actor: DecideActor, id: string, now: Date = new Date()): Promise<ProposalView> {
  const { row, table } = await ownRow(actor, id);
  const cutoff = new Date(now.getTime() - PROPOSAL_TTL_MS);
  const claimed = await db.aiProposal.updateMany({ where: { id, status: "PENDING", createdAt: { gte: cutoff } }, data: { status: "APPROVED", decidedAt: now, decidedById: actor.userId } });
  if (claimed.count === 0) {
    const stale = await db.aiProposal.updateMany({ where: { id, status: "PENDING", createdAt: { lt: cutoff } }, data: { status: "EXPIRED", decidedAt: now } });
    throw new AssistantError(stale.count > 0 || row.status === "EXPIRED" ? "assistant.proposal_expired" : "assistant.proposal_not_pending", "conflict");
  }

  const type = row.type;
  try {
    if (!isActionType(type)) throw new AssistantError("assistant.exec_invalid", "validation.failed");
    // the data may have changed since the proposal was made: every id is checked again
    const params = await checkParams(actor.orgId, type, row.paramsJson as Record<string, unknown>);
    const done = await execute(actor, type, params, table);
    await db.$transaction([
      db.aiProposal.update({ where: { id }, data: { resultJson: done.result as Prisma.InputJsonValue } }),
      db.auditLog.create({ data: { action: "ai.proposal_approved", actorId: actor.userId, orgId: actor.orgId, target: id, meta: { proposalId: id, type } } }),
    ]);
  } catch (err) {
    const error = failureKey(err);
    await db.$transaction([
      db.aiProposal.update({ where: { id }, data: { status: "FAILED", resultJson: { error } } }),
      db.auditLog.create({ data: { action: "ai.proposal_failed", actorId: actor.userId, orgId: actor.orgId, target: id, meta: { proposalId: id, type, error } } }),
    ]);
  }
  return viewOf(actor, id, table);
}

/** «ارفض»: the proposal is closed and nothing runs. */
export async function rejectProposal(actor: DecideActor, id: string, now: Date = new Date()): Promise<ProposalView> {
  const { table } = await ownRow(actor, id);
  const cutoff = new Date(now.getTime() - PROPOSAL_TTL_MS);
  const claimed = await db.aiProposal.updateMany({ where: { id, status: "PENDING", createdAt: { gte: cutoff } }, data: { status: "REJECTED", decidedAt: now, decidedById: actor.userId } });
  if (claimed.count === 0) {
    await db.aiProposal.updateMany({ where: { id, status: "PENDING", createdAt: { lt: cutoff } }, data: { status: "EXPIRED", decidedAt: now } });
    throw new AssistantError("assistant.proposal_not_pending", "conflict");
  }
  await db.auditLog.create({ data: { action: "ai.proposal_rejected", actorId: actor.userId, orgId: actor.orgId, target: id, meta: { proposalId: id } } });
  return viewOf(actor, id, table);
}

