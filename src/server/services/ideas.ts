import { Prisma } from "@prisma/client";
import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireUser } from "@/server/auth";
import type { OrgAccessContext } from "@/server/auth";
import { canManageOrg } from "@/server/services/orgs";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertCanWrite, assertNotGuest } from "@/server/services/guest-guard";
import type { ActorContext } from "@/server/services/tasks";
import { createTask } from "@/server/services/tasks";
import type { DbClient } from "@/server/db";
import { isSpaceManager } from "@/server/workspace-role";
import { assertMemberCan, can } from "@/server/policy/actor";
import { sectionGridOf } from "@/server/policy/section-grid";

/**
 * Membership context resolved from the idea's own org (shared by API routes). Only an ACTIVE member
 * of that org gets one: somebody suspended or offboarded there is "not a member", even when they
 * are active in another organization of theirs. Ideas are the team's own, so an external partner
 * (guest) is refused with `guest.no_access` too, including for an idea they wrote before they were
 * made a guest - the door every per-idea route goes through (edit, delete, vote, convert).
 */
export async function ideaAccessCtx(ideaId: string): Promise<OrgAccessContext> {
  const user = await requireUser();
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    select: { orgId: true },
  });
  if (!idea) throw new ForbiddenError("idea.not_found");
  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: idea.orgId, userId: user.id } },
    select: {
      role: true,
      status: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
      organization: { select: { settings: true } },
    },
  });
  if (!membership || membership.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
  assertNotGuest({ orgRole: membership.role });
  // the ideas row of the person's grid: a section switched off for them is closed at every door
  if (!can(membership, "ideas.view", { sectionGrid: sectionGridOf(membership.organization.settings) })) {
    throw new ForbiddenError("section.view_denied");
  }
  return { orgId: idea.orgId, orgRole: membership.role, userId: user.id };
}

export type IdeaStatus = "NEW" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "PLANNING" | "LAUNCHED";

/**
 * Allowed status transitions — the owner's road (2026-10-25): an idea is shared, planned and launched.
 *   فكرة (NEW) → مراجعة (UNDER_REVIEW) → تخطيط (PLANNING) → انطلقت (LAUNCHED), or مرفوضة (REJECTED).
 * NEW must go through review first; a rejected idea may come back to review; planning may go back to review;
 * LAUNCHED is the end. ACCEPTED («معتمدة») is the old last step: no idea reaches it any more, and the ones that
 * did go on to planning or launch.
 */
const TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  NEW: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["PLANNING", "REJECTED"],
  PLANNING: ["LAUNCHED", "UNDER_REVIEW"],
  REJECTED: ["UNDER_REVIEW"],
  ACCEPTED: ["PLANNING", "LAUNCHED"],
  LAUNCHED: [],
};

/** Pure transition check (unit-tested). */
export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const IDEA_INCLUDE = {
  creator: { select: { id: true, name: true, jobTitle: true } },
  votes: { select: { userId: true } },
  workspace: { select: { name: true } },
} satisfies Prisma.IdeaInclude;

/**
 * WHERE AN IDEA IS READ (the owner's decision, 2026-10-25: each space has its own ideas, and «شارك مع الشركة»):
 * inside a space, the ideas born there; inside «الشركة» also the ones shared with the company and the ones from
 * before spaces had ideas.
 */
export interface IdeaPlace {
  spaceId: string | null;
  isHq: boolean;
}

export function ideaPlaceWhere(place: IdeaPlace): Prisma.IdeaWhereInput {
  if (!place.spaceId) return { id: { in: [] } };
  const here: Prisma.IdeaWhereInput[] = [{ workspaceId: place.spaceId }];
  if (place.isHq) here.push({ workspaceId: null }, { sharedAt: { not: null } });
  return { OR: here };
}

/**
 * Who moves an idea along and shares it: the managers of its space (the OWNER, its ADMIN, an org ADMIN in it); an
 * idea with no space is the company's, so the OWNER and the ADMINs.
 */
async function managesIdea(orgRole: OrgRole, userId: string, workspaceId: string | null, client: DbClient = db): Promise<boolean> {
  if (!workspaceId) return canManageOrg(orgRole);
  const row = await client.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return isSpaceManager(orgRole, row?.role);
}

export interface IdeaDTO {
  id: string;
  title: string;
  description: string | null;
  status: IdeaStatus;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  creatorName: string;
  creatorJobTitle: string | null;
  voteCount: number;
  votedByMe: boolean;
  orgKeyPrefix: string;
  /** The space it was born in (null: from before spaces had ideas). */
  workspaceId: string | null;
  /** Its name, to say where a shared idea comes from. */
  spaceName: string | null;
  /** Shared with the company («شارك مع الشركة»). */
  shared: boolean;
  /** «الباب»: set when another system sent it in through /api/v1 (the sending token's name); null for an idea a person wrote. */
  source: string | null;
}

interface Row {
  id: string;
  title: string;
  description: string | null;
  status: IdeaStatus;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  creator: { id: string; name: string; jobTitle: string | null };
  votes: { userId: string }[];
  organization: { keyPrefix: string };
  workspaceId: string | null;
  sharedAt: Date | null;
  workspace: { name: string } | null;
  source: string | null;
}

function toDTO(row: Row, viewerId: string, external = false): IdeaDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    taskId: row.taskId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    creatorId: row.creator.id,
    creatorName: row.creator.name,
    // the staff directory is closed to external partners: no job titles for them
    creatorJobTitle: external ? null : row.creator.jobTitle,
    voteCount: row.votes.length,
    votedByMe: row.votes.some((v) => v.userId === viewerId),
    orgKeyPrefix: row.organization.keyPrefix,
    workspaceId: row.workspaceId,
    spaceName: row.workspace?.name ?? null,
    shared: row.sharedAt !== null,
    source: row.source,
  };
}

export interface ListIdeasFilters {
  status?: IdeaStatus;
  mine?: boolean;
  viewerId: string;
  /** The viewer is an external partner (org GUEST): the list is not shared with them at all (`guest.no_access`). */
  external?: boolean;
  /** Inside a space: its ideas (and in «الشركة» the shared ones). */
  place?: IdeaPlace;
}

export async function listIdeas(orgId: string, filters: ListIdeasFilters): Promise<IdeaDTO[]> {
  // The route and the page refuse a guest first; this is the same rule held where the data is, so a
  // new caller that forgets it still hands a partner nothing (every idea names its author).
  if (filters.external === true) throw new ForbiddenError("guest.no_access");
  const where: Prisma.IdeaWhereInput = { orgId, ...(filters.place ? { AND: [ideaPlaceWhere(filters.place)] } : {}) };
  if (filters.status) where.status = filters.status;
  if (filters.mine) where.creatorId = filters.viewerId;
  const rows = await db.idea.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    include: {
      ...IDEA_INCLUDE,
      organization: { select: { keyPrefix: true } },
    },
  });
  return rows.map((row) => toDTO(row, filters.viewerId, filters.external === true));
}

export interface CreateIdeaInput {
  title: string;
  description?: string | null;
}

/** What an idea sent in through «الباب» (/api/v1) carries beside the text: where it came from and the sender's own reference. */
export interface IdeaDoorExtra {
  source: string;
  externalRef: string | null;
  tags: string[];
  apiTokenId: string;
}

/**
 * An idea is born in the space the person is in. `opts.client`: a transaction the CALLER holds, so the idea is born in the
 * same commit as something else (the door's idempotency record); `opts.extra`: the columns of an idea sent in by another system.
 */
export async function createIdea(
  orgId: string,
  actor: ActorContext,
  input: CreateIdeaInput,
  spaceId: string | null = null,
  opts: { client?: DbClient; extra?: IdeaDoorExtra } = {},
): Promise<IdeaDTO> {
  await assertMemberCan({ orgId, userId: actor.userId }, "ideas.edit", "section.edit_denied");
  const row = await (opts.client ?? db).idea.create({
    data: {
      orgId,
      workspaceId: spaceId,
      creatorId: actor.userId,
      title: input.title,
      description: input.description ?? null,
      ...(opts.extra ? { source: opts.extra.source, externalRef: opts.extra.externalRef, tags: opts.extra.tags, apiTokenId: opts.extra.apiTokenId } : {}),
    },
    include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
  });
  return toDTO(row, actor.userId);
}

/**
 * The idea, if the person may reach it: of their company, and born in a space of theirs — or shared with the company,
 * or from before spaces had ideas (those are everybody's in «الشركة»). Anything else is «not found».
 */
async function assertIdeaScope(ideaId: string, orgId: string, client: DbClient, userId?: string): Promise<
  { id: string; status: IdeaStatus; creatorId: string; taskId: string | null; workspaceId: string | null }
> {
  const row = await client.idea.findFirst({
    where: { id: ideaId, orgId },
    select: { id: true, status: true, creatorId: true, taskId: true, workspaceId: true, sharedAt: true },
  });
  if (!row) throw new NotFoundError("idea.not_found");
  if (userId && row.workspaceId && !row.sharedAt && !(await accessibleWorkspaceIds(userId)).includes(row.workspaceId)) {
    throw new NotFoundError("idea.not_found");
  }
  return row;
}

export async function updateIdea(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
  data: { title?: string; description?: string | null; status?: IdeaStatus },
): Promise<IdeaDTO> {
  // an external partner never writes, not even on an idea they wrote before they were made a guest
  assertCanWrite({ orgRole });
  await assertMemberCan({ orgId, userId: actor.userId }, "ideas.edit", "section.edit_denied");
  return db.$transaction(async (tx) => {
    const idea = await assertIdeaScope(ideaId, orgId, tx, actor.userId);
    const manager = await managesIdea(orgRole, actor.userId, idea.workspaceId, tx);
    const updateData: Prisma.IdeaUpdateInput = {};
    // text edits: author or the managers of its space
    if (data.title !== undefined) {
      if (idea.creatorId !== actor.userId && !manager) {
        throw new ForbiddenError("idea.not_owner");
      }
      if (!data.title.trim()) throw new ForbiddenError("idea.bad_title");
      updateData.title = data.title.trim();
    }
    if (data.description !== undefined) {
      if (idea.creatorId !== actor.userId && !manager) {
        throw new ForbiddenError("idea.not_owner");
      }
      updateData.description = data.description;
    }
    // status changes: the managers of its space only, and along the road
    if (data.status !== undefined && data.status !== idea.status) {
      if (!manager) throw new ForbiddenError("insufficient_role");
      if (!canTransition(idea.status, data.status)) {
        throw new ForbiddenError(`idea.invalid_transition:${idea.status}->${data.status}`);
      }
      updateData.status = data.status;
    }
    const row = await tx.idea.update({
      where: { id: ideaId },
      data: updateData,
      include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
    });
    return toDTO(row, actor.userId);
  });
}

export async function deleteIdea(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
): Promise<void> {
  assertCanWrite({ orgRole });
  await assertMemberCan({ orgId, userId: actor.userId }, "ideas.delete", "section.delete_denied");
  const idea = await assertIdeaScope(ideaId, orgId, db, actor.userId);
  if (idea.creatorId !== actor.userId && !(await managesIdea(orgRole, actor.userId, idea.workspaceId))) {
    throw new ForbiddenError("idea.not_owner");
  }
  await db.idea.delete({ where: { id: ideaId } });
}

/**
 * «شارك مع الشركة» (and taking it back): the idea is read in «الشركة» too. Its author or the managers of its space; an
 * idea with no space is the company's already.
 */
export async function shareIdea(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
  shared: boolean,
): Promise<IdeaDTO> {
  assertCanWrite({ orgRole });
  await assertMemberCan({ orgId, userId: actor.userId }, "ideas.edit", "section.edit_denied");
  const idea = await assertIdeaScope(ideaId, orgId, db, actor.userId);
  if (idea.creatorId !== actor.userId && !(await managesIdea(orgRole, actor.userId, idea.workspaceId))) {
    throw new ForbiddenError("idea.not_owner");
  }
  const row = await db.idea.update({
    where: { id: ideaId },
    data: { sharedAt: shared ? new Date() : null },
    include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
  });
  return toDTO(row, actor.userId);
}

/** Toggle the caller's upvote. Org GUESTs are read-only. */
export async function toggleIdeaVote(
  orgId: string,
  actor: ActorContext,
  ideaId: string,
): Promise<{ voted: boolean }> {
  await assertMemberCan({ orgId, userId: actor.userId }, "ideas.edit", "section.edit_denied");
  const idea = await assertIdeaScope(ideaId, orgId, db, actor.userId);
  const existing = await db.ideaVote.findUnique({
    where: { ideaId_userId: { ideaId: idea.id, userId: actor.userId } },
    select: { id: true },
  });
  if (existing) {
    await db.ideaVote.delete({ where: { id: existing.id } });
    return { voted: false };
  }
  try {
    await db.ideaVote.create({
      data: { orgId, ideaId: idea.id, userId: actor.userId },
    });
    return { voted: true };
  } catch (err) {
    if (
      typeof err === "object" && err !== null && "code" in err &&
      String(err.code) === "P2002"
    ) {
      return { voted: true }; // concurrent double-vote: treat as idempotent
    }
    throw err;
  }
}

/** Turns an idea into a real task through the task service; the idea moves on to planning. */
export async function convertIdeaToTask(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
  target: { workspaceId: string; projectId: string; boardId: string },
): Promise<{ idea: IdeaDTO; taskId: string }> {
  assertCanWrite({ orgRole });
  await assertMemberCan({ orgId, userId: actor.userId }, "ideas.edit", "section.edit_denied");
  const idea = await assertIdeaScope(ideaId, orgId, db, actor.userId);
  if (idea.taskId) throw new ForbiddenError("idea.already_converted");
  if (idea.creatorId !== actor.userId && !(await managesIdea(orgRole, actor.userId, idea.workspaceId))) {
    throw new ForbiddenError("idea.not_owner");
  }
  // the caller must be able to open the TARGET workspace (the same rule every view
  // uses); a workspace that does not exist or is closed to them is refused alike,
  // so the answer never reveals whether an id exists
  const reachable = await accessibleWorkspaceIds(actor.userId);
  if (!reachable.includes(target.workspaceId)) throw new ForbiddenError("not_workspace_member");
  // through the single task service so counter/done/labels rules all apply
  const full = await db.idea.findUniqueOrThrow({
    where: { id: idea.id },
    select: { title: true, description: true },
  });
  const task = await createTask(actor, {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    boardId: target.boardId,
    title: full.title,
    description: full.description ?? undefined,
  });
  // turned into work: it is being planned (an idea already launched stays launched)
  const row = await db.idea.update({
    where: { id: idea.id },
    data: { status: idea.status === "LAUNCHED" ? "LAUNCHED" : "PLANNING", taskId: task.id },
    include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
  });
  return { idea: toDTO(row, actor.userId), taskId: task.id };
}
