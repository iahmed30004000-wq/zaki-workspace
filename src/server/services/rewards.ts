import { Prisma } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { canPinTask, canSeeReward, canSetReward } from "@/server/policy/reward";
import { pushNotification } from "@/server/notify";
import { featureOn } from "@/lib/features";
import { assertFeatureOn } from "@/server/services/features";
import { isOrgOwner, rewardsOn } from "@/server/services/reward-guard";
import { fmtReward, isRewardCurrency, REWARD_REASON_MAX, rewardProblem } from "@/lib/rewards";

/**
 * «مهمة بمكافأة» — set, award, cancel; and «تثبيت» — pin.
 *
 * WHO: only the OWNER rank (every OWNER, the co-owners with him) sets, edits, awards or cancels a reward (read from the
 * database, never from the cookie). A pin is the owner's and the space's ADMIN's. The company's switch `taskRewards`
 * closes every door (404 `features.off`); what was stored stays.
 *
 * THE APP NEVER MOVES MONEY. An award is a record and an approval (who, when, by whom); the payroll pays. Nothing here
 * calls a payment, and no reward field goes into a webhook payload or a Web Push (src/server/services/n8n.ts is handed
 * the task id, number and title only).
 *
 * MONEY IS EXACT: integer minor units; the open total is added in SQL per currency, never across currencies.
 */

export const REWARD_EVENTS = {
  set: "task.reward_set",
  awarded: "task.reward_awarded",
  cancelled: "task.reward_cancelled",
  pinned: "task.pinned",
  unpinned: "task.unpinned",
} as const;

type Client = Prisma.TransactionClient | typeof db;

/** The company's default currency (`Organization.settings.defaultCurrency`), when it is one the picker offers. */
export async function defaultCurrencyOf(orgId: string, client: Client = db): Promise<string | null> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const raw = org?.settings && typeof org.settings === "object" ? (org.settings as Record<string, unknown>)["defaultCurrency"] : null;
  return isRewardCurrency(raw) ? raw : null;
}

/** What a request may carry for a reward: the amount in minor units, a currency (or the company's default), a note. */
export interface RewardRequest {
  amountMinor: number;
  currency?: string | null;
  note?: string | null;
}

/**
 * The reward a new or changed task carries, checked: the OWNER only (403 `reward.owner_only`), the switch on, an amount
 * above zero and under the cap, a currency, and a due date (422 with the reason's key). Returns the row's columns.
 */
export async function prepareReward(
  ctx: { orgId: string; userId: string },
  req: RewardRequest,
  dueDate: Date | null | undefined,
  client: Client = db,
): Promise<{ rewardAmountMinor: number; rewardCurrency: string; rewardNote: string | null; rewardStatus: "OPEN" }> {
  if (!canSetReward({ isOwner: await isOrgOwner(ctx) })) throw new ForbiddenError("reward.owner_only");
  await assertFeatureOn(ctx.orgId, "taskRewards");
  const currency = req.currency ?? (await defaultCurrencyOf(ctx.orgId, client));
  if (!currency) throw new ValidationError([{ path: "currency", message: "reward.currency_required" }]);
  const note = req.note?.trim() ? req.note.trim() : null;
  const problem = rewardProblem({ amountMinor: req.amountMinor, currency, note, dueDate });
  if (problem) throw new ValidationError([{ path: problem === "reward.due_required" ? "dueDate" : "reward", message: problem }]);
  return { rewardAmountMinor: req.amountMinor, rewardCurrency: currency, rewardNote: note, rewardStatus: "OPEN" };
}

interface RewardRow {
  id: string;
  number: number;
  title: string;
  workspaceId: string;
  dueDate: Date | null;
  completedAt: Date | null;
  assigneeId: string | null;
  rewardStatus: string | null;
  rewardAmountMinor: number | null;
  rewardCurrency: string | null;
}

const ROW_SELECT = {
  id: true,
  number: true,
  title: true,
  workspaceId: true,
  dueDate: true,
  completedAt: true,
  assigneeId: true,
  rewardStatus: true,
  rewardAmountMinor: true,
  rewardCurrency: true,
} as const;

/** The task row, locked for the rest of the transaction (two owners pressing at once are taken one after the other). */
async function lockedTask(tx: Prisma.TransactionClient, orgId: string, taskId: string): Promise<RewardRow> {
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${taskId} AND "orgId" = ${orgId} FOR UPDATE`;
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  const task = await tx.task.findFirst({ where: { id: taskId, orgId }, select: ROW_SELECT });
  if (!task) throw new NotFoundError("task.not_found");
  return task;
}

async function assertOwnerAndOn(ctx: OrgAccessContext): Promise<void> {
  await assertFeatureOn(ctx.orgId, "taskRewards");
  if (!canSetReward({ isOwner: await isOrgOwner(ctx) })) throw new ForbiddenError("reward.owner_only");
}

/** Puts a reward on a task, or changes it (the owner). A reward that was paid out is never changed; a called-off one is opened again. */
export async function setReward(
  ctx: OrgAccessContext,
  taskId: string,
  req: RewardRequest & { dueDate?: Date | null },
): Promise<{ id: string; rewardStatus: string; rewardAmountMinor: number; rewardCurrency: string }> {
  await assertOwnerAndOn(ctx);
  return db.$transaction(async (tx) => {
    const task = await lockedTask(tx, ctx.orgId, taskId);
    if (task.rewardStatus === "AWARDED") throw new ForbiddenError("reward.awarded_locked");
    const due = req.dueDate === undefined ? task.dueDate : req.dueDate;
    const data = await prepareReward(ctx, req, due, tx);
    const saved = await tx.task.update({
      where: { id: taskId },
      data: {
        ...data,
        ...(req.dueDate !== undefined ? { dueDate: req.dueDate } : {}),
        rewardCancelReason: null,
        rewardCancelledAt: null,
      },
      select: { id: true, rewardStatus: true, rewardAmountMinor: true, rewardCurrency: true },
    });
    await tx.auditLog.create({
      data: {
        action: REWARD_EVENTS.set,
        actorId: ctx.userId,
        orgId: ctx.orgId,
        target: taskId,
        workspaceId: task.workspaceId,
        meta: {
          before: { status: task.rewardStatus, amountMinor: task.rewardAmountMinor, currency: task.rewardCurrency },
          after: { status: "OPEN", amountMinor: data.rewardAmountMinor, currency: data.rewardCurrency },
        },
      },
    });
    return { id: saved.id, rewardStatus: saved.rewardStatus!, rewardAmountMinor: saved.rewardAmountMinor!, rewardCurrency: saved.rewardCurrency! };
  });
}

export interface AwardResult {
  taskId: string;
  awardedToId: string;
}

/**
 * «اعتمد المكافأة لـ…»: the owner picks ONE of the task's assignees (the first or one beside), once. The status, the person,
 * the moment and the approver are written in one conditional UPDATE — only a task that is OPEN and finished matches it —
 * so two owners pressing at the same time award once and the second gets 409-class `reward.already_awarded`.
 */
export async function awardReward(ctx: OrgAccessContext, taskId: string, userId: string): Promise<AwardResult> {
  await assertOwnerAndOn(ctx);
  const done = await db.$transaction(async (tx) => {
    const task = await lockedTask(tx, ctx.orgId, taskId);
    if (task.rewardStatus === "AWARDED") throw new ForbiddenError("reward.already_awarded");
    if (task.rewardStatus === "CANCELLED") throw new ForbiddenError("reward.cancelled");
    if (task.rewardStatus !== "OPEN") throw new ForbiddenError("reward.none");
    if (!task.completedAt) throw new ForbiddenError("reward.not_completed");
    const co = await tx.taskCoAssignee.findMany({ where: { taskId }, select: { userId: true } });
    const holders = new Set([...(task.assigneeId ? [task.assigneeId] : []), ...co.map((r) => r.userId)]);
    if (!holders.has(userId)) throw new ForbiddenError("reward.not_assignee");
    // somebody who is no longer ACTIVE in the company cannot be paid through it
    const person = await tx.organizationMember.findFirst({
      where: { organizationId: ctx.orgId, userId, status: "ACTIVE" },
      select: { role: true },
    });
    if (!person) throw new ForbiddenError("reward.not_assignee");
    const now = new Date();
    const won = await tx.task.updateMany({
      where: { id: taskId, orgId: ctx.orgId, rewardStatus: "OPEN", completedAt: { not: null } },
      data: { rewardStatus: "AWARDED", rewardAwardedToId: userId, rewardAwardedAt: now, rewardApprovedById: ctx.userId },
    });
    if (won.count !== 1) throw new ForbiddenError("reward.already_awarded");
    await tx.auditLog.create({
      data: {
        action: REWARD_EVENTS.awarded,
        actorId: ctx.userId,
        orgId: ctx.orgId,
        target: taskId,
        workspaceId: task.workspaceId,
        meta: { awardedToId: userId, amountMinor: task.rewardAmountMinor, currency: task.rewardCurrency },
      },
    });
    return { task, personRole: person.role };
  });
  await notifyAwarded(ctx, done.task, userId, done.personRole);
  return { taskId, awardedToId: userId };
}

/**
 * The bell tells the person. The title and the Web Push are GENERIC («اعتُمدت مكافأتك على مهمة …»): the push carries the task's
 * key and title and never the amount. The bell's body (inside the app, behind the sign-in) may carry the amount — and never for an external partner.
 */
async function notifyAwarded(ctx: OrgAccessContext, task: RewardRow, userId: string, personRole: string): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
  const label = `${org?.keyPrefix ?? "ZK"}-${task.number} · ${task.title}`;
  const amount = canSeeReward({ orgRole: personRole }) ? fmtReward(task.rewardAmountMinor, task.rewardCurrency) : "";
  await pushNotification({
    userId,
    type: "reward_awarded",
    title: AR["reward.notif.title"] ?? "",
    body: amount ? `${label} · ${interpolate(AR["reward.notif.amount"] ?? "", { amount })}` : label,
    pushBody: label,
    taskId: task.id,
    linkUrl: `/tasks/${task.id}`,
    workspaceId: task.workspaceId,
    organizationId: ctx.orgId,
  }).catch(() => undefined); // a failed bell never undoes an award that is already committed
}

/** «ألغِ المكافأة»: the owner calls an OPEN reward off, with a reason; audited. A paid-out reward is not called off here. */
export async function cancelReward(ctx: OrgAccessContext, taskId: string, rawReason: string): Promise<{ taskId: string }> {
  await assertOwnerAndOn(ctx);
  const reason = rawReason.replace(/\s+/g, " ").trim();
  if (!reason) throw new ValidationError([{ path: "reason", message: "reward.reason_required" }]);
  if (reason.length > REWARD_REASON_MAX) throw new ValidationError([{ path: "reason", message: "reward.reason_long" }]);
  await db.$transaction(async (tx) => {
    const task = await lockedTask(tx, ctx.orgId, taskId);
    if (task.rewardStatus === "AWARDED") throw new ForbiddenError("reward.already_awarded");
    if (task.rewardStatus === "CANCELLED") throw new ForbiddenError("reward.cancelled");
    if (task.rewardStatus !== "OPEN") throw new ForbiddenError("reward.none");
    await tx.task.update({
      where: { id: taskId },
      data: { rewardStatus: "CANCELLED", rewardCancelReason: reason, rewardCancelledAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: REWARD_EVENTS.cancelled,
        actorId: ctx.userId,
        orgId: ctx.orgId,
        target: taskId,
        workspaceId: task.workspaceId,
        meta: { reason, amountMinor: task.rewardAmountMinor, currency: task.rewardCurrency },
      },
    });
  });
  return { taskId };
}

/**
 * «تثبيت»: the owner and the space's ADMIN pin or unpin a task (the route passed the space guard with the ADMIN role, and the
 * rank is read again here). A pin never changes who may open the task. Audited. Pinning twice changes nothing.
 */
export async function setPinned(ctx: OrgAccessContext, taskId: string, pinned: boolean): Promise<{ id: string; pinnedAt: Date | null }> {
  await assertFeatureOn(ctx.orgId, "taskRewards");
  await assertMemberCan(ctx, "tasks.edit", "section.edit_denied");
  return db.$transaction(async (tx) => {
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    const task = await tx.task.findFirst({ where: { id: taskId, orgId: ctx.orgId }, select: { id: true, workspaceId: true, pinnedAt: true } });
    if (!task) throw new NotFoundError("task.not_found");
    const wsRow = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: task.workspaceId, userId: ctx.userId } },
      select: { role: true },
    });
    if (!canPinTask({ orgRole: ctx.orgRole, spaceRole: wsRow?.role ?? null })) throw new ForbiddenError("pin.denied");
    if (pinned === (task.pinnedAt !== null)) return { id: task.id, pinnedAt: task.pinnedAt };
    const saved = await tx.task.update({
      where: { id: taskId },
      data: pinned ? { pinnedAt: new Date(), pinnedById: ctx.userId } : { pinnedAt: null, pinnedById: null },
      select: { id: true, pinnedAt: true },
    });
    await tx.auditLog.create({
      data: { action: pinned ? REWARD_EVENTS.pinned : REWARD_EVENTS.unpinned, actorId: ctx.userId, orgId: ctx.orgId, target: taskId, workspaceId: task.workspaceId },
    });
    return saved;
  });
}

/** One bucket of money, in minor units, in one currency. */
export interface RewardTotal {
  currency: string;
  minor: number;
  count: number;
}

/**
 * «مجموع المكافآت المفتوحة» (the owner's header of the task lists): the OPEN rewards of the company that are not archived,
 * added IN SQL from the integer minor units, one row per currency — currencies are never mixed. The owner only (an empty
 * list for anybody else, never an error, so a screen can ask without a branch). `workspaceId` narrows to the space he is in.
 */
export async function openRewardTotals(ctx: { orgId: string; userId: string }, opts: { workspaceId?: string | null } = {}): Promise<RewardTotal[]> {
  if (!(await isOrgOwner(ctx)) || !(await rewardsOn(ctx.orgId))) return [];
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  const rows = await db.$queryRaw<{ currency: string; minor: bigint; count: bigint }[]>`
    SELECT "rewardCurrency" AS currency, SUM("rewardAmountMinor")::bigint AS minor, COUNT(*)::bigint AS count
    FROM "Task"
    WHERE "orgId" = ${ctx.orgId}
      AND "rewardStatus" = 'OPEN'
      AND "archived" = FALSE
      AND "rewardCurrency" IS NOT NULL
      ${opts.workspaceId ? Prisma.sql`AND "workspaceId" = ${opts.workspaceId}` : Prisma.empty}
    GROUP BY "rewardCurrency"
    ORDER BY "rewardCurrency" ASC`;
  return rows.map((r) => ({ currency: r.currency, minor: Number(r.minor), count: Number(r.count) }));
}

/**
 * May this person be shown a reward of a task in this space? The switch is on AND they are not an external partner (an org
 * GUEST, or a row in the space that says GUEST). The owner reading a space he is not in is shown it. One small read.
 */
export async function rewardsVisibleTo(ctx: { orgId: string; orgRole: string; userId: string }, workspaceId: string): Promise<boolean> {
  if (ctx.orgRole === "GUEST") return false;
  if (!(await rewardsOn(ctx.orgId))) return false;
  if (ctx.orgRole === "OWNER") return true;
  const row = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.userId } },
    select: { role: true },
  });
  return canSeeReward({ orgRole: ctx.orgRole, spaceRole: row?.role ?? null });
}

/**
 * What a screen of one space may draw for this person, from the database (never the cookie): `rewards` (the badges, the
 * card, the filter — never for a partner), `pins` (the pin strip and sorting: everybody who may open the task, while the
 * switch is on), `owner` (the amounts' totals, the toggle, the award controls), `canPin` (the pin button).
 * Everything is false while the company's switch `taskRewards` is off.
 */
export interface RewardLens {
  rewards: boolean;
  pins: boolean;
  owner: boolean;
  canPin: boolean;
}

export const NO_LENS: RewardLens = { rewards: false, pins: false, owner: false, canPin: false };

export async function rewardLensFor(ctx: { orgId: string; userId: string }, workspaceId: string | null | undefined): Promise<RewardLens> {
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
    select: { role: true, status: true, organization: { select: { settings: true } } },
  });
  if (!member || member.status !== "ACTIVE" || !featureOn(member.organization.settings, "taskRewards")) return NO_LENS;
  const row = workspaceId
    ? await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ctx.userId } }, select: { role: true } })
    : null;
  const viewer = { orgRole: member.role, spaceRole: row?.role ?? null };
  return {
    rewards: canSeeReward(viewer),
    pins: member.role !== "GUEST",
    owner: member.role === "OWNER",
    canPin: canPinTask(viewer),
  };
}
