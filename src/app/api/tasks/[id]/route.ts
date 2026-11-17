import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { db } from "@/server/db";
import { requireTaskAccess, audit, ForbiddenError, NotFoundError } from "@/server/auth";
import { userSeesProject } from "@/server/services/team-scope";
import { withApi } from "@/server/api";
import { parseJson, priorities, taskTypes } from "@/server/validation";
import { updateTask, deleteTask } from "@/server/services/tasks";
import { assertActiveAssignee } from "@/server/services/active-people";
import { orgTimeZone } from "@/server/services/org-day";
import { dueInstantForDay, parseDayText } from "@/lib/due-day";
import { notifyAssignment } from "@/server/notify";
import { rewardsVisibleTo, setReward } from "@/server/services/rewards";
import { rewardBodySchema, toRewardRequest } from "@/server/services/reward-input";
import { withoutReward } from "@/server/policy/reward";

/**
 * A due (or start) date the API accepts: a full instant (`2026-11-05T09:00:00Z`) or a plain day
 * (`2026-11-05` — the date box). A plain day is noon in the COMPANY's zone; the browser's zone never
 * decides which day a person picked (review B5).
 */
async function dueFromInput(orgId: string, value: string | null | undefined): Promise<Date | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (parseDayText(value)) return dueInstantForDay(value, await orgTimeZone(orgId));
  return new Date(value);
}


export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    // its space, then its project's team: outside the team it is «not found»
    const access = await requireTaskAccess(params.id);
    await assertMemberCan(access, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
    const task = await db.task.findFirst({
      where: { id: params.id },
      include: {
        labels: { select: { label: true } },
        assignee: { select: { id: true, name: true } },
        coAssignees: { select: { userId: true, user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
        creator: { select: { id: true, name: true } },
        milestone: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, name: true } } } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { actor: { select: { id: true, name: true } } },
        },
        dependencies: {
          select: { id: true, kind: true, dependsOn: { select: { id: true, title: true, number: true } } },
        },
        _count: { select: { comments: true } },
      },
    });
    if (!task) throw new NotFoundError("task.not_found");
    // «مهمة بمكافأة»: an external partner (or a switch that is off) is handed the task with no reward field at all
    return NextResponse.json({ task: (await rewardsVisibleTo(access, task.workspaceId)) ? task : withoutReward(task) });
  });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(280).optional(),
  description: z.string().max(10_000).nullable().optional(),
  priority: z.enum(priorities).optional(),
  type: z.enum(taskTypes).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  /** «لمين» with more than one person: the full ordered list, the first is the primary (`assigneeId`). */
  assigneeIds: z.array(z.string().min(1)).max(50).optional(),
  /** The people beside the primary, when the primary is sent on its own (`assigneeId` + these). */
  coAssigneeIds: z.array(z.string().min(1)).max(50).optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
  /** A milestone of THIS task's project, or null to detach it (`updateTask` refuses another project's). */
  milestoneId: z.string().min(1).nullable().optional(),
  archived: z.boolean().optional(),
  labelIds: z.array(z.string().min(1)).max(15).optional(),
  /** «مهمة بمكافأة»: the OWNER's alone (403 `reward.owner_only`); a day must exist (the task's or `dueDate` here). */
  reward: rewardBodySchema.optional(),
  /** «مين بيشوفها؟»: its creator, a manager of its space or of its assignee, or oversight (403 `task.visibility_denied`). */
  visibility: z.enum(["SPACE", "PARTICIPANTS"]).optional(),
  /** publishing a task made from a private conversation: the person confirmed (422 `work.confirm_public_required` otherwise) */
  confirmPublic: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const ctx = await requireTaskAccess(params.id, ["ADMIN", "MEMBER"]);
    // «مهمة بمكافأة»: a reward is the owner's: refused (403 / 404 / 422) BEFORE any other field of the request is written
    if (input.reward) {
      await setReward(ctx, params.id, { ...toRewardRequest(input.reward), dueDate: await dueFromInput(ctx.orgId, input.dueDate) });
    }
    const prev = await db.task.findUnique({
      where: { id: params.id },
      select: {
        assigneeId: true,
        number: true,
        orgId: true,
        coAssignees: { select: { userId: true } },
      },
    });
    // «لمين» with more than one person: `assigneeIds` is the whole list (the first is the primary); without it
    // the old single box and the extras keep working exactly as before.
    const people = input.assigneeIds
      ? [...new Set(input.assigneeIds)]
      : null;
    const primary = people ? (people[0] ?? null) : input.assigneeId;
    const coIds = people ? people.slice(1) : input.coAssigneeIds;
    const held = new Set([...(prev?.assigneeId ? [prev.assigneeId] : []), ...(prev?.coAssignees ?? []).map((r) => r.userId)]);
    // Handing the task to somebody NEW: they must be an ACTIVE member of the org (never a stranger,
    // never someone who was suspended or has left). Re-sending somebody who already holds it, who may have
    // been suspended since, changes nothing: work somebody holds stays editable until it is moved.
    const newcomers = [...new Set([...(primary ? [primary] : []), ...(coIds ?? [])])].filter((id) => !held.has(id));
    for (const userId of newcomers) {
      await assertActiveAssignee(ctx.orgId, userId);
      // a team's task goes to somebody who sees that team's work (its members and the space's managers)
      if (ctx.task.teamId && !(await userSeesProject(userId, ctx.task))) throw new ForbiddenError("assignee.not_in_team");
    }
    const task = await updateTask(ctx, params.id, {
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority,
      type: input.type,
      assigneeId: people ? primary : input.assigneeId === null ? null : input.assigneeId,
      coAssigneeIds: coIds === undefined ? undefined : coIds,
      dueDate: await dueFromInput(ctx.orgId, input.dueDate),
      startDate: await dueFromInput(ctx.orgId, input.startDate),
      milestoneId: input.milestoneId === null ? null : input.milestoneId,
      archived: input.archived,
      labelIds: input.labelIds,
      visibility: input.visibility,
      confirmPublic: input.confirmPublic,
    });
    await audit("task.updated", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    // only the people the task REALLY went to are told: a person of a higher rank was asked instead (task-assign.ts)
    const holds = (id: string) => task.assigneeId === id || task.coAssignees.some((r) => r.userId === id);
    const toTell = newcomers.filter((id) => id !== ctx.userId && holds(id));
    if (toTell.length) {
      const orgPrefix = await orgPrefixOf(prev?.orgId ?? task.orgId);
      for (const assigneeId of toTell) {
        await notifyAssignment({
          assigneeId,
          taskNumber: prev?.number ?? 0,
          orgPrefix,
          taskId: task.id,
          title: task.title,
          workspaceId: ctx.task.workspaceId,
        });
      }
    }
    return NextResponse.json({ task });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireTaskAccess(params.id, ["ADMIN"]);
    await deleteTask(ctx, params.id);
    await audit("task.deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json({ ok: true });
  });
}

async function orgPrefixOf(orgId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { keyPrefix: true },
  });
  return org?.keyPrefix ?? "ZW";
}
