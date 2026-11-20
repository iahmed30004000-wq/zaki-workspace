import * as crypto from "node:crypto";
import type { WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireUser, type OrgAccessContext } from "@/server/auth";
import { canManageWorkspaceMembers } from "@/server/services/access";
import { workspaceRoleOf, type WorkspaceRoleName } from "@/server/workspace-role";
import { emitRealtime } from "@/server/realtime/emit";
import { forgetTypingFacts } from "@/server/chat/typing-gate";
import type { SpaceLayout } from "@/lib/cards/shared";
import { ensureStarterTopics, SPACE_STARTER_TOPICS, spaceTopicIdOf } from "@/server/chat/space-topics";

/**
 * Spaces (workspaces): who is in one, who may change it.
 *
 * The rule behind all of it: a space is visible only to the people IN it (a row) and to the OWNER,
 * who sees every space of the company without a row and without leaving a trace. Rank gives nobody a
 * space (an ADMIN included), and only ACTIVE organization members count: a suspended or offboarded
 * person keeps their rows (history, and reactivation restores everything) but is never listed, never
 * added, never promoted, and never counted as an administrator.
 */

/** A refusal that is a clash with the current state, not a missing right: the routes answer 409 with the key as the message. */
export class SpaceConflictError extends Error {
  constructor(
    message: "spaces.last_admin" | "spaces.not_empty" | "spaces.delete_hq" | "spaces.delete_department" | "spaces.delete_name_mismatch" | "spaces.archive_hq",
  ) {
    super(message);
    this.name = "SpaceConflictError";
  }
}

const unique = (ids?: readonly string[]): string[] => [...new Set(ids ?? [])];

// ---------- creating ----------

export interface CreateWorkspaceInput {
  organizationId: string;
  name: string;
  description?: string | null;
  /** People to put in it from the start. The creator is always its ADMIN and need not be listed. */
  memberIds?: readonly string[];
  /** «نوع المساحة»: STANDARD (the default) or CARDS (a space of «لوحات» only). */
  layout?: SpaceLayout;
}

/**
 * Opens a space: the creator becomes its ADMIN, and everybody in `memberIds` is put in it (a
 * plain member as MEMBER, an org GUEST as a GUEST whatever was asked; repeated ids and the creator's
 * own id count once). Each of them must be an ACTIVE member of THIS organization, otherwise nothing at
 * all is created. `added` is who has to be told.
 *
 * The caller must already have checked the right to do it (capability `spaces.create`).
 */
export async function createWorkspace(userId: string, input: CreateWorkspaceInput) {
  const wanted = unique(input.memberIds).filter((id) => id !== userId);
  const people = wanted.length
    ? await db.organizationMember.findMany({
        where: { organizationId: input.organizationId, status: "ACTIVE", userId: { in: wanted } },
        select: { userId: true, role: true },
      })
    : [];
  if (people.length !== wanted.length) throw new ForbiddenError("spaces.member_not_in_org");

  const base = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const slug = `${base || "ws"}-${crypto.randomBytes(2).toString("hex")}`;
  // one nested write = one transaction: the space and all its rows exist together or not at all
  const workspace = await db.workspace.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      layout: input.layout ?? "STANDARD",
      members: {
        create: [
          { userId, role: "ADMIN" as WorkspaceRole },
          ...people.map((p) => ({ userId: p.userId, role: (p.role === "GUEST" ? "GUEST" : "MEMBER") as WorkspaceRole })),
        ],
      },
    },
    select: { id: true, name: true, slug: true },
  });
  // its own talk from the first day: entering a new space opens on «عام» and «التنبيهات», never a blank chat
  await ensureStarterTopics(input.organizationId, workspace.id);
  return { workspace, added: people.map((p) => p.userId) };
}

// ---------- reading ----------

/** Can this person add, remove and promote people here? An org GUEST never can, whatever an old row says. */
export async function canManageHere(ctx: Pick<OrgAccessContext, "userId" | "orgRole">, workspaceId: string): Promise<boolean> {
  if (ctx.orgRole === "GUEST") return false;
  return canManageWorkspaceMembers(ctx.userId, workspaceId);
}

/** A space as its people read it. The caller has already passed `requireWorkspace`. */
export async function readWorkspace(ctx: Pick<OrgAccessContext, "userId" | "orgRole">, workspaceId: string) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, description: true, organizationId: true, createdAt: true },
  });
  if (!workspace) throw new NotFoundError("workspace.not_found");
  const [memberCount, canManage] = await Promise.all([
    // the people who can actually work in it: a suspended person's leftover row is not a person here
    db.workspaceMember.count({
      where: { workspaceId, user: { memberships: { some: { organizationId: workspace.organizationId, status: "ACTIVE" } } } },
    }),
    canManageHere(ctx, workspaceId),
  ]);
  return { workspace, memberCount, canManage };
}

/**
 * The people IN a space, whose organization membership is ACTIVE — and nobody else: the OWNER is
 * not on the list unless they have a real row (their oversight is silent), an ADMIN is not on it by
 * rank, and a suspended or offboarded person's leftover row is not shown.
 *
 * The viewer is the signed-in user unless `viewerId` is given. An org GUEST gets names only
 * (`{ id, name }`, never an email or a role); everyone else gets `{ id, name, email, role }`, the role
 * being the one they really have in this space (an org GUEST is a GUEST whatever their row says).
 * A viewer who may not open the space (not ACTIVE, or not in it and not the OWNER) gets nothing.
 */
export async function listWorkspaceMembers(workspaceId: string, viewerId?: string) {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
  if (!ws) return [];
  const viewer = viewerId ?? (await requireUser()).id;
  const viewerOrg = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ws.organizationId, userId: viewer } },
    select: { role: true, status: true },
  });
  if (!viewerOrg || viewerOrg.status !== "ACTIVE") return [];
  if (viewerOrg.role !== "OWNER") {
    const own = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: viewer } },
      select: { id: true },
    });
    if (!own) return [];
  }

  const rows = await db.workspaceMember.findMany({
    where: { workspaceId, user: { memberships: { some: { organizationId: ws.organizationId, status: "ACTIVE" } } } },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          memberships: { where: { organizationId: ws.organizationId, status: "ACTIVE" }, select: { role: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (viewerOrg.role === "GUEST") return rows.map((r) => ({ id: r.user.id, name: r.user.name }));
  return rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    avatarUrl: r.user.avatarUrl,
    role: workspaceRoleOf(r.user.memberships[0]?.role, r.role) as WorkspaceRoleName,
  }));
}

// ---------- changing who is in it ----------

export interface MemberChanges {
  add?: readonly string[];
  remove?: readonly string[];
  promote?: readonly string[];
  demote?: readonly string[];
}

/**
 * Adds, removes, promotes and demotes the people of a space, all or nothing. The caller has already
 * checked that the actor manages the space; `ctx.orgRole` decides one thing here: only the OWNER may
 * take the last space ADMIN away.
 *
 *  - whoever is added or promoted must be an ACTIVE member of the space's organization (never another
 *    organization's user, never a suspended or offboarded person): 403 `spaces.member_not_in_org`;
 *  - an org GUEST is added as a space GUEST (an old MEMBER/ADMIN row is repaired), never promoted
 *    (403 `guest.readonly`), and a demotion lands them on GUEST;
 *  - a request that would leave the space without a working ADMIN is refused (409 `spaces.last_admin`)
 *    unless the OWNER makes it. "Working" = an ACTIVE, non-guest member with an ADMIN row; a space that
 *    has none already is not blocked from being tidied up;
 *  - changes of one space are serialised, so two admins stepping down at the same moment cannot
 *    both succeed.
 *
 * Returns who was newly put in (and so has to be told); nobody is told about a repair or a repeat.
 */
export async function changeWorkspaceMembers(
  ctx: Pick<OrgAccessContext, "userId" | "orgRole">,
  workspaceId: string,
  changes: MemberChanges,
): Promise<{ added: string[] }> {
  const add = unique(changes.add);
  const remove = unique(changes.remove);
  const promote = unique(changes.promote);
  const demote = unique(changes.demote);

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    if (!ws) throw new NotFoundError("workspace.not_found");

    const current = await tx.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } });
    const rowRole = new Map<string, WorkspaceRole>(current.map((r) => [r.userId, r.role] as const));
    const adminRows = current.filter((r) => r.role === "ADMIN").map((r) => r.userId);

    const orgRows = await tx.organizationMember.findMany({
      where: { organizationId: ws.organizationId, userId: { in: unique([...add, ...remove, ...promote, ...demote, ...adminRows]) } },
      select: { userId: true, role: true, status: true },
    });
    const org = new Map(orgRows.map((r) => [r.userId, r] as const));
    const isGuest = (id: string) => org.get(id)?.role === "GUEST";
    const isActive = (id: string) => org.get(id)?.status === "ACTIVE";
    const isWorkingAdmin = (id: string) => isActive(id) && !isGuest(id);

    // Refused up front, so nothing else in the same request is applied either.
    if (promote.some(isGuest)) throw new ForbiddenError("guest.readonly");
    if (add.some((id) => !isActive(id)) || promote.some((id) => !isActive(id))) {
      throw new ForbiddenError("spaces.member_not_in_org");
    }

    // What the space would look like afterwards, in the order the changes are applied below.
    const after = new Map(rowRole);
    for (const id of add) {
      if (!after.has(id)) after.set(id, isGuest(id) ? "GUEST" : "MEMBER");
      else if (isGuest(id)) after.set(id, "GUEST");
    }
    for (const id of promote) if (after.get(id) === "MEMBER") after.set(id, "ADMIN");
    for (const id of demote) {
      const role = after.get(id);
      if (role === "ADMIN") after.set(id, isGuest(id) ? "GUEST" : "MEMBER");
      else if (role && isGuest(id)) after.set(id, "GUEST");
    }
    for (const id of remove) after.delete(id);
    const workingAdminsBefore = adminRows.filter(isWorkingAdmin).length;
    const workingAdminsAfter = [...after].filter(([id, role]) => role === "ADMIN" && isWorkingAdmin(id)).length;
    if (workingAdminsBefore > 0 && workingAdminsAfter === 0 && ctx.orgRole !== "OWNER") {
      throw new SpaceConflictError("spaces.last_admin");
    }

    for (const userId of add) {
      const guest = isGuest(userId);
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, role: guest ? "GUEST" : "MEMBER" },
        // adding a guest again repairs a row that older data stored as MEMBER/ADMIN
        update: guest ? { role: "GUEST" } : {},
      });
    }
    if (promote.length) {
      await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: { in: promote }, role: "MEMBER" },
        data: { role: "ADMIN" },
      });
    }
    if (demote.length) {
      await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: { in: demote.filter((id) => !isGuest(id)) }, role: "ADMIN" },
        data: { role: "MEMBER" },
      });
      // a guest that older data stored as MEMBER/ADMIN lands on GUEST, not on MEMBER
      await tx.workspaceMember.updateMany({
        where: { workspaceId, userId: { in: demote.filter(isGuest) }, role: { not: "GUEST" } },
        data: { role: "GUEST" },
      });
    }
    if (remove.length) {
      await tx.workspaceMember.deleteMany({ where: { workspaceId, userId: { in: remove } } });
      // and out of the space's teams (a team holds only people of its space), and no longer leading one
      await tx.teamMember.deleteMany({ where: { userId: { in: remove }, team: { workspaceId } } });
      await tx.team.updateMany({ where: { workspaceId, leadId: { in: remove } }, data: { leadId: null } });
      // and out of the space's topics: a row left behind kept feeding them its messages (review A3)
      const rows = await tx.conversationMember.findMany({
        where: { userId: { in: remove }, conversation: { spaceId: workspaceId } },
        select: { id: true, conversationId: true, userId: true },
      });
      if (rows.length) {
        await tx.conversationMember.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        for (const r of rows) {
          await emitRealtime(tx, ws.organizationId, "membership.changed", { conversationId: r.conversationId, userId: r.userId, spaceId: workspaceId });
        }
      }
      // the moderation trail of the space: who was taken out of it (ids only, no content)
      await tx.auditLog.createMany({
        data: remove.map((userId) => ({
          action: "workspace.member_removed",
          actorId: ctx.userId,
          orgId: ws.organizationId,
          target: userId,
          workspaceId,
        })),
      });
    }
    return { added: add.filter((id) => !rowRole.has(id)) };
  });
  for (const id of [...remove, ...promote, ...demote]) forgetTypingFacts(id); // C1.8: a removal or a role change ends typing at once, not after the 30 s the memory keeps
  return result;
}

// ---------- deleting ----------

/**
 * Deletes a space that holds no projects (and so no tasks) and no conversations: its rows and teams go
 * with it. A space with work or chat in it is never deleted by this door — the work would go with it, for good — and answers
 * 409 `spaces.not_empty`.
 */
export async function deleteEmptyWorkspace(workspaceId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    // the lock makes a project being created at this very moment either land first (and be seen) or wait
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!ws) throw new NotFoundError("workspace.not_found");
    if ((await tx.project.count({ where: { workspaceId } })) > 0) throw new SpaceConflictError("spaces.not_empty");
    // a topic (the HQ's, a migrated group's, one somebody opened) keeps the space: the database refuses
    // too (Conversation.spaceId ON DELETE RESTRICT), but that answered a bare 409 without a reason
    // …except the starter topics every space is given («عام»، «التنبيهات»): while nobody has written there, they
    // go with the space
    const starters = SPACE_STARTER_TOPICS.map((t) => spaceTopicIdOf(workspaceId, t.key));
    const talk = { spaceId: workspaceId, OR: [{ id: { notIn: starters } }, { messages: { some: {} } }] };
    if ((await tx.conversation.count({ where: talk })) > 0) throw new SpaceConflictError("spaces.not_empty");
    await tx.conversationMember.deleteMany({ where: { conversationId: { in: starters } } });
    await tx.conversation.deleteMany({ where: { id: { in: starters } } });
    await tx.workspace.delete({ where: { id: workspaceId } });
  });
}
