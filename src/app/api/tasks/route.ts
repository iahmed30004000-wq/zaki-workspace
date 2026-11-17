import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { teamFilterInSpace } from "@/server/services/team-scope";
import { parseJson, priorities, taskTypes } from "@/server/validation";
import { createTask, listTasks } from "@/server/services/tasks";
import { orgTimeZone } from "@/server/services/org-day";
import { dueInstantForDay, parseDayText } from "@/lib/due-day";
import { dispatchEvent } from "@/server/services/n8n";
import { rewardsVisibleTo } from "@/server/services/rewards";
import { rewardBodySchema, toRewardRequest } from "@/server/services/reward-input";
import { withoutReward } from "@/server/policy/reward";

const createSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1).optional(),
  title: z.string().trim().min(1, "title.required").max(280),
  description: z.string().max(10_000).optional().nullable(),
  priority: z.enum(priorities).optional(),
  type: z.enum(taskTypes).optional(),
  assigneeId: z.string().min(1).optional().nullable(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).optional().nullable(),
  labels: z.array(z.string().min(1)).max(10).optional(),
  /** «مهمة بمكافأة»: the OWNER's alone; needs `dueDate` (src/server/services/rewards.ts). */
  reward: rewardBodySchema.optional(),
  /** «مين بيشوفها؟»: the whole space, or «المعنيين بس». Absent: the company's default. */
  visibility: z.enum(["SPACE", "PARTICIPANTS"]).optional(),
});

export interface ListFilters {
  projectId?: string;
  boardId?: string;
  assigneeId?: string;
  overdue?: boolean;
  limit: number;
  cursor?: string;
}

const listSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  assigneeId: z.string().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const filters = listSchema.parse(Object.fromEntries(url.searchParams));
    const ctx = await requireWorkspace(filters.workspaceId);
    if (filters.overdue) requireValidOverdue();
    const tasks = await listTasks(ctx, {
      // the space the caller was checked for, and only the projects they see in it (teams)
      workspaceId: filters.workspaceId,
      project: await teamFilterInSpace(ctx.userId, filters.workspaceId, ctx.spaceManager === true),
      projectId: filters.projectId,
      boardId: filters.boardId,
      assigneeId: filters.assigneeId,
      overdue: filters.overdue === "true",
      limit: filters.limit,
      cursor: filters.cursor,
    });
    // «مهمة بمكافأة»: an external partner (or a switch that is off) is handed rows with no reward field at all
    const shown = (await rewardsVisibleTo(ctx, filters.workspaceId)) ? tasks : tasks.map((t) => withoutReward(t));
    return NextResponse.json({ tasks: shown, hasMore: tasks.length === filters.limit });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const ctx = await requireWorkspace(input.workspaceId, ["ADMIN", "MEMBER"]);
    // a plain day ("2026-11-05", the date box) is noon in the COMPANY's zone, never the browser's (review B5)
    const dueDate = input.dueDate
      ? parseDayText(input.dueDate)
        ? dueInstantForDay(input.dueDate, await orgTimeZone(ctx.orgId))
        : new Date(input.dueDate)
      : null;
    const task = await createTask(ctx, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      type: input.type,
      assigneeId: input.assigneeId ?? null,
      dueDate,
      labelIds: reqLabels(input),
      reward: input.reward ? toRewardRequest(input.reward) : undefined,
      visibility: input.visibility,
    });
    await audit("task.created", {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      target: task.id,
    });
    await dispatchEvent(ctx.orgId, "task.created", { taskId: task.id, number: task.number, title: task.title });
    return NextResponse.json({ task }, { status: 201 });
  });
}

/**
 * Labels are passed through untyped in createSchema so that both
 * `labels` (ids) and `labelIds` keep a single canonical shape for the service.
 */
function reqLabels(input: z.infer<typeof createSchema>): string[] {
  return Object.hasOwn(input, "labels") ? (input.labels ?? []) : [];
}

function requireValidOverdue(): void {
  // overdue filtering is validated inside listTasks; keep hook for policy
}
