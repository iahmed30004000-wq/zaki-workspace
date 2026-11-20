import { z } from "zod";
import type { CampaignStatus } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { nextTaskNumber, type Tx } from "@/server/services/tasks";
import { assertMemberCan } from "@/server/policy/actor";
import { assertCanWrite } from "@/server/services/guest-guard";
import { createTask } from "@/server/services/tasks";
import { sourceTaskPlace, taskLinkViews, withSourceLock, type LinkedTaskView, type SourceTaskInput } from "@/server/services/production";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";

/**
 * Campaigns live inside a department (marketing calendars).
 * Policy mirrors tickets: any org member reads/creates; dept members and org
 * admins manage (edit, transition, items). Org GUESTs get nothing: the read
 * routes refuse them (assertNotGuest, 403) and every mutation below starts with
 * assertCanWrite, so a guest who is also a department member or the owner of
 * an old campaign is still refused.
 */

export const CAMPAIGN_STATUSES: CampaignStatus[] = ["DRAFT", "SCHEDULED", "RUNNING", "DONE", "CANCELLED"];

export const createCampaignSchema = z
  .object({
    title: z.string().trim().min(3, "title.too_short").max(200),
    description: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine((v) => new Date(v.startDate) <= new Date(v.endDate), { message: "campaign.bad_range" });

export const updateCampaignSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["DRAFT", "SCHEDULED", "RUNNING", "DONE", "CANCELLED"]).optional(),
    priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "campaign.no_change" });

export const campaignItemSchema = z.object({
  title: z.string().trim().min(2, "title.too_short").max(200),
  kind: z.enum(["post", "event", "task"]).default("post"),
  dueDate: z.string().date(),
});

const isoDay = (s: string) => new Date(s + "T12:00:00.000Z");

/** Owner-or-admin gate for campaign mutation. */
function canManage(ctx: OrgAccessContext, isDeptMember: boolean): boolean {
  return isDeptMember || ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
}

async function deptContext(ctx: OrgAccessContext, departmentId: string) {
  const dept = await db.department.findFirst({
    where: { id: departmentId, orgId: ctx.orgId },
    select: { id: true, name: true, memberships: { select: { userId: true } } },
  });
  if (!dept) throw new NotFoundError("dept.not_found");
  return { dept, isMember: dept.memberships.some((m) => m.userId === ctx.userId) };
}

async function loadCampaign(ctx: OrgAccessContext, campaignId: string) {
  const c = await db.campaign.findFirst({
    where: { id: campaignId, orgId: ctx.orgId },
    select: { id: true, orgId: true, departmentId: true, number: true, title: true, status: true, ownerId: true, startDate: true, endDate: true },
  });
  if (!c) throw new NotFoundError("campaign.not_found");
  return c;
}

/** A department's campaigns: all of them for its people and the managers; anybody else sees the ones they own. */
export async function listDepartmentCampaigns(departmentId: string, viewer?: OrgAccessContext) {
  if (viewer) await assertMemberCan(viewer, "campaigns.view", "section.view_denied");
  const insider = viewer ? canManage(viewer, (await deptContext(viewer, departmentId)).isMember) : true;
  return db.campaign.findMany({
    where: { departmentId, ...(insider || !viewer ? {} : { ownerId: viewer.userId }) },
    orderBy: [{ startDate: "asc" }],
    select: {
      id: true, number: true, title: true, description: true, status: true,
      priority: true, startDate: true, endDate: true, createdAt: true,
      owner: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });
}

export async function createCampaign(
  ctx: OrgAccessContext,
  departmentId: string,
  input: z.infer<typeof createCampaignSchema>,
) {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.edit", "section.edit_denied");
  const { dept } = await deptContext(ctx, departmentId);
  return db.$transaction(async (tx: Tx) => {
    const number = await nextTaskNumber(ctx.orgId, tx);
    const c = await tx.campaign.create({
      data: {
        orgId: ctx.orgId,
        departmentId: dept.id,
        number,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        status: "DRAFT",
        startDate: isoDay(input.startDate),
        endDate: isoDay(input.endDate),
        ownerId: ctx.userId,
      },
      select: { id: true, number: true, title: true },
    });
    return c;
  });
}

export async function updateCampaign(
  ctx: OrgAccessContext,
  campaignId: string,
  input: z.infer<typeof updateCampaignSchema>,
) {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.edit", "section.edit_denied");
  const c = await loadCampaign(ctx, campaignId);
  const { isMember } = await deptContext(ctx, c.departmentId);
  if (!canManage(ctx, isMember)) throw new ForbiddenError("campaign.admin_only");
  if (input.startDate && input.endDate && isoDay(input.startDate) > isoDay(input.endDate)) {
    throw new ForbiddenError("campaign.bad_range");
  }
  return db.campaign.update({
    where: { id: c.id },
    data: {
      title: input.title ?? undefined,
      description: input.description ?? undefined,
      status: input.status ?? undefined,
      priority: input.priority ?? undefined,
      startDate: input.startDate ? isoDay(input.startDate) : undefined,
      endDate: input.endDate ? isoDay(input.endDate) : undefined,
    },
    select: { id: true, number: true, status: true },
  });
}

export async function deleteCampaign(ctx: OrgAccessContext, campaignId: string) {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.delete", "section.delete_denied");
  const c = await loadCampaign(ctx, campaignId);
  const { isMember } = await deptContext(ctx, c.departmentId);
  if (!canManage(ctx, isMember)) throw new ForbiddenError("campaign.admin_only");
  await db.campaign.delete({ where: { id: c.id } });
}

export async function campaignDetail(ctx: OrgAccessContext, campaignId: string) {
  await assertMemberCan(ctx, "campaigns.view", "section.view_denied");
  const c = await db.campaign.findFirst({
    where: { id: campaignId, orgId: ctx.orgId },
    select: {
      id: true, number: true, title: true, description: true, status: true, priority: true,
      startDate: true, endDate: true, createdAt: true,
      owner: { select: { id: true, name: true } },
      department: { select: { id: true, name: true, emoji: true } },
      items: { orderBy: { dueDate: "asc" } },
    },
  });
  if (!c) throw new NotFoundError("campaign.not_found");
  // outside the department, only one's own campaign: anything else is «not found»
  if (c.owner.id !== ctx.userId && !canManage(ctx, (await deptContext(ctx, c.department.id)).isMember)) {
    throw new NotFoundError("campaign.not_found");
  }
  // W1.6: an item that became a task shows its task, as THIS reader may read it (the title only when they may open the task; else just that a link exists)
  const views = await taskLinkViews(ctx, c.items.flatMap((i) => (i.taskId ? [i.taskId] : [])));
  return { ...c, items: c.items.map(({ taskId, ...item }) => ({ ...item, task: taskId ? (views.get(taskId) ?? null) : null })) };
}

/**
 * W1.6 «اعمل منه مهمة»: a campaign item becomes a task through `createTask` (every rule of a task applies), in «صندوق المهام» of the person's space (the
 * campaign's department space when the person is in it), due on the item's day, held by the person unless they name somebody. The item keeps the link
 * (`CampaignItem.taskId`) and the task shows its source. Who may manage the campaign (its department, the admins) may; a second click returns the same task.
 */
export async function campaignItemToTask(
  ctx: OrgAccessContext,
  itemId: string,
  input: SourceTaskInput,
): Promise<{ created: boolean; task: LinkedTaskView }> {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.edit", "section.edit_denied");
  const item = await db.campaignItem.findUnique({
    where: { id: itemId },
    select: { id: true, title: true, dueDate: true, campaign: { select: { orgId: true, departmentId: true, title: true, department: { select: { name: true } } } } },
  });
  if (!item || item.campaign.orgId !== ctx.orgId) throw new NotFoundError("campaign.not_found");
  const { isMember } = await deptContext(ctx, item.campaign.departmentId);
  if (!canManage(ctx, isMember)) throw new ForbiddenError("campaign.admin_only");

  let created = false;
  const taskId = await withSourceLock(`campaignItem:${item.id}`, async () => {
    const fresh = await db.campaignItem.findUnique({ where: { id: item.id }, select: { taskId: true } });
    if (fresh?.taskId) return fresh.taskId;
    const deptSpace = await db.workspace.findFirst({ where: { organizationId: ctx.orgId, departmentId: item.campaign.departmentId, archivedAt: null }, select: { id: true } });
    const place = await sourceTaskPlace(ctx, { spaceId: input.workspaceId ?? null, prefer: deptSpace?.id ?? null });
    const task = await createTask(
      { userId: ctx.userId, orgId: ctx.orgId },
      {
        ...place,
        title: item.title.slice(0, 280),
        description: interpolate(AR["work.convert.from_campaign"] ?? "{title}", { title: item.campaign.title }),
        dueDate: item.dueDate,
        assigneeId: input.assigneeId === undefined ? ctx.userId : input.assigneeId,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    );
    await db.campaignItem.update({ where: { id: item.id }, data: { taskId: task.id } });
    created = true;
    return task.id;
  });
  return { created, task: (await taskLinkViews(ctx, [taskId])).get(taskId) ?? { state: "hidden" } };
}

/**
 * The campaign a task was made from, as `ctx` may read it: named when they own the campaign or manage its department (and hold the box), else only «hidden».
 * Null when the task is no campaign item's.
 */
export async function campaignSourceOf(
  ctx: OrgAccessContext,
  taskId: string,
): Promise<{ kind: "campaignItem"; state: "visible"; id: string; key: string; title: string; href: string } | { kind: "campaignItem"; state: "hidden" } | null> {
  const item = await db.campaignItem.findFirst({
    where: { taskId, campaign: { orgId: ctx.orgId } },
    select: { campaign: { select: { id: true, number: true, title: true, ownerId: true, departmentId: true, organization: { select: { keyPrefix: true } } } } },
  });
  if (!item) return null;
  const c = item.campaign;
  const mayRead =
    (await assertMemberCan(ctx, "campaigns.view", "section.view_denied").then(() => true, () => false)) &&
    (c.ownerId === ctx.userId || canManage(ctx, (await deptContext(ctx, c.departmentId)).isMember));
  return mayRead
    ? { kind: "campaignItem", state: "visible", id: c.id, key: `${c.organization.keyPrefix}-C${c.number}`, title: c.title, href: "/campaigns" }
    : { kind: "campaignItem", state: "hidden" };
}

export async function addCampaignItem(
  ctx: OrgAccessContext,
  campaignId: string,
  input: z.infer<typeof campaignItemSchema>,
) {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.edit", "section.edit_denied");
  const c = await loadCampaign(ctx, campaignId);
  const { isMember } = await deptContext(ctx, c.departmentId);
  if (!canManage(ctx, isMember)) throw new ForbiddenError("campaign.admin_only");
  return db.campaignItem.create({
    data: {
      campaignId: c.id,
      title: input.title,
      kind: input.kind,
      dueDate: isoDay(input.dueDate),
    },
  });
}

export async function toggleCampaignItem(ctx: OrgAccessContext, itemId: string) {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.edit", "section.edit_denied");
  const item = await db.campaignItem.findUnique({
    where: { id: itemId },
    select: { id: true, doneAt: true, campaign: { select: { orgId: true, departmentId: true } } },
  });
  if (!item || item.campaign.orgId !== ctx.orgId) throw new NotFoundError("campaign.not_found");
  const { isMember } = await deptContext(ctx, item.campaign.departmentId);
  if (!canManage(ctx, isMember)) throw new ForbiddenError("campaign.admin_only");
  return db.campaignItem.update({
    where: { id: item.id },
    data: { doneAt: item.doneAt ? null : new Date() },
  });
}

export async function deleteCampaignItem(ctx: OrgAccessContext, itemId: string) {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "campaigns.edit", "section.edit_denied");
  const item = await db.campaignItem.findUnique({
    where: { id: itemId },
    select: { id: true, campaign: { select: { orgId: true, departmentId: true } } },
  });
  if (!item || item.campaign.orgId !== ctx.orgId) throw new NotFoundError("campaign.not_found");
  const { isMember } = await deptContext(ctx, item.campaign.departmentId);
  if (!canManage(ctx, isMember)) throw new ForbiddenError("campaign.admin_only");
  await db.campaignItem.delete({ where: { id: item.id } });
}

/** «حملاتي» — campaigns the caller owns in their org. */
export async function myCampaigns(ctx: OrgAccessContext) {
  await assertMemberCan(ctx, "campaigns.view", "section.view_denied");
  return db.campaign.findMany({
    where: { orgId: ctx.orgId, ownerId: ctx.userId },
    orderBy: [{ status: "asc" }, { startDate: "asc" }],
    take: 100,
    select: {
      id: true, number: true, title: true, status: true, startDate: true, endDate: true,
      department: { select: { id: true, name: true, emoji: true } },
      _count: { select: { items: true } },
    },
  });
}