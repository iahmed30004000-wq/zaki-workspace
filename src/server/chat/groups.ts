import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { canModerate, isSpaceAdmin, loadOrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { assertPeopleOfSpace, createTopic, createTopicSchema, guardTopic } from "@/server/chat/topics";

/**
 * «مجموعات المواضيع» — Telegram's folder → group → topic. A group is a named, ordered set of the topics of ONE space; a topic is in exactly one group, or in none («عام»).
 *
 *  - A group only ARRANGES. Who may read a topic is still decided by the topic's own rows (`restricted` + `ConversationMember`): that is the one door every chat rule already asks
 *    (the list, the search, the forward sheet, the digest…), so a group never opens a second one.
 *  - A restricted group names its people (`TopicGroupMember`). Its topics are then restricted topics with exactly those people; the group's own row is listed for the OWNER
 *    rank and for them, and nobody else learns it exists (404). Moving a topic OUT of a restricted group leaves it as private as it was: an arrangement never opens anything.
 *  - Making, renaming, ordering, moving: the space's ADMIN and the OWNER rank (like opening a topic). Deleting a group deletes no topic: they fall back to «عام».
 */

export const GROUP_NAME_MAX = 60;

const personIds = z.array(z.string().min(1)).max(200);

export const createGroupSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().trim().min(1, "chat.e.empty").max(GROUP_NAME_MAX, "chat.e.too_long"),
  emoji: z.string().max(16).nullable().optional(),
  restricted: z.boolean().optional(),
  memberIds: personIds.optional(),
  position: z.number().int().min(-100000).max(100000).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1, "chat.e.empty").max(GROUP_NAME_MAX, "chat.e.too_long").optional(),
  emoji: z.string().max(16).nullable().optional(),
  /** the order inside the space: smaller first */
  position: z.number().int().min(-100000).max(100000).optional(),
  restricted: z.boolean().optional(),
  /** with a restricted group: exactly who it is for (the one changing it stays in) */
  memberIds: personIds.optional(),
});

export const groupTopicSchema = createTopicSchema.omit({ spaceId: true, restricted: true, memberIds: true, teamId: true });

export interface GroupDto {
  id: string;
  spaceId: string;
  name: string;
  emoji: string | null;
  /** `/api/avatars/<id>` when the group has a picture (src/server/chat/group-picture.ts), else null: the emoji is drawn */
  imageUrl: string | null;
  position: number;
  restricted: boolean;
  topicCount: number;
  /** only for the people who manage the space */
  memberIds?: string[];
}

interface Viewer {
  owner: boolean;
  /** may arrange this space: the OWNER rank, or its ADMIN */
  manager: boolean;
}

async function viewerIn(ctx: OrgAccessContext, spaceId: string): Promise<Viewer> {
  const [org, row] = await Promise.all([
    loadOrgFacts(ctx.userId, ctx.orgId),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: ctx.userId } }, select: { role: true } }),
  ]);
  const owner = org?.role === "OWNER"; // oversight-ok: arranging a space is management by rank; it reads nothing
  return { owner, manager: owner || isSpaceAdmin(row?.role ?? null) };
}

async function spaceOf(ctx: OrgAccessContext, spaceId: string): Promise<{ id: string }> {
  const space = await db.workspace.findFirst({ where: { id: spaceId, organizationId: ctx.orgId }, select: { id: true } });
  if (!space) throw new NotFoundError("chat.e.not_found");
  return space;
}

type GroupRow = Prisma.TopicGroupGetPayload<{ include: { members: { select: { userId: true } } } }>;

/** Does this viewer know the group exists? An open group: yes. A restricted one: the OWNER rank and its people only. */
function seen(g: GroupRow, v: Viewer, userId: string): boolean {
  return !g.restricted || v.owner || g.members.some((m) => m.userId === userId);
}

/** The group, as far as the viewer may know it: a miss, another company's and a restricted one they are outside of all read the same (404). */
async function loadVisible(ctx: OrgAccessContext, groupId: string): Promise<{ group: GroupRow; viewer: Viewer }> {
  const group = await db.topicGroup.findFirst({ where: { id: groupId, orgId: ctx.orgId }, include: { members: { select: { userId: true } } } });
  if (!group) throw new NotFoundError("chat.e.not_found");
  const viewer = await viewerIn(ctx, group.spaceId);
  if (!seen(group, viewer, ctx.userId)) throw new NotFoundError("chat.e.not_found");
  return { group, viewer };
}

export async function loadManaged(ctx: OrgAccessContext, groupId: string): Promise<GroupRow> {
  const { group, viewer } = await loadVisible(ctx, groupId);
  if (!viewer.manager) throw new ForbiddenError("chat.e.moderator_only");
  return group;
}

async function audit(ctx: OrgAccessContext, action: string, groupId: string, workspaceId: string, meta: Prisma.InputJsonValue): Promise<void> {
  await db.auditLog.create({ data: { action, actorId: ctx.userId, orgId: ctx.orgId, target: groupId, workspaceId, meta } });
}

const dto = (g: GroupRow, topicCount: number, withPeople: boolean): GroupDto => ({
  id: g.id,
  spaceId: g.spaceId,
  name: g.name,
  emoji: g.emoji,
  imageUrl: g.imageUrl,
  position: g.position,
  restricted: g.restricted,
  topicCount,
  ...(withPeople ? { memberIds: g.members.map((m) => m.userId) } : {}),
});

/** The people of a restricted group: the ones named, and the one arranging (who stays in). */
function peopleOf(named: readonly string[] | undefined, actorId: string): string[] {
  return [...new Set([...(named ?? []), actorId])];
}

/** Restricts every topic of the group to exactly these people (the one door of «من يقدر يقرأ»). */
async function restrictTopics(tx: Prisma.TransactionClient, groupId: string, people: readonly string[]): Promise<void> {
  const topics = await tx.conversation.findMany({ where: { groupId }, select: { id: true } });
  const ids = topics.map((t) => t.id);
  if (!ids.length) return;
  await tx.conversation.updateMany({ where: { id: { in: ids } }, data: { restricted: true } });
  await tx.conversationMember.deleteMany({ where: { conversationId: { in: ids }, userId: { notIn: [...people] } } });
  await tx.conversationMember.createMany({ data: ids.flatMap((conversationId) => people.map((userId) => ({ conversationId, userId }))), skipDuplicates: true });
}

// ───────────────────────────────────────── groups ─────────────────────────────────────────

export async function listGroups(ctx: OrgAccessContext, spaceId: string): Promise<GroupDto[]> {
  await spaceOf(ctx, spaceId);
  const viewer = await viewerIn(ctx, spaceId);
  // somebody who is not in the space knows nothing of its arrangement
  const inSpace = viewer.owner || (await db.workspaceMember.count({ where: { workspaceId: spaceId, userId: ctx.userId } })) > 0;
  if (!inSpace) throw new NotFoundError("chat.e.not_found");
  const rows = await db.topicGroup.findMany({ where: { spaceId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { members: { select: { userId: true } } } });
  const visible = rows.filter((g) => seen(g, viewer, ctx.userId));
  const counts = await db.conversation.groupBy({ by: ["groupId"], where: { groupId: { in: visible.map((g) => g.id) } }, _count: { _all: true } });
  const countOf = new Map(counts.map((c) => [c.groupId, c._count._all]));
  return visible.map((g) => dto(g, countOf.get(g.id) ?? 0, viewer.manager));
}

export async function createGroup(ctx: OrgAccessContext, input: z.infer<typeof createGroupSchema>): Promise<GroupDto> {
  await spaceOf(ctx, input.spaceId);
  const viewer = await viewerIn(ctx, input.spaceId);
  if (!viewer.manager) throw new ForbiddenError("chat.e.moderator_only");
  const restricted = input.restricted ?? false;
  const people = restricted ? peopleOf(input.memberIds, ctx.userId) : [];
  await assertPeopleOfSpace(ctx.orgId, input.spaceId, people.filter((id) => id !== ctx.userId));
  // a new group goes to the end unless the caller placed it
  const last = await db.topicGroup.aggregate({ where: { spaceId: input.spaceId }, _max: { position: true } });
  const group = await db.$transaction(async (tx) => {
    const g = await tx.topicGroup.create({
      data: {
        orgId: ctx.orgId,
        spaceId: input.spaceId,
        name: input.name,
        emoji: input.emoji ?? null,
        restricted,
        position: input.position ?? (last._max.position === null ? 0 : last._max.position + 1),
        members: { create: people.map((userId) => ({ userId })) },
      },
      include: { members: { select: { userId: true } } },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: input.spaceId });
    return g;
  });
  await audit(ctx, "chat.group.create", group.id, input.spaceId, { name: group.name, restricted });
  return dto(group, 0, true);
}

export async function updateGroup(ctx: OrgAccessContext, groupId: string, input: z.infer<typeof updateGroupSchema>): Promise<GroupDto> {
  const group = await loadManaged(ctx, groupId);
  const restricted = input.restricted ?? group.restricted;
  const people = restricted ? peopleOf(input.memberIds ?? (group.restricted ? group.members.map((m) => m.userId) : undefined), ctx.userId) : [];
  if (restricted) await assertPeopleOfSpace(ctx.orgId, group.spaceId, people.filter((id) => id !== ctx.userId));
  const changedPeople = restricted && (input.memberIds !== undefined || !group.restricted);
  const out = await db.$transaction(async (tx) => {
    await tx.topicGroup.update({
      where: { id: groupId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.emoji !== undefined ? { emoji: input.emoji } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.restricted !== undefined ? { restricted: input.restricted } : {}),
      },
    });
    if (changedPeople) {
      await tx.topicGroupMember.deleteMany({ where: { groupId, userId: { notIn: people } } });
      await tx.topicGroupMember.createMany({ data: people.map((userId) => ({ groupId, userId })), skipDuplicates: true });
      await restrictTopics(tx, groupId, people);
    }
    // an open group has no people list of its own: the rows go, the topics keep whatever they were
    if (!restricted) await tx.topicGroupMember.deleteMany({ where: { groupId } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: group.spaceId });
    return tx.topicGroup.findUniqueOrThrow({ where: { id: groupId }, include: { members: { select: { userId: true } } } });
  });
  await audit(ctx, "chat.group.update", groupId, group.spaceId, { fields: Object.keys(input) });
  const topicCount = await db.conversation.count({ where: { groupId } });
  return dto(out, topicCount, true);
}

export async function deleteGroup(ctx: OrgAccessContext, groupId: string): Promise<void> {
  const group = await loadManaged(ctx, groupId);
  await db.$transaction(async (tx) => {
    // the topics fall back to «عام» (the column is SET NULL): none is deleted, none changes but its group
    await tx.topicGroup.delete({ where: { id: groupId } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: group.spaceId });
  });
  await audit(ctx, "chat.group.delete", groupId, group.spaceId, { name: group.name });
}

// ───────────────────────────────────────── topics in a group ─────────────────────────────────────────

/** What putting a topic in `groupId` asks of the topic, decided BEFORE the write: the group must be of the topic's own space and one the person knows. */
export interface Placement {
  groupId: string | null;
  /** a restricted group: the topic becomes restricted to exactly these people */
  restrictTo: string[] | null;
}

export async function resolvePlacement(ctx: OrgAccessContext, spaceId: string, groupId: string | null): Promise<Placement> {
  if (groupId === null) return { groupId: null, restrictTo: null };
  const { group, viewer } = await loadVisible(ctx, groupId);
  // another space's group reads as a miss: a topic never leaves its space by being arranged
  if (group.spaceId !== spaceId) throw new NotFoundError("chat.e.not_found");
  if (!viewer.manager) throw new ForbiddenError("chat.e.moderator_only");
  // the one arranging stays in what they arrange (like changing a topic's people)
  return { groupId: group.id, restrictTo: group.restricted ? [...new Set([...group.members.map((m) => m.userId), ctx.userId])] : null };
}

/** The writes of a placement, inside the caller's transaction. */
export async function applyPlacement(tx: Prisma.TransactionClient, conversationId: string, placement: Placement): Promise<void> {
  await tx.conversation.update({ where: { id: conversationId }, data: { groupId: placement.groupId, ...(placement.restrictTo ? { restricted: true } : {}) } });
  if (placement.restrictTo) {
    await tx.conversationMember.deleteMany({ where: { conversationId, userId: { notIn: placement.restrictTo } } });
    await tx.conversationMember.createMany({ data: placement.restrictTo.map((userId) => ({ conversationId, userId })), skipDuplicates: true });
  }
}

/** A new topic inside a group: born for the group's people when the group is restricted. */
export async function createTopicInGroup(ctx: OrgAccessContext, groupId: string, input: z.infer<typeof groupTopicSchema>): Promise<{ id: string }> {
  const { group } = await loadVisible(ctx, groupId);
  const placement = await resolvePlacement(ctx, group.spaceId, groupId);
  const made = await createTopic(ctx, {
    ...input,
    spaceId: group.spaceId,
    ...(placement.restrictTo ? { restricted: true, memberIds: placement.restrictTo.filter((id) => id !== ctx.userId) } : {}),
  });
  await db.$transaction((tx) => applyPlacement(tx, made.id, placement));
  await audit(ctx, "chat.group.topic", groupId, group.spaceId, { topicId: made.id });
  return made;
}

/** «نقل إلى مجموعة»: the topic goes to one group of its own space, or (null) back to «عام». Only the topic's moderators; nothing of the topic but its group changes. */
export async function moveTopicToGroup(ctx: OrgAccessContext, conversationId: string, groupId: string | null): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  if (!facts.spaceId) throw new NotFoundError("chat.e.not_found");
  const placement = await resolvePlacement(ctx, facts.spaceId, groupId);
  await db.$transaction(async (tx) => {
    await applyPlacement(tx, conversationId, placement);
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
  await audit(ctx, "chat.topic.group", groupId ?? conversationId, facts.spaceId, { topicId: conversationId, groupId });
}

export const reorderGroupsSchema = z.object({
  spaceId: z.string().min(1),
  /** the groups of the space in the order they should have: the ones named come first in that order, the others keep their order after them */
  order: z.array(z.string().min(1)).max(200),
});

/** Dragging the groups: `position` becomes the place in the list sent. Only for the people who arrange the space; a group the viewer does not know is never touched. */
export async function reorderGroups(ctx: OrgAccessContext, input: z.infer<typeof reorderGroupsSchema>): Promise<GroupDto[]> {
  await spaceOf(ctx, input.spaceId);
  const viewer = await viewerIn(ctx, input.spaceId);
  if (!viewer.manager) throw new ForbiddenError("chat.e.moderator_only");
  const rows = await db.topicGroup.findMany({ where: { spaceId: input.spaceId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { members: { select: { userId: true } } } });
  const mine = rows.filter((g) => seen(g, viewer, ctx.userId));
  const named = [...new Set(input.order)].filter((id) => mine.some((g) => g.id === id));
  const rest = mine.map((g) => g.id).filter((id) => !named.includes(id));
  const final = [...named, ...rest];
  await db.$transaction(async (tx) => {
    for (const [position, id] of final.entries()) await tx.topicGroup.update({ where: { id }, data: { position } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: input.spaceId });
  });
  await audit(ctx, "chat.group.order", input.spaceId, input.spaceId, { order: final });
  return listGroups(ctx, input.spaceId);
}
