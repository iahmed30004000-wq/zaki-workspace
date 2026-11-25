import type { TaskPriority, TaskType } from "@prisma/client";
import { db } from "@/server/db";
import { actorCanWork, type Actor } from "@/server/policy/actor";
import { isRequestTo } from "@/server/policy/assign-rank";
import { actorFeatureOn } from "@/server/services/features";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { pendingRequestsOf } from "@/server/services/task-assign";
import { stepsOfTask } from "@/server/services/task-steps";
import type { StepDto, StepProgress } from "@/lib/task-steps";
import { rewardLensFor, type RewardLens } from "@/server/services/rewards";
import { isRewardTaskStatus } from "@/lib/rewards";
import { canWriteInWorkspace } from "@/server/workspace-role";

/** What the viewer may do with a pending request to give the task to somebody of a higher rank. */
export type RequestMode = "addressee" | "owner" | "waiting";

/**
 * ONE TASK AS ITS SHEET SHOWS IT — what the task page (src/app/(app)/tasks/[id]/page.tsx) draws, built in one place so the page and
 * the phone (`GET /api/tasks/[id]/sheet`) can never disagree. It reads exactly what the page always read, with the same rules:
 * - the task is found only inside the person's work scope (their spaces and their teams: `taskVisibleWhere`); outside it, `notFound`;
 * - the tasks row of the person's grid (`tasks.view`) decides whether the section is theirs at all (`off`);
 * - `canEdit` is the space's write rule (the real company rank and the real row in the space) AND the grid's `tasks.edit`;
 * - the people offered for «لمين» are the space's ACTIVE members, each marked `request` when the viewer may only ASK them (a higher rank);
 * - a reward is described only when the viewer's lens shows rewards (never to a partner); the pin only when they may pin.
 * The cards with their own switches and slots (time, recurrence, custom fields, linked approvals, dependencies) stay the page's.
 */
export interface TaskSheet {
  task: {
    id: string;
    number: number;
    key: string;
    title: string;
    description: string | null;
    priority: TaskPriority;
    type: TaskType;
    workspaceId: string;
    projectId: string;
    boardId: string;
    boardName: string;
    columnId: string;
    status: string;
    columnDone: boolean;
    dueDate: string | null;
    startDate: string | null;
    completedAt: null | string;
    createdAt: string;
    creatorId: string;
    creatorName: string;
    visibility: string;
    assigneeId: string | null;
    assigneeName: string | null;
    assigneeIds: string[];
    milestoneId: string | null;
    milestoneName: string | null;
    labelIds: string[];
    pinned: boolean;
    comments: { id: string; author: string; authorId: string; body: string; createdAt: string }[];
  };
  canEdit: boolean;
  viewerId: string;
  members: { id: string; name: string; request: boolean }[];
  assignRequests: { id: string; mode: RequestMode; fromName: string; toName: string }[];
  labels: { id: string; name: string; color: string }[];
  /** the board's columns, in order: the «الحالة» picker (a move is `POST /api/tasks/[id]/move`) */
  columns: { id: string; name: string; done: boolean; stage: string }[];
  milestones: { id: string; name: string }[] | null;
  steps: { steps: StepDto[]; progress: StepProgress; canEdit: boolean } | null;
  remind: boolean;
  lockedFields: boolean;
  lens: RewardLens;
  /** the reward card's facts, only while `lens.rewards` and the task carries a reward */
  reward: {
    status: "OPEN" | "AWARDED" | "CANCELLED";
    amountMinor: number | null;
    currency: string | null;
    note: string | null;
    completed: boolean;
    awardedToName: string | null;
    awardedAt: string | null;
    cancelReason: string | null;
  } | null;
  /** the people a reward may go to (the task's holders), only with the reward */
  rewardPeople: { id: string; name: string }[];
  /** what the page's own cards need to look themselves up */
  internal: { orgId: string; viewerOrgRole: string | null; viewerSpaceRole: string | null; holderIds: string[]; ownerOutsideSpace: boolean };
}

export type TaskSheetResult = { kind: "ok"; sheet: TaskSheet } | { kind: "notFound" } | { kind: "off" };

export async function taskSheetFor(userId: string, actor: Actor, taskId: string): Promise<TaskSheetResult> {
  // workspace membership and the project's team gate task access (writes go through the API's own role checks)
  const scope = await loadWorkScope(userId);
  const task = await db.task.findFirst({
    where: { id: taskId, AND: [taskVisibleWhere(scope)] },
    include: {
      labels: { select: { label: true } },
      assignee: { select: { id: true, name: true } },
      // «لمين» with more than one person: the others, in the order they were picked
      coAssignees: { select: { userId: true }, orderBy: { createdAt: "asc" } },
      creator: { select: { id: true, name: true } },
      organization: { select: { keyPrefix: true } },
      milestone: { select: { id: true, name: true } },
      column: { select: { name: true, done: true, board: { select: { id: true, name: true } } } },
      comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, name: true } } } },
    },
  });
  if (!task) return { kind: "notFound" };
  // the tasks row of the person's grid
  if (!actorCanWork(actor, "tasks.view")) return { kind: "off" };

  const [membership, spaceRow] = await Promise.all([
    db.organizationMember.findFirst({ where: { userId, organizationId: task.orgId, status: "ACTIVE" }, select: { role: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: task.workspaceId, userId } }, select: { role: true } }),
  ]);
  // editable exactly when the API would let the person write in this space: an org guest never writes, a space guest row makes even a
  // member read-only, and being the creator or the assignee changes nothing (the server refuses a write the screen would have offered)
  const canEdit = membership ? canWriteInWorkspace(membership.role, spaceRow?.role) && actorCanWork(actor, "tasks.edit") : false;
  // the owner reading a space he is not in: a tick or a series carries a name and a time, silent reading leaves no trace
  const ownerOutsideSpace = membership?.role === "OWNER" && !spaceRow;

  const [milestonesOn, stepsOn, remind, lens, pending] = await Promise.all([
    actorFeatureOn(actor, "milestones"),
    actorFeatureOn(actor, "taskSteps"),
    actorFeatureOn(actor, "reminders"),
    rewardLensFor(actor, task.workspaceId),
    pendingRequestsOf(task.id),
  ]);

  const [milestones, steps, members, labels, columns] = await Promise.all([
    milestonesOn
      ? db.milestone.findMany({ where: { projectId: task.projectId }, orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } })
      : Promise.resolve(null),
    stepsOn ? stepsOfTask(task.id) : Promise.resolve(null),
    // the people who can be assigned: the space's members still ACTIVE in the company (a suspended person keeps their space row so that
    // reactivating them restores everything, but they must not be offered)
    db.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId, user: { memberships: { some: { organizationId: task.orgId, status: "ACTIVE" } } } },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.label.findMany({ where: { orgId: task.orgId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    db.boardColumn.findMany({ where: { boardId: task.column.board.id }, orderBy: { position: "asc" }, select: { id: true, name: true, done: true, stage: true } }),
  ]);

  // the ranks of the people offered: somebody above the viewer is only ASKED (marked «طلب» in the picker)
  const ranks = await db.organizationMember.findMany({
    where: { organizationId: task.orgId, status: "ACTIVE", userId: { in: members.map((m) => m.user.id) } },
    select: { userId: true, role: true },
  });
  const roleOf = new Map(ranks.map((r) => [r.userId, r.role]));

  // a request to give this task to somebody of a higher rank, and what the viewer may do with it (each one read for the viewer)
  const assignRequests = pending.flatMap((r) => {
    const mode: RequestMode | null = r.toUserId === userId ? "addressee" : membership?.role === "OWNER" ? "owner" : r.fromUserId === userId ? "waiting" : null;
    return mode ? [{ id: r.id, mode, fromName: r.fromName, toName: r.toName }] : [];
  });

  // «مهمة بمكافأة»: what this person may be shown, from the database. A partner is handed no reward at all.
  const rewardStatus = isRewardTaskStatus(task.rewardStatus) ? task.rewardStatus : null;
  // a reward task is the owner's: everybody else reads the title, the day and the rest (the server refuses their writes anyway)
  const lockedFields = lens.pins && rewardStatus !== null && !lens.owner;
  const holderIds = [...(task.assigneeId ? [task.assigneeId] : []), ...task.coAssignees.map((r) => r.userId)];
  const awardedToId = task.rewardAwardedToId;
  const rewardPeopleRows =
    lens.rewards && rewardStatus
      ? await db.user.findMany({ where: { id: { in: [...new Set([...holderIds, ...(awardedToId ? [awardedToId] : [])])] } }, select: { id: true, name: true } })
      : [];
  const nameOf = new Map(rewardPeopleRows.map((p) => [p.id, p.name]));
  const reward =
    lens.rewards && rewardStatus
      ? {
          status: rewardStatus,
          amountMinor: task.rewardAmountMinor,
          currency: task.rewardCurrency,
          note: task.rewardNote,
          completed: task.completedAt != null,
          awardedToName: awardedToId ? (nameOf.get(awardedToId) ?? null) : null,
          awardedAt: task.rewardAwardedAt?.toISOString() ?? null,
          cancelReason: task.rewardCancelReason,
        }
      : null;

  return {
    kind: "ok",
    sheet: {
      task: {
        id: task.id,
        number: task.number,
        key: `${task.organization.keyPrefix}-${task.number}`,
        title: task.title,
        description: task.description,
        priority: task.priority,
        type: task.type,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        boardId: task.column.board.id,
        boardName: task.column.board.name,
        columnId: task.columnId,
        status: task.column.name,
        columnDone: task.column.done,
        dueDate: task.dueDate?.toISOString() ?? null,
        startDate: task.startDate?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        creatorId: task.creator.id,
        creatorName: task.creator.name,
        visibility: task.visibility,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee?.name ?? null,
        assigneeIds: holderIds,
        milestoneId: task.milestoneId,
        milestoneName: task.milestone?.name ?? null,
        labelIds: task.labels.map((l) => l.label.id),
        pinned: task.pinnedAt != null,
        comments: task.comments.map((c) => ({ id: c.id, author: c.author.name, authorId: c.author.id, body: c.body, createdAt: c.createdAt.toISOString() })),
      },
      canEdit,
      viewerId: userId,
      members: members.map((m) => {
        const role = roleOf.get(m.user.id);
        return { id: m.user.id, name: m.user.name, request: !!membership && m.user.id !== userId && role !== undefined && isRequestTo(membership.role, role) };
      }),
      assignRequests,
      labels,
      columns,
      milestones,
      steps: steps ? { steps: steps.steps, progress: steps.progress, canEdit: canEdit && !ownerOutsideSpace } : null,
      remind,
      lockedFields,
      lens,
      reward,
      rewardPeople: reward ? holderIds.flatMap((id) => (nameOf.get(id) ? [{ id, name: nameOf.get(id)! }] : [])) : [],
      internal: { orgId: task.orgId, viewerOrgRole: membership?.role ?? null, viewerSpaceRole: spaceRow?.role ?? null, holderIds, ownerOutsideSpace },
    },
  };
}
