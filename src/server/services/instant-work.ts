import { Prisma, type TaskPriority } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { notifyAssignment } from "@/server/notify";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { spacesOf, type SpaceSubject } from "@/server/services/current-space";
import { createTask, DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";
import type { RewardRequest } from "@/server/services/rewards";

/**
 * «مهمة فورية» (the owner's ask, 2026-10-27: «+ بالمهام ومهمة فورية لشخص محدد مع أولوية»): a task typed in one go —
 * a title, the person, the priority, a day — with no project to pick. It lands in the space's own «مهام فورية»
 * project (made the first time, then found again by its `systemKey`, whatever it was renamed to), in the «to do»
 * column, through `createTask` and so through every rule of a task (the tasks row's «يضيف ويعدّل» box, an active
 * assignee). The person must be in the space, or they would hold a task they cannot open. They are told at once.
 *
 * Behind the «instantWork» switch: off, the route answers «not found» and the tasks already made stay as they are.
 *
 * «صندوق المهام» (W1.2, switch `workInbox`): the SAME project (same `systemKey`, same service) becomes a visible, named,
 * pinned inbox on top of «المشاريع». A quick task from anywhere lands in it, in «للتنفيذ»: Today's quick add
 * (`createInboxTask`), «اعمل منها مهمة» with no project chosen (`inboxTarget`, src/server/chat/make-work.ts), «جديد».
 * «الشركة» holds no project (D-N3): a quick task made while in it lands in the inbox of the person's first STANDARD space
 * (`inboxSpaceFor`), and with none the quick add says why («instant.no_space»). A quick task with an assignee is
 * «المعنيين بس» (P0.2). A project that already existed keeps its id and its tasks; only the default name changes.
 * With the switch off nothing here changes.
 */

export const INSTANT_PROJECT_KEY = "instant";

/** The space's «مهام فورية» board and its «to do» column, made on first use (two at once: one wins, both use it). */
async function instantBoard(workspaceId: string, inbox: boolean): Promise<{ projectId: string; boardId: string; columnId: string }> {
  const find = () =>
    db.project.findUnique({
      where: { workspaceId_systemKey: { workspaceId, systemKey: INSTANT_PROJECT_KEY } },
      select: { id: true, name: true, boards: { where: { archived: false }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true, done: true } } } } },
    });
  let project = await find();
  if (!project) {
    try {
      await db.project.create({
        data: {
          workspaceId,
          systemKey: INSTANT_PROJECT_KEY,
          name: inbox ? (AR["work.inbox.name"] ?? "صندوق المهام") : (AR["instant.project"] ?? "مهام فورية"),
          status: "ACTIVE",
          boards: {
            create: { name: AR["instant.board"] ?? "فوري", columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })) } },
          },
        },
      });
    } catch (err) {
      // somebody else made it a moment ago
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
    project = await find();
  }
  if (!project) throw new ForbiddenError("instant.unavailable");
  // the hidden project that still wears its old default name takes the inbox's name; a name somebody chose is kept
  // (one conditional write: a rename made in between is never overwritten)
  const oldName = AR["instant.project"] ?? "مهام فورية";
  if (inbox && project.name === oldName) {
    await db.project.updateMany({ where: { id: project.id, name: oldName }, data: { name: AR["work.inbox.name"] ?? "صندوق المهام" } });
  }
  let board = project.boards[0];
  if (!board || board.columns.length === 0) {
    // its board was archived or emptied: a fresh one
    const made = await db.board.create({
      data: { projectId: project.id, name: AR["instant.board"] ?? "فوري", columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })) } },
      select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true, done: true } } },
    });
    board = made;
  }
  // the first column that is not the backlog and not done («للتنفيذ»), else the first
  const open = board.columns.filter((c) => !c.done);
  const column = open[1] ?? open[0] ?? board.columns[0]!;
  return { projectId: project.id, boardId: board.id, columnId: column.id };
}

export interface InstantTaskInput {
  title: string;
  /** «لمين» — one or more people of the space; the first is the task's own assignee, the rest ride beside them. */
  assigneeIds?: string[];
  /** The one person (the form before «لمين» took several): the same as `assigneeIds: [assigneeId]`. */
  assigneeId?: string;
  priority: TaskPriority;
  dueDate: Date | null;
  description?: string | null;
  /** «مهمة بمكافأة»: the OWNER's alone (`createTask` refuses anybody else: 403 `reward.owner_only`); needs `dueDate`. */
  reward?: RewardRequest;
}

export interface InboxSpace {
  id: string;
  name: string;
}

/**
 * The space a quick task goes to (D-N3): the one the person is in, unless it is «الشركة» (it holds no project) — then their
 * first STANDARD space (the order of the space switcher: the owner's order, then by name) that they may work in. Null when
 * they have none, or when `spaceId` is not one of theirs.
 */
export async function inboxSpaceFor(who: SpaceSubject, spaceId: string | null | undefined): Promise<InboxSpace | null> {
  const spaces = await spacesOf(who);
  const here = spaces.find((s) => s.id === spaceId);
  // the space the person is in, unless it is «الشركة» (no project there) or they may not add work in it (a guest of that space)
  if (here && here.kind !== "HQ" && here.role !== "GUEST") return { id: here.id, name: here.name };
  if (spaceId && !here) return null;
  const first = spaces.find((s) => s.kind === "STANDARD" && s.layout === "STANDARD" && s.role !== "GUEST");
  return first ? { id: first.id, name: first.name } : null;
}

/** What the clients need to know: where a quick task would go (null: no space) and the inbox project's id once it exists (a read: nothing is made). */
export async function inboxInfo(who: SpaceSubject, spaceId: string | null | undefined): Promise<{ space: InboxSpace | null; projectId: string | null }> {
  const space = await inboxSpaceFor(who, spaceId);
  if (!space) return { space: null, projectId: null };
  const project = await db.project.findUnique({ where: { workspaceId_systemKey: { workspaceId: space.id, systemKey: INSTANT_PROJECT_KEY } }, select: { id: true } });
  return { space, projectId: project?.id ?? null };
}

/**
 * The inbox's project, board and «للتنفيذ» column of a space, made if it is not there yet — for «اعمل منها مهمة» with no project
 * chosen. `workspaceId` is a space the caller was checked for (`inboxSpaceFor` has already moved «الشركة» to a real one).
 */
export async function inboxTarget(ctx: OrgAccessContext, workspaceId: string): Promise<{ projectId: string; boardId: string; columnId: string }> {
  await assertFeatureOn(ctx.orgId, "workInbox");
  assertNotGuest(ctx);
  return instantBoard(workspaceId, true);
}

/** `ctx`: the caller checked for this space (`requireWorkspace(spaceId, ["ADMIN", "MEMBER"])`). */
export async function createInstantTask(ctx: OrgAccessContext, workspaceId: string, input: InstantTaskInput): Promise<{ id: string; number: number; requested: boolean }> {
  await assertFeatureOn(ctx.orgId, "instantWork");
  return makeInboxTask(ctx, workspaceId, input);
}

/**
 * Today's quick add («اليوم» → the line at the foot of the list): a task typed with just a title, the person's own unless they
 * name somebody, in the inbox. It needs the switch `workInbox` only (not `instantWork`: it is not the «مهمة فورية» form).
 */
export async function createInboxTask(ctx: OrgAccessContext, workspaceId: string, input: InstantTaskInput): Promise<{ id: string; number: number; requested: boolean }> {
  await assertFeatureOn(ctx.orgId, "workInbox");
  const named = input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : []);
  return makeInboxTask(ctx, workspaceId, { ...input, assigneeIds: named.length ? named : [ctx.userId] });
}

async function makeInboxTask(ctx: OrgAccessContext, workspaceId: string, input: InstantTaskInput): Promise<{ id: string; number: number; requested: boolean }> {
  assertNotGuest(ctx);
  const inbox = await isFeatureOn(ctx.orgId, "workInbox");
  const people = [...new Set((input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : [])).filter(Boolean))];
  if (people.length === 0) throw new ForbiddenError("instant.pick_person");
  // every person named must be in this space (or be the company's owner), or they would hold a task they cannot open
  const allowed = await Promise.all(
    people.map(async (userId) => {
      const [inSpace, owner] = await Promise.all([
        db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } }),
        db.organizationMember.findFirst({ where: { organizationId: ctx.orgId, userId, role: "OWNER", status: "ACTIVE" }, select: { id: true } }),
      ]);
      return Boolean(inSpace || owner);
    }),
  );
  if (allowed.some((ok) => !ok)) throw new ForbiddenError("instant.not_in_space");
  const where = await instantBoard(workspaceId, inbox);
  const task = await createTask(ctx, {
    workspaceId,
    ...where,
    // a quick task that somebody holds is «المعنيين بس» (P0.2, D-P2): the inbox is a place everybody of the space opens
    ...(inbox ? { visibility: "PARTICIPANTS" as const } : {}),
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    assigneeId: people[0]!,
    coAssigneeIds: people.slice(1),
    dueDate: input.dueDate,
    reward: input.reward,
  });
  // by RANK (task-assign.ts): somebody of a HIGHER rank was asked, not assigned: they were told by the request instead.
  // Only the people the task really went to (its assignee and the people beside them) are told «أُسندت إليك».
  const held = [
    ...(task.assigneeId && task.assigneeId !== ctx.userId ? [task.assigneeId] : []),
    ...task.coAssignees.map((r) => r.userId).filter((id) => id !== ctx.userId),
  ];
  if (held.length) {
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
    await Promise.all(
      held.map((assigneeId) =>
        notifyAssignment({
          assigneeId,
          taskNumber: task.number,
          orgPrefix: org?.keyPrefix ?? "ZK",
          taskId: task.id,
          title: task.title,
          workspaceId,
        }),
      ),
    );
  }
  return { id: task.id, number: task.number, requested: task.assignRequest !== null || task.coRequests.length > 0 };
}
