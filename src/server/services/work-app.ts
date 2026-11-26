import { db } from "@/server/db";
import { actorCanWork, type Actor } from "@/server/policy/actor";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn, isFeatureOn } from "@/server/services/features";
import { INSTANT_PROJECT_KEY } from "@/server/services/instant-work";
import { loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, taskParticipantWhere, taskVisibleWhere } from "@/server/services/team-scope";
import { TASK_INCLUDE } from "@/server/services/tasks";
import { stepProgressFor } from "@/server/services/task-steps";
import { rewardLensFor } from "@/server/services/rewards";
import { listBadgeStatus } from "@/lib/rewards";
import { myRunningTaskId } from "@/server/services/time-tracking";
import { recurringTaskIds } from "@/server/services/task-recurrence";
import { fieldCellsFor } from "@/server/services/custom-fields";
import { pinnedTasks, type PinnedCard } from "@/server/services/pinned";
import { projectProgress } from "@/components/work/project/progress";
import { projectCardAccess, type ProjectCardAccess } from "@/app/(app)/projects/[id]/project-chrome";
import type { TaskCardData } from "@/components/board-view";
import { resolveTimeZone } from "@/lib/zoned-time";
import { fmtDueStamp, fmtStamp } from "@/lib/work/stamp";
import { isDueOverdue, isDueToday, dueTimeText, dueWallOfInstant } from "@/lib/due-day";

/**
 * M2 N3 — what the projects pages show, read ONCE for the page and for the phone's doors (the way `taskSheetFor` serves the task page and
 * `/api/tasks/[id]/sheet`). Nothing here decides anything new: the rules are the pages' own (`projectVisibleWhere`, `taskVisibleWhere`, the grid's
 * «المشاريع» / «المهام» rows, `canWriteInWorkspace`, the reward lens). A page keeps what only a browser needs (redirects, `keepInSpace`, the trail).
 */

export type ScreenResult<T> = { kind: "ok"; data: T } | { kind: "notFound" } | { kind: "off" };

// ---------------------------------------------------------------- the projects of the space the person is in

export interface ProjectRow {
  id: string;
  name: string;
  systemKey: string | null;
  description: string | null;
  status: string;
  priority: string;
  targetDate: string | null;
  workspaceName: string;
  tasks: number;
  boards: number;
  createdAt: string;
  createdById: string | null;
  createdByName: string | null;
}

export interface ProjectsScreen {
  /** The space the person is in (null: in none). */
  space: { id: string; name: string; description: string | null; manager: boolean } | null;
  /** «صندوق المهام» pinned on top (switch `workInbox`), not repeated in `projects`. */
  inboxes: ProjectRow[];
  projects: ProjectRow[];
  /** May offer «مشروع جديد»: the grid's projects row «يضيف ويعدّل» (the server still judges the space). */
  canCreate: boolean;
}

export async function projectsScreenFor(actor: Actor, opts: { sort?: "created" } = {}): Promise<ScreenResult<ProjectsScreen>> {
  if (!actorCanWork(actor, "projects.view")) return { kind: "off" };
  const space = await currentSpace(actor);
  const everything = await loadWorkScope(actor.userId);
  // the projects of the space the person is in — and inside a space with «مقاطع» only its own and theirs
  const scope = narrowScope(everything, space?.id);
  const accessible = scopeSpaceIds(scope);
  const canCreate = !actor.isExternal && actorCanWork(actor, "projects.edit");
  if (accessible.length === 0) return { kind: "ok", data: { space: null, inboxes: [], projects: [], canCreate } };
  const rows = await db.project.findMany({
    where: { workspaceId: { in: accessible }, status: { not: "ARCHIVED" }, AND: [projectVisibleWhere(scope)] },
    orderBy: opts.sort === "created" ? { createdAt: "desc" } : { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      systemKey: true,
      createdAt: true,
      createdById: true,
      description: true,
      status: true,
      priority: true,
      targetDate: true,
      workspace: { select: { name: true } },
      _count: { select: { tasks: { where: { archived: false, AND: [taskParticipantWhere(everything)] } }, boards: true } },
    },
  });
  const creatorIds = [...new Set(rows.flatMap((p) => (p.createdById ? [p.createdById] : [])))];
  const creators = new Map(
    (creatorIds.length ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name] as const),
  );
  const projects: ProjectRow[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    systemKey: p.systemKey,
    description: p.description,
    status: p.status,
    priority: p.priority,
    targetDate: p.targetDate ? p.targetDate.toISOString() : null,
    workspaceName: p.workspace.name,
    tasks: p._count.tasks,
    boards: p._count.boards,
    createdAt: p.createdAt.toISOString(),
    createdById: p.createdById,
    createdByName: p.createdById ? (creators.get(p.createdById) ?? null) : null,
  }));
  // «صندوق المهام» (W1.2, switch `workInbox`): drawn once, pinned on top; off: an ordinary card, as it was
  const inboxes = (await isFeatureOn(actor.orgId, "workInbox")) ? projects.filter((p) => p.systemKey === INSTANT_PROJECT_KEY) : [];
  const ordinary = inboxes.length > 0 ? projects.filter((p) => p.systemKey !== INSTANT_PROJECT_KEY) : projects;
  const one = accessible.length === 1 ? accessible[0]! : null;
  const info = one ? await db.workspace.findUnique({ where: { id: one }, select: { id: true, name: true, description: true } }) : null;
  return {
    kind: "ok",
    data: {
      space: info ? { id: info.id, name: info.name, description: info.description, manager: space?.id === info.id ? space.manager : false } : null,
      inboxes,
      projects: ordinary,
      canCreate,
    },
  };
}

// ---------------------------------------------------------------- one project: its head, boards, progress, what the person may do there

export interface ProjectScreen {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    targetDate: string | null;
    teamId: string | null;
    workspaceId: string;
    workspaceName: string;
    organizationId: string;
  };
  boards: { id: string; name: string; tasks: number }[];
  progress: { open: number; done: number; pct: number };
  access: ProjectCardAccess;
  pinned: PinnedCard[];
}

export async function projectScreenFor(actor: Actor, projectId: string): Promise<ScreenResult<ProjectScreen>> {
  const scope = await loadWorkScope(actor.userId);
  const visible = taskVisibleWhere(scope);
  const project = await db.project.findFirst({
    where: { id: projectId, AND: [projectVisibleWhere(scope)] },
    include: {
      // what is counted is what the person may open: a private task of somebody else is not (P0)
      boards: {
        where: { archived: false },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, _count: { select: { tasks: { where: { archived: false, AND: [visible] } } } } },
      },
      _count: { select: { tasks: { where: { archived: false, AND: [visible] } } } },
      workspace: { select: { id: true, name: true, organizationId: true } },
    },
  });
  if (!project) return { kind: "notFound" };
  // the projects row of the person's grid
  if (!actorCanWork(actor, "projects.view")) return { kind: "off" };
  const access = await projectCardAccess(actor, { workspaceId: project.workspace.id, organizationId: project.workspace.organizationId });
  const doneColumns = await db.boardColumn.findMany({ where: { board: { projectId: project.id }, done: true }, select: { id: true } });
  const doneCount = doneColumns.length
    ? await db.task.count({ where: { projectId: project.id, archived: false, columnId: { in: doneColumns.map((c) => c.id) }, AND: [visible] } })
    : 0;
  const lens = await rewardLensFor(actor, project.workspace.id);
  const pinned = await pinnedTasks(actor, { projectId: project.id }, lens);
  return {
    kind: "ok",
    data: {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        targetDate: project.targetDate ? project.targetDate.toISOString() : null,
        teamId: project.teamId,
        workspaceId: project.workspace.id,
        workspaceName: project.workspace.name,
        organizationId: project.workspace.organizationId,
      },
      boards: project.boards.map((b) => ({ id: b.id, name: b.name, tasks: b._count.tasks })),
      progress: projectProgress(project._count.tasks, doneCount),
      access,
      pinned,
    },
  };
}

// ---------------------------------------------------------------- one board: its columns and cards, as the Kanban draws them

export interface BoardScreen {
  board: { id: string; name: string; workspaceId: string; workspaceName: string; projectId: string; projectName: string };
  columns: { id: string; name: string; color: string; position: number; done: boolean }[];
  tasks: TaskCardData[];
  fieldDefs: NonNullable<Awaited<ReturnType<typeof fieldCellsFor>>>["defs"];
  /** Add, drag, edit: the space's rule and the tasks row's «يضيف ويعدّل» box (a guest never). */
  canEdit: boolean;
}

export async function boardScreenFor(actor: Actor, boardId: string): Promise<ScreenResult<BoardScreen>> {
  // its project's space and team: another team's board is «not found»
  const scope = await loadWorkScope(actor.userId);
  const board = await db.board.findFirst({
    where: { id: boardId, project: projectVisibleWhere(scope) },
    include: { project: { select: { id: true, name: true, workspace: { select: { id: true, name: true, organizationId: true } } } } },
  });
  if (!board) return { kind: "notFound" };
  // the projects row of the person's grid
  if (!actorCanWork(actor, "projects.view")) return { kind: "off" };
  const member = await db.organizationMember.findFirst({
    where: { organizationId: board.project.workspace.organizationId, userId: actor.userId, status: "ACTIVE" },
    select: { role: true },
  });
  if (!member) return { kind: "notFound" };
  const wsRow = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: board.project.workspace.id, userId: actor.userId } },
    select: { role: true },
  });

  const [columns, tasks, org] = await Promise.all([
    db.boardColumn.findMany({ where: { boardId: board.id }, orderBy: { position: "asc" }, select: { id: true, name: true, color: true, position: true, done: true } }),
    db.task.findMany({ where: { boardId: board.id, archived: false, AND: [taskVisibleWhere(scope)] }, orderBy: [{ position: "asc" }, { id: "asc" }], include: TASK_INCLUDE }),
    db.organization.findUnique({ where: { id: board.project.workspace.organizationId }, select: { keyPrefix: true, timezone: true } }),
  ]);
  const zone = resolveTimeZone(org?.timezone);
  const creators = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(tasks.map((t) => t.creatorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const),
  );

  // «٣ من ٥» on the cards: one grouped read for the whole board, and only while the company's switch is on
  const progress = (await actorFeatureOn(actor, "taskSteps")) ? await stepProgressFor(tasks.map((t) => t.id)) : new Map();
  // «الوقت شغّال» on the card of the task the person's own timer runs on
  const runningTaskId = await myRunningTaskId(actor);
  const lens = await rewardLensFor(actor, board.project.workspace.id);
  // «🔁 متكررة» on the cards: one read for the whole board, and only while the company's switch is on
  const recurring = (await actorFeatureOn(actor, "recurringTasks")) ? await recurringTaskIds(tasks.map((t) => t.id)) : new Set<string>();
  // «حقول مخصصة» on the cards: one read for the whole board; `null` while the switch is off and for an external partner
  const fieldCells = await fieldCellsFor(
    { orgId: actor.orgId, userId: actor.userId, orgRole: member.role },
    board.project.workspace.id,
    tasks.map((t) => ({ id: t.id, projectId: t.projectId })),
  );

  const taskData: TaskCardData[] = tasks.map((t) => ({
    id: t.id,
    key: `${org?.keyPrefix ?? "ZW"}-${t.number}`,
    title: t.title,
    priority: t.priority,
    columnId: t.columnId,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    dueTone: !t.dueDate || t.completedAt ? null : isDueOverdue(t.dueDate, zone) ? "late" : isDueToday(t.dueDate, zone) ? "today" : null,
    dueText: t.dueDate ? fmtDueStamp(t.dueDate, zone) : null,
    dueTime: t.dueDate ? dueTimeText(dueWallOfInstant(t.dueDate, zone)) : "",
    createdBy: creators.get(t.creatorId),
    createdText: fmtStamp(t.createdAt, zone),
    labels: t.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    assigneeNames: [...(t.assignee ? [t.assignee.name] : []), ...t.coAssignees.map((r) => r.user.name)],
    commentCount: t._count.comments,
    completed: t.completedAt != null,
    steps: progress.get(t.id),
    // «مهمة بمكافأة» / «تثبيت»: for a viewer who may see them, while the company's switch is on
    reward:
      lens.rewards && listBadgeStatus(t.rewardStatus) && t.rewardAmountMinor != null && t.rewardCurrency
        ? { status: t.rewardStatus as string, amountMinor: t.rewardAmountMinor, currency: t.rewardCurrency }
        : null,
    pinned: lens.pins && t.pinnedAt != null,
    running: t.id === runningTaskId,
    recurring: recurring.has(t.id),
    ...(fieldCells?.cells[t.id] ? { fields: fieldCells.cells[t.id] } : {}),
  }));

  return {
    kind: "ok",
    data: {
      board: {
        id: board.id,
        name: board.name,
        workspaceId: board.project.workspace.id,
        workspaceName: board.project.workspace.name,
        projectId: board.project.id,
        projectName: board.project.name,
      },
      columns,
      tasks: taskData,
      fieldDefs: fieldCells?.defs ?? [],
      // the space's rule, and the tasks row's «يضيف ويعدّل» box of the section grid (add, drag, edit)
      canEdit: canWriteInWorkspace(member.role, wsRow?.role) && actorCanWork(actor, "tasks.edit"),
    },
  };
}
