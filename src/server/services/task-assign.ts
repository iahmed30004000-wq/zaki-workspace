import type { Prisma } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { pushNotification } from "@/server/notify";
import { assignKindByRank } from "@/server/policy/assign-rank";

/**
 * GIVING A TASK BY RANK (the owner's decision, 2026-10-30; the pure rule is `policy/assign-rank.ts`).
 *
 *   - yourself, somebody below you, somebody of your own rank: the task is assigned at once (`direct`);
 *   - somebody ABOVE you: nothing is assigned. A `TaskAssignRequest` is stored and the higher person is told; they ACCEPT
 *     (the task becomes theirs, the requester is told) or RETURN it with a written reason (the requester is told, the
 *     task stays as it was). Only the addressed person, or the OWNER, answers, and only once;
 *   - an external partner (GUEST) gives tasks to nobody and receives them from nobody, EXCEPT inside a space both are
 *     members of; there the same rank rules hold, and a partner giving upward is refused outright (never a request).
 *
 * Every place a task gets an assignee (`createTask`, `updateTask`, the instant task, a task made from a message or an
 * idea) goes through `judgeAssignment`, so there is one rule.
 */

type Db = Prisma.TransactionClient;

export type AssignVerdict = "direct" | "request";

export interface AssignRequestInfo {
  id: string;
  toUserId: string;
}

/**
 * Whether `actor` may hand a task of `workspaceId` to `targetId` directly, or only ask. Throws when it is not allowed at all.
 * The person must belong to the company and be ACTIVE (`assignee.not_member`, `assignee.not_active`: the same keys as before).
 */
export async function judgeAssignment(
  client: Db,
  actor: { userId: string; orgId: string },
  targetId: string,
  workspaceId: string,
): Promise<AssignVerdict> {
  const target = await client.organizationMember.findFirst({
    where: { organizationId: actor.orgId, userId: targetId },
    select: { status: true, role: true },
  });
  if (!target) throw new ForbiddenError("assignee.not_member");
  if (target.status !== "ACTIVE") throw new ForbiddenError("assignee.not_active");
  if (targetId === actor.userId) return "direct";

  const me = await client.organizationMember.findFirst({
    where: { organizationId: actor.orgId, userId: actor.userId, status: "ACTIVE" },
    select: { role: true },
  });
  if (!me) throw new ForbiddenError("assign.not_allowed");

  // an external partner is only ever in play inside a space both are members of (the owner needs no row)
  const inSpace = async (userId: string, role: typeof me.role) =>
    role === "OWNER" || !!(await client.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } }));
  if (me.role === "GUEST" || target.role === "GUEST") {
    const [mine, theirs] = await Promise.all([inSpace(actor.userId, me.role), inSpace(targetId, target.role)]);
    if (!mine || !theirs) throw new ForbiddenError(me.role === "GUEST" ? "assign.guest_cannot_give" : "assign.guest_outside_space");
  }

  const kind = assignKindByRank(me.role, target.role);
  if (kind === "refused") throw new ForbiddenError("assign.guest_no_request");
  if (kind === "direct") return "direct";

  // a request is answered on the task's own page, so the addressed person must be able to open it
  if (!(await inSpace(targetId, target.role))) throw new ForbiddenError("assign.request_not_in_space");
  return "request";
}

/** One request at a time per task for the MAIN assignee: a second one waits for the answer to the first. */
export async function assertNoPendingRequest(client: Db, taskId: string): Promise<void> {
  if (await client.taskAssignRequest.findFirst({ where: { taskId, status: "PENDING", asCo: false }, select: { id: true } })) {
    throw new ForbiddenError("taskreq.already_pending");
  }
}

/**
 * «لمين» with more than one person: each person BESIDE the first goes through the same judge as the first
 * (`judgeAssignment`). Somebody of the same or a lower rank is added directly; somebody of a HIGHER rank is not added
 * but asked (a request of their own), and the others are still added: one higher person never refuses the whole list.
 * A person the judge refuses outright (not in the company, not active, a partner outside the space, a partner asking
 * upward) still throws, exactly as it does for the first person.
 */
export async function judgeCoAssignees(
  client: Db,
  actor: { userId: string; orgId: string },
  ids: string[],
  workspaceId: string,
): Promise<{ direct: string[]; request: string[] }> {
  const direct: string[] = [];
  const request: string[] = [];
  for (const userId of ids) {
    ((await judgeAssignment(client, actor, userId, workspaceId)) === "request" ? request : direct).push(userId);
  }
  return { direct, request };
}

/**
 * Stores one request per higher person beside the first (`asCo`). A person who already has a pending request on this
 * task is not asked twice (the same pick sent again changes nothing). Returns the requests that were really made.
 */
export async function storeCoRequests(
  client: Db,
  input: { orgId: string; taskId: string; fromUserId: string; toUserIds: string[] },
): Promise<AssignRequestInfo[]> {
  const made: AssignRequestInfo[] = [];
  for (const toUserId of new Set(input.toUserIds)) {
    const waiting = await client.taskAssignRequest.findFirst({ where: { taskId: input.taskId, toUserId, status: "PENDING" }, select: { id: true } });
    if (waiting) continue;
    made.push(await storeAssignRequest(client, { orgId: input.orgId, taskId: input.taskId, fromUserId: input.fromUserId, toUserId, asCo: true }));
  }
  return made;
}

/** Stores the request and its line in the task's history. Call inside the transaction that holds the task. */
export async function storeAssignRequest(
  client: Db,
  input: { orgId: string; taskId: string; fromUserId: string; toUserId: string; asCo?: boolean },
): Promise<AssignRequestInfo> {
  const row = await client.taskAssignRequest.create({
    data: { orgId: input.orgId, taskId: input.taskId, fromUserId: input.fromUserId, toUserId: input.toUserId, asCo: input.asCo ?? false },
    select: { id: true, toUserId: true },
  });
  await client.taskActivity.create({
    data: { taskId: input.taskId, actorId: input.fromUserId, event: "task.assign_requested", meta: { toUserId: input.toUserId } },
  });
  return row;
}

async function taskLine(taskId: string): Promise<{ key: string; title: string; workspaceId: string; creatorId: string } | null> {
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { number: true, title: true, workspaceId: true, creatorId: true, organization: { select: { keyPrefix: true } } },
  });
  return task ? { key: `${task.organization.keyPrefix}-${task.number}`, title: task.title, workspaceId: task.workspaceId, creatorId: task.creatorId } : null;
}

/** Tells the addressed person (after the transaction that stored the request has committed). */
export async function notifyAssignRequest(taskId: string, fromUserId: string, toUserId: string): Promise<void> {
  const [line, from] = await Promise.all([taskLine(taskId), db.user.findUnique({ where: { id: fromUserId }, select: { name: true } })]);
  if (!line) return;
  await pushNotification({
    userId: toUserId,
    type: "task_assign_request",
    title: AR["notif.type.task_assign_request"] ?? "إشعار",
    body: `${from?.name ?? ""}: ${line.key} · ${line.title}`,
    taskId,
    linkUrl: `/tasks/${taskId}`,
    workspaceId: line.workspaceId,
  });
}

export type AssignAnswer = { accept: true } | { accept: false; reason: string };

/**
 * The addressed person (or the OWNER) answers the task's pending request.
 * Accept: the task is assigned to the person it was addressed to. Return: it stays as it was, and the reason goes back.
 * Either way the requester is told. A second answer, or an answer to a task with no request, is refused.
 */
export async function answerAssignRequest(
  actor: { userId: string; orgId: string },
  taskId: string,
  answer: AssignAnswer,
  requestId?: string,
): Promise<{ status: "ACCEPTED" | "RETURNED" }> {
  const reason = answer.accept ? null : answer.reason.trim();
  if (!answer.accept && !reason) throw new ForbiddenError("taskreq.reason_required");

  const done = await db.$transaction(async (tx) => {
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    const task = await tx.task.findFirst({ where: { id: taskId, orgId: actor.orgId }, select: { id: true, assigneeId: true } });
    if (!task) throw new NotFoundError("task.not_found");
    const all = await tx.taskAssignRequest.findMany({ where: { taskId, orgId: actor.orgId }, orderBy: { createdAt: "desc" } });
    if (all.length === 0) throw new NotFoundError("taskreq.not_found");
    const open = all.filter((r) => r.status === "PENDING");
    if (open.length === 0) throw new ForbiddenError("taskreq.already_answered");

    const me = await tx.organizationMember.findFirst({
      where: { organizationId: actor.orgId, userId: actor.userId, status: "ACTIVE" },
      select: { role: true },
    });
    if (!me) throw new ForbiddenError("taskreq.not_addressee");
    // a task may hold several pending requests: the person answers the one addressed to them; the owner, who may answer
    // for anybody, answers the one named by `requestId`, else the main one
    const named = requestId ? open.find((r) => r.id === requestId) : undefined;
    if (requestId && !named) throw new ForbiddenError("taskreq.already_answered");
    const latest =
      named ?? open.find((r) => r.toUserId === actor.userId) ?? (me.role === "OWNER" ? (open.find((r) => !r.asCo) ?? open[0]) : undefined);
    if (!latest || (latest.toUserId !== actor.userId && me.role !== "OWNER")) throw new ForbiddenError("taskreq.not_addressee");

    if (answer.accept) {
      const target = await tx.organizationMember.findFirst({
        where: { organizationId: actor.orgId, userId: latest.toUserId },
        select: { status: true },
      });
      if (!target || target.status !== "ACTIVE") throw new ForbiddenError("assignee.not_active");
    }

    // the single winner of two answers at the same moment
    const claimed = await tx.taskAssignRequest.updateMany({
      where: { id: latest.id, status: "PENDING" },
      data: { status: answer.accept ? "ACCEPTED" : "RETURNED", reason, answeredAt: new Date() },
    });
    if (claimed.count !== 1) throw new ForbiddenError("taskreq.already_answered");

    if (answer.accept) {
      if (latest.asCo && task.assigneeId && task.assigneeId !== latest.toUserId) {
        // beside the first person: one row per person, whatever the order of two answers
        await tx.taskCoAssignee.upsert({
          where: { taskId_userId: { taskId, userId: latest.toUserId } },
          create: { taskId, userId: latest.toUserId },
          update: {},
        });
      } else if (!latest.asCo || !task.assigneeId) {
        // the main kind, or a co request on a task nobody holds yet: the person becomes its assignee (and leaves the extras)
        await tx.taskCoAssignee.deleteMany({ where: { taskId, userId: latest.toUserId } });
        await tx.task.update({ where: { id: taskId }, data: { assigneeId: latest.toUserId } });
      }
      await tx.taskActivity.create({
        data: { taskId, actorId: actor.userId, event: "task.updated", meta: { fields: [latest.asCo ? "assignees" : "assignee"], viaRequest: latest.id } },
      });
    } else {
      await tx.taskActivity.create({ data: { taskId, actorId: actor.userId, event: "task.assign_returned", meta: { requestId: latest.id } } });
    }
    return latest;
  });

  const [line, answerer] = await Promise.all([taskLine(taskId), db.user.findUnique({ where: { id: actor.userId }, select: { name: true } })]);
  if (line) {
    const key = answer.accept ? "task_assign_accepted" : "task_assign_returned";
    await pushNotification({
      userId: done.fromUserId,
      type: key,
      title: AR[`notif.type.${key}`] ?? "إشعار",
      body: answer.accept ? `${answerer?.name ?? ""}: ${line.key} · ${line.title}` : `${answerer?.name ?? ""}: ${reason} (${line.key} · ${line.title})`,
      taskId,
      linkUrl: `/tasks/${taskId}`,
      workspaceId: line.workspaceId,
    });
  }
  return { status: answer.accept ? "ACCEPTED" : "RETURNED" };
}

export interface PendingRequestInfo {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  asCo: boolean;
}

/** What the task page needs to draw the banners: every pending request with the two names, the main one first (empty when none). */
export async function pendingRequestsOf(taskId: string): Promise<PendingRequestInfo[]> {
  const rows = await db.taskAssignRequest.findMany({ where: { taskId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))];
  const people = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  return rows
    .map((r) => ({ id: r.id, fromUserId: r.fromUserId, toUserId: r.toUserId, fromName: nameOf(r.fromUserId), toName: nameOf(r.toUserId), asCo: r.asCo }))
    .sort((a, b) => Number(a.asCo) - Number(b.asCo));
}
