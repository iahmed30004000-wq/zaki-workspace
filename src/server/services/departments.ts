import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { assertNotGuest, assertCanWrite } from "@/server/services/guest-guard";
import { assertMemberCan } from "@/server/policy/actor";
import { createTask } from "@/server/services/tasks";
import { canReadTicket } from "@/server/services/tickets";
import { sourceIsPrivate } from "@/server/chat/private-source";
import { sourceTaskPlace, taskLinkViews, withSourceLock, type LinkedTaskView, type SourceTaskInput } from "@/server/services/production";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { loadWorkScope, projectVisibleWhere, scopeSpaceIds, taskParticipantWhere } from "@/server/services/team-scope";
import { assertCapability } from "@/server/services/active-people";
import { alignDepartmentSpace, syncDepartmentSpace } from "@/server/services/department-space";
import { resolveTimeZone, zonedDayStart } from "@/lib/zoned-time";

/**
 * The departments area is the company's staff directory (who works where, with
 * which job title), so org GUESTs get 403 on every function here, read or write.
 * Every exported function below takes the caller's context for that.
 *
 * Reading it (the list and one department) is the `directory.view` capability, like the directory
 * itself: a MEMBER who lost it gets 403 `insufficient_role` (the guest's own message stays
 * `guest.no_access`). The routes check it as well; this is the same rule, held where the data is.
 *
 * Two more rules hold for what it shows: only ACTIVE people are listed (a suspended or offboarded
 * person's old roster row stays, unlisted), and the projects of a department - with the task
 * numbers built from them - come only from the spaces the viewer can open (`accessibleWorkspaceIds`:
 * the OWNER sees them all, everybody else, an ADMIN included, the spaces they were put in).
 */

/** Department mutations are office-level decisions: OWNER/ADMIN only. */
export function canManageDepartments(orgRole: string): boolean {
  return orgRole === "OWNER" || orgRole === "ADMIN";
}

export const DEPARTMENT_COLORS = ["sky", "emerald", "amber", "fuchsia", "indigo", "rose"] as const;

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2, "dept.name_short").max(40),
  emoji: z.string().trim().max(16).optional().nullable(),
  color: z.enum(DEPARTMENT_COLORS).optional().nullable(),
  leadId: z.string().min(1).optional().nullable(),
  memberIds: z.array(z.string()).max(200).optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const membersSchema = z
  .object({
    addUserIds: z.array(z.string()).max(200).optional(),
    removeUserIds: z.array(z.string()).max(200).optional(),
  })
  .refine((v) => Boolean(v.addUserIds?.length || v.removeUserIds?.length), { message: "dept.no_change" });

/** Of these ids, the people who are ACTIVE members of the organization (a suspended or offboarded person cannot lead or join). */
async function assertOrgUsers(orgId: string, userIds: string[]) {
  if (userIds.length === 0) return [];
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId, userId: { in: userIds }, status: "ACTIVE" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Only roster rows of people who are still ACTIVE in the organization are shown (the old rows of the others stay, unlisted). */
function activeRoster(orgId: string) {
  return { user: { memberships: { some: { organizationId: orgId, status: "ACTIVE" as const } } } };
}

export async function createDepartment(ctx: OrgAccessContext, input: z.infer<typeof createDepartmentSchema>) {
  assertNotGuest(ctx);
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  if (input.leadId) {
    const ok = await assertOrgUsers(ctx.orgId, [input.leadId]);
    if (ok.length === 0) throw new NotFoundError("dept.lead_not_member");
  }
  const validMembers = await assertOrgUsers(ctx.orgId, input.memberIds ?? []);

  const dept = await db.department.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      emoji: input.emoji || null,
      color: input.color || null,
      leadId: input.leadId || null,
      memberships: { create: validMembers.map((userId) => ({ userId })) },
    },
    select: { id: true, name: true },
  });
  // its own space from the first day, with its people (and its lead as the space's ADMIN)
  await syncDepartmentSpace(ctx.orgId, dept.id, { add: [...validMembers, ...(input.leadId ? [input.leadId] : [])] });
  return dept;
}

/**
 * «الأقسام» — each department, its people and how much work is open and late in it.
 *
 * "Late" is the COMPANY's day, the same line as My Work, analytics, the Today page and «كل المساحات»:
 * a task due at 09:00 today is not late at noon. `now` is injected so a test can pin the day.
 */
export async function listDepartments(ctx: OrgAccessContext, now: Date = new Date()) {
  assertNotGuest(ctx);
  await assertCapability(ctx, "directory.view");
  const [scope, org] = await Promise.all([
    loadWorkScope(ctx.userId),
    db.organization.findUnique({ where: { id: ctx.orgId }, select: { timezone: true } }),
  ]);
  const todayStart = zonedDayStart(now, resolveTimeZone(org?.timezone));
  const wsIds = scopeSpaceIds(scope);
  const rows = await db.department.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "asc" },
    include: {
      memberships: {
        where: activeRoster(ctx.orgId),
        select: { user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } }, role: true },
      },
      projects: {
        where: { workspaceId: { in: wsIds }, AND: [projectVisibleWhere(scope)] },
        select: { id: true, tasks: { where: taskParticipantWhere(scope), select: { completedAt: true, dueDate: true } } },
      },
      tickets: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } },
    },
  });
  return rows.map((d) => {
    const all = d.projects.flatMap((p) => p.tasks);
    const open = all.filter((t) => !t.completedAt).length;
    const overdue = all.filter((t) => !t.completedAt && t.dueDate && t.dueDate < todayStart).length;
    return {
      id: d.id,
      name: d.name,
      emoji: d.emoji,
      color: d.color,
      leadId: d.leadId,
      members: d.memberships.map((m) => ({ id: m.user.id, name: m.user.name, jobTitle: m.user.jobTitle, role: m.role, avatarUrl: m.user.avatarUrl })),
      projectsCount: d.projects.length,
      openTasks: open,
      overdueTasks: overdue,
      openTickets: d.tickets.length,
    };
  });
}

export async function getDepartment(ctx: OrgAccessContext, id: string) {
  assertNotGuest(ctx);
  await assertCapability(ctx, "directory.view");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!d) throw new NotFoundError("dept.not_found");
  const members = await db.departmentMember.findMany({
    where: { departmentId: d.id, ...activeRoster(ctx.orgId) },
    include: { user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } } },
  });
  // only the spaces this person can open: a department's projects live in spaces, and a space is
  // visible to the people in it (and the OWNER), not to a rank
  const scope = await loadWorkScope(ctx.userId);
  const projects = await db.project.findMany({
    where: { departmentId: d.id, workspaceId: { in: scopeSpaceIds(scope) }, AND: [projectVisibleWhere(scope)] },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      priority: true,
      tasks: { where: taskParticipantWhere(scope), select: { completedAt: true, dueDate: true } },
      workspace: { select: { name: true } },
    },
  });
  return {
    id: d.id,
    name: d.name,
    emoji: d.emoji,
    color: d.color,
    leadId: d.leadId,
    members: members.map((m) => ({ id: m.user.id, name: m.user.name, jobTitle: m.user.jobTitle, role: m.role, avatarUrl: m.user.avatarUrl })),
    projects: projects.map((p) => {
      const open = p.tasks.filter((t) => !t.completedAt).length;
      const done = p.tasks.filter((t) => t.completedAt).length;
      return {
        id: p.id,
        name: p.name,
        status: p.status as string,
        priority: p.priority as string,
        workspace: p.workspace.name,
        openTasks: open,
        doneTasks: done,
      };
    }),
  };
}

export async function updateDepartment(ctx: OrgAccessContext, id: string, input: z.infer<typeof updateDepartmentSchema>) {
  assertNotGuest(ctx);
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!d) throw new NotFoundError("dept.not_found");
  if (input.leadId) {
    const ok = await assertOrgUsers(ctx.orgId, [input.leadId]);
    if (ok.length === 0) throw new NotFoundError("dept.lead_not_member");
  }
  await db.department.update({
    where: { id: d.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.emoji !== undefined ? { emoji: input.emoji || null } : {}),
      ...(input.color !== undefined ? { color: input.color || null } : {}),
      ...(input.leadId !== undefined ? { leadId: input.leadId || null } : {}),
    },
  });
  // the space carries the department's name and mark, and its lead
  await alignDepartmentSpace(ctx.orgId, d.id);
}

export async function deleteDepartment(ctx: OrgAccessContext, id: string): Promise<void> {
  assertNotGuest(ctx);
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
  if (!d) throw new NotFoundError("dept.not_found");
  // members cascade; projects survive with departmentId = null (SetNull)
  await db.department.delete({ where: { id: d.id } });
}

export async function setMembers(ctx: OrgAccessContext, id: string, input: z.infer<typeof membersSchema>) {
  assertNotGuest(ctx);
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
  if (!d) throw new NotFoundError("dept.not_found");
  const add = await assertOrgUsers(ctx.orgId, input.addUserIds ?? []);
  const remove = input.removeUserIds ?? [];
  await db.$transaction(async (tx) => {
    for (const userId of add) {
      await tx.departmentMember.upsert({
        where: { departmentId_userId: { departmentId: id, userId } },
        create: { departmentId: id, userId },
        update: {},
      });
    }
    if (remove.length) {
      await tx.departmentMember.deleteMany({
        where: { departmentId: id, userId: { in: remove } },
      });
    }
  });
  // who is in the department is who is in its space
  await syncDepartmentSpace(ctx.orgId, id, { add, remove });
}

// ───────────────────────────── W1.6: a ticket and its task ─────────────────────────────

/** The ticket as its readers see it (the rule of `ticketDetail`): whoever raised or holds it, the department's people, the owner and the admins. */
async function readableTicket(ctx: OrgAccessContext, ticketId: string) {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, orgId: ctx.orgId },
    select: { id: true, number: true, title: true, description: true, departmentId: true, creatorId: true, assigneeId: true, sourceMessageId: true, organization: { select: { keyPrefix: true } } },
  });
  if (!ticket || !(await canReadTicket(ctx, ticket))) throw new NotFoundError("ticket.not_found");
  return ticket;
}

/**
 * W1.6 «حوّل لمهمة»: a ticket becomes a task through `createTask`, in «صندوق المهام» of the person's space (the department's space when they are in it),
 * held by the person unless they name somebody. The task keeps the link (`Task.sourceTicketId`) and the ticket shows it. The ticket keeps ITS own access
 * rules: only a reader of it may convert it. PRIVACY (P0.2, P0.3): a ticket that came from a private conversation makes a «المعنيين بس» task, and
 * «المساحة كلها» needs `confirmPublic` on the server. A second click (or two at once) returns the same task.
 */
export async function ticketToTask(ctx: OrgAccessContext, ticketId: string, input: SourceTaskInput): Promise<{ created: boolean; task: LinkedTaskView }> {
  assertCanWrite(ctx);
  await assertMemberCan(ctx, "tickets.view", "section.view_denied");
  const ticket = await readableTicket(ctx, ticketId);
  const privateSource = ticket.sourceMessageId ? await sourceIsPrivate(ctx.orgId, ticket.sourceMessageId) : false;
  if (privateSource && input.visibility === "SPACE" && input.confirmPublic !== true) {
    throw new ValidationError([{ path: "confirmPublic", message: "work.confirm_public_required" }]);
  }
  const visibility = privateSource ? (input.visibility ?? "PARTICIPANTS") : input.visibility;

  let created = false;
  const taskId = await withSourceLock(`ticket:${ticket.id}`, async () => {
    // task-visibility: the id of a task already made from this ticket is read to return it; what the caller may read of it is `taskLinkViews`
    const already = await db.task.findFirst({ where: { orgId: ctx.orgId, sourceTicketId: ticket.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (already) return already.id;
    const deptSpace = ticket.departmentId
      ? await db.workspace.findFirst({ where: { organizationId: ctx.orgId, departmentId: ticket.departmentId, archivedAt: null }, select: { id: true } })
      : null;
    const place = await sourceTaskPlace(ctx, { spaceId: input.workspaceId ?? null, prefer: deptSpace?.id ?? null });
    const key = `${ticket.organization.keyPrefix}-T${ticket.number}`;
    const task = await createTask(
      { userId: ctx.userId, orgId: ctx.orgId },
      {
        ...place,
        title: ticket.title.slice(0, 280),
        description: `${ticket.description ?? ""}\n\n${interpolate(AR["work.convert.from_ticket"] ?? "{key}", { key })}`.trim().slice(0, 4000),
        assigneeId: input.assigneeId === undefined ? ctx.userId : input.assigneeId,
        ...(visibility ? { visibility } : {}),
      },
    );
    await db.task.update({ where: { id: task.id }, data: { sourceTicketId: ticket.id } });
    created = true;
    return task.id;
  });
  return { created, task: (await taskLinkViews(ctx, [taskId])).get(taskId) ?? { state: "hidden" } };
}

/** What the ticket's page shows of its task: the task as `ctx` may read it (named, or only «hidden»), null when the ticket was never converted. The caller already passed the ticket's own reader check. */
export async function ticketTaskView(ctx: OrgAccessContext, ticketId: string): Promise<LinkedTaskView | null> {
  // task-visibility: the id of the task made from this ticket is read to show it; what the caller may read of it is `taskLinkViews`
  const made = await db.task.findFirst({ where: { orgId: ctx.orgId, sourceTicketId: ticketId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!made) return null;
  return (await taskLinkViews(ctx, [made.id])).get(made.id) ?? null;
}

/** The ticket a task was made from, as `ctx` may read it: named to a reader of the ticket, else only «hidden». Null when the task is no ticket's. */
export async function ticketSourceOf(
  ctx: OrgAccessContext,
  sourceTicketId: string | null,
): Promise<{ kind: "ticket"; state: "visible"; id: string; key: string; title: string; href: string } | { kind: "ticket"; state: "hidden" } | null> {
  if (!sourceTicketId) return null;
  const ticket = await db.ticket.findFirst({
    where: { id: sourceTicketId, orgId: ctx.orgId },
    select: { id: true, number: true, title: true, departmentId: true, creatorId: true, assigneeId: true, organization: { select: { keyPrefix: true } } },
  });
  if (!ticket) return null;
  const mayRead = (await assertMemberCan(ctx, "tickets.view", "section.view_denied").then(() => true, () => false)) && (await canReadTicket(ctx, ticket));
  return mayRead
    ? { kind: "ticket", state: "visible", id: ticket.id, key: `${ticket.organization.keyPrefix}-T${ticket.number}`, title: ticket.title, href: "/tickets" }
    : { kind: "ticket", state: "hidden" };
}
