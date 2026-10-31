import { notFound, redirect } from "next/navigation";
import { pageUser } from "@/server/auth";
import { db } from "@/server/db";
import { actorCanWork, requireActor } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { SectionOffNotice } from "@/app/(app)/_access";
import { keepInSpace } from "@/server/services/current-space";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { TaskDetail } from "@/components/task-detail";
import type { RequestBannerMode } from "@/components/task-assign-request-banner";
import { isRequestTo } from "@/server/policy/assign-rank";
import { pendingRequestsOf } from "@/server/services/task-assign";
import { stepsOfTask } from "@/server/services/task-steps";
import { defaultCurrencyOf, rewardLensFor } from "@/server/services/rewards";
import { isRewardTaskStatus } from "@/lib/rewards";
import { RewardCard, type RewardCardData } from "@/components/rewards/reward-card";
import { PinButton } from "@/components/rewards/pin-button";
import { buildTaskTimeCard } from "@/server/services/time-tracking";
import { recurrenceOfTask } from "@/server/services/task-recurrence";
import { taskFieldsCard } from "@/server/services/custom-fields";
import { TaskFieldsCard } from "@/components/custom-fields/task-fields-card";
import { approvalsLinkedTo } from "@/server/services/approvals";
import { LinkedApprovals } from "@/components/approvals/linked-approvals";

export default async function TaskPage({ params }: { params: { id: string } }) {
  const user = await pageUser();
  if (!user) redirect("/login");

  // Workspace membership gates task access (writes go through API role checks).
  // Workspace membership and the project's team gate task access (writes go through API role checks).
  const scope = await loadWorkScope(user.id);
  const task = await db.task.findFirst({
    where: { id: params.id, AND: [taskVisibleWhere(scope)] },
    include: {
      labels: { select: { label: true } },
      assignee: { select: { id: true, name: true } },
      // «لمين» with more than one person: the others, in the order they were picked
      coAssignees: { select: { userId: true }, orderBy: { createdAt: "asc" } },
      creator: { select: { id: true, name: true } },
      organization: { select: { keyPrefix: true } },
      milestone: { select: { id: true, name: true } },
      column: {
        select: { name: true, board: { select: { id: true, name: true } } },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  });
  if (!task) notFound();
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  const actor = await requireActor();
  // the tasks row of the person's grid
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;
  await keepInSpace(actor, task.workspaceId, `/tasks/${task.id}`);

  // Editable exactly when the API would let the person write in this space (the same rule as the
  // board page): the real organization rank and the real row in the space. An org guest never
  // writes, a space guest row makes even a member read-only, and being the creator or the assignee
  // of the task changes nothing - the server refuses a write the screen would have offered.
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id, organizationId: task.orgId, status: "ACTIVE" },
    select: { role: true },
  });
  const spaceRow = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: task.workspaceId, userId: user.id } },
    select: { role: true },
  });
  // the space's rule, and the tasks row's «يضيف ويعدّل» box of the section grid
  const canEdit = membership ? canWriteInWorkspace(membership.role, spaceRow?.role) && actorCanWork(actor, "tasks.edit") : false;

  // «التبعيات»: the switch decides whether the card exists at all, and the picker offers the other
  // tasks of the SAME space that this person may see (the team rule, not the whole company)
  const linksOn = await actorFeatureOn(actor, "taskLinks");
  // «المعالم»: the picker on the task is drawn only while the company's switch is on, and only when the
  // task's project actually has milestones to point at
  const milestonesOn = await actorFeatureOn(actor, "milestones");
  const projectMilestones = milestonesOn
    ? await db.milestone.findMany({
        where: { projectId: task.projectId },
        orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true },
      })
    : [];

  // «الخطوات»: the card exists only while the switch is on. Who may tick is who may edit the task, except that the owner
  // reading a space he is not in does not (a tick carries a name and a time: silent reading leaves no trace)
  const stepsOn = await actorFeatureOn(actor, "taskSteps");
  const steps = stepsOn ? await stepsOfTask(task.id) : null;
  const remindOn = await actorFeatureOn(actor, "reminders");
  // «الوقت»: the card exists only while the switch is on, and never for an external partner (an org guest, or a guest row of
  // the space); the owner reading a space he is not in sees it without the buttons
  const timeOn = (await actorFeatureOn(actor, "timeTracking")) && !actor.isExternal && spaceRow?.role !== "GUEST";
  const timeCard = timeOn
    ? await buildTaskTimeCard(
        { userId: user.id, orgId: task.orgId, orgRole: membership?.role ?? actor.role, spaceRole: spaceRow?.role, workspaceId: task.workspaceId, archived: task.archived },
        task.id,
      )
    : null;
  // «تكرار»: drawn only while the switch is on; who may change it is who may edit the task, except that the owner reading a
  // space he is not in does not (a series acts as the person who set it: silent reading leaves no trace)
  const recurrenceOn = await actorFeatureOn(actor, "recurringTasks");
  const recurrence = recurrenceOn ? await recurrenceOfTask(task.id, task.orgId) : null;

  // «حقول مخصصة»: the project's fields and this task's values. `null` while the switch is off, empty for an external partner
  // (no field, no money). Editable by whoever may edit the task, except the owner reading a space he is not in, and a reward
  // task stays the owner's (`lockedFields`: the server refuses the others anyway)
  const fieldsCard = await taskFieldsCard({ orgId: task.orgId, userId: user.id, orgRole: membership?.role ?? actor.role }, { id: task.id, projectId: task.projectId, workspaceId: task.workspaceId });

  // «طلب موافقة»: the requests about this task that the person may read, and the button to ask a new one. `null` (nothing drawn) while
  // the switch is off or for an external partner
  const linkedApprovals = await approvalsLinkedTo(actor, "TASK", task.id, task.workspaceId);

  // a request to give this task to somebody of a higher rank, and what the viewer may do with it
  // (a task may hold several: the main one and one per higher person beside the first; each is read for the viewer)
  const pending = await pendingRequestsOf(task.id);
  const requestBanners = pending.flatMap((r) => {
    const mode: RequestBannerMode | null = r.toUserId === user.id ? "addressee" : membership?.role === "OWNER" ? "owner" : r.fromUserId === user.id ? "waiting" : null;
    return mode ? [{ id: r.id, mode, fromName: r.fromName, toName: r.toName }] : [];
  });

  // «مهمة بمكافأة» and «تثبيت»: what this person may be shown and do, from the database. A partner is handed no reward at all.
  const lens = await rewardLensFor(actor, task.workspaceId);
  const rewardStatus = isRewardTaskStatus(task.rewardStatus) ? task.rewardStatus : null;
  // a reward task is the owner's: everybody else reads the title, the day and the rest (the server refuses their writes anyway)
  const lockedFields = lens.pins && rewardStatus !== null && !lens.owner;
  const holderIds = [...(task.assigneeId ? [task.assigneeId] : []), ...task.coAssignees.map((r) => r.userId)];
  const awardedToId = task.rewardAwardedToId;
  const rewardPeople =
    lens.rewards && rewardStatus
      ? await db.user.findMany({ where: { id: { in: [...new Set([...holderIds, ...(awardedToId ? [awardedToId] : [])])] } }, select: { id: true, name: true } })
      : [];
  const nameOf = new Map(rewardPeople.map((p) => [p.id, p.name]));
  const rewardData: RewardCardData | null =
    lens.rewards && rewardStatus
      ? {
          status: rewardStatus,
          amountMinor: task.rewardAmountMinor,
          currency: task.rewardCurrency,
          note: task.rewardNote,
          dueDate: task.dueDate?.toISOString() ?? null,
          completed: task.completedAt != null,
          awardedToName: awardedToId ? (nameOf.get(awardedToId) ?? null) : null,
          awardedAt: task.rewardAwardedAt?.toISOString() ?? null,
          cancelReason: task.rewardCancelReason,
        }
      : null;
  const defaultCurrency = lens.owner ? await defaultCurrencyOf(task.orgId) : null;

  const [members, labels, linkCandidates] = await Promise.all([
    // the people who can be assigned: the space's members who are still ACTIVE in the company (a
    // suspended person keeps their space row so that reactivating them restores everything, but
    // they must not be offered)
    db.workspaceMember.findMany({
      where: {
        workspaceId: task.workspaceId,
        user: { memberships: { some: { organizationId: task.orgId, status: "ACTIVE" } } },
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.label.findMany({
      where: { orgId: task.orgId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    // the other tasks of this space, in the same team scope the page itself was read with
    linksOn
      ? db.task.findMany({
          where: {
            workspaceId: task.workspaceId,
            id: { not: task.id },
            archived: false,
            AND: [taskVisibleWhere(scope)],
          },
          select: { id: true, number: true, title: true, organization: { select: { keyPrefix: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  // the ranks of the people offered: somebody above the viewer is only ASKED (marked «طلب» in the picker)
  const ranks = await db.organizationMember.findMany({
    where: { organizationId: task.orgId, status: "ACTIVE", userId: { in: members.map((m) => m.user.id) } },
    select: { userId: true, role: true },
  });
  const roleOf = new Map(ranks.map((r) => [r.userId, r.role]));

  return (
    <TaskDetail
      task={{
        id: task.id,
        number: task.number,
        key: `${task.organization.keyPrefix}-${task.number}`,
        title: task.title,
        description: task.description,
        priority: task.priority,
        type: task.type,
        status: task.column.name,
        boardId: task.column.board.id,
        boardName: task.column.board.name,
        dueDate: task.dueDate?.toISOString() ?? null,
        creatorName: task.creator.name,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee?.name ?? null,
        assigneeIds: [...(task.assigneeId ? [task.assigneeId] : []), ...task.coAssignees.map((r) => r.userId)],
        milestoneId: task.milestoneId,
        milestoneName: task.milestone?.name ?? null,
        labelIds: task.labels.map((l) => l.label.id),
        comments: task.comments.map((c) => ({
          id: c.id,
          author: c.author.name,
          authorId: c.author.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
      }}
      canEdit={canEdit}
      currentUserId={user.id}
      members={members.map((m) => {
        const role = roleOf.get(m.user.id);
        return { id: m.user.id, name: m.user.name, request: !!membership && m.user.id !== user.id && role !== undefined && isRequestTo(membership.role, role) };
      })}
      assignRequests={requestBanners}
      labels={labels}
      links={
        linksOn
          ? {
              candidates: linkCandidates.map((c) => ({
                id: c.id,
                key: `${c.organization.keyPrefix}-${c.number}`,
                title: c.title,
              })),
            }
          : null
      }
      milestones={milestonesOn ? projectMilestones : null}
      steps={steps ? { initial: steps.steps, canEdit: canEdit && !(membership?.role === "OWNER" && !spaceRow) } : null}
      remind={remindOn}
      lockedFields={lockedFields}
      rewardSlot={
        lens.rewards && (rewardData || lens.owner) ? (
          <RewardCard
            taskId={task.id}
            reward={rewardData}
            owner={lens.owner}
            people={holderIds.flatMap((id) => (nameOf.get(id) ? [{ id, name: nameOf.get(id)! }] : []))}
            defaultCurrency={defaultCurrency}
          />
        ) : null
      }
      pinSlot={lens.canPin ? <PinButton taskId={task.id} pinned={task.pinnedAt != null} /> : null}
      time={timeCard}
      approvalsSlot={
        linkedApprovals ? <LinkedApprovals kind="TASK" id={task.id} workspaceId={task.workspaceId} canAsk={linkedApprovals.canAsk} items={linkedApprovals.items} /> : null
      }
      customFieldsSlot={
        fieldsCard && fieldsCard.fields.length > 0 ? (
          <TaskFieldsCard
            taskId={task.id}
            fields={fieldsCard.fields}
            initialValues={fieldsCard.values}
            people={fieldsCard.people}
            canEdit={canEdit && !lockedFields && !(membership?.role === "OWNER" && !spaceRow)}
          />
        ) : null
      }
      recurrence={recurrence ? { initial: recurrence.recurrence, timeZone: recurrence.timeZone, canEdit: canEdit && !(membership?.role === "OWNER" && !spaceRow) } : null}
    />
  );
}
