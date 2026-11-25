import { notFound, redirect } from "next/navigation";
import { pageUser } from "@/server/auth";
import { db } from "@/server/db";
import { requireActor } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { SectionOffNotice } from "@/app/(app)/_access";
import { keepInSpace } from "@/server/services/current-space";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { TaskDetail } from "@/components/task-detail";
import { taskSheetFor } from "@/server/services/task-sheet";
import { defaultCurrencyOf } from "@/server/services/rewards";
import { RewardCard } from "@/components/rewards/reward-card";
import { PinButton } from "@/components/rewards/pin-button";
import { buildTaskTimeCard } from "@/server/services/time-tracking";
import { recurrenceOfTask } from "@/server/services/task-recurrence";
import { taskFieldsCard } from "@/server/services/custom-fields";
import { TaskFieldsCard } from "@/components/custom-fields/task-fields-card";
import { approvalsLinkedTo } from "@/server/services/approvals";
import { LinkedApprovals } from "@/components/approvals/linked-approvals";

/**
 * The task page. What the sheet shows (the task, who may edit, the people offered for «لمين» with their «طلب», the pending requests, the
 * labels, the steps, the reward) is `taskSheetFor` — the same service the phone reads through `GET /api/tasks/[id]/sheet`, so the two never
 * disagree. The cards with their own switches (time, recurrence, custom fields, linked approvals, dependencies) are read here.
 */
export default async function TaskPage({ params }: { params: { id: string } }) {
  const user = await pageUser();
  if (!user) redirect("/login");
  const actor = await requireActor();

  const result = await taskSheetFor(user.id, actor, params.id);
  if (result.kind === "notFound") notFound();
  // the tasks row of the person's grid
  if (result.kind === "off") return <SectionOffNotice />;
  const sheet = result.sheet;
  const task = sheet.task;
  const { orgId, viewerOrgRole, viewerSpaceRole, ownerOutsideSpace } = sheet.internal;
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  await keepInSpace(actor, task.workspaceId, `/tasks/${task.id}`);

  // «التبعيات»: the switch decides whether the card exists at all, and the picker offers the other
  // tasks of the SAME space that this person may see (the team rule, not the whole company)
  const linksOn = await actorFeatureOn(actor, "taskLinks");
  // «الوقت»: the card exists only while the switch is on, and never for an external partner (an org guest, or a guest row of
  // the space); the owner reading a space he is not in sees it without the buttons
  const timeOn = (await actorFeatureOn(actor, "timeTracking")) && !actor.isExternal && viewerSpaceRole !== "GUEST";
  const archived = (await db.task.findUnique({ where: { id: task.id }, select: { archived: true } }))?.archived ?? false;
  const timeCard = timeOn
    ? await buildTaskTimeCard(
        { userId: user.id, orgId, orgRole: viewerOrgRole ?? actor.role, spaceRole: viewerSpaceRole, workspaceId: task.workspaceId, archived },
        task.id,
      )
    : null;
  // «تكرار»: drawn only while the switch is on; who may change it is who may edit the task, except that the owner reading a
  // space he is not in does not (a series acts as the person who set it: silent reading leaves no trace)
  const recurrenceOn = await actorFeatureOn(actor, "recurringTasks");
  const recurrence = recurrenceOn ? await recurrenceOfTask(task.id, orgId) : null;

  // «حقول مخصصة»: the project's fields and this task's values. `null` while the switch is off, empty for an external partner
  // (no field, no money). Editable by whoever may edit the task, except the owner reading a space he is not in, and a reward
  // task stays the owner's (`lockedFields`: the server refuses the others anyway)
  const fieldsCard = await taskFieldsCard({ orgId, userId: user.id, orgRole: viewerOrgRole ?? actor.role }, { id: task.id, projectId: task.projectId, workspaceId: task.workspaceId });

  // «طلب موافقة»: the requests about this task that the person may read, and the button to ask a new one. `null` (nothing drawn) while
  // the switch is off or for an external partner
  const linkedApprovals = await approvalsLinkedTo(actor, "TASK", task.id, task.workspaceId);

  const defaultCurrency = sheet.lens.owner ? await defaultCurrencyOf(orgId) : null;

  // the other tasks of this space, in the same team scope the sheet itself was read with
  const linkCandidates = linksOn
    ? await db.task.findMany({
        where: { workspaceId: task.workspaceId, id: { not: task.id }, archived: false, AND: [taskVisibleWhere(await loadWorkScope(user.id))] },
        select: { id: true, number: true, title: true, organization: { select: { keyPrefix: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];

  return (
    <TaskDetail
      task={{
        id: task.id,
        number: task.number,
        key: task.key,
        title: task.title,
        description: task.description,
        priority: task.priority,
        type: task.type,
        status: task.status,
        boardId: task.boardId,
        boardName: task.boardName,
        dueDate: task.dueDate,
        creatorName: task.creatorName,
        visibility: task.visibility,
        assigneeId: task.assigneeId,
        assigneeName: task.assigneeName,
        assigneeIds: task.assigneeIds,
        milestoneId: task.milestoneId,
        milestoneName: task.milestoneName,
        labelIds: task.labelIds,
        comments: task.comments,
      }}
      canEdit={sheet.canEdit}
      currentUserId={user.id}
      members={sheet.members}
      assignRequests={sheet.assignRequests}
      labels={sheet.labels}
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
      milestones={sheet.milestones}
      steps={sheet.steps ? { initial: sheet.steps.steps, canEdit: sheet.steps.canEdit } : null}
      remind={sheet.remind}
      lockedFields={sheet.lockedFields}
      rewardSlot={
        sheet.lens.rewards && (sheet.reward || sheet.lens.owner) ? (
          <RewardCard
            taskId={task.id}
            reward={sheet.reward ? { ...sheet.reward, dueDate: task.dueDate } : null}
            owner={sheet.lens.owner}
            people={sheet.rewardPeople}
            defaultCurrency={defaultCurrency}
          />
        ) : null
      }
      pinSlot={sheet.lens.canPin ? <PinButton taskId={task.id} pinned={task.pinned} /> : null}
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
            canEdit={sheet.canEdit && !sheet.lockedFields && !ownerOutsideSpace}
          />
        ) : null
      }
      recurrence={recurrence ? { initial: recurrence.recurrence, timeZone: recurrence.timeZone, canEdit: sheet.canEdit && !ownerOutsideSpace } : null}
    />
  );
}
